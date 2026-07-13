from __future__ import annotations

import re


TIMESTAMP_RE = re.compile(r"\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]")


def _seconds(match: re.Match[str]) -> float:
    fraction = match.group(3) or "0"
    return int(match.group(1)) * 60 + int(match.group(2)) + int(fraction.ljust(3, "0")) / 1000


def parse_lrc(original_lrc: str) -> list[dict]:
    timed_lines: list[tuple[float, str]] = []
    plain_lines: list[str] = []

    for raw_line in original_lrc.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        matches = list(TIMESTAMP_RE.finditer(line))
        if matches:
            original = TIMESTAMP_RE.sub("", line).strip()
            if not original:
                continue
            timed_lines.extend((_seconds(match), original) for match in matches)
        elif not re.match(r"^\[[a-zA-Z]+:", line):
            plain_lines.append(line)

    if timed_lines:
        timed_lines.sort(key=lambda item: item[0])
        source = timed_lines
    else:
        source = [(None, original) for original in plain_lines]

    return [
        {
            "line_no": index,
            "time": timestamp,
            "original": original,
            "reading": None,
            "kr": None,
            "jp": None,
            "en": None,
            "user_edit": False,
            "reason_tags": [],
        }
        for index, (timestamp, original) in enumerate(source)
    ]
