import uuid

from flask import Blueprint, current_app, g, jsonify, request

from .ai import indexer, nlp, vectorstore
from .ai.extract import UnsupportedFile, chunk_pages, extract_text
from .db import get_db
from .tokens import require_auth

bp = Blueprint("documents", __name__, url_prefix="/documents")


def _doc_json(row) -> dict:
    return {
        "id": row["id"],
        "filename": row["filename"],
        "mimeType": row["mime_type"],
        "size": row["size_bytes"],
        "chunks": row["chunks"],
        "indexed": row["indexed"],
        "progress": round(row["indexed"] / row["chunks"], 3) if row["chunks"] else 1,
        "status": row["status"],
        "error": row["error"],
        "createdAt": row["created_at"],
    }


@bp.get("")
@require_auth
def list_documents():
    rows = get_db().execute(
        "SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC", (g.user["id"],)
    ).fetchall()
    return jsonify(documents=[_doc_json(r) for r in rows])


@bp.post("")
@require_auth
def upload():
    file = request.files.get("file")
    if file is None or not file.filename:
        return jsonify(error="No file uploaded."), 400
    data = file.read()
    max_bytes = current_app.config["UPLOAD_MAX_MB"] * 1024 * 1024
    if len(data) > max_bytes:
        return jsonify(error=f"File is larger than {current_app.config['UPLOAD_MAX_MB']} MB."), 413

    try:
        text = extract_text(file.filename, data)
    except UnsupportedFile as exc:
        return jsonify(error=str(exc)), 415
    except Exception:
        current_app.logger.exception("extract failed")
        return jsonify(error="Could not read this file. It may be encrypted or corrupted."), 422

    chunks = nlp.chunk_text(text)
    if not chunks:
        return jsonify(error="No readable text found in this file."), 422

    doc_id = uuid.uuid4().hex
    db = get_db()
    db.execute(
        "INSERT INTO documents (id, user_id, filename, mime_type, size_bytes, chunks, indexed, status) "
        "VALUES (?, ?, ?, ?, ?, ?, 0, 'indexing')",
        (doc_id, g.user["id"], file.filename, file.mimetype, len(data), len(chunks)),
    )
    db.commit()
    # Embedding is the slow part (~0.25 s per passage on CPU): do it in the background.
    indexer.submit(current_app._get_current_object(), indexer.Job(g.user["id"], doc_id, file.filename, chunks, chunk_pages(chunks)))
    return jsonify(document=_doc_json(db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone())), 202


@bp.get("/<doc_id>")
@require_auth
def status(doc_id: str):
    row = get_db().execute("SELECT * FROM documents WHERE id = ? AND user_id = ?", (doc_id, g.user["id"])).fetchone()
    if row is None:
        return jsonify(error="Document not found."), 404
    return jsonify(document=_doc_json(row))


@bp.delete("/<doc_id>")
@require_auth
def delete(doc_id: str):
    db = get_db()
    row = db.execute("SELECT id FROM documents WHERE id = ? AND user_id = ?", (doc_id, g.user["id"])).fetchone()
    if row is None:
        return jsonify(error="Document not found."), 404
    vectorstore.delete_where(vectorstore.DOCS, g.user["id"], {"document_id": doc_id})
    db.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
    db.commit()
    return jsonify(ok=True)
