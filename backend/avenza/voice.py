from flask import Blueprint, Response, current_app, jsonify, request

from .ai import speech, voice_nlp
from .tokens import require_auth

bp = Blueprint("voice", __name__, url_prefix="/voice")


@bp.post("/transcribe")
@require_auth
def transcribe():
    audio = request.files.get("audio")
    if audio is None:
        return jsonify(error="No audio uploaded."), 400
    data = audio.read()
    if len(data) > current_app.config["VOICE_MAX_AUDIO_MB"] * 1024 * 1024:
        return jsonify(error="Recording is too long."), 413
    if len(data) < 1000:
        return jsonify(text="", language=None, command=None)
    try:
        result = speech.transcribe(data, request.form.get("language"))
    except speech.SpeechError as exc:
        return jsonify(error=str(exc)), 422
    text = voice_nlp.clean_transcript(result["text"])
    return jsonify(text=text, language=result["language"], duration=result["duration"], command=voice_nlp.detect_command(text))


@bp.post("/speak")
@require_auth
def speak():
    data = request.get_json(silent=True) or {}
    language = str(data.get("language") or "") or None
    text = voice_nlp.speakable(str(data.get("text", "")), language)[:1500]
    if len(text) < 2:
        return jsonify(error="Nothing to say."), 400
    by_language = data.get("voices") if isinstance(data.get("voices"), dict) else None
    try:
        wav = speech.synthesize(text, data.get("voice"), float(data.get("speed", 1.0)), language, by_language)
    except speech.NoVoice as exc:
        # The app then reads it with the device's own voice for that language.
        return jsonify(error=str(exc), code="NO_VOICE", language=exc.family), 422
    except speech.SpeechError as exc:
        return jsonify(error=str(exc)), 503
    return Response(wav, mimetype="audio/wav", headers={"Cache-Control": "no-store"})


@bp.get("/voices")
@require_auth
def voices():
    return jsonify(voices=speech.available_voices(), default=current_app.config["DEFAULT_VOICE"])


@bp.get("/catalog")
@require_auth
def catalog():
    try:
        return jsonify(voices=speech.catalog(), default=current_app.config["DEFAULT_VOICE"])
    except speech.SpeechError as exc:
        return jsonify(error=str(exc)), 503


@bp.post("/voices/<voice_id>")
@require_auth
def install(voice_id: str):
    try:
        speech.install_voice(voice_id)
    except speech.SpeechError as exc:
        return jsonify(error=str(exc)), 400
    return jsonify(ok=True), 202


@bp.delete("/voices/<voice_id>")
@require_auth
def remove(voice_id: str):
    try:
        speech.remove_voice(voice_id)
    except speech.SpeechError as exc:
        return jsonify(error=str(exc)), 400
    return jsonify(ok=True)
