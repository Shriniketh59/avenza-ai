"""Post-check of a generated answer: every figure it states must appear in the sources it was given."""
import re
from datetime import datetime

_CODE = re.compile(r"```.*?```|`[^`\n]*`", re.S)
_CITATION = re.compile(r"\[\d+(?:\s*[,–-]\s*\d+)*\]")
_LIST_NUMBER = re.compile(r"^\s*\d+[.)]\s", re.M)
_URL = re.compile(r"https?://\S+")
# Worked arithmetic: inline code with "=", or a line with an operation between numbers and a result.
_WORKED = re.compile(r"`([^`\n]*=[^`\n]*)`|^([^\n]*\d\s*[×*/÷+^−-]\s*\(?\d[^\n]*=[^\n]*)$", re.M)
_NUMBER = re.compile(r"(?<![\w.])[$₹€£]?\s?\d[\d,]*(?:\.\d+)?\s?%?")


def _values(text: str) -> set[float]:
    out = set()
    for m in _NUMBER.finditer(text):
        raw = re.sub(r"[^\d.]", "", m.group())
        try:
            out.add(round(float(raw), 6))
        except ValueError:
            continue
    return out


def unsupported_figures(answer: str, evidence: list[str]) -> list[str]:
    """Figures in the answer that appear in none of the evidence texts (sources, memory, question, today's date).

    Small counts (below 10) are ignored; they are usually list sizes or ordinals, not facts.
    """
    now = datetime.now()
    known = _values(" ".join(evidence)) | {float(now.year), float(now.day), float(now.month)}
    # Arithmetic the answer shows (`120 × 1.08 = 129.6`) is checkable on screen: its results are derived, not
    # claimed from nowhere, so they count as known and the working itself is not scanned.
    worked = [a or b for a, b in _WORKED.findall(answer)]
    known |= _values(" ".join(w.rsplit("=", 1)[1] for w in worked))
    body = _WORKED.sub(" ", answer)
    body = _URL.sub(" ", _LIST_NUMBER.sub(" ", _CITATION.sub(" ", _CODE.sub(" ", body))))
    flagged = []
    for m in _NUMBER.finditer(body):
        shown = m.group().strip()
        raw = re.sub(r"[^\d.]", "", shown).rstrip(".")
        try:
            value = round(float(raw), 6)
        except ValueError:
            continue
        if value < 10 and "." not in raw and "%" not in shown:
            continue
        if value not in known and shown not in flagged:
            flagged.append(shown)
    return flagged


def warning(flagged: list[str], had_sources: bool) -> str:
    figures = ", ".join(f"`{f}`" for f in flagged[:8])
    if had_sources:
        return f"\n\n> ⚠️ **Check before relying on it:** {figures} could not be found in the cited sources."
    return f"\n\n> ⚠️ **No source found for:** {figures}. Verify these figures independently."
