"""Local speech: faster-whisper (speech-to-text) and Piper (text-to-speech). Models load lazily, once.

Piper has about 180 voices in about 55 languages (catalog: rhasspy/piper-voices on Hugging Face). Any of them can
be installed from Settings; a reply is spoken by an installed voice of its own language when there is one.
"""
import io
import json
import re
import tempfile
import threading
import time
import wave
from pathlib import Path

import requests
from flask import current_app

# Domain words bias Whisper toward correct spellings of names and finance terms. Written as natural phrases:
# a bare list of company names pulled similar-sounding words toward them ("repo rate" -> "Wipro rate").
# Measured 2026-10-25 (small model): "Tata Motors", "EMI", "SIP", "lump sum" now heard correctly.
VOCAB_HINT = (
    "AVENZA AI, a finance and technology assistant. The RBI repo rate, home loan EMI, SIP and lump sum in mutual "
    "funds, NAV, EBITDA, GST, GDP, inflation, Nifty, Sensex, the NSE and BSE stock exchanges, SEBI, UPI, IPO, "
    "rupees, crore, lakh. Reliance Industries, Tata Motors, TCS, Infosys, HDFC Bank, ICICI Bank."
)

# Languages users are expected to speak when auto-detecting; anything else on a short clip is usually a
# misdetection ("New chat." -> Russian), so it is retried as English. Picking a language in Settings skips this,
# and Whisper itself understands all of its 99 languages.
EXPECTED_LANGUAGES = {
    "en", "hi", "ta", "te", "kn", "ml", "mr", "bn", "gu", "pa", "ur", "ne", "si", "or", "as",
    "es", "fr", "de", "it", "pt", "nl", "sv", "no", "da", "fi", "pl", "cs", "sk", "hu", "ro", "el", "bg", "uk", "ru",
    "tr", "ar", "fa", "he", "zh", "ja", "ko", "th", "vi", "id", "ms", "tl", "sw", "am", "yo", "ha",
}

_lock = threading.Lock()
_whisper = None
_voices: dict = {}


class SpeechError(RuntimeError):
    pass


def _whisper_model():
    global _whisper
    with _lock:
        if _whisper is None:
            from faster_whisper import WhisperModel

            cfg = current_app.config
            _whisper = WhisperModel(cfg["WHISPER_MODEL"], device="cpu", compute_type="int8", download_root=cfg["WHISPER_DIR"])
        return _whisper


def transcribe(audio: bytes, language: str | None = None) -> dict:
    """Return {"text", "language", "duration"} for an audio clip (webm/ogg/wav/mp3...)."""
    model = _whisper_model()
    forced = None if not language or language == "auto" else language
    with tempfile.NamedTemporaryFile(suffix=".audio") as tmp:
        tmp.write(audio)
        tmp.flush()
        try:
            with _lock:  # CTranslate2 model: one transcription at a time on CPU
                text, info = _run(model, tmp.name, forced)
                # Auto-detect is unreliable on very short clips ("New chat." -> Russian).
                if not forced and (info.language not in EXPECTED_LANGUAGES or info.language_probability < 0.6):
                    text, info = _run(model, tmp.name, "en")
                # Silence trimming can clip the first syllable of one- or two-word commands.
                if info.duration < 2.5 and len(text.split()) <= 3:
                    text, info = _run(model, tmp.name, info.language if info.language in EXPECTED_LANGUAGES else "en", vad=False)
        except Exception as exc:
            raise SpeechError("Could not decode the recording.") from exc
    return {"text": text, "language": info.language, "duration": round(info.duration, 2)}


def _run(model, path: str, language: str | None, vad: bool = True):
    segments, info = model.transcribe(
        path,
        language=language,
        beam_size=5,  # ~0.1 s more than greedy on the small model, fewer misheard words
        vad_filter=vad,
        vad_parameters={"min_silence_duration_ms": 400},
        # The hint is English: for other forced languages it pulls the transcript toward English words.
        initial_prompt=VOCAB_HINT if language in (None, "en", "hi") else None,
        condition_on_previous_text=False,
    )
    return " ".join(s.text.strip() for s in segments).strip(), info


