"""Retrieval-augmented prompt assembly: documents, memory, news and live web results."""
import re
import time
from datetime import datetime

from flask import current_app

from . import reader, vectorstore
from .nlp import QueryAnalysis

SYSTEM_PROMPT = """You are AVENZA AI, a precise assistant for finance and technology work.
- Accuracy comes first: a short correct answer beats a long uncertain one. Never guess.
- Never invent or estimate figures, prices, rates, dates, names, quotes, events or URLs. Only state a specific fact if it is in the provided sources or saved memory, or is stable textbook knowledge (definitions, formulas, how things work).
- When sources are provided, answer from them and cite them inline as [1], [2] matching their numbers.
- If something is unknown or not in the sources, say so plainly instead of filling the gap.
- Answer clearly and completely: as long as the question needs, without padding. Use Markdown: short paragraphs, lists, tables and fenced code where useful. No LaTeX (it is not rendered): write formulas and arithmetic as inline code, like `FV = P × (1 + r)^n`.
- Understand the question the way a thoughtful person would: read past typos and shorthand, work out the real need behind it, and answer that. Pitch the explanation to the user's level (simple words and an example for beginners, precise terms for experts). If it is genuinely ambiguous, state the most reasonable reading and answer it.
- You are not a licensed financial adviser.
- When the user shares personal details or asks you to remember something, confirm briefly in one sentence."""

GROUNDING = """Answer the question above using ONLY these sources. Rules:
- Every fact, figure, name and date must come from the sources, with the source number right after it, like [1]. Copy figures exactly as written; do not round, convert or recompute them unless asked. Any number you calculate (differences, totals, growth) must be shown with its arithmetic as inline code, like `40,000 - 35,000 = 5,000`.
- Start with the direct, precise answer in one or two sentences. Then explain it from the sources: why or how it is so, the key figures, dates and context they give, each cited. Use short paragraphs or bullets. Explain only what the sources support, and keep it focused on what was asked.
- If sources disagree, prefer the most recent one and mention the difference.
- If the sources only partly answer, answer that part and say what is missing.
- If the sources do not answer the question, reply "I couldn't find this in the sources." You may then add stable textbook background labelled "General knowledge:", but no specific figures, prices, dates or recent events."""


def retrieve(user_id: int, query: str, analysis: QueryAnalysis, use_memory: bool) -> tuple[list[dict], list[dict]]:
    """Vector candidates from the user's documents and memory; rank() decides which are relevant."""
    if not analysis.needs_retrieval:
        return [], []
    cfg = current_app.config
    docs = vectorstore.query(vectorstore.DOCS, user_id, query, cfg["RAG_TOP_K"] * 2, cfg["RAG_KEYWORD_DISTANCE"])
    memories = (
        vectorstore.query(vectorstore.MEMORY, user_id, query, 3, cfg["MEMORY_MAX_DISTANCE"]) if use_memory else []
    )
    return docs, memories


def retrieve_news(query: str) -> list[dict]:
    from .news import NEWS_OWNER

    cfg = current_app.config
    since = int(time.time()) - cfg["NEWS_MAX_AGE_DAYS"] * 86400
    hits = vectorstore.query(
        vectorstore.NEWS, NEWS_OWNER, query, 6, cfg["NEWS_MAX_DISTANCE"], where={"published_ts": {"$gte": since}}
    )
    return sorted(hits, key=lambda h: -h["meta"].get("published_ts", 0))


def latest_headlines(categories: tuple, limit: int = 6) -> list[dict]:
    """Newest saved news items, optionally only from feeds in these categories ("markets", "technology"...)."""
    from .news import NEWS_OWNER

    since = int(time.time()) - current_app.config["NEWS_MAX_AGE_DAYS"] * 86400
    got = vectorstore.collection(vectorstore.NEWS, NEWS_OWNER).get(
        where={"published_ts": {"$gte": since}}, include=["documents", "metadatas"]
    )
    rows = [{"text": t, "meta": m or {}} for t, m in zip(got["documents"], got["metadatas"])]
    if categories:
        rows = [r for r in rows if any(c in r["meta"].get("source", "").lower() for c in categories)] or rows
    rows.sort(key=lambda r: -r["meta"].get("published_ts", 0))
    picked, seen = [], set()
    for r in rows:
        title = r["meta"].get("title", "").rsplit(" - ", 1)[0].strip().lower()
        if title in seen:
            continue
        seen.add(title)
        picked.append(r)
        if len(picked) >= limit:
            break
    return picked


