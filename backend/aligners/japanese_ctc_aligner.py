from __future__ import annotations

import argparse
import json
import math
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence


DEFAULT_MODEL = "prj-beatrice/japanese-hubert-base-phoneme-ctc-v4"
TARGET_SAMPLE_RATE = 16_000


@dataclass(frozen=True)
class Candidate:
    line_no: int
    surface: str
    surface_start: int
    surface_end: int
    reading: str
    source: str
    prior_score: float
    phonemes: tuple[str, ...]


@dataclass(frozen=True)
class CandidatePath:
    candidates: tuple[Candidate, ...]
    prior_score: float

    @property
    def phonemes(self) -> tuple[str, ...]:
        return tuple(
            phoneme for candidate in self.candidates for phoneme in candidate.phonemes
        )


@dataclass(frozen=True)
class CtcAlignment:
    score: float
    phone_frames: tuple[tuple[int, ...], ...]


_MORA_PHONEMES: dict[str, tuple[str, ...]] = {
    "あ": ("a",),
    "い": ("i",),
    "う": ("u",),
    "え": ("e",),
    "お": ("o",),
    "か": ("k", "a"),
    "き": ("k", "i"),
    "く": ("k", "u"),
    "け": ("k", "e"),
    "こ": ("k", "o"),
    "が": ("g", "a"),
    "ぎ": ("g", "i"),
    "ぐ": ("g", "u"),
    "げ": ("g", "e"),
    "ご": ("g", "o"),
    "さ": ("s", "a"),
    "し": ("sh", "i"),
    "す": ("s", "u"),
    "せ": ("s", "e"),
    "そ": ("s", "o"),
    "ざ": ("z", "a"),
    "じ": ("j", "i"),
    "ず": ("z", "u"),
    "ぜ": ("z", "e"),
    "ぞ": ("z", "o"),
    "た": ("t", "a"),
    "ち": ("ch", "i"),
    "つ": ("ts", "u"),
    "て": ("t", "e"),
    "と": ("t", "o"),
    "だ": ("d", "a"),
    "ぢ": ("j", "i"),
    "づ": ("z", "u"),
    "で": ("d", "e"),
    "ど": ("d", "o"),
    "な": ("n", "a"),
    "に": ("n", "i"),
    "ぬ": ("n", "u"),
    "ね": ("n", "e"),
    "の": ("n", "o"),
    "は": ("h", "a"),
    "ひ": ("h", "i"),
    "ふ": ("f", "u"),
    "へ": ("h", "e"),
    "ほ": ("h", "o"),
    "ば": ("b", "a"),
    "び": ("b", "i"),
    "ぶ": ("b", "u"),
    "べ": ("b", "e"),
    "ぼ": ("b", "o"),
    "ぱ": ("p", "a"),
    "ぴ": ("p", "i"),
    "ぷ": ("p", "u"),
    "ぺ": ("p", "e"),
    "ぽ": ("p", "o"),
    "ま": ("m", "a"),
    "み": ("m", "i"),
    "む": ("m", "u"),
    "め": ("m", "e"),
    "も": ("m", "o"),
    "や": ("y", "a"),
    "ゆ": ("y", "u"),
    "よ": ("y", "o"),
    "ら": ("r", "a"),
    "り": ("r", "i"),
    "る": ("r", "u"),
    "れ": ("r", "e"),
    "ろ": ("r", "o"),
    "わ": ("w", "a"),
    "ゐ": ("w", "i"),
    "ゑ": ("w", "e"),
    "を": ("o",),
    "ん": ("N",),
    "っ": ("cl",),
    "ゔ": ("v", "u"),
    "きゃ": ("ky", "a"),
    "きゅ": ("ky", "u"),
    "きょ": ("ky", "o"),
    "ぎゃ": ("gy", "a"),
    "ぎゅ": ("gy", "u"),
    "ぎょ": ("gy", "o"),
    "しゃ": ("sh", "a"),
    "しゅ": ("sh", "u"),
    "しょ": ("sh", "o"),
    "じゃ": ("j", "a"),
    "じゅ": ("j", "u"),
    "じょ": ("j", "o"),
    "ちゃ": ("ch", "a"),
    "ちゅ": ("ch", "u"),
    "ちょ": ("ch", "o"),
    "にゃ": ("ny", "a"),
    "にゅ": ("ny", "u"),
    "にょ": ("ny", "o"),
    "ひゃ": ("hy", "a"),
    "ひゅ": ("hy", "u"),
    "ひょ": ("hy", "o"),
    "びゃ": ("by", "a"),
    "びゅ": ("by", "u"),
    "びょ": ("by", "o"),
    "ぴゃ": ("py", "a"),
    "ぴゅ": ("py", "u"),
    "ぴょ": ("py", "o"),
    "みゃ": ("my", "a"),
    "みゅ": ("my", "u"),
    "みょ": ("my", "o"),
    "りゃ": ("ry", "a"),
    "りゅ": ("ry", "u"),
    "りょ": ("ry", "o"),
    "てぃ": ("ty", "i"),
    "でぃ": ("dy", "i"),
    "とぅ": ("t", "u"),
    "どぅ": ("d", "u"),
    "ふぁ": ("f", "a"),
    "ふぃ": ("f", "i"),
    "ふぇ": ("f", "e"),
    "ふぉ": ("f", "o"),
    "うぃ": ("w", "i"),
    "うぇ": ("w", "e"),
    "うぉ": ("w", "o"),
    "ゔぁ": ("v", "a"),
    "ゔぃ": ("v", "i"),
    "ゔぇ": ("v", "e"),
    "ゔぉ": ("v", "o"),
}


