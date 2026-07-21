from __future__ import annotations

from dataclasses import replace

import pytest

from aligners.japanese_ctc_aligner import (
    build_candidate_paths,
    ctc_forced_align,
    reading_to_phonemes,
)
from app.config import settings
from app.services.analysis_adapters import select_adapters


def test_kana_reading_converts_to_openjtalk_style_phonemes():
    assert reading_to_phonemes("ワタシハ") == (
        "w",
        "a",
        "t",
        "a",
        "sh",
        "i",
        "h",
        "a",
    )
    assert reading_to_phonemes("トゥエンティーワン") == (
        "t",
        "u",
        "e",
        "N",
        "ty",
        "i",
        "i",
        "w",
        "a",
        "N",
    )


def test_candidate_paths_keep_acoustic_pronunciation_alternatives():
    paths = build_candidate_paths(
        {
            "candidates": [
                {
                    "lineNo": 0,
                    "surface": "1991",
                    "surfaceStart": 0,
                    "surfaceEnd": 4,
                    "reading": "イチキュウキュウイチ",
                    "source": "digits",
                    "priorScore": 0.7,
                },
                {
                    "lineNo": 0,
                    "surface": "1991",
                    "surfaceStart": 0,
                    "surfaceEnd": 4,
                    "reading": "ナインティーンナインティーワン",
                    "source": "english_year",
                    "priorScore": 0.8,
                },
            ]
        },
        max_paths=8,
    )

    assert len(paths) == 2
    assert {path.candidates[0].source for path in paths} == {
        "digits",
        "english_year",
    }


def test_ctc_viterbi_returns_monotonic_phone_frames():
    np = pytest.importorskip("numpy")
    probabilities = np.asarray(
        [
            [0.90, 0.05, 0.05],
            [0.05, 0.90, 0.05],
            [0.90, 0.05, 0.05],
            [0.05, 0.05, 0.90],
            [0.90, 0.05, 0.05],
        ],
        dtype=np.float32,
    )
    alignment = ctc_forced_align(np.log(probabilities), [1, 2], blank_id=0)

    assert alignment.phone_frames[0]
    assert alignment.phone_frames[1]
    assert max(alignment.phone_frames[0]) < min(alignment.phone_frames[1])
    assert alignment.score < 0


def test_auto_selection_prefers_installed_japanese_ctc_runtime(tmp_path):
    python = tmp_path / "python.exe"
    script = tmp_path / "aligner.py"
    python.write_bytes(b"")
    script.write_text("", encoding="utf-8")
    selection = select_adapters(
        configuration=replace(
            settings,
            analysis_separator="passthrough",
            analysis_aligner="auto",
            analysis_aligner_command=None,
            analysis_ctc_python=python,
            analysis_ctc_script=script,
            analysis_mfa_command="definitely-not-installed-mfa",
        ),
        work_dir=tmp_path,
        line_timings={},
        requested_aligner=None,
    )

    assert selection.aligner_name == "japanese_ctc"
