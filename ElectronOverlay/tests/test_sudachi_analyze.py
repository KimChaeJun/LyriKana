import json
from pathlib import Path
import subprocess
import sys


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "src" / "sudachi_analyze.py"


def analyze(text: str) -> dict:
    completed = subprocess.run(
        [sys.executable, str(SCRIPT_PATH)],
        input=json.dumps({"text": text, "splitMode": "C"}, ensure_ascii=False),
        text=True,
        encoding="utf-8",
        capture_output=True,
        check=True,
    )
    return json.loads(completed.stdout)


def test_whitespace_is_not_pronounced_as_kigou():
    result = analyze("貴方に 会いたくて")

    assert result["reading"] == "あなたに あいたくて"
    assert "きごう" not in result["reading"]


def test_non_breaking_space_is_not_pronounced_as_kigou():
    result = analyze("生まれて\u00a0きたんだよ")

    assert result["reading"] == "うまれて\u00a0きたんだよ"
    assert "きごう" not in result["reading"]


def test_the_actual_word_kigou_keeps_its_reading():
    result = analyze("記号")

    assert result["reading"] == "きごう"