def _hiragana(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value)
    return "".join(
        chr(ord(character) - 0x60)
        if "ァ" <= character <= "ヶ"
        else character
        for character in normalized
    )


def reading_to_phonemes(reading: str) -> tuple[str, ...]:
    value = _hiragana(reading)
    phonemes: list[str] = []
    index = 0
    last_vowel: str | None = None
    while index < len(value):
        character = value[index]
        if character == "ー":
            if last_vowel:
                phonemes.append(last_vowel)
            index += 1
            continue
        pair = value[index : index + 2]
        mapped = _MORA_PHONEMES.get(pair)
        if mapped is not None:
            index += 2
        else:
            mapped = _MORA_PHONEMES.get(character)
            index += 1
        if mapped is None:
            continue
        phonemes.extend(mapped)
        for phoneme in reversed(mapped):
            if phoneme in {"a", "i", "u", "e", "o"}:
                last_vowel = phoneme
                break
    return tuple(phonemes)


def _candidate_key(raw: dict) -> tuple[int, int, int, str]:
    return (
        int(raw.get("lineNo", 0)),
        int(raw.get("surfaceStart", 0)),
        int(raw.get("surfaceEnd", 0)),
        str(raw.get("surface", "")),
    )


def build_candidate_paths(payload: dict, max_paths: int) -> tuple[CandidatePath, ...]:
    raw_candidates = payload.get("candidates")
    if not isinstance(raw_candidates, list):
        raise ValueError("request_candidates_missing")
    grouped: dict[tuple[int, int, int, str], list[Candidate]] = {}
    order: list[tuple[int, int, int, str]] = []
    for raw in raw_candidates:
        if not isinstance(raw, dict):
            continue
        key = _candidate_key(raw)
        reading = str(raw.get("spokenReading") or raw.get("reading") or "")
        phonemes = reading_to_phonemes(reading)
        if not phonemes:
            continue
        candidate = Candidate(
            line_no=key[0],
            surface=key[3],
            surface_start=key[1],
            surface_end=key[2],
            reading=reading,
            source=str(raw.get("source", "unknown")),
            prior_score=max(0.001, min(1.0, float(raw.get("priorScore", 0.5)))),
            phonemes=phonemes,
        )
        if key not in grouped:
            grouped[key] = []
            order.append(key)
        if not any(existing.phonemes == phonemes for existing in grouped[key]):
            grouped[key].append(candidate)
    if not order:
        raise ValueError("request_has_no_pronounceable_candidates")

    paths: list[CandidatePath] = [CandidatePath((), 0.0)]
    for key in order:
        variants = sorted(
            grouped[key], key=lambda item: item.prior_score, reverse=True
        )[:4]
        expanded = [
            CandidatePath(
                path.candidates + (variant,),
                path.prior_score + math.log(variant.prior_score),
            )
            for path in paths
            for variant in variants
        ]
        paths = sorted(expanded, key=lambda item: item.prior_score, reverse=True)[
            :max_paths
        ]
    return tuple(paths)


