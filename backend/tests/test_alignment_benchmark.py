from app.alignment_benchmark import PhoneBoundary, parse_htk_labels, score_boundaries


def test_htk_labels_ignore_silence_and_use_seconds(tmp_path):
    labels = tmp_path / "sample.lab"
    labels.write_text(
        "0 1000000 sil\n1000000 2000000 k\n2000000 4000000 a\n",
        encoding="utf-8",
    )

    parsed = parse_htk_labels(labels)

    assert [item.phoneme for item in parsed] == ["k", "a"]
    assert parsed[0].start == 0.1
    assert parsed[1].end == 0.4


def test_boundary_score_matches_same_phones_and_reports_error():
    reference = [
        PhoneBoundary("k", 0.1, 0.2),
        PhoneBoundary("a", 0.2, 0.4),
    ]
    predicted = [
        PhoneBoundary("k", 0.12, 0.22),
        PhoneBoundary("a", 0.22, 0.42),
    ]

    score = score_boundaries(predicted, reference)

    assert score["matchedPhones"] == 2
    assert score["phoneCoverage"] == 1.0
    assert score["boundaryMaeMs"] == 20.0
    assert score["boundaryWithin50Ms"] == 1.0
