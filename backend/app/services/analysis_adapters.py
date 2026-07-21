from __future__ import annotations

import importlib.util
import json
import os
import shlex
import shutil
import subprocess
import sys
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from sudachipy import dictionary, tokenizer

from app.config import Settings
from app.services.karaoke_pipeline import (
    AlignedUnit,
    ForcedAligner,
    LineSegmenter,
    NormalizedLyrics,
    PipelineComponents,
    ReadingCandidate,
    ReadingCandidateGenerator,
    VocalSeparator,
    normalize_lyrics_for_analysis,
)


class AnalysisAdapterError(RuntimeError):
    pass


def _run_checked(
    command: list[str],
    *,
    timeout: float,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
) -> None:
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            creationflags=creationflags,
            env=env,
        )
    except FileNotFoundError as error:
        raise AnalysisAdapterError(f"command_not_found:{command[0]}") from error
    except subprocess.TimeoutExpired as error:
        raise AnalysisAdapterError(f"command_timeout:{command[0]}") from error
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()[-2000:]
        raise AnalysisAdapterError(
            f"command_failed:{Path(command[0]).name}:{result.returncode}:{detail}"
        )


class PassthroughVocalSeparator:
    name = "passthrough"

    def separate(self, audio_path: Path, work_dir: Path) -> Path:
        del work_dir
        return audio_path


class AudioSeparatorVocalSeparator:
    name = "audio_separator"

    def __init__(
        self,
        *,
        command: str,
        model: str | None,
        model_dir: Path,
        ffmpeg_dir: Path,
        device: str,
        timeout: float,
    ) -> None:
        self.command = command
        self.model = model
        self.model_dir = model_dir
        self.ffmpeg_dir = ffmpeg_dir
        self.device = device
        self.timeout = timeout

    def separate(self, audio_path: Path, work_dir: Path) -> Path:
        output_dir = work_dir / "separated"
        output_dir.mkdir(parents=True, exist_ok=True)
        self.model_dir.mkdir(parents=True, exist_ok=True)
        command = [
            self.command,
            str(audio_path),
            "--output_dir",
            str(output_dir),
            "--model_file_dir",
            str(self.model_dir),
            "--output_format",
            "WAV",
            "--single_stem",
            "Vocals",
            "--custom_output_names",
            '{"Vocals":"vocals"}',
        ]
        if self.model:
            command.extend(["-m", self.model])
        if self.device == "cuda" and not (self.model or "").casefold().endswith(".onnx"):
            command.append("--use_autocast")
        environment = os.environ.copy()
        environment["AUDIO_SEPARATOR_MODEL_DIR"] = str(self.model_dir)
        if self.ffmpeg_dir.is_dir():
            environment["PATH"] = str(self.ffmpeg_dir) + os.pathsep + environment.get("PATH", "")
        _run_checked(command, timeout=self.timeout, env=environment)
        preferred = output_dir / "vocals.wav"
        if preferred.is_file():
            return preferred
        candidates = sorted(
            path
            for path in output_dir.rglob("*.wav")
            if "vocal" in path.stem.casefold()
        )
        if not candidates:
            raise AnalysisAdapterError("vocal_stem_not_created")
        return candidates[0]


class DemucsVocalSeparator:
    name = "demucs"

    def __init__(self, *, model: str, device: str, timeout: float) -> None:
        self.model = model
        self.device = device
        self.timeout = timeout

    def separate(self, audio_path: Path, work_dir: Path) -> Path:
        output_dir = work_dir / "separated"
        output_dir.mkdir(parents=True, exist_ok=True)
        command = [
            sys.executable,
            "-m",
            "demucs",
            "--two-stems=vocals",
            "-n",
            self.model,
            "-o",
            str(output_dir),
            "-d",
            self.device,
            str(audio_path),
        ]
        _run_checked(command, timeout=self.timeout)
        candidates = sorted(output_dir.rglob("vocals.wav"))
        if not candidates:
            raise AnalysisAdapterError("vocal_stem_not_created")
        return candidates[0]


def _katakana_to_hiragana(value: str) -> str:
    return "".join(
        chr(ord(character) - 0x60)
        if "ァ" <= character <= "ヶ"
        else character
        for character in value
    )