def file_items(user_id: int, doc_ids: list[str], query: str, max_chars: int = 24000) -> list[dict]:
    """Passages from the files attached to this conversation only, in reading order.

    Small files are read whole (so "summarise this" sees everything); large ones contribute their
    opening passage plus the passages the reranker finds most relevant to the question.
    """
    col = vectorstore.collection(vectorstore.DOCS, user_id)
    where = {"document_id": {"$in": doc_ids}} if len(doc_ids) > 1 else {"document_id": doc_ids[0]}
    got = col.get(where=where, include=["documents", "metadatas"])
    rows = [{"text": t, "meta": m or {}} for t, m in zip(got["documents"], got["metadatas"])]
    order = {d: i for i, d in enumerate(doc_ids)}
    key = lambda r: (order.get(r["meta"].get("document_id"), 99), r["meta"].get("chunk", 0))  # noqa: E731
    if sum(len(r["text"]) for r in rows) > max_chars:
        try:
            scores = reader.rerank(query, [r["text"] for r in rows])
        except Exception:
            current_app.logger.exception("reranker unavailable; reading files from the start")
            scores = [-r["meta"].get("chunk", 0) for r in rows]
        firsts = {r["meta"].get("document_id"): r for r in sorted(rows, key=key)}
        picked, size = [], 0
        for _, r in sorted(zip(scores, rows), key=lambda sr: -sr[0]):
            if r in picked or size + len(r["text"]) > max_chars:
                continue
            picked.append(r)
            size += len(r["text"])
        for r in firsts.values():  # each file's opening passage gives the model its context
            if r not in picked:
                picked.append(r)
        rows = picked
    items = _context_items(docs=sorted(rows, key=key))
    for it in items:
        it["score"] = 10.0  # chosen by the user, not by similarity
    return items


def headline_items(categories: tuple) -> list[dict]:
    items = _context_items(news=latest_headlines(categories))
    for it in items:
        it["score"] = 10.0  # chosen by recency, not by similarity
    return items


def _context_items(docs=(), news=(), web=()) -> list[dict]:
    items = []
    for d in docs:
        items.append({"kind": "document", "text": d["text"], "label": d["meta"].get("filename", "document"),
                      "filename": d["meta"].get("filename"), "documentId": d["meta"].get("document_id"),
                      "page": d["meta"].get("page")})
    for n in news:
        items.append({"kind": "news", "text": n["text"], "label": n["meta"].get("source", "news"),
                      "title": n["meta"].get("title"), "url": n["meta"].get("url")})
    for w in web:
        items.append({"kind": "web", "text": w["text"], "label": w.get("site", "web"), "title": w.get("title"), "url": w.get("url")})
    return items


def rank(query: str, docs=(), news=(), web=()) -> list[dict]:
    """Score every passage against the question with the cross-encoder; keep relevant ones, best first."""
    items = _context_items(docs, news, web)
    if not items:
        return []
    try:
        scores = reader.rerank(query, [it["text"] for it in items])
    except Exception:
        current_app.logger.exception("reranker unavailable; keeping retrieval order")
        scores = [0.0] * len(items)
    for it, score in zip(items, scores):
        it["score"] = round(score, 2)
    kept = [it for it in items if it["score"] >= current_app.config["RERANK_MIN_SCORE"]]
    return sorted(kept, key=lambda it: -it["score"])


def top(items: list[dict]) -> list[dict]:
    """Best passages overall, with no source repeated more than twice."""
    picked, per_source = [], {}
    for it in sorted(items, key=lambda it: -it.get("score", 0.0)):
        key = it.get("url") or it.get("filename") or it["label"]
        if per_source.get(key, 0) >= 2:
            continue
        per_source[key] = per_source.get(key, 0) + 1
        picked.append(it)
        if len(picked) >= current_app.config["MAX_CONTEXT_PASSAGES"]:
            break
    return picked


