"""Local speech: faster-whisper (speech-to-text) and Piper (text-to-speech). Models load lazily, once."""
import io
import tempfile
import threading
import wave
from pathlib import Path

from flask import current_app

# Domain words bias Whisper toward correct spellings of names and finance terms.
VOCAB_HINT = (
    "AVENZA AI. Finance and technology: RBI, repo rate, EBITDA, GST, Nifty, Sensex, NSE, BSE, "
    "SEBI, UPI, fintech, ChromaDB, rupees, crore, lakh."
)

# Languages users are expected to speak; anything else on a short clip is usually a misdetection.
EXPECTED_LANGUAGES = {"en", "hi", "ta", "te", "kn", "ml", "mr", "bn", "gu", "pa", "ur", "es", "fr", "de"}

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
        beam_size=1,
        vad_filter=vad,
        vad_parameters={"min_silence_duration_ms": 400},
        initial_prompt=VOCAB_HINT,
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


def available_voices() -> list[dict]:
    out = []
    for f in sorted(Path(current_app.config["VOICES_DIR"]).glob("*.onnx")):
        lang, name, quality = (f.stem.split("-") + ["", ""])[:3]
        out.append({"id": f.stem, "language": lang.replace("_", "-"), "name": name.title(), "quality": quality})
    return out


def _voice(voice_id: str):
    from piper import PiperVoice

    path = Path(current_app.config["VOICES_DIR"]) / f"{voice_id}.onnx"
    if not path.exists():
        path = Path(current_app.config["VOICES_DIR"]) / f"{current_app.config['DEFAULT_VOICE']}.onnx"
    if not path.exists():
        raise SpeechError("No voice installed. Run: python -m piper.download_voices en_US-lessac-medium --data-dir backend/instance/voices")
    with _lock:
        if path.stem not in _voices:
            _voices[path.stem] = PiperVoice.load(str(path))
        return _voices[path.stem]


def synthesize(text: str, voice_id: str | None = None, speed: float = 1.0) -> bytes:
    """Return WAV bytes. speed > 1 talks faster."""
    from piper import SynthesisConfig

    voice = _voice(voice_id or current_app.config["DEFAULT_VOICE"])
    speed = min(max(speed, 0.6), 1.8)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        voice.synthesize_wav(text, wav, syn_config=SynthesisConfig(length_scale=1.0 / speed))
    return buf.getvalue()