_JAPANESE_DIGITS = {
    "0": "ぜろ",
    "1": "いち",
    "2": "に",
    "3": "さん",
    "4": "よん",
    "5": "ご",
    "6": "ろく",
    "7": "なな",
    "8": "はち",
    "9": "きゅう",
}
_ENGLISH_DIGITS = {
    "0": "ぜろ",
    "1": "わん",
    "2": "つー",
    "3": "すりー",
    "4": "ふぉー",
    "5": "ふぁいぶ",
    "6": "しっくす",
    "7": "せぶん",
    "8": "えいと",
    "9": "ないん",
}
_ENGLISH_TEENS = {
    10: "てん",
    11: "いれぶん",
    12: "とぅえるぶ",
    13: "さーてぃーん",
    14: "ふぉーてぃーん",
    15: "ふぃふてぃーん",
    16: "しっくすてぃーん",
    17: "せぶんてぃーん",
    18: "えいてぃーん",
    19: "ないんてぃーん",
}
_ENGLISH_TENS = {
    2: "とぅえんてぃー",
    3: "さーてぃー",
    4: "ふぉーてぃー",
    5: "ふぃふてぃー",
    6: "しっくすてぃー",
    7: "せぶんてぃー",
    8: "えいてぃー",
    9: "ないんてぃー",
}


def _english_number_under_100(value: int) -> str:
    if value < 10:
        return _ENGLISH_DIGITS[str(value)]
    if value < 20:
        return _ENGLISH_TEENS[value]
    tens, units = divmod(value, 10)
    return _ENGLISH_TENS[tens] + (_ENGLISH_DIGITS[str(units)] if units else "")


def numeric_reading_variants(surface: str) -> tuple[tuple[str, str, float], ...]:
    if not surface.isascii() or not surface.isdigit():
        return ()
    variants: list[tuple[str, str, float]] = [
        ("numeric_japanese_digits", "".join(_JAPANESE_DIGITS[item] for item in surface), 0.8),
        ("numeric_english_digits", "".join(_ENGLISH_DIGITS[item] for item in surface), 0.76),
    ]
    if len(surface) == 4:
        first, second = int(surface[:2]), int(surface[2:])
        variants.append(
            (
                "numeric_english_year",
                _english_number_under_100(first) + _english_number_under_100(second),
                0.86,
            )
        )
    return tuple(variants)


class SudachiReadingCandidateGenerator:
    name = "sudachi"

    def __init__(self) -> None:
        self._tokenizer = dictionary.Dictionary().create()

    def generate(self, lyrics: NormalizedLyrics) -> Sequence[ReadingCandidate]:
        candidates: list[ReadingCandidate] = []
        for line_no, original_line in enumerate(lyrics.original.splitlines()):
            normalized_line = normalize_lyrics_for_analysis(original_line)
            cursor = 0
            for morpheme in self._tokenizer.tokenize(
                normalized_line.analysis_text, tokenizer.Tokenizer.SplitMode.C
            ):
                surface = morpheme.surface()
                if not surface.strip() or all(
                    unicodedata.category(character)[0] in {"P", "S", "Z"}
                    for character in surface
                ):
                    continue
                analysis_start = normalized_line.analysis_text.find(surface, cursor)
                if analysis_start < 0:
                    analysis_start = cursor
                analysis_end = min(
                    len(normalized_line.analysis_text), analysis_start + len(surface)
                )
                cursor = analysis_end
                surface_start = (
                    normalized_line.analysis_to_original[analysis_start]
                    if normalized_line.analysis_to_original and analysis_start < len(normalized_line.analysis_to_original)
                    else None
                )
                surface_end = (
                    normalized_line.analysis_to_original[analysis_end - 1] + 1
                    if normalized_line.analysis_to_original and analysis_end > analysis_start
                    else surface_start
                )
                reading = _katakana_to_hiragana(morpheme.reading_form() or surface)
                spoken_reading = None
                pos = morpheme.part_of_speech()
                if pos and pos[0] == "助詞":
                    spoken_reading = {"は": "わ", "へ": "え", "を": "お"}.get(surface)
                candidates.append(
                    ReadingCandidate(
                        surface=surface,
                        reading=reading,
                        source="sudachi",
                        score=1.0,
                        line_no=line_no,
                        surface_start=surface_start,
                        surface_end=surface_end,
                        spoken_reading=spoken_reading,
                        reasons=("particle_pronunciation",) if spoken_reading else (),
                    )
                )
                seen = {reading, spoken_reading}
                for source, variant, score in numeric_reading_variants(surface):
                    if variant in seen:
                        continue
                    seen.add(variant)
                    candidates.append(
                        ReadingCandidate(
                            surface=surface,
                            reading=variant,
                            source=source,
                            score=score,
                            line_no=line_no,
                            surface_start=surface_start,
                            surface_end=surface_end,
                            reasons=("numeric_pronunciation_variant",),
                        )
                    )
        return candidates


