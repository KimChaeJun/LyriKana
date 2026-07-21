from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from app.config import settings
from app.services.analysis_adapters import SudachiReadingCandidateGenerator
from app.services.karaoke_pipeline import normalize_lyrics_for_analysis


@dataclass(frozen=True)
class PhoneBoundary:
    phoneme: str
    start: float
    end: float


_SILENCE_PHONES = {"", "sil", "pau", "sp", "br", "silb", "sile"}


def _normalized_phone(value: str) -> str:
    phone = value.strip()
    if phone in {"q", "Q"}:
        return "cl"
    if phone == "N":
        return "N"
    return phone.casefold()


def parse_htk_labels(path: Path) -> list[PhoneBoundary]:
    boundaries: list[PhoneBoundary] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) < 3:
            continue
        phone = _normalized_phone(parts[2])
        if phone in _SILENCE_PHONES:
            continue
        boundaries.append(
            PhoneBoundary(
                phoneme=phone,
                start=int(parts[0]) / 10_000_000,
                end=int(parts[1]) / 10_000_000,
            )
        )
    return boundaries


def _matched_indices(
    predicted: Sequence[PhoneBoundary], reference: Sequence[PhoneBoundary]
) -> list[tuple[int, int]]:
    rows = len(predicted) + 1
    columns = len(reference) + 1
    costs = [[0] * columns for _ in range(rows)]
    directions = [[""] * columns for _ in range(rows)]
    for row in range(1, rows):
        costs[row][0] = row
        directions[row][0] = "delete"
    for column in range(1, columns):
        costs[0][column] = column
        directions[0][column] = "insert"
    for row in range(1, rows):
        for column in range(1, columns):
            same = predicted[row - 1].phoneme == reference[column - 1].phoneme
            choices = (
                (costs[row - 1][column - 1] + (0 if same else 1), "match"),
                (costs[row - 1][column] + 1, "delete"),
                (costs[row][column - 1] + 1, "insert"),
            )
            costs[row][column], directions[row][column] = min(
                choices, key=lambda item: item[0]
            )
    matches: list[tuple[int, int]] = []
    row, column = len(predicted), len(reference)
    while row or column:
        direction = directions[row][column]
        if direction == "match":
            if predicted[row - 1].phoneme == reference[column - 1].phoneme:
                matches.append((row - 1, column - 1))
            row -= 1
            column -= 1
        elif direction == "delete":
            row -= 1
        else:
            column -= 1
    matches.reverse()
    return matches


def score_boundaries(
    predicted: Sequence[PhoneBoundary], reference: Sequence[PhoneBoundary]
) -> dict:
    matches = _matched_indices(predicted, reference)
    if not matches:
        raise ValueError("benchmark_has_no_matching_phonemes")
    errors = [
        abs(predicted[predicted_index].start - reference[reference_index].start)
        for predicted_index, reference_index in matches
    ] + [
        abs(predicted[predicted_index].end - reference[reference_index].end)
        for predicted_index, reference_index in matches
    ]
    return {
        "matchedPhones": len(matches),
        "predictedPhones": len(predicted),
        "referencePhones": len(reference),
        "phoneCoverage": round(len(matches) / max(1, len(reference)), 4),
        "boundaryMaeMs": round(sum(errors) / len(errors) * 1000, 3),
        "boundaryWithin50Ms": round(
            sum(error <= 0.05 for error in errors) / len(errors), 4
        ),
        "boundaryWithin100Ms": round(
            sum(error <= 0.1 for error in errors) / len(errors), 4
        ),
    }


def _build_request(lyrics: str) -> dict:
    candidates = SudachiReadingCandidateGenerator().generate(
        normalize_lyrics_for_analysis(lyrics)
    )
    return {
        "schemaVersion": 1,
        "candidates": [
            {
                "lineNo": item.line_no,
                "surface": item.surface,
                "surfaceStart": item.surface_start,
                "surfaceEnd": item.surface_end,
                "reading": item.reading,
                "spokenReading": item.spoken_reading,
                "source": item.source,
                "priorScore": item.score,
            }
            for item in candidates
        ],
    }


def run_benchmark(*, audio_path: Path, labels_path: Path, lyrics: str) -> dict:
    settings.analysis_data_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix="lyrikana-alignment-benchmark-", dir=settings.analysis_data_dir
    ) as temporary:
        root = Path(temporary)
        request_path = root / "request.json"
        output_path = root / "result.json"
        request_path.write_text(
            json.dumps(_build_request(lyrics), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        command = [
            str(settings.analysis_ctc_python),
            str(settings.analysis_ctc_script),
            "--audio",
            str(audio_path),
            "--request",
            str(request_path),
            "--output",
            str(output_path),
            "--model",
            settings.analysis_ctc_model,
            "--cache-dir",
            str(settings.analysis_ctc_cache_dir),
            "--device",
            settings.analysis_device,
            "--max-paths",
            str(settings.analysis_ctc_max_paths),
            "--chunk-seconds",
            str(settings.analysis_ctc_chunk_seconds),
        ]
        environment = os.environ.copy()
        environment["HF_HOME"] = str(settings.analysis_ctc_cache_dir)
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
            timeout=settings.analysis_command_timeout_seconds,
            env=environment,
        )
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "").strip()[-4000:]
            raise RuntimeError(f"alignment_benchmark_failed:{detail}")
        payload = json.loads(output_path.read_text(encoding="utf-8"))
        predicted = [
            PhoneBoundary(
                phoneme=_normalized_phone(str(item["phoneme"])),
                start=float(item["startTime"]),
                end=float(item["endTime"]),
            )
            for item in payload.get("phonemes", [])
            if _normalized_phone(str(item.get("phoneme", "")))
            not in _SILENCE_PHONES
        ]
        scored = score_boundaries(predicted, parse_htk_labels(labels_path))
        return {
            "status": "ok",
            "audio": audio_path.name,
            "labels": labels_path.name,
            **scored,
            "diagnostics": payload.get("diagnostics", {}),
        }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Benchmark the Japanese CTC aligner against HTK phone labels"
    )
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--lyrics", required=True)
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()
    result = run_benchmark(
        audio_path=arguments.audio,
        labels_path=arguments.labels,
        lyrics=arguments.lyrics,
    )
    rendered = json.dumps(result, ensure_ascii=False, indent=2)
    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)


if __name__ == "__main__":
    main()
