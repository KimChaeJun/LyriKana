from app.services.lrc import parse_lrc


def test_parse_lrc_supports_multiple_timestamps_and_milliseconds():
    result = parse_lrc("[00:01.2][00:02.250]line\n[ar:artist]\n[01:03]next")

    assert [(line["line_no"], line["time"], line["original"]) for line in result] == [
        (0, 1.2, "line"),
        (1, 2.25, "line"),
        (2, 63.0, "next"),
    ]


def test_parse_lrc_keeps_plain_lyrics_nullable_timestamps():
    result = parse_lrc("first\nsecond")

    assert [line["time"] for line in result] == [None, None]
    assert [line["original"] for line in result] == ["first", "second"]