def _candidate_key(candidate: ReadingCandidate) -> tuple[int, int, int, str]:
    return (
        candidate.line_no,
        candidate.surface_start if candidate.surface_start is not None else -1,
        candidate.surface_end if candidate.surface_end is not None else -1,
        candidate.surface,
    )


def _top_candidates(candidates: Sequence[ReadingCandidate]) -> list[ReadingCandidate]:
    grouped: dict[tuple[int, int, int, str], list[ReadingCandidate]] = defaultdict(list)
    for candidate in candidates:
        grouped[_candidate_key(candidate)].append(candidate)
    return [
        max(group, key=lambda item: item.score)
        for _key, group in sorted(grouped.items(), key=lambda item: item[0])
    ]


class TimedLyricsForcedAligner:
    """Deterministic baseline used when no acoustic aligner is available."""

    name = "timed_lyrics"

    def __init__(self, line_timings: dict[int, tuple[float | None, float | None]]) -> None:
        self.line_timings = line_timings

    def align(
        self, vocal_path: Path, candidates: Sequence[ReadingCandidate]
    ) -> Sequence[AlignedUnit]:
        del vocal_path
        selected = _top_candidates(candidates)
        by_line: dict[int, list[ReadingCandidate]] = defaultdict(list)
        for candidate in selected:
            by_line[candidate.line_no].append(candidate)

        units: list[AlignedUnit] = []
        synthetic_cursor = 0.0
        for line_no in sorted(by_line):
            line_candidates = by_line[line_no]
            configured_start, configured_end = self.line_timings.get(line_no, (None, None))
            synthetic = configured_start is None
            start = configured_start if configured_start is not None else synthetic_cursor
            end = configured_end if configured_end is not None else start + 4.0
            if end <= start:
                end = start + 0.25
            synthetic_cursor = end
            weights = [
                max(1, len(candidate.spoken_reading or candidate.reading))
                for candidate in line_candidates
            ]
            total_weight = max(1, sum(weights))
            cursor = start
            for index, (candidate, weight) in enumerate(zip(line_candidates, weights)):
                unit_end = end if index == len(line_candidates) - 1 else (
                    cursor + ((end - start) * weight / total_weight)
                )
                units.append(
                    AlignedUnit(
                        surface=candidate.surface,
                        reading=candidate.spoken_reading or candidate.reading,
                        phoneme=None,
                        start_time=cursor,
                        end_time=unit_end,
                        confidence=0.12 if synthetic else 0.4,
                        line_no=line_no,
                        unit_type="token",
                        source="synthetic_timing" if synthetic else "timed_lyrics",
                    )
                )
                cursor = unit_end
        return units


def _split_command_template(value: str) -> list[str]:
    if value.lstrip().startswith("["):
        parsed = json.loads(value)
        if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
            raise AnalysisAdapterError("aligner_command_must_be_string_array")
        return parsed
    parts = shlex.split(value, posix=os.name != "nt")
    return [
        item[1:-1] if len(item) >= 2 and item[0] == item[-1] and item[0] in {'"', "'"} else item
        for item in parts
    ]


