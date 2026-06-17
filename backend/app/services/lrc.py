import re


TIME_RE = re.compile(r"\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)")


def parse_lrc(original_lrc: str) -> list[dict]:
    lines = []

    for raw_line in original_lrc.splitlines():
        match = TIME_RE.match(raw_line.strip())
        if not match:
            continue

        minute = int(match.group(1))
        second = int(match.group(2))
        millis = match.group(3) or "0"
        text = match.group(4).strip()

        time = minute * 60 + second + int(millis.ljust(3, "0")) / 1000

        if text:
            lines.append({
                "order": len(lines) + 1,
                "time": time,
                "original": text,
                "hiragana": None,
                "korean_pronunciation": None,
                "english_pronunciation": None,
                "hard_mapped_pronunciation": None,
                "user_feedback": None,
            })

    return lines