def build_messages(history, items: list[dict], memories, analysis: QueryAnalysis, pending=(), searched: bool = False,
                   agent=None, understood=None, images=()) -> list[dict]:
    now = datetime.now().astimezone()
    system = (
        SYSTEM_PROMPT
        + f"\n\nCurrent date and time: {now:%A, %d %B %Y, %H:%M %Z}. "
        "Your built-in knowledge stops at your training cutoff, which is earlier than this date. "
        "For anything recent (prices, rates, news, results) rely on the sources, "
        "or say your information may be out of date."
    )
    if agent is not None:
        system += f"\n\n{agent.instructions}"
    if memories:
        system += (
            "\n\nSaved memory: the user previously told you the following about themselves. "
            "Treat it as true and use it to answer questions about the user:\n"
            + "\n".join(f"- {m['text']}" for m in memories)
        )
    if pending:
        names = ", ".join(f"{n} ({p}% indexed)" for n, p in pending)
        system += (
            f"\n\nThe user uploaded documents that are still being indexed: {names}. "
            "If the answer is not in the sources, say the document is still being processed and may not be "
            "fully searchable yet, and suggest asking again in a moment. Do not claim you cannot read documents."
        )
    if searched and not items:
        system += (
            "\n\nA search of the user's documents, recent news and the web found nothing relevant to this question. "
            "Do not state any specific figure, price, rate, date, name or recent event for it: say you could not find "
            "a source. Stable textbook knowledge (definitions, how something works) is fine, labelled as general knowledge."
        )

    turns = [m for m in history if m.get("role") in ("user", "assistant") and m.get("content")]
    question = turns[-1]["content"] if turns else ""
    if understood is not None:
        # The model sees both the user's words and how they were understood (typos fixed, references resolved).
        notes = [f"Understood as: {understood.question.split(chr(10) + chr(10) + 'Original message:')[0]}"]
        if understood.goal:
            notes.append(f"User's goal: {understood.goal}")
        if understood.level:
            notes.append(f"User's level: {understood.level}")
        question = f"{question}\n\n({' | '.join(notes)})"
        turns[-1] = {"role": "user", "content": question}
    if items:
        blocks = []
        for i, it in enumerate(items):
            head = f"[{i + 1}] {it['kind']}: {it['label']}" + (f" — {it['title']}" if it.get("title") else "")
            head += f" (page {it['page']})" if it.get("page") else ""
            blocks.append(f"{head}\n{it['text'][:1800]}")
        turns[-1] = {
            "role": "user",
            "content": (
                f"Question: {question}\n\nSources (retrieved just now, most relevant first):\n\n"
                + "\n\n".join(blocks)
                + f"\n\n{getattr(agent, 'grounding', None) or GROUNDING}\n\nQuestion again: {question}"
            ),
        }

    # Keep the most recent turns within a character budget so long chats stay fast and cheap.
    budget, trimmed = (16000 if items else 24000), []
    for i, msg in enumerate(reversed(turns)):
        if i:
            budget -= len(msg["content"])
            if budget < 0:
                break
        trimmed.append({"role": msg["role"], "content": msg["content"]})
    trimmed.reverse()
    if images and trimmed:
        # Vision input: the question text plus each attached image (data URLs, OpenAI-compatible format).
        trimmed[-1] = {"role": "user", "content": [{"type": "text", "text": trimmed[-1]["content"]}]
                       + [{"type": "image_url", "image_url": {"url": url}} for url in images]}
    return [{"role": "system", "content": system}, *trimmed]


def sources(items: list[dict]) -> list[dict]:
    return [
        {"index": i + 1, "kind": it["kind"], "filename": it.get("filename") or it["label"], "title": it.get("title"),
         "url": it.get("url"), "documentId": it.get("documentId"), "page": it.get("page")}
        for i, it in enumerate(items)
    ]


# A short question that leans on the previous turn: "and in 2025?", "what about TCS?", "why did it fall?".
_FOLLOW_UP = re.compile(
    r"^\s*(and|also|but|or|so|then|what about|how about|same for|compared to|vs\.?|why|how come)\b"
    r"|\b(it|its|it's|that|those|they|them|their|he|she|his|her|him|there|the same)\b",
    re.I,
)
_CHATTER = re.compile(
    r"^\s*(hey|hi|hello|ok(ay)?|so|please|avenza( ai)?)[,!.\s]+"
    r"|^\s*(can|could|would|will) you (please )?(tell me|let me know|find( out)?|check|search( for)?|look up|explain)\s*"
    r"|^\s*(please )?(tell me|let me know|i want to know|i'd like to know|search( the web| online)? for|look up|google)\s*",
    re.I,
)


def search_query(history: list[dict], question: str) -> str:
    """The text to search for: the user's question, plus the previous question only for real follow-ups."""
    q = question.strip()
    for _ in range(3):  # "Hey, can you tell me ..." has several layers
        q = _CHATTER.sub("", q).strip()
    q = q or question.strip()
    previous = [m["content"] for m in history[:-1] if m.get("role") == "user" and m.get("content")]
    if previous and len(q.split()) <= 7 and _FOLLOW_UP.search(q):
        return f"{previous[-1].strip()} {q}"
    return q
