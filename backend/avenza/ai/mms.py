"""Neural voices from Meta's MMS-TTS for languages Piper has no voice for (Tamil first).

Each voice is a folder backend/instance/voices/mms-<code>/ with model.onnx and config.json, converted once from
facebook/mms-tts-<iso3> by backend/tools/export_mms_voice.py. It runs on onnxruntime like the other models.
MMS voices are licensed CC-BY-NC-4.0: fine for personal and testing use, not for a commercial product.

The model reads only its own alphabet, so numbers and English abbreviations (EMI, GST) are spelled out in the
language first (Tamil); other Latin-script words are skipped.
"""
import json
import re
import threading
from pathlib import Path

import numpy as np

_lock = threading.Lock()
_sessions: dict[str, tuple] = {}


def installed(voices_dir: Path) -> list[dict]:
    out = []
    for cfg_path in sorted(voices_dir.glob("mms-*/config.json")):
        code = cfg_path.parent.name.removeprefix("mms-")
        from .languages import LANGUAGES

        name, native = next(((n, nat) for c, n, nat in LANGUAGES if c == code), (code, ""))
        out.append({"id": cfg_path.parent.name, "language": f"{code}-IN", "name": "MMS", "quality": "medium",
                    "languageName": name, "nativeName": native, "country": "India (Meta MMS, non-commercial)"})
    return out


def _load(folder: Path):
    with _lock:
        if folder.name not in _sessions:
            import onnxruntime as ort

            cfg = json.loads((folder / "config.json").read_text())
            sess = ort.InferenceSession(str(folder / "model.onnx"), providers=["CPUExecutionProvider"])
            _sessions[folder.name] = (sess, cfg)
        return _sessions[folder.name]


def synthesize(folder: Path, text: str, speed: float = 1.0) -> tuple[np.ndarray, int]:
    """(float waveform, sample rate) for text, read by the MMS voice in folder."""
    sess, cfg = _load(folder)
    code = folder.name.removeprefix("mms-")
    if code == "ta":
        text = tamil_abbreviations(tamil_numbers(text))
    vocab, pad = cfg["vocab"], cfg["pad_id"]
    chars = [c for c in (text.lower() if cfg.get("normalize", True) else text) if c in vocab]
    if not any(c.strip() for c in chars):
        return np.zeros(0, dtype=np.float32), cfg["sample_rate"]
    ids = [pad]
    for c in chars:
        ids += [vocab[c], pad]
    wave = sess.run(None, {"input_ids": np.array([ids], dtype=np.int64),
                           "speaking_rate": np.array(speed, dtype=np.float32)})[0][0]
    return wave.astype(np.float32), cfg["sample_rate"]


# --- Tamil numbers --------------------------------------------------------------------------------------------

_UNITS = ["பூஜ்ஜியம்", "ஒன்று", "இரண்டு", "மூன்று", "நான்கு", "ஐந்து", "ஆறு", "ஏழு", "எட்டு", "ஒன்பது"]
_TEENS = ["பத்து", "பதினொன்று", "பன்னிரண்டு", "பதிமூன்று", "பதினான்கு", "பதினைந்து", "பதினாறு", "பதினேழு",
          "பதினெட்டு", "பத்தொன்பது"]
_TENS = ["", "", "இருபது", "முப்பது", "நாற்பது", "ஐம்பது", "அறுபது", "எழுபது", "எண்பது", "தொண்ணூறு"]
_TENS_JOIN = ["", "", "இருபத்தி", "முப்பத்தி", "நாற்பத்தி", "ஐம்பத்தி", "அறுபத்தி", "எழுபத்தி", "எண்பத்தி", "தொண்ணூற்றி"]
_HUNDREDS = ["", "நூறு", "இருநூறு", "முன்னூறு", "நானூறு", "ஐநூறு", "அறுநூறு", "எழுநூறு", "எண்ணூறு", "தொள்ளாயிரம்"]
_HUNDREDS_JOIN = ["", "நூற்றி", "இருநூற்றி", "முன்னூற்றி", "நானூற்றி", "ஐநூற்றி", "அறுநூற்றி", "எழுநூற்றி", "எண்ணூற்றி",
                  "தொள்ளாயிரத்தி"]


def _below_1000(n: int) -> str:
    h, rest = divmod(n, 100)
    parts = []
    if h:
        parts.append(_HUNDREDS_JOIN[h] if rest else _HUNDREDS[h])
    if rest >= 20:
        t, u = divmod(rest, 10)
        parts.append(f"{_TENS_JOIN[t]} {_UNITS[u]}" if u else _TENS[t])
    elif rest >= 10:
        parts.append(_TEENS[rest - 10])
    elif rest or not h:
        parts.append(_UNITS[rest])
    return " ".join(parts)


def tamil_words(n: int) -> str:
    """Spoken Tamil for a whole number, in the Indian system (ஆயிரம், லட்சம், கோடி)."""
    if n == 0:
        return _UNITS[0]
    parts = []
    for size, word, join in ((10 ** 7, "கோடி", "கோடியே"), (10 ** 5, "லட்சம்", "லட்சத்து"), (1000, "ஆயிரம்", "ஆயிரத்தி")):
        q, n = divmod(n, size)
        if q:
            parts.append((f"{tamil_words(q)} " if q > 1 else "") + (join if n else word))
    if n:
        parts.append(_below_1000(n))
    return " ".join(parts)


def _number(m: re.Match) -> str:
    whole, frac = m["whole"].replace(",", ""), m["frac"]
    out = tamil_words(int(whole)) if len(whole) <= 15 else " ".join(_UNITS[int(d)] for d in whole)
    if frac:
        out += " புள்ளி " + " ".join(_UNITS[int(d)] for d in frac)
    return out


def tamil_numbers(text: str) -> str:
    text = re.sub(r"₹\s?([\d,]+(?:\.\d+)?)", r"\1 ரூபாய்", text)
    text = re.sub(r"\$\s?([\d,]+(?:\.\d+)?)", r"\1 டாலர்", text)
    text = re.sub(r"([\d,]+(?:\.\d+)?)\s?%", r"\1 சதவீதம்", text)
    return re.sub(r"(?P<whole>\d[\d,]*)(?:\.(?P<frac>\d+))?", _number, text)


# English letters as Tamil speakers say them, for abbreviations in Tamil text: "EMI" -> ஈ எம் ஐ.
_LETTERS = {"A": "ஏ", "B": "பி", "C": "சி", "D": "டி", "E": "ஈ", "F": "எஃப்", "G": "ஜி", "H": "ஹெச்", "I": "ஐ", "J": "ஜே",
            "K": "கே", "L": "எல்", "M": "எம்", "N": "என்", "O": "ஓ", "P": "பி", "Q": "க்யூ", "R": "ஆர்", "S": "எஸ்", "T": "டி",
            "U": "யு", "V": "வி", "W": "டபிள்யூ", "X": "எக்ஸ்", "Y": "வை", "Z": "இசட்"}


def tamil_abbreviations(text: str) -> str:
    return re.sub(r"\b[A-Z]{2,6}s?\b", lambda m: " ".join(_LETTERS[c] for c in m.group().rstrip("s")), text)
