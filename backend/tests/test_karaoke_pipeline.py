import json
import sys
from pathlib import Path

from app.services.karaoke_pipeline import (
    AlignedUnit,
    KaraokePipeline,
    PipelineComponents,
    ReadingCandidate,
    normalize_lyrics_for_analysis,
)
from app.services.analysis_adapters import (
    JsonCommandForcedAligner,
    SudachiReadingCandidateGenerator,
)


def test_analysis_normalization_preserves_original_offsets_while_removing_symbols():
    original = '⌈“私は”⌋ A-priori'
    normalized = normalize_lyrics_for_analysis(original)

    assert normalized.original == original
    assert normalized.analysis_text == "私は A priori"
    assert len(normalized.analysis_text) == len(normalized.analysis_to_original)
    watashi_start = normalized.analysis_text.index("私")
    assert original[normalized.analysis_to_original[watashi_start]] == "私"
    a_start = normalized.analysis_text.index("A")
    assert original[normalized.analysis_to_original[a_start]] == "A"


def test_pipeline_runs_replaceable_model_adapters_in_order(tmp_path):
    stages: list[str] = []

    class Separator:
        def separate(self, audio_path: Path, work_dir: Path) -> Path:
            assert audio_path.name == "song.wav"
            return work_dir / "vocals.wav"

    class CandidateGenerator:
        def generate(self, lyrics):
            assert lyrics.analysis_text == "私は"
            return [ReadingCandidate("私は", "わたしは", "test", 1.0)]

    class Aligner:
        def align(self, vocal_path: Path, candidates):
            assert vocal_path.name == "vocals.wav"
            assert candidates[0].reading == "わたしは"
            return [AlignedUnit("私は", "わたしわ", None, 1.0, 2.0, 0.9)]

    class Segmenter:
        def segment(self, units):
            return [units]

    pipeline = KaraokePipeline(
        PipelineComponents(Separator(), CandidateGenerator(), Aligner(), Segmenter())
    )
    result = pipeline.run(
        audio_path=Path("song.wav"),
        lyrics="「私は」",
        work_dir=tmp_path,
        on_stage=lambda stage, _progress: stages.append(stage),
    )

    assert result.lines[0][0].reading == "わたしわ"
    assert stages == [
        "ingest",
        "separate_vocals",
        "normalize_lyrics",
        "generate_reading_candidates",
        "forced_align",
        "segment_lines",
        "quality_review",
    ]


def test_sudachi_candidates_keep_particle_context_and_add_numeric_pronunciations():
    candidates = SudachiReadingCandidateGenerator().generate(
        normalize_lyrics_for_analysis("⌈私は⌋ 1991")
    )

    particle = next(item for item in candidates if item.surface == "は")
    assert particle.reading == "は"
    assert particle.spoken_reading == "わ"
    number_candidates = [item for item in candidates if item.surface == "1991"]
    assert {item.source for item in number_candidates} >= {
        "sudachi",
        "numeric_english_digits",
        "numeric_english_year",
    }
    english_year = next(
        item for item in number_candidates if item.source == "numeric_english_year"
    )
    assert english_year.reading == "ないんてぃーんないんてぃーわん"


def test_external_json_aligner_contract_uses_acoustic_candidate_result(tmp_path):
    script_path = tmp_path / "fake_aligner.py"
    script_path.write_text(
        """
import json
import sys
from pathlib import Path

audio_path, request_path, output_path = sys.argv[1:]
request = json.loads(Path(request_path).read_text(encoding="utf-8"))
assert Path(audio_path).name == "vocals.wav"
assert len(request["candidates"]) == 1
Path(output_path).write_text(json.dumps({"units": [{
    "lineNo": 0,
    "surface": "1991",
    "reading": "ないんてぃーんないんてぃーわん",
    "startTime": 1.25,
    "endTime": 2.75,
    "confidence": 0.92,
    "acousticScore": -2.1,
    "source": "fake-singing-model"
}]}, ensure_ascii=False), encoding="utf-8")
""".strip(),
        encoding="utf-8",
    )
    audio_path = tmp_path / "vocals.wav"
    audio_path.write_bytes(b"audio")
    command_template = json.dumps(
        [
            sys.executable,
            str(script_path),
            "{audio}",
            "{request}",
            "{output}",
        ]
    )
    aligner = JsonCommandForcedAligner(
        command_template=command_template,
        work_dir=tmp_path,
        timeout=10,
    )

    units = aligner.align(
        audio_path,
        [
            ReadingCandidate(
                "1991",
                "ないんてぃーんないんてぃーわん",
                "numeric_english_year",
                0.86,
            )
        ],
    )

    assert len(units) == 1
    assert units[0].reading == "ないんてぃーんないんてぃーわん"
    assert units[0].confidence == 0.92
    assert units[0].acoustic_score == -2.1
