"""Background document indexing: embeds chunks into ChromaDB without blocking the upload request.

One worker thread processes jobs in order (CPU-bound embeddings would only fight each other),
and it yields to live chats so answers stay fast.
"""
import queue
import threading
import time
from dataclasses import dataclass

from . import vectorstore
from .llm import LLMUnavailable

BATCH = 16  # small batches = smooth progress updates and quick yielding to chats


@dataclass
class Job:
    user_id: int
    doc_id: str
    filename: str
    chunks: list[str]
    pages: list[int | None] | None = None  # page or slide each chunk starts on


_jobs: "queue.Queue[Job]" = queue.Queue()
_started = False
_start_lock = threading.Lock()


def submit(app, job: Job):
    global _started
    with _start_lock:
        if not _started:
            threading.Thread(target=_worker, args=(app,), name="doc-indexer", daemon=True).start()
            _started = True
    _jobs.put(job)


def _worker(app):
    from .news import chat_active

    while True:
        job = _jobs.get()
        try:
            with app.app_context():
                _index(job, chat_active)
        except Exception:
            app.logger.exception("indexing failed for %s", job.doc_id)
            with app.app_context():
                _set(job.doc_id, status="error", error="Indexing failed. Please try uploading again.")


def _index(job: Job, chat_active: threading.Event):
    from ..db import get_db

    total = len(job.chunks)
    for start in range(0, total, BATCH):
        # Pause while a chat answer is generating so the reply is not slowed down.
        while chat_active.is_set():
            time.sleep(0.5)
        if get_db().execute("SELECT 1 FROM documents WHERE id = ?", (job.doc_id,)).fetchone() is None:
            vectorstore.delete_where(vectorstore.DOCS, job.user_id, {"document_id": job.doc_id})
            return  # deleted while indexing
        batch = job.chunks[start:start + BATCH]
        try:
            vectorstore.add(
                vectorstore.DOCS,
                job.user_id,
                ids=[f"{job.doc_id}:{start + i}" for i in range(len(batch))],
                texts=batch,
                metadatas=[_meta(job, start + i) for i in range(len(batch))],
            )
        except LLMUnavailable as exc:
            _set(job.doc_id, status="error", error=str(exc))
            return
        _set(job.doc_id, indexed=min(start + BATCH, total))
    _set(job.doc_id, status="ready", indexed=total)


def _meta(job: Job, i: int) -> dict:
    meta = {"document_id": job.doc_id, "filename": job.filename, "chunk": i}
    if job.pages and job.pages[i] is not None:
        meta["page"] = job.pages[i]  # Chroma metadata cannot hold None
    return meta


def _set(doc_id: str, **fields):
    from ..db import get_db

    db = get_db()
    cols = ", ".join(f"{k} = ?" for k in fields)
    db.execute(f"UPDATE documents SET {cols} WHERE id = ?", (*fields.values(), doc_id))
    db.commit()