def warm_up(app):
    """Load Whisper, the default voice and the NLP models in the background so the first request is fast."""

    def load():
        with app.app_context():
            try:
                _whisper_model()
                _voice(app.config["DEFAULT_VOICE"])
                # Spoken answers come from the reranker + reader, so load those instead of an LLM.
                from . import reader

                reader.warm_up()
            except Exception as exc:
                app.logger.warning("voice warm-up failed: %s", exc)

    threading.Thread(target=load, name="voice-warmup", daemon=True).start()


def _voices_dir() -> Path:
    return Path(current_app.config["VOICES_DIR"])


def available_voices() -> list[dict]:
    """Installed voices, with their language from each voice's own config."""
    out = []
    for f in sorted(_voices_dir().glob("*.onnx")):
        try:
            lang = json.loads(f.with_suffix(".onnx.json").read_text()).get("language") or {}
        except (OSError, ValueError):
            lang = {}
        code, name, quality = (f.stem.split("-") + ["", ""])[:3]
        out.append({"id": f.stem, "language": code.replace("_", "-"), "name": name.replace("_", " ").title(),
                    "quality": quality, "languageName": lang.get("name_english") or code,
                    "nativeName": lang.get("name_native") or "", "country": lang.get("country_english") or ""})
    return out


# --- Voice catalog and installs -------------------------------------------------------------------------------

CATALOG_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/voices.json?download=true"
FILE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/{path}?download=true"
_CATALOG_TTL = 7 * 24 * 3600
_installs: dict[str, dict] = {}  # voice id -> {"state": "installing" | "error", "error"?, "progress"}


def _catalog_raw() -> dict:
    """Piper's voices.json, cached for a week in the voices folder (the cached copy is used when offline)."""
    path = _voices_dir() / "catalog.json"
    if not path.exists() or time.time() - path.stat().st_mtime > _CATALOG_TTL:
        try:
            res = requests.get(CATALOG_URL, timeout=15)
            res.raise_for_status()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(res.text)
        except (requests.RequestException, OSError) as exc:
            if not path.exists():
                raise SpeechError("Could not load the voice list. Check the internet connection.") from exc
    return json.loads(path.read_text())


def catalog() -> list[dict]:
    """Every Piper voice: id, language, name, quality, size and whether it is installed or installing."""
    installed = {v["id"] for v in available_voices()}
    out = []
    for key, v in _catalog_raw().items():
        lang = v["language"]
        size = sum(f["size_bytes"] for p, f in v["files"].items() if p.endswith(".onnx"))
        state = "installed" if key in installed else _installs.get(key, {}).get("state", "available")
        out.append({"id": key, "language": lang["code"].replace("_", "-"), "languageName": lang["name_english"],
                    "nativeName": lang.get("name_native", ""), "country": lang.get("country_english", ""),
                    "name": v["name"].replace("_", " ").title(), "quality": v["quality"], "speakers": v.get("num_speakers", 1),
                    "sizeMb": round(size / 1e6), "state": state, "error": _installs.get(key, {}).get("error"),
                    "progress": _installs.get(key, {}).get("progress", 0)})
    return sorted(out, key=lambda x: (x["languageName"], x["country"], x["name"], x["quality"]))


def install_voice(voice_id: str) -> None:
    """Download a voice in the background; catalog() reports progress and the result."""
    entry = _catalog_raw().get(voice_id)
    if entry is None:
        raise SpeechError("Unknown voice.")
    if (_voices_dir() / f"{voice_id}.onnx").exists() or _installs.get(voice_id, {}).get("state") == "installing":
        return
    files = [p for p in entry["files"] if p.endswith((".onnx", ".onnx.json"))]
    total = sum(entry["files"][p]["size_bytes"] for p in files) or 1
    folder = _voices_dir()
    _installs[voice_id] = {"state": "installing", "progress": 0}

    def run():
        done = 0
        try:
            # The config first and the model last, renamed into place only when complete: a voice whose
            # .onnx exists is always whole.
            for path in sorted(files, key=lambda p: p.endswith(".onnx")):
                target = folder / path.rsplit("/", 1)[-1]
                part = target.with_name(target.name + ".part")
                with requests.get(FILE_URL.format(path=path), stream=True, timeout=30) as res:
                    res.raise_for_status()
                    with open(part, "wb") as fh:
                        for chunk in res.iter_content(1 << 20):
                            fh.write(chunk)
                            done += len(chunk)
                            _installs[voice_id]["progress"] = min(99, round(100 * done / total))
                part.replace(target)
            _installs.pop(voice_id, None)
        except Exception as exc:  # network or disk: shown next to the voice, which can be retried
            for p in folder.glob(f"{voice_id}.*.part"):
                p.unlink(missing_ok=True)
            _installs[voice_id] = {"state": "error", "error": f"Download failed: {exc.__class__.__name__}", "progress": 0}

    threading.Thread(target=run, name=f"voice-install-{voice_id}", daemon=True).start()