class JsonCommandForcedAligner:
    """Adapter contract for singing-specific aligners without importing them into the API."""

    name = "external_json"

    def __init__(self, *, command_template: str, work_dir: Path, timeout: float) -> None:
        self.command_template = command_template
        self.work_dir = work_dir
        self.timeout = timeout

    def align(
        self, vocal_path: Path, candidates: Sequence[ReadingCandidate]
    ) -> Sequence[AlignedUnit]:
        aligner_dir = self.work_dir / "external-aligner"
        aligner_dir.mkdir(parents=True, exist_ok=True)
        request_path = aligner_dir / "request.json"
        output_path = aligner_dir / "result.json"
        request_path.write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "audioPath": str(vocal_path),
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
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        replacements = {
            "{audio}": str(vocal_path),
            "{request}": str(request_path),
            "{output}": str(output_path),
        }
        template_parts = _split_command_template(self.command_template)
        missing_placeholders = [
            marker
            for marker in replacements
            if not any(marker in part for part in template_parts)
        ]
        if missing_placeholders:
            raise AnalysisAdapterError(
                "aligner_command_missing_placeholders:" + ",".join(missing_placeholders)
            )
        command = []
        for part in template_parts:
            for marker, value in replacements.items():
                part = part.replace(marker, value)
            command.append(part)
        if not command:
            raise AnalysisAdapterError("aligner_command_empty")
        _run_checked(command, timeout=self.timeout, cwd=aligner_dir)
        if not output_path.is_file():
            raise AnalysisAdapterError("aligner_output_not_created")
        return _parse_external_units(json.loads(output_path.read_text(encoding="utf-8")))


class JapaneseCtcForcedAligner:
    """Japanese phoneme CTC baseline isolated in the analysis environment."""

    name = "japanese_ctc"

    def __init__(
        self,
        *,
        python: Path,
        script: Path,
        model: str,
        cache_dir: Path,
        device: str,
        max_paths: int,
        chunk_seconds: float,
        work_dir: Path,
        timeout: float,
    ) -> None:
        command_template = json.dumps(
            [
                str(python),
                str(script),
                "--audio",
                "{audio}",
                "--request",
                "{request}",
                "--output",
                "{output}",
                "--model",
                model,
                "--cache-dir",
                str(cache_dir),
                "--device",
                device,
                "--max-paths",
                str(max_paths),
                "--chunk-seconds",
                str(chunk_seconds),
            ]
        )
        self.delegate = JsonCommandForcedAligner(
            command_template=command_template,
            work_dir=work_dir,
            timeout=timeout,
        )

    def align(
        self, vocal_path: Path, candidates: Sequence[ReadingCandidate]
    ) -> Sequence[AlignedUnit]:
        return self.delegate.align(vocal_path, candidates)


def _parse_external_units(payload: object) -> list[AlignedUnit]:
    if not isinstance(payload, dict) or not isinstance(payload.get("units"), list):
        raise AnalysisAdapterError("invalid_aligner_output")
    units: list[AlignedUnit] = []
    for raw in payload["units"]:
        if not isinstance(raw, dict):
            raise AnalysisAdapterError("invalid_aligner_unit")
        try:
            start = float(raw["startTime"])
            end = float(raw["endTime"])
            confidence = min(1.0, max(0.0, float(raw.get("confidence", 0.0))))
            if end <= start:
                raise ValueError
            units.append(
                AlignedUnit(
                    surface=str(raw["surface"]),
                    reading=str(raw["reading"]),
                    phoneme=str(raw["phoneme"]) if raw.get("phoneme") else None,
                    start_time=start,
                    end_time=end,
                    confidence=confidence,
                    line_no=int(raw["lineNo"]),
                    unit_type=str(raw.get("unitType", "mora")),
                    source=str(raw.get("source", "external_json")),
                    acoustic_score=(
                        float(raw["acousticScore"])
                        if raw.get("acousticScore") is not None
                        else None
                    ),
                )
            )
        except (KeyError, TypeError, ValueError) as error:
            raise AnalysisAdapterError("invalid_aligner_unit") from error
    if not units:
        raise AnalysisAdapterError("aligner_returned_no_units")
    return units