def ctc_forced_align(log_probabilities, target_ids: Sequence[int], blank_id: int) -> CtcAlignment:
    import numpy as np

    frame_count, _label_count = log_probabilities.shape
    if not target_ids:
        raise ValueError("ctc_target_empty")
    state_count = len(target_ids) * 2 + 1
    if frame_count < len(target_ids):
        raise ValueError("ctc_audio_too_short")

    labels = np.full(state_count, blank_id, dtype=np.int64)
    labels[1::2] = np.asarray(target_ids, dtype=np.int64)
    skip_allowed = np.zeros(state_count, dtype=bool)
    for state in range(3, state_count, 2):
        skip_allowed[state] = labels[state] != labels[state - 2]

    negative_infinity = np.float32(-1e30)
    previous = np.full(state_count, negative_infinity, dtype=np.float32)
    previous[0] = 0.0
    backpointers = np.zeros((frame_count, state_count), dtype=np.uint8)
    for frame in range(frame_count):
        stay = previous
        advance = np.full(state_count, negative_infinity, dtype=np.float32)
        advance[1:] = previous[:-1]
        skip = np.full(state_count, negative_infinity, dtype=np.float32)
        skip[2:] = previous[:-2]
        skip[~skip_allowed] = negative_infinity
        sources = np.stack((stay, advance, skip), axis=0)
        decisions = np.argmax(sources, axis=0).astype(np.uint8)
        best = np.take_along_axis(sources, decisions[None, :], axis=0)[0]
        previous = best + log_probabilities[frame, labels]
        backpointers[frame] = decisions

    final_states = (state_count - 2, state_count - 1)
    state = max(final_states, key=lambda item: float(previous[item]))
    score = float(previous[state]) / frame_count
    state_path = np.empty(frame_count, dtype=np.int32)
    for frame in range(frame_count - 1, -1, -1):
        state_path[frame] = state
        state -= int(backpointers[frame, state])
        if state < 0:
            state = 0

    phone_frames = tuple(
        tuple(int(frame) for frame in np.flatnonzero(state_path == phone * 2 + 1))
        for phone in range(len(target_ids))
    )
    if any(not frames for frames in phone_frames):
        raise ValueError("ctc_alignment_incomplete")
    return CtcAlignment(score=score, phone_frames=phone_frames)


def _load_audio(path: Path):
    import numpy as np
    import soundfile
    from scipy.signal import resample_poly

    audio, sample_rate = soundfile.read(
        str(path), dtype="float32", always_2d=True
    )
    mono = audio.mean(axis=1)
    if sample_rate != TARGET_SAMPLE_RATE:
        divisor = math.gcd(sample_rate, TARGET_SAMPLE_RATE)
        mono = resample_poly(
            mono,
            TARGET_SAMPLE_RATE // divisor,
            sample_rate // divisor,
        ).astype(np.float32)
    peak = float(np.max(np.abs(mono))) if mono.size else 0.0
    if peak > 1.0:
        mono = mono / peak
    if mono.size < TARGET_SAMPLE_RATE // 4:
        raise ValueError("audio_is_too_short")
    return mono


def _generate_emissions(
    audio,
    *,
    model_name: str,
    cache_dir: Path,
    device_name: str,
    chunk_seconds: float,
):
    import numpy as np
    import torch
    from transformers import AutoFeatureExtractor, AutoModelForCTC, AutoTokenizer

    device = torch.device(
        "cuda" if device_name == "cuda" and torch.cuda.is_available() else "cpu"
    )
    feature_extractor = AutoFeatureExtractor.from_pretrained(
        model_name, cache_dir=str(cache_dir), local_files_only=True
    )
    tokenizer = AutoTokenizer.from_pretrained(
        model_name, cache_dir=str(cache_dir), local_files_only=True
    )
    model = AutoModelForCTC.from_pretrained(
        model_name, cache_dir=str(cache_dir), local_files_only=True
    )
    model.eval().to(device)

    chunk_samples = max(TARGET_SAMPLE_RATE, round(chunk_seconds * TARGET_SAMPLE_RATE))
    log_probabilities: list = []
    frame_times: list = []
    with torch.inference_mode():
        for start in range(0, len(audio), chunk_samples):
            end = min(len(audio), start + chunk_samples)
            chunk = audio[start:end]
            inputs = feature_extractor(
                chunk, sampling_rate=TARGET_SAMPLE_RATE, return_tensors="pt"
            )
            model_inputs = {key: value.to(device) for key, value in inputs.items()}
            with torch.autocast(
                device_type=device.type,
                dtype=torch.float16,
                enabled=device.type == "cuda",
            ):
                logits = model(**model_inputs).logits[0]
            chunk_log_probabilities = torch.log_softmax(logits.float(), dim=-1).cpu().numpy()
            duration = (end - start) / TARGET_SAMPLE_RATE
            count = chunk_log_probabilities.shape[0]
            times = start / TARGET_SAMPLE_RATE + (
                (np.arange(count, dtype=np.float64) + 0.5) * duration / count
            )
            log_probabilities.append(chunk_log_probabilities)
            frame_times.append(times)
    return (
        np.concatenate(log_probabilities, axis=0),
        np.concatenate(frame_times, axis=0),
        tokenizer.get_vocab(),
        int(model.config.pad_token_id),
        str(device),
    )