def remove_voice(voice_id: str) -> None:
    if voice_id == current_app.config["DEFAULT_VOICE"]:
        raise SpeechError("The default voice cannot be removed.")
    if not re.fullmatch(r"[\w-]+", voice_id):
        raise SpeechError("Unknown voice.")
    for suffix in (".onnx", ".onnx.json"):
        (_voices_dir() / f"{voice_id}{suffix}").unlink(missing_ok=True)
    with _lock:
        _voices.pop(voice_id, None)


# --- Picking a voice for a reply ------------------------------------------------------------------------------

# Writing systems that point to one language family (first is the likeliest; Devanagari is Hindi before Marathi).
_SCRIPTS = [
    (r"[\u0900-\u097f]", ["hi", "mr", "ne"]), (r"[\u0980-\u09ff]", ["bn"]), (r"[\u0c00-\u0c7f]", ["te"]),
    (r"[\u0d00-\u0d7f]", ["ml"]), (r"[\u0b80-\u0bff]", ["ta"]), (r"[\u0c80-\u0cff]", ["kn"]),
    (r"[\u0a80-\u0aff]", ["gu"]), (r"[\u0a00-\u0a7f]", ["pa"]), (r"[\u0b00-\u0b7f]", ["or"]), (r"[\u0600-\u06ff]", ["ar", "fa", "ur"]), (r"[\u0590-\u05ff]", ["he"]),
    (r"[\u0400-\u04ff]", ["ru", "uk", "bg", "sr", "kk"]), (r"[\u0370-\u03ff]", ["el"]), (r"[\u0e00-\u0e7f]", ["th"]),
    (r"[\uac00-\ud7af]", ["ko"]), (r"[\u3040-\u30ff]", ["ja"]), (r"[\u4e00-\u9fff]", ["zh", "ja"]),
    (r"[\u10a0-\u10ff]", ["ka"]), (r"[\u0530-\u058f]", ["hy"]),
]

_NON_LATIN = {f for _, fams in _SCRIPTS for f in fams}


def _families(text: str, language: str | None) -> list[str]:
    """Language families to look for, most likely first: the text's script, then the language the client gave."""
    sample = re.sub(r"[\s\d\W_]+", "", text[:400])
    out = []
    if sample:
        for pattern, fams in _SCRIPTS:
            if len(re.findall(pattern, sample)) / len(sample) > 0.3:
                out += fams
                break
    if language and language != "auto":
        fam = re.split(r"[-_]", language)[0].lower()
        if fam in out:
            out = [fam] + [f for f in out if f != fam]
        elif not out and fam not in _NON_LATIN:  # romanised Hindi ("kya haal hai") is not read by a Hindi voice
            out = [fam]
    return out


class NoVoice(SpeechError):
    """The text's language is known but no installed voice speaks it (the browser's own voice is used instead)."""

    def __init__(self, family: str):
        super().__init__(f"No voice is installed for this language ({family}). Install one in Settings, Voice library.")
        self.family = family


_langid = None


def _latin_language(text: str, families: set[str]) -> str:
    """Language of Latin-script text, among the installed voices' languages. English unless clearly another:
    short or mixed sentences are often misread, and an English voice reading English is the safe default."""
    global _langid
    from . import languages

    if languages.is_english(text) or len(text) < 15:
        return "en"
    candidates = sorted(families - _NON_LATIN | {"en"})
    if len(candidates) < 2:
        return "en"
    with _lock:
        if _langid is None:
            from langid.langid import LanguageIdentifier, model

            _langid = LanguageIdentifier.from_modelstring(model, norm_probs=True)
        _langid.set_languages(candidates)
        lang, prob = _langid.classify(text)
    return lang if prob >= 0.9 else "en"


