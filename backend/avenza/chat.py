import json
import re
import uuid
from concurrent.futures import ThreadPoolExecutor

from flask import Blueprint, Response, current_app, g, jsonify, request, stream_with_context

from .ai import agents, factcheck, llm, news as news_feed, nlp, rag, understand, vectorstore, voice_answer, websearch
from .db import get_db
from .tokens import require_auth

bp = Blueprint("chat", __name__)

# First-person statements worth remembering ("my name is…", "I work at…", "remember that…").
# Only clear self-descriptions: "I'm looking for gold prices" is a request, not a fact to store.
_MEMORABLE = re.compile(
    r"^\s*(please )?(remember|note|keep in mind)\b|\bmy name is\b|\bcall me\b|\bi work (at|for|in|as)\b|"
    r"\bmy (company|role|job|employer|title|email|birthday) is\b|\bi prefer\b|"
    r"^\s*i(?:'m| am) (a|an|the|from|based in|\d+ years old)\b",
    re.I,
)


def _event(obj: dict) -> str:
    return json.dumps(obj) + "\n"


def _tool(tool_id: str, name: str, status: str, summary: str | None = None) -> str:
    tool = {"id": tool_id, "name": name, "status": status}
    if summary:
        tool["summary"] = summary
    return _event({"type": "tool", "tool": tool})