def _phone_segments(
    alignment: CtcAlignment,
    phonemes: Sequence[str],
    target_ids: Sequence[int],
    log_probabilities,
    frame_times,
) -> list[dict]:
    import numpy as np

    centers = np.asarray(
        [float(np.mean(frame_times[list(frames)])) for frames in alignment.phone_frames]
    )
    if len(centers) == 1:
        typical_gap = 0.1
    else:
        typical_gap = max(0.02, float(np.median(np.diff(centers))))
    starts = np.empty(len(centers), dtype=np.float64)
    ends = np.empty(len(centers), dtype=np.float64)
    starts[0] = max(0.0, centers[0] - typical_gap / 2)
    ends[-1] = min(float(frame_times[-1]), centers[-1] + typical_gap / 2)
    for index in range(1, len(centers)):
        boundary = (centers[index - 1] + centers[index]) / 2
        ends[index - 1] = boundary
        starts[index] = boundary

    segments: list[dict] = []
    for index, (phoneme, frames, target_id) in enumerate(
        zip(phonemes, alignment.phone_frames, target_ids)
    ):
        frame_indices = list(frames)
        confidence = float(
            np.mean(np.exp(log_probabilities[frame_indices, target_id]))
        )
        segments.append(
            {
                "phoneme": phoneme,
                "startTime": round(float(starts[index]), 4),
                "endTime": round(max(float(starts[index]) + 0.01, float(ends[index])), 4),
                "confidence": round(min(1.0, max(0.0, confidence)), 5),
            }
        )
    return segments


def align_request(
    *,
    audio_path: Path,
    request: dict,
    model_name: str,
    cache_dir: Path,
    device: str,
    max_paths: int,
    chunk_seconds: float,
) -> dict:
    audio = _load_audio(audio_path)
    log_probabilities, frame_times, vocabulary, blank_id, actual_device = (
        _generate_emissions(
            audio,
            model_name=model_name,
            cache_dir=cache_dir,
            device_name=device,
            chunk_seconds=chunk_seconds,
        )
    )
    paths = build_candidate_paths(request, max_paths)
    best: tuple[float, CandidatePath, CtcAlignment, list[int]] | None = None
    errors: list[str] = []
    for path in paths:
        try:
            target_ids = [vocabulary[phoneme] for phoneme in path.phonemes]
        except KeyError as error:
            errors.append(f"model_vocabulary_missing:{error.args[0]}")
            continue
        try:
            alignment = ctc_forced_align(log_probabilities, target_ids, blank_id)
        except ValueError as error:
            errors.append(str(error))
            continue
        combined_score = alignment.score + 0.02 * (
            path.prior_score / max(1, len(path.candidates))
        )
        if best is None or combined_score > best[0]:
            best = (combined_score, path, alignment, target_ids)
    if best is None:
        raise ValueError("alignment_failed:" + ",".join(sorted(set(errors))))

    _combined_score, path, alignment, target_ids = best
    phone_segments = _phone_segments(
        alignment,
        path.phonemes,
        target_ids,
        log_probabilities,
        frame_times,
    )
    units: list[dict] = []
    phone_cursor = 0
    for candidate in path.candidates:
        owned = phone_segments[phone_cursor : phone_cursor + len(candidate.phonemes)]
        phone_cursor += len(candidate.phonemes)
        confidence = sum(item["confidence"] for item in owned) / len(owned)
        units.append(
            {
                "lineNo": candidate.line_no,
                "surface": candidate.surface,
                "reading": candidate.reading,
                "phoneme": " ".join(candidate.phonemes),
                "startTime": owned[0]["startTime"],
                "endTime": owned[-1]["endTime"],
                "confidence": round(confidence, 5),
                "acousticScore": round(alignment.score, 6),
                "unitType": "token",
                "source": "japanese_ctc_v4",
                "readingSource": candidate.source,
            }
        )
    return {
        "schemaVersion": 1,
        "units": units,
        "phonemes": phone_segments,
        "diagnostics": {
            "model": model_name,
            "device": actual_device,
            "candidatePathsEvaluated": len(paths),
            "selectedPriorScore": round(path.prior_score, 6),
            "ctcScore": round(alignment.score, 6),
            "audioSeconds": round(len(audio) / TARGET_SAMPLE_RATE, 4),
            "frameCount": int(log_probabilities.shape[0]),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Align LyriKana Japanese reading candidates with a phoneme CTC model"
    )
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
    parser.add_argument("--max-paths", type=int, default=8)
    parser.add_argument("--chunk-seconds", type=float, default=25.0)
    arguments = parser.parse_args()
    if not 1 <= arguments.max_paths <= 32:
        parser.error("--max-paths must be between 1 and 32")
    if not 5 <= arguments.chunk_seconds <= 60:
        parser.error("--chunk-seconds must be between 5 and 60")
    request = json.loads(arguments.request.read_text(encoding="utf-8"))
    result = align_request(
        audio_path=arguments.audio,
        request=request,
        model_name=arguments.model,
        cache_dir=arguments.cache_dir,
        device=arguments.device,
        max_paths=arguments.max_paths,
        chunk_seconds=arguments.chunk_seconds,
    )
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(result["diagnostics"], ensure_ascii=False))


if __name__ == "__main__":
    main()