class MfaForcedAligner:
    name = "mfa"

    def __init__(
        self,
        *,
        command: str,
        dictionary_name: str,
        acoustic_model: str,
        g2p_model: str | None,
        work_dir: Path,
        timeout: float,
    ) -> None:
        self.command = command
        self.dictionary_name = dictionary_name
        self.acoustic_model = acoustic_model
        self.g2p_model = g2p_model
        self.work_dir = work_dir
        self.timeout = timeout

    def align(
        self, vocal_path: Path, candidates: Sequence[ReadingCandidate]
    ) -> Sequence[AlignedUnit]:
        selected = _top_candidates(candidates)
        if not selected:
            raise AnalysisAdapterError("lyrics_have_no_alignable_tokens")
        mfa_dir = self.work_dir / "mfa"
        mfa_dir.mkdir(parents=True, exist_ok=True)
        transcript_path = mfa_dir / "transcript.txt"
        output_path = mfa_dir / "alignment.json"
        transcript_path.write_text(
            " ".join(item.surface for item in selected), encoding="utf-8"
        )
        command = [
            self.command,
            "align_one",
            str(vocal_path),
            str(transcript_path),
            self.dictionary_name,
            self.acoustic_model,
            str(output_path),
            "--output_format",
            "json",
            "--clean",
            "--overwrite",
            "--single_speaker",
        ]
        if self.g2p_model:
            command.extend(["--g2p_model_path", self.g2p_model])
        _run_checked(command, timeout=self.timeout, cwd=mfa_dir)
        if not output_path.is_file():
            raise AnalysisAdapterError("mfa_output_not_created")
        payload = json.loads(output_path.read_text(encoding="utf-8"))
        tiers = payload.get("tiers", {}) if isinstance(payload, dict) else {}
        word_entries = _tier_entries(tiers, "word")
        phone_entries = _tier_entries(tiers, "phone")
        word_entries = [item for item in word_entries if str(item[2]).strip()]
        if len(word_entries) < len(selected):
            raise AnalysisAdapterError(
                f"mfa_word_count_mismatch:{len(word_entries)}:{len(selected)}"
            )
        units: list[AlignedUnit] = []
        for candidate, entry in zip(selected, word_entries):
            start, end, label = float(entry[0]), float(entry[1]), str(entry[2])
            phones = [
                str(phone[2])
                for phone in phone_entries
                if float(phone[0]) >= start - 0.001
                and float(phone[1]) <= end + 0.001
                and str(phone[2]).strip()
            ]
            exact = unicodedata.normalize("NFKC", label).casefold() == unicodedata.normalize(
                "NFKC", candidate.surface
            ).casefold()
            units.append(
                AlignedUnit(
                    surface=candidate.surface,
                    reading=candidate.spoken_reading or candidate.reading,
                    phoneme=" ".join(phones) or None,
                    start_time=start,
                    end_time=end,
                    confidence=0.65 if exact else 0.45,
                    line_no=candidate.line_no,
                    unit_type="token",
                    source="mfa",
                )
            )
        return units


def _tier_entries(tiers: object, kind: str) -> list[list[object]]:
    if not isinstance(tiers, dict):
        return []
    for name, tier in tiers.items():
        if kind in str(name).casefold() and isinstance(tier, dict):
            entries = tier.get("entries")
            if isinstance(entries, list):
                return [entry for entry in entries if isinstance(entry, list) and len(entry) >= 3]
    return []


class LineNumberSegmenter:
    name = "line_number"

    def segment(self, units: Sequence[AlignedUnit]) -> Sequence[Sequence[AlignedUnit]]:
        grouped: dict[int, list[AlignedUnit]] = defaultdict(list)
        for unit in units:
            grouped[unit.line_no].append(unit)
        return [
            sorted(grouped[line_no], key=lambda item: (item.start_time, item.end_time))
            for line_no in sorted(grouped)
        ]


@dataclass(frozen=True)
class AdapterSelection:
    components: PipelineComponents
    separator_name: str
    aligner_name: str


def _command_exists(command: str) -> bool:
    path = Path(command)
    return path.is_file() if path.parent != Path(".") else shutil.which(command) is not None


