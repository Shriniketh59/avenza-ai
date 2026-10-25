"""Image generation with Gemini's image models (Avenza Flash -> fast image model, Avenza Plus -> pro image model).

Images are saved under IMAGES_PATH and served by GET /images/<id> to their owner only, so chat history keeps a short
link instead of megabytes of base64. Token usage is added to the turn's tally like any other API call.
"""
import base64
import re
import uuid
from pathlib import Path

import requests
from flask import Blueprint, current_app, g, jsonify, send_file

from ..tokens import require_auth
from . import llm

bp = Blueprint("images", __name__)

# "generate / create / draw / make ... image / picture / photo / illustration / logo / poster ...", "imagine ...".
REQUEST = re.compile(
    r"\b(generate|create|draw|make|design|render|paint|produce|show me)\b.{0,40}?\b(an? |the |some |\d+ )?"
    r"(image|images|picture|pic|photo|photograph|illustration|artwork|drawing|painting|logo|icon|poster|banner|"
    r"wallpaper|sketch|thumbnail|avatar|mockup)s?\b|^\s*imagine\b",
    re.I,
)

_GUIDE = (
    "Create the image exactly as described. Follow every detail the user gives: subjects, counts, colours, layout, "
    "style and aspect. Spell any text in the image exactly as written by the user, and add no other text, logos or "
    "watermarks. If numbers or data are given, show them exactly. After the image, add one short sentence describing it."
)

_ID = re.compile(r"^[a-f0-9]{32}$")


def _dir(user_id: int) -> Path:
    path = Path(current_app.config["IMAGES_PATH"]) / str(user_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def generate(prompt: str, mode: str, user_id: int, images: list[str] = ()) -> tuple[list[str], str]:
    """Generate images for prompt; attached images (data URLs) are given to the model to edit or follow.

    Returns (image ids, the model's caption). Raises llm.LLMUnavailable.
    """
    cfg = current_app.config
    key = cfg["GEMINI_API_KEY"]
    if not key:
        raise llm.LLMUnavailable("Image generation needs GEMINI_API_KEY in .env.local.")
    model = cfg["IMAGE_MODELS"][mode]
    body = {
        "contents": [{"role": "user", "parts": [{"text": f"{_GUIDE}\n\nRequest: {prompt}"}, *[
            {"inlineData": {"mimeType": url[5:url.index(";")], "data": url.split(",", 1)[1]}} for url in images
        ]]}],
        "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
    }
    try:
        res = requests.post(f"{cfg['IMAGE_BASE_URL']}/models/{model}:generateContent",
                            headers={"x-goog-api-key": key}, json=body, timeout=(5, 120))
    except requests.RequestException as exc:
        raise llm.LLMUnavailable("Cannot reach the Gemini API for images. Check your internet connection.") from exc
    if res.status_code == 429:
        if "PerDay" in res.text and "FreeTier" in res.text:
            raise llm.LLMUnavailable(
                "Image generation is not included in the Gemini API free tier. Turn on billing for this API key's "
                "project in Google AI Studio (aistudio.google.com → Billing), then try again.")
        raise llm.LLMUnavailable("Image generation is busy (rate limit). Try again in a minute.")
    if not res.ok:
        raise llm.LLMUnavailable(f"Image generation failed ({res.status_code}): {llm._error_message(res)}")
    data = res.json()
    u = data.get("usageMetadata") or {}
    llm._count(mode, int(u.get("promptTokenCount") or 0), int(u.get("candidatesTokenCount") or 0))
    ids, caption = [], []
    for cand in data.get("candidates") or []:
        for part in (cand.get("content") or {}).get("parts") or []:
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and str(inline.get("mimeType", inline.get("mime_type", ""))).startswith("image/"):
                image_id = uuid.uuid4().hex
                (_dir(user_id) / f"{image_id}.png").write_bytes(base64.b64decode(inline["data"]))
                ids.append(image_id)
            elif part.get("text") and not part.get("thought"):
                caption.append(part["text"].strip())
    if not ids:
        reason = (data.get("candidates") or [{}])[0].get("finishReason") or (data.get("promptFeedback") or {}).get("blockReason")
        raise llm.LLMUnavailable("The model did not return an image" + (f" ({reason})." if reason else ". Try rephrasing."))
    return ids, " ".join(caption)[:600]


@bp.get("/images/<image_id>")
@require_auth
def get_image(image_id: str):
    if not _ID.match(image_id):
        return jsonify(error="Not found."), 404
    path = _dir(g.user["id"]) / f"{image_id}.png"
    if not path.exists():
        return jsonify(error="Not found."), 404
    return send_file(path, max_age=86400)
