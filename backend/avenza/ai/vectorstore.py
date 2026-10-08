"""ChromaDB persistence. Embeddings come from Ollama, so Chroma never downloads models."""
import re

import chromadb
from flask import current_app

from . import llm

DOCS = "docs"
MEMORY = "memory"
NEWS = "news"


_clients: dict[str, chromadb.ClientAPI] = {}


def _client() -> chromadb.ClientAPI:
    # One client per path, shared across requests and the news thread.
    path = current_app.config["CHROMA_PATH"]
    if path not in _clients:
        _clients[path] = chromadb.PersistentClient(path=path)
    return _clients[path]


def _name(kind: str, user_id: int) -> str:
    # Embeddings from different models are incompatible, so each model gets its own collection.
    model = re.sub(r"[^a-z0-9]+", "-", current_app.config["EMBED_MODEL"].lower()).strip("-")
    return f"{kind}_{model}_u{user_id}"


def collection(kind: str, user_id: int):
    return _client().get_or_create_collection(
        name=_name(kind, user_id),
        embedding_function=None,
        metadata={"hnsw:space": "cosine"},
    )


def add(kind: str, user_id: int, ids: list[str], texts: list[str], metadatas: list[dict], batch: int = 32):
    col = collection(kind, user_id)
    for i in range(0, len(texts), batch):
        col.add(
            ids=ids[i:i + batch],
            documents=texts[i:i + batch],
            metadatas=metadatas[i:i + batch],
            embeddings=llm.embed(texts[i:i + batch], "document"),
        )


def query(kind: str, user_id: int, text: str, k: int, max_distance: float, where: dict | None = None) -> list[dict]:
    col = collection(kind, user_id)
    if col.count() == 0:
        return []
    res = col.query(
        query_embeddings=llm.embed([text], "query"),
        n_results=min(k, col.count()),
        where=where,
        include=["documents", "metadatas", "distances"],
    )
    hits = []
    for doc, meta, dist in zip(res["documents"][0], res["metadatas"][0], res["distances"][0]):
        if dist <= max_distance:
            hits.append({"text": doc, "meta": meta or {}, "distance": round(float(dist), 4)})
    return hits


def delete_where(kind: str, user_id: int, where: dict):
    collection(kind, user_id).delete(where=where)


def drop(kind: str, user_id: int):
    try:
        _client().delete_collection(_name(kind, user_id))
    except Exception:  # collection absent
        pass