def voice_for(text: str, voice_id: str | None, language: str | None, by_language: dict | None = None) -> str:
    """The voice to speak this text with: the text's language from its script, the language the app sends, or
    detection; then the user's voice for that language (Settings), else an installed voice of it. Raises NoVoice
    when the language is known and no voice speaks it, rather than an English voice garbling it."""
    installed = [v["id"] for v in available_voices()]
    default = current_app.config["DEFAULT_VOICE"]
    picked = voice_id if voice_id and voice_id != "auto" and voice_id in installed else None
    fams = _families(text, language)
    if not fams:
        fams = [_latin_language(text, {v.split("_")[0] for v in installed})]
    chosen = {str(k).lower(): str(v) for k, v in (by_language or {}).items()}
    for fam in fams:
        if chosen.get(fam) in installed:
            return chosen[fam]
        if picked and picked.split("_")[0] == fam:
            return picked
        matches = [v for v in installed if v.split("_")[0] == fam]
        if matches:
            return default if default in matches else matches[0]
    if fams[0] != "en":
        raise NoVoice(fams[0])
    return picked or default


def _voice(voice_id: str):
    from piper import PiperVoice

    path = _voices_dir() / f"{voice_id}.onnx"
    if not path.exists():
        path = _voices_dir() / f"{current_app.config['DEFAULT_VOICE']}.onnx"
    if not path.exists():
        raise SpeechError("No voice installed. Run: python -m piper.download_voices en_US-lessac-medium --data-dir backend/instance/voices")
    with _lock:
        if path.stem not in _voices:
            _voices[path.stem] = PiperVoice.load(str(path))
        return _voices[path.stem]


def synthesize(text: str, voice_id: str | None = None, speed: float = 1.0, language: str | None = None,
               by_language: dict | None = None) -> bytes:
    """Return WAV bytes. speed > 1 talks faster. language (like "hi" or "es") helps pick a voice for text
    whose script does not show its language; by_language maps a language to the user's voice for it."""
    from piper import SynthesisConfig

    voice = _voice(voice_for(text, voice_id, language, by_language))
    speed = min(max(speed, 0.6), 1.8)
    buf = io.BytesIO()
    try:
        with wave.open(buf, "wb") as wav:
            voice.synthesize_wav(text, wav, syn_config=SynthesisConfig(length_scale=1.0 / speed))
    except Exception as exc:  # a voice whose language needs a missing helper package, or text it cannot read
        current_app.logger.warning("speech synthesis failed: %s", exc)
        raise SpeechError("This voice could not read the text.") from exc
    return _louder(buf.getvalue(), current_app.config["VOICE_BOOST"])


def _louder(wav_bytes: bytes, boost: float) -> bytes:
    """Even, clear loudness for phone speakers. Each clip is brought to the same average level (voices differ by
    up to 8 dB), then only the loudest peaks are softened, so speech is not distorted. The earlier tanh
    compressor squashed every loud syllable of the louder voices (Hindi, Arabic), which blurred them.
    boost is the most a quiet clip is amplified; 1 turns it off."""
    if boost <= 1:
        return wav_bytes
    import numpy as np

    with wave.open(io.BytesIO(wav_bytes)) as src:
        params = src.getparams()
        x = np.frombuffer(src.readframes(src.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    voiced = x[np.abs(x) > 0.02]  # pauses would make the average look quieter than the speech is
    rms = float(np.sqrt(np.mean(voiced ** 2))) if voiced.size else 0.0
    if rms > 0:
        x = x * min(boost, 10 ** (-12 / 20) / rms)  # target -12 dBFS while speaking: loud on phones, still clean
    knee = 0.7
    over = np.abs(x) > knee
    x[over] = np.sign(x[over]) * (knee + (1 - knee) * np.tanh((np.abs(x[over]) - knee) / (1 - knee)))
    out = io.BytesIO()
    with wave.open(out, "wb") as dst:
        dst.setparams(params)
        dst.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())
    return out.getvalue()
