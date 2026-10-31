"""Camera scans: pages of a book (or views of an object) captured live, read one by one into a document.

Each photo is read by the API vision model: pages are transcribed exactly, objects are described with every
visible label and number. Local OCR is the fallback when the model is unavailable. A photo of a page already
captured is skipped. The pages are stored and indexed like an uploaded file, so the chat answers questions
from them with page citations.

A book cover is looked up (books.py): its details are added, and for a public-domain book its whole text, so
questions about the inside can be answered from the cover alone.
"""
import base64
import re
import uuid
from datetime import datetime
from difflib import SequenceMatcher

from flask import Blueprint, current_app, g, jsonify, request

from . import usage
from .ai import books, indexer, llm, nlp, ocr
from .db import get_db
from .documents import _doc_json
from .tokens import require_auth

bp = Blueprint("scans", __name__, url_prefix="/scans")

MAX_PAGES = 300
MAX_IMAGE_MB = 8
MIME = "application/x-avenza-scan"

_PROMPT = """This is a photo taken with a phone camera. Read it for a person who will ask questions about it later.

If it shows text to read (a book or document page, a two-page spread, a screen, a label, a sign, a whiteboard):
- Transcribe ALL readable text exactly, in reading order. For a two-page spread, the left page first, then a line "---", then the right page.
- Keep headings (as Markdown #), lists, and tables (as Markdown tables). Copy every number, date, name and formula exactly.
- Describe each figure, chart or photo on the page in one line in [brackets], with any values it shows.
- Note a printed page number as "Printed page: N" on its own line at the end.

If it shows the front cover or spine of a book: transcribe every word on it (title, subtitle, author, publisher, series,
edition, ISBN, blurbs), and describe the cover picture in one line.

Otherwise (an object, product, device, plant, food, scene):
- Say exactly what it is, then describe it in detail: type, brand and model if visible, colour, material, size cues, parts, condition, how many.
- Copy every visible word, label, number, code and logo text exactly.

Never guess: write [unreadable] for text you cannot read, and do not add facts that are not visible.
Start your reply with exactly four lines:
KIND: page   (or KIND: cover, or KIND: object)
TITLE: the book, document or object's name if it is visible or clear, else -
AUTHOR: the book's author if visible, else -
ISBN: the ISBN if visible, else -"""

_HEAD = re.compile(r"^\s*KIND:\s*(page|cover|object)\s*\n\s*TITLE:\s*(.*?)\s*\n"
                   r"(?:\s*AUTHOR:\s*(.*?)\s*\n)?(?:\s*ISBN:\s*(.*?)\s*\n)?", re.I)


def _clean(field: str | None) -> str:
    return (field or "").strip(" -\"'")


def _read(image_url: str) -> tuple[str, str, str, str, str]:
    """(kind, title, author, isbn, text) for one photo: the vision model, else local OCR."""
    try:
        reply = llm.complete([{"role": "user", "content": [
            {"type": "text", "text": _PROMPT},
            {"type": "image_url", "image_url": {"url": image_url}},
        ]}], mode="fast").strip()
        m = _HEAD.match(reply + "\n")
        if m:
            return m[1].lower(), _clean(m[2]), _clean(m[3]), _clean(m[4]), reply[m.end():].strip()
        if reply:
            return "page", "", "", "", reply
    except Exception as exc:  # no key, rate limit, network: fall back to reading the text locally
        current_app.logger.warning("scan vision failed, using local OCR: %s", exc)
    return "page", "", "", "", ocr.read_data_url(image_url).strip()


def _norm(text: str) -> str:
    return re.sub(r"\W+", " ", text.lower()).strip()


@bp.post("")
@require_auth
def create():
    """An empty scan document; pages are added with POST /scans/<id>/pages."""
    title = str((request.get_json(silent=True) or {}).get("title") or "").strip()[:80]
    doc_id = uuid.uuid4().hex
    name = f"Scan · {title or datetime.now().strftime('%d %b %Y %H:%M')}"
    db = get_db()
    db.execute("INSERT INTO documents (id, user_id, filename, mime_type, size_bytes, chunks, indexed, status) "
               "VALUES (?, ?, ?, ?, 0, 0, 0, 'ready')", (doc_id, g.user["id"], name, MIME))
    db.commit()
    return jsonify(document=_doc_json(db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone())), 201


