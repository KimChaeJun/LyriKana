import json
import sys

from sudachipy import Dictionary, SplitMode


def katakana_to_hiragana(value: str) -> str:
    return "".join(
        chr(ord(ch) - 0x60) if "\u30a1" <= ch <= "\u30f6" else ch
        for ch in value
    )


def get_split_mode(value: str):
    mode = (value or "C").upper()
    if mode == "A":
        return SplitMode.A
    if mode == "B":
        return SplitMode.B
    return SplitMode.C


def main() -> None:
    raw_input = sys.stdin.buffer.read().decode("utf-8")
    payload = json.loads(raw_input or "{}")
    text = str(payload.get("text") or "").strip()
    split_mode = get_split_mode(str(payload.get("splitMode") or "C"))

    tokenizer = Dictionary().create()
    morphemes = tokenizer.tokenize(text, split_mode)

    tokens = []
    reading_parts = []

    for morpheme in morphemes:
        surface = morpheme.surface()
        reading = morpheme.reading_form()
        part_of_speech = morpheme.part_of_speech()
        if not reading or reading == "*":
            reading = surface

        # Sudachi returns キゴウ as the reading_form for whitespace tokens.
        # It is a token category label, not something that should be pronounced.
        if surface.isspace() or (reading == "キゴウ" and surface != "記号"):
            reading = surface

        hiragana = katakana_to_hiragana(reading)
        reading_parts.append(hiragana)
        tokens.append(
            {
                "surface": surface,
                "reading": hiragana,
                "normalized": morpheme.normalized_form(),
                "dictionary": morpheme.dictionary_form(),
                "partOfSpeech": part_of_speech,
            }
        )

    sys.stdout.buffer.write(
        (
            json.dumps(
            {
                "ok": True,
                "reading": "".join(reading_parts),
                "tokens": tokens,
            },
            ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")
    )


if __name__ == "__main__":
    main()
