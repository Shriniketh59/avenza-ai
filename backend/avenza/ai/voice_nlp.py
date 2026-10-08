"""NLP for the voice assistant: transcript cleanup, spoken commands, and speech-friendly text."""
import re

_FILLERS = re.compile(r"\b(um+|uh+|erm+|hmm+|ah+|you know,?|i mean,?)\b[,.]?\s*", re.I)
# Common Whisper mishearings of the product name.
_BRAND = re.compile(r"\b(evans?|avenza|aventa|avanza|a venza|avenger|avensa|evenza)\s*(ai|a\.i\.|eye)?\b", re.I)


def clean_transcript(text: str) -> str:
    text = _BRAND.sub("AVENZA AI", text)
    text = _FILLERS.sub("", text)
    text = re.sub(r"\s{2,}", " ", text).strip()
    return text[:1].upper() + text[1:] if text else text


_COMMANDS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"^(please )?(start (a )?)?new (chat|conversation)\.?$", re.I), "new_chat"),
    (re.compile(r"^(stop|cancel|be quiet|stop talking|shut up)\.?$", re.I), "stop"),
    (re.compile(r"^(exit|close|end|quit) (voice|voice mode|conversation)\.?$|^goodbye\.?$|^bye\.?$", re.I), "exit_voice"),
    (re.compile(r"^(turn|switch) (on|off) (the )?web search\.?$", re.I), "toggle_web"),
    (re.compile(r"^(switch|change) to (fast|accurate) mode\.?$", re.I), "set_mode"),
]
_SEARCH = re.compile(r"^(please )?(search( the web| online| google)? for|look up|google) (?P<q>.+?)\.?$", re.I)


# Canonical short phrases for fuzzy matching of misheard one/two-word commands.
_SHORT = {"new chat": "New chat.", "stop": "Stop.", "cancel": "Cancel.", "goodbye": "Goodbye.", "bye": "Bye."}


def _fuzzy_short(text: str) -> str:
    """Map a misheard short utterance ("Nuchat.", "Top.") to its command phrase."""
    import difflib

    squashed = re.sub(r"[^a-z]", "", text.lower())
    if not squashed or len(text.split()) > 3:
        return text
    best, score = None, 0.0
    for phrase, canonical in _SHORT.items():
        r = difflib.SequenceMatcher(None, squashed, phrase.replace(" ", "")).ratio()
        if r > score:
            best, score = canonical, r
    return best if best and score >= 0.75 else text


def detect_command(text: str) -> dict | None:
    """Recognise spoken app commands. Returns {"name", ...} or None for a normal question."""
    t = _fuzzy_short(text.strip())
    for pattern, name in _COMMANDS:
        m = pattern.match(t)
        if m:
            if name == "toggle_web":
                return {"name": name, "value": m.group(2).lower() == "on"}
            if name == "set_mode":
                return {"name": name, "value": m.group(2).lower()}
            return {"name": name}
    m = _SEARCH.match(t)
    if m:
        # Still a question for the assistant, but force a live web search for it.
        return {"name": "web_search", "query": m.group("q")}
    return None


_UNITS = [
    (re.compile(r"₹\s?(\d+(?:,\d+)*(?:\.\d+)?)(?:\s?(crore|lakh|cr)\b)?", re.I), lambda m: re.sub(r"\s+", " ", f"{m.group(1)} {_crore(m.group(2))} rupees")),
    (re.compile(r"\$\s?(\d+(?:,\d+)*(?:\.\d+)?)(?:\s?(billion|million|bn|m|k)\b)?", re.I), lambda m: re.sub(r"\s+", " ", f"{m.group(1)} {_scale(m.group(2))} dollars")),
    (re.compile(r"(\d+(?:\.\d+)?)\s?%"), lambda m: f"{m.group(1)} percent"),
    (re.compile(r"\bvs\.?\b", re.I), lambda m: "versus"),
    (re.compile(r"\be\.g\.", re.I), lambda m: "for example"),
    (re.compile(r"\bi\.e\.", re.I), lambda m: "that is"),
]


def _crore(s: str | None) -> str:
    return {"cr": "crore", "crore": "crore", "lakh": "lakh"}.get((s or "").lower(), "")


def _scale(s: str | None) -> str:
    return {"bn": "billion", "billion": "billion", "m": "million", "million": "million", "k": "thousand"}.get((s or "").lower(), "")


def speakable(markdown: str) -> str:
    """Turn a Markdown reply into text that sounds natural when read aloud."""
    t = re.sub(r"```.*?```", " (code shown on screen) ", markdown, flags=re.S)
    t = re.sub(r"`([^`]+)`", r"\1", t)
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", t)
    t = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r"\1", t)
    t = re.sub(r"https?://\S+", "", t)
    t = re.sub(r"\[\d+(?:,\s*\d+)*\]", "", t)  # citation markers
    t = re.sub(r"^\s*\|?[-:| ]+\|?\s*$", "", t, flags=re.M)  # table separators
    t = t.replace("|", ", ")
    t = re.sub(r"^\s{0,3}#{1,6}\s*", "", t, flags=re.M)
    t = re.sub(r"^\s*[-*+]\s+", "", t, flags=re.M)
    t = re.sub(r"^\s*\d+\.\s+", "", t, flags=re.M)
    t = re.sub(r"[*_~>#]+", "", t)
    for pattern, repl in _UNITS:
        t = pattern.sub(repl, t)
    t = re.sub(r"\s*\n\s*", ". ", t)
    t = re.sub(r"\.\s*\.", ".", t)
    t = re.sub(r"\s+([.,;:!?])", r"\1", t)
    return re.sub(r"\s{2,}", " ", t).strip(" .") + "."