@bp.post("/<doc_id>/pages")
@require_auth
def add_page(doc_id: str):
    db = get_db()
    doc = db.execute("SELECT * FROM documents WHERE id = ? AND user_id = ? AND mime_type = ?",
                     (doc_id, g.user["id"], MIME)).fetchone()
    if doc is None:
        return jsonify(error="Scan not found."), 404
    image = request.files.get("image")
    if image is None:
        return jsonify(error="No photo uploaded."), 400
    data = image.read()
    if len(data) > MAX_IMAGE_MB * 1024 * 1024:
        return jsonify(error=f"Photo is larger than {MAX_IMAGE_MB} MB."), 413
    limit = usage.blocked(g.user["id"])
    if limit:
        return jsonify(error=limit, code="USAGE_LIMIT"), 429

    rows = db.execute("SELECT idx, text, page FROM doc_chunks WHERE document_id = ? ORDER BY idx", (doc_id,)).fetchall()
    page = max((r["page"] or 0 for r in rows), default=0) + 1
    if page > MAX_PAGES:
        return jsonify(error=f"A scan can have up to {MAX_PAGES} pages. Start a new scan."), 400

    g.usage = {}  # the vision call counts toward the account's usage, like a chat turn
    mime = image.mimetype if (image.mimetype or "").startswith("image/") else "image/jpeg"
    kind, title, author, isbn, text = _read(f"data:{mime};base64,{base64.b64encode(data).decode()}")
    usage.record(g.user["id"], g.usage)
    if not text or len(_norm(text)) < 3:
        return jsonify(status="empty", error="Nothing readable in this photo. Hold the page flat, in good light."), 200

    # The same page held up twice (or the camera catching it again before the turn): skip it.
    by_page: dict[int, str] = {}
    for r in rows:
        if r["page"] is not None:  # full text loaded from a cover has no page
            by_page[r["page"]] = by_page.get(r["page"], "") + " " + r["text"]
    new = _norm(text)
    for p in sorted(by_page)[-3:]:
        old = _norm(re.sub(r"\[Page \d+\]|Camera photo \d+.*?\n", " ", by_page[p]))
        if SequenceMatcher(None, new[:3000], old[:3000], autojunk=False).ratio() > 0.85:
            return jsonify(status="duplicate", page=p, document=_doc_json(doc)), 200

    label = {"page": "page", "cover": "book cover", "object": "object view"}[kind]
    body = f"[Page {page}]\nCamera photo {page} ({label}{f': {title}' if title else ''})\n{text}"
    chunks = nlp.chunk_text(body)
    pages: list[int | None] = [page] * len(chunks)

    # A book cover: look the book up and add what can be read of its inside (once per book in a scan).
    found = None
    if kind == "cover" and (title or isbn) and not any(f"Book details: {title.lower()}" in r["text"].lower() for r in rows):
        found = books.lookup(title, author, isbn)
        if found:
            details = f"[Page {page + 1}]\nBook details: {title} (from {', '.join(found.sources) or 'book catalogues'})\n{found.info}"
            more = nlp.chunk_text(details)
            chunks += more
            pages += [page + 1] * len(more)
            if found.full_text:
                # The whole book has no printed page numbers here: its passages are cited as the full text.
                full = nlp.chunk_text(found.full_text)
                chunks += [f"Full text of {found.title} (Project Gutenberg, {found.full_text_source}):\n{c}" for c in full]
                pages += [None] * len(full)

    start = len(rows)
    db.executemany("INSERT INTO doc_chunks (document_id, user_id, idx, text, page) VALUES (?, ?, ?, ?, ?)",
                   [(doc_id, g.user["id"], start + i, c, pages[i]) for i, c in enumerate(chunks)])
    # The first title the camera reads names the scan, unless the user named it.
    rename = title and page == 1 and re.fullmatch(r"Scan · \d{2} \w{3} \d{4} \d{2}:\d{2}", doc["filename"])
    db.execute("UPDATE documents SET chunks = ?, size_bytes = size_bytes + ?, status = 'indexing'"
               + (", filename = ?" if rename else "") + " WHERE id = ?",
               (start + len(chunks), len(data), *([f"Scan · {title[:70]}"] if rename else []), doc_id))
    db.commit()
    doc = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
    indexer.submit(current_app._get_current_object(),
                   indexer.Job(g.user["id"], doc_id, doc["filename"], chunks, pages, offset=start))
    preview = re.sub(r"\s+", " ", text)[:160]
    book = found and {"title": found.title, "authors": found.authors[:3], "fullText": bool(found.full_text),
                      "characters": len(found.full_text), "source": found.full_text_source or (found.sources or [""])[0]}
    return jsonify(status="added", page=page, kind=kind, title=title, preview=preview, book=book or None,
                   document=_doc_json(doc)), 201