@bp.post("/chat")
@require_auth
def chat():
    data = request.get_json(silent=True) or {}
    history = [m for m in (data.get("messages") or []) if isinstance(m, dict)]
    if not history or history[-1].get("role") != "user":
        return jsonify(error="The last message must be from the user."), 400
    use_memory = bool(data.get("memory", True))
    use_web = bool(data.get("webSearch", True))
    mode = llm.resolve_mode(data.get("mode"))
    voice = bool(data.get("voice", False))
    agent_id = str(data.get("agentId") or "auto")
    # Images attached to this turn (data URLs, read by the vision model) and files attached to the conversation.
    images = [u for u in (data.get("images") or []) if isinstance(u, str) and u.startswith("data:image/")][:4]
    file_ids = list(dict.fromkeys(str(d) for d in (data.get("files") or []) if isinstance(d, str) and d))[:10]
    # Files attached in this very message (not just earlier in the conversation) always go to the files agent.
    files_now = bool(data.get("filesInTurn")) and bool(file_ids)
    user_id = g.user["id"]
    question = str(history[-1].get("content", ""))
    rows = get_db().execute(
        "SELECT filename, indexed, chunks FROM documents WHERE user_id = ? AND status = 'indexing'", (user_id,)
    ).fetchall()
    pending = [(r["filename"], round(100 * r["indexed"] / r["chunks"]) if r["chunks"] else 0) for r in rows]
    # ~0.25 s per passage on CPU (measured); used for a rough "ready in" estimate.
    pending_seconds = int(sum(r["chunks"] - r["indexed"] for r in rows) * 0.3) + 5

    @stream_with_context
    def generate():
        analysis = nlp.analyze_query(question)
        memorable = bool(_MEMORABLE.search(question)) and "?" not in question
        docs, memories, news, web = [], [], [], []
        query = rag.search_query(history, question)
        app = current_app._get_current_object()
        news_feed.chat_active.set()
        pool = ThreadPoolExecutor(max_workers=1)
        try:
            # Read the message like a person first (typos, shorthand, "it" = earlier topic). Voice stays LLM-free.
            understood = None
            simple = memorable or analysis.intent == "smalltalk" or nlp.CLOCK.search(question)
            if not voice and not simple and current_app.config["UNDERSTAND_ENABLED"]:
                yield _tool("understand", "understand", "running")
                understood = understand.understand(history, question, has_images=bool(images), has_files=files_now)
                if understood:
                    analysis = nlp.analyze_query(understood.question)
                    query = understood.search or understood.question.split("\n\nOriginal message:")[0][:300]
                    yield _tool("understand", "understand", "succeeded", understood.goal or understood.question[:100])
                else:
                    yield _tool("understand", "understand", "failed", "used the question as written")
            if memorable:
                analysis.needs_retrieval = analysis.needs_web = False
            agent = agents.resolve(agent_id, understood.question if understood else question, analysis,
                                   suggested=understood.agent if understood else None,
                                   has_images=bool(images), has_files=files_now)
            # Earlier attachments: the files agent when the question is about them ("this file", "the report").
            if file_ids and agent_id == "auto" and agent.id in ("general", "research") and (
                (understood and understood.agent in ("files", "analyst")) or (not understood and nlp.DOC_HINTS.search(question))
            ):
                agent = agents.AGENTS["analyst" if understood and understood.agent == "analyst" else "files"]
            # Agents that work on the attached files read them directly instead of searching all documents.
            file_mode = agent.id in ("files", "analyst", "diagram") and bool(file_ids)
            # An attached image or file is the source; the web is only for agents that need it or recent facts.
            if (not agent.web or file_mode or images) and not analysis.is_recent:
                analysis.needs_web = False
            if file_mode:
                analysis.needs_retrieval = True
            elif agent.id == "image" or (agent.id == "diagram" and images):
                analysis.needs_retrieval = False  # the image is the source; a document search only adds seconds
            if not voice:
                yield _tool("agent", "agent", "succeeded", agent.name)
            # Start the web search immediately; it runs while local retrieval happens.
            web_future = None
            if use_web and analysis.needs_web:
                yield _tool("web", "web_search", "running", f"“{query[:80]}”")

                def run_web():
                    with app.app_context():
                        return websearch.search(query, fast=voice)

                web_future = pool.submit(run_web)

            local = []
            if analysis.needs_retrieval:
                yield _tool("knowledge", "search_knowledge", "running")
                if file_mode:
                    try:
                        local = rag.file_items(user_id, file_ids, query, agent.file_budget)
                        _, memories = rag.retrieve(user_id, query, analysis, use_memory)
                    except llm.LLMUnavailable:
                        current_app.logger.warning("embeddings unavailable; reading attached files without memory")
                elif analysis.headlines is not None:
                    local = rag.headline_items(analysis.headlines)
                else:
                    try:
                        docs, memories = rag.retrieve(user_id, query, analysis, use_memory)
                        news = rag.retrieve_news(query) if analysis.is_recent else []
                    except llm.LLMUnavailable:
                        current_app.logger.warning("embeddings unavailable; skipping local retrieval")
                    local = rag.rank(query, docs, news)
                kinds = {it["kind"] for it in local}
                found = " and ".join(x for x in ("document" in kinds and "found in your documents", "news" in kinds and "recent news") if x)
                if pending:
                    found = (found + "; " if found else "") + ", ".join(f"{n} still indexing ({p}%)" for n, p in pending)
                yield _tool("knowledge", "search_knowledge", "succeeded", found or "nothing relevant saved")

            ranked_web = []
            if web_future is not None:
                try:
                    web = web_future.result(timeout=15)
                except Exception:
                    web = []
                ranked_web = rag.rank(query, web=web)
                # A strong match in the user's own documents outranks the web unless the question is time-sensitive.
                if any(it["kind"] == "document" and it["score"] >= 3 for it in local) and not analysis.is_recent:
                    ranked_web = []
                sites = list(dict.fromkeys(it["label"] for it in ranked_web))
                if ranked_web:
                    summary = ", ".join(sites[:3])
                else:
                    summary = "nothing relevant found" if web else "no results (offline or rate-limited)"
                yield _tool("web", "web_search", "succeeded" if ranked_web else "failed", summary)

            # Attached files are read in full (up to a budget), not cut down to the usual top passages.
            items = (local + ranked_web[:4]) if file_mode else rag.top(local + ranked_web)
            if agent.id == "diagram" and not file_mode and not images:
                items = items[:4]  # a diagram from a description needs little context
            for i, it in enumerate(items):
                it["n"] = i
            if items:
                yield _event({"type": "sources", "sources": rag.sources(items)})

            # Asked about a document that is not searchable yet: answer honestly instead of guessing.
            if pending and not any(it["kind"] == "document" for it in items) and (analysis.intent == "document_question" or file_mode):
                names = ", ".join(f"**{n}** ({p}% indexed)" for n, p in pending)
                wait = f"about {max(1, round(pending_seconds / 60))} minute(s)" if pending_seconds >= 60 else f"about {pending_seconds} seconds"
                yield _event({"type": "token", "value": (
                    f"Your document is still being processed: {names}. "
                    f"It should be fully searchable in {wait}. Ask me again then and I'll answer from it."
                )})
                yield _event({"type": "done"})
                return

            if voice:
                # Voice answers come from the NLP reader over the sources, never from the LLM.
                answer = voice_answer.reply(question, query, analysis, items, memories, memorable=memorable,
                                            use_memory=use_memory, web_enabled=use_web)
                if answer is not None:
                    yield _event({"type": "token", "value": answer})
                else:
                    # Quoting could not answer it (nothing found, or a task/creative request): the LLM answers
                    # briefly, from the sources when there are any, so every spoken question gets an answer.
                    voice_agent = agents.VOICE
                    messages = rag.build_messages(history, items, memories, analysis, pending, False, voice_agent)
                    for chunk in llm.stream_chat(messages, voice_agent.mode, voice_agent.reasoning):
                        yield _event({"type": "token", "value": chunk})
            else:
                searched = analysis.needs_retrieval and (web_future is not None or bool(docs or news))
                messages = rag.build_messages(history, items, memories, analysis, pending, searched, agent, understood, images)
                answer = []
                for chunk in llm.stream_chat(messages, agent.mode or mode, agent.reasoning):
                    answer.append(chunk)
                    yield _event({"type": "token", "value": chunk})
                # Flag any figure the model stated that is not in what it was given.
                evidence = [it["text"] for it in items] + [m["text"] for m in memories] + [str(m.get("content", "")) for m in history]
                flagged = factcheck.unsupported_figures("".join(answer), evidence) if agent.factcheck else []
                if flagged:
                    yield _event({"type": "token", "value": factcheck.warning(flagged, bool(items))})

            if use_memory and _MEMORABLE.search(question) and len(question) < 500:
                vectorstore.add(vectorstore.MEMORY, user_id, [uuid.uuid4().hex], [question], [{"source": "chat"}])
            yield _event({"type": "done"})
        except llm.LLMUnavailable as exc:
            yield _event({"type": "error", "message": str(exc)})
        except Exception:
            current_app.logger.exception("chat pipeline failed")
            yield _event({"type": "error", "message": "Something went wrong while generating a response."})
        finally:
            pool.shutdown(wait=False, cancel_futures=True)
            news_feed.chat_active.clear()

    return Response(generate(), mimetype="application/x-ndjson", headers={"X-Accel-Buffering": "no"})