def select_adapters(
    *,
    configuration: Settings,
    work_dir: Path,
    line_timings: dict[int, tuple[float | None, float | None]],
    requested_aligner: str | None,
) -> AdapterSelection:
    separator_choice = configuration.analysis_separator
    separator: VocalSeparator
    if separator_choice in {"auto", "audio_separator"} and _command_exists(
        configuration.analysis_separator_command
    ):
        separator = AudioSeparatorVocalSeparator(
            command=configuration.analysis_separator_command,
            model=configuration.analysis_separator_model,
            model_dir=configuration.analysis_model_dir,
            ffmpeg_dir=configuration.analysis_ffmpeg_dir,
            device=configuration.analysis_device,
            timeout=configuration.analysis_command_timeout_seconds,
        )
    elif separator_choice in {"auto", "demucs"} and importlib.util.find_spec("demucs"):
        separator = DemucsVocalSeparator(
            model=configuration.analysis_demucs_model,
            device=configuration.analysis_device,
            timeout=configuration.analysis_command_timeout_seconds,
        )
    elif separator_choice in {"auto", "passthrough"}:
        separator = PassthroughVocalSeparator()
    else:
        raise AnalysisAdapterError(f"separator_unavailable:{separator_choice}")

    aligner_choice = (requested_aligner or configuration.analysis_aligner or "auto").casefold()
    aligner: ForcedAligner
    if aligner_choice in {"external", "external_json"} or (
        aligner_choice == "auto" and configuration.analysis_aligner_command
    ):
        if not configuration.analysis_aligner_command:
            raise AnalysisAdapterError("external_aligner_command_not_configured")
        aligner = JsonCommandForcedAligner(
            command_template=configuration.analysis_aligner_command,
            work_dir=work_dir,
            timeout=configuration.analysis_command_timeout_seconds,
        )
    elif aligner_choice in {"ctc", "japanese_ctc"} or (
        aligner_choice == "auto"
        and configuration.analysis_ctc_python.is_file()
        and configuration.analysis_ctc_script.is_file()
    ):
        if not configuration.analysis_ctc_python.is_file():
            raise AnalysisAdapterError("ctc_aligner_python_not_found")
        if not configuration.analysis_ctc_script.is_file():
            raise AnalysisAdapterError("ctc_aligner_script_not_found")
        aligner = JapaneseCtcForcedAligner(
            python=configuration.analysis_ctc_python,
            script=configuration.analysis_ctc_script,
            model=configuration.analysis_ctc_model,
            cache_dir=configuration.analysis_ctc_cache_dir,
            device=configuration.analysis_device,
            max_paths=configuration.analysis_ctc_max_paths,
            chunk_seconds=configuration.analysis_ctc_chunk_seconds,
            work_dir=work_dir,
            timeout=configuration.analysis_command_timeout_seconds,
        )
    elif aligner_choice == "mfa" or (
        aligner_choice == "auto" and _command_exists(configuration.analysis_mfa_command)
    ):
        if not _command_exists(configuration.analysis_mfa_command):
            raise AnalysisAdapterError("mfa_command_not_found")
        aligner = MfaForcedAligner(
            command=configuration.analysis_mfa_command,
            dictionary_name=configuration.analysis_mfa_dictionary,
            acoustic_model=configuration.analysis_mfa_acoustic_model,
            g2p_model=configuration.analysis_mfa_g2p_model,
            work_dir=work_dir,
            timeout=configuration.analysis_command_timeout_seconds,
        )
    elif aligner_choice in {"auto", "timed", "timed_lyrics"}:
        aligner = TimedLyricsForcedAligner(line_timings)
    else:
        raise AnalysisAdapterError(f"aligner_unavailable:{aligner_choice}")

    candidate_generator: ReadingCandidateGenerator = SudachiReadingCandidateGenerator()
    segmenter: LineSegmenter = LineNumberSegmenter()
    return AdapterSelection(
        components=PipelineComponents(
            vocal_separator=separator,
            candidate_generator=candidate_generator,
            forced_aligner=aligner,
            line_segmenter=segmenter,
        ),
        separator_name=getattr(separator, "name", type(separator).__name__),
        aligner_name=getattr(aligner, "name", type(aligner).__name__),
    )
