import json
import re
import uuid
from concurrent.futures import ThreadPoolExecutor

from flask import Blueprint, Response, current_app, g, jsonify, request, stream_with_context

from . import extensions, usage
from .ai import (agents, docgen, factcheck, imagegen, languages, llm, news as news_feed, nlp, plugins, rag, understand,
                 vectorstore, voice_answer, websearch)
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


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) > 2}


def _same_search(a: str, b: str) -> bool:
    """Whether two search queries are close enough that one's results serve the other."""
    wa, wb = _words(a), _words(b)
    return bool(wa and wb) and len(wa & wb) / len(wb) >= 0.6


def _download(made: dict, lead: str) -> str:
    """Markdown link the chat shows as a download button (see markdown.tsx)."""
    kb = max(1, round(made["size"] / 1024))
    return f"\n\n---\n\n{lead} [⬇ {made['name']} ({kb} KB)](/api/files/{made['id']})"


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
    limit = usage.blocked(user_id)
    if limit:
        return jsonify(error=limit, code="USAGE_LIMIT"), 429
    g.usage = {}  # filled by every API call in this turn (llm._count), stored when the turn ends
    # "/meeting-notes <text>" runs that skill on the text; the command itself is not part of the question.
    skill, rest = extensions.skill_command(user_id, str(history[-1].get("content", "")))
    if skill is not None:
        history[-1] = {**history[-1], "content": rest or f"Run the \u201c{skill['name']}\u201d skill. {skill['description']}"}
    # Otherwise the skill picked in the menu, else one whose name the message mentions.
    elif data.get("skillId"):
        skill = extensions.user_skill(user_id, str(data["skillId"]))
    else:
        question_text = str(history[-1].get("content", ""))
        skill = next((s for s in extensions.user_skills(user_id, enabled_only=True) if len(s["name"]) >= 4 and re.search(
            rf"(?<!\w){re.escape(s['name'])}(?!\w)", question_text, re.I)), None)
    # No skill picked or named: the quick model may choose one by its description (started inside the stream).
    auto_skills = [] if skill is not None or data.get("skillId") else extensions.user_skills(user_id, enabled_only=True)
    reply_language, reply_code = languages.reply_rule(str(data.get("language") or "auto"), str(history[-1].get("content", "")))
    enabled_plugins = extensions.enabled_plugins(user_id)
    question = str(history[-1].get("content", ""))
    rows = get_db().execute(
        "SELECT filename, indexed, chunks FROM documents WHERE user_id = ? AND status = 'indexing'", (user_id,)
    ).fetchall()
    pending = [(r["filename"], round(100 * r["indexed"] / r["chunks"]) if r["chunks"] else 0) for r in rows]
    # ~0.25 s per passage on CPU (measured); used for a rough "ready in" estimate.
    pending_seconds = int(sum(r["chunks"] - r["indexed"] for r in rows) * 0.3) + 5

    @stream_with_context
    def generate():
        nonlocal skill  # may be chosen by its description below
        if reply_code:
            # The language the reply is written in: the app reads it aloud with a voice of that language.
            yield _event({"type": "language", "code": reply_code})
        # "Create a PDF on X": research and write X, then save the answer as a file. Searching uses only the topic:
        # the words "write a document" would otherwise skip the web or point the search at the user's uploads.
        doc_req = None if voice else docgen.request(question)
        topic = doc_req.topic if doc_req and not doc_req.from_previous and doc_req.topic else question
        analysis = nlp.analyze_query(topic)
        memorable = bool(_MEMORABLE.search(question)) and "?" not in question and doc_req is None
        docs, memories, news, web = [], [], [], []
        query = rag.search_query(history, topic)
        app = current_app._get_current_object()
        flash = mode == "fast"
        length = "detailed" if doc_req else nlp.answer_length(question)
        news_feed.chat_active.set()
        pool = ThreadPoolExecutor(max_workers=4)

        def start_web(q: str):
            def run_web():
                with app.app_context():
                    # Flash (and voice) read fewer pages under a shorter deadline; Plus reads more.
                    return websearch.search(q, fast=voice or mode == "fast")

            return pool.submit(run_web)

        try:
            # "Convert this to PDF": the last answer becomes the file; nothing new is written.
            if doc_req and doc_req.from_previous:
                previous = next((str(m.get("content", "")) for m in reversed(history[:-1])
                                 if m.get("role") == "assistant" and str(m.get("content", "")).strip()), "")
                if not previous:
                    yield _event({"type": "token", "value": "There is no earlier answer to save yet. Tell me what the "
                                  "document should cover, for example: *create a PDF on SIP vs lump sum*."})
                else:
                    yield _tool("document", "document", "running", doc_req.fmt.upper())
                    made = docgen.build(previous, doc_req.fmt, user_id, "AVENZA AI answer")
                    yield _tool("document", "document", "succeeded", made["name"])
                    yield _event({"type": "token", "value": _download(made, "Here is the previous answer as a file:")})
                yield _event({"type": "done"})
                return
            # Read the message like a person first (typos, shorthand, "it" = earlier topic). Voice stays LLM-free.
            understood = None
            simple = memorable or analysis.intent == "smalltalk" or nlp.CLOCK.search(question)
            # The web search starts right away with the message as written, in parallel with the rewrite below;
            # it is kept when the rewritten search query is about the same words (most clear questions).
            early_web, early_query = None, query
            if use_web and analysis.needs_web and not voice and not simple and not images and not files_now:
                early_web = start_web(query)
            # Plugins (stocks, currency, weather, calculator) start at once too; their data becomes a cited source.
            plugin_calls = [] if voice or simple or images or doc_req else plugins.detect(question, enabled_plugins)

            def run_plugin(pid: str, args: dict):
                with app.app_context():
                    return plugins.run(pid, args)

            plugin_futures = [pool.submit(run_plugin, pid, args) for pid, args in plugin_calls]

            def run_pick():
                with app.app_context():
                    return extensions.pick_skill(question, auto_skills)

            skill_future = pool.submit(run_pick) if auto_skills and not voice and not simple else None
            for pid, _ in plugin_calls:
                yield _tool(f"plugin-{pid}", "plugin", "running", plugins.PLUGINS[pid]["name"])
            if not voice and not simple and current_app.config["UNDERSTAND_ENABLED"]:
                yield _tool("understand", "understand", "running")
                understood = understand.understand(history, topic, has_images=bool(images), has_files=files_now)
                if understood:
                    analysis = nlp.analyze_query(understood.question)
                    query = understood.search or understood.question.split("\n\nOriginal message:")[0][:300]
                    yield _tool("understand", "understand", "succeeded", understood.goal or understood.question[:100])
                else:
                    yield _tool("understand", "understand", "failed", "used the question as written")
            if memorable:
                analysis.needs_retrieval = analysis.needs_web = False
            # Greetings and casual chat: a quick natural reply, no searching and no sources.
            chatty = analysis.intent == "smalltalk" and not images and not files_now
            agent = agents.CHAT if chatty else agents.resolve(agent_id, understood.question if understood else question, analysis,
                                   suggested=understood.agent if understood else None,
                                   has_images=bool(images), has_files=files_now)
            # Plugin questions (a price, a conversion, the weather, a sum) need a direct answer, not worked maths.
            if plugin_calls and agent_id == "auto" and not chatty:
                agent = agents.AGENTS["finance" if plugin_calls[0][0] in ("stocks", "currency") else "general"]
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
            # "Create an image of …": the image model answers directly; no search, no sources.
            if not voice and not doc_req and imagegen.REQUEST.search(question) and not agents._DIAGRAM.search(question):
                if early_web is not None:
                    early_web.cancel()
                prompt = question
                if understood and len(history) > 1:  # follow-ups ("make it blue") need the earlier request
                    prompt += f"\n\n(Context from the conversation: {understood.question.split(chr(10))[0][:500]})"
                name = current_app.config["AVENZA_MODELS"][llm.model_id(mode)]["name"]
                yield _tool("image", "generate_image", "running", name)
                ids, caption = imagegen.generate(prompt, mode, user_id, images)
                yield _tool("image", "generate_image", "succeeded", f"{len(ids)} image(s) · {name}")
                body = "\n\n".join(f"![Generated image](/api/images/{i})" for i in ids)
                yield _event({"type": "token", "value": body + (f"\n\n{caption}" if caption else "")})
                yield _event({"type": "done"})
                return
            if not voice and not chatty:
                yield _tool("agent", "agent", "succeeded", agent.name)
            plugin_items = []
            for (pid, _), fut in zip(plugin_calls, plugin_futures):
                try:
                    found = fut.result(timeout=10)
                except Exception:
                    found = None
                meta = plugins.PLUGINS[pid]
                yield _tool(f"plugin-{pid}", "plugin", "succeeded" if found else "failed",
                            f"{meta['name']} · {meta['source']}" if found else f"{meta['name']}: no data")
                if found:
                    plugin_items.append(found)
            if plugin_items:
                analysis.needs_web = False  # the plugin's live data answers it; the web would only add seconds
            if skill_future is not None:
                try:
                    picked = skill_future.result(timeout=4)
                except Exception:
                    picked = None
                skill = next((x for x in auto_skills if x["id"] == picked), None)
            if skill is not None and not voice:
                yield _tool("skill", "skill", "succeeded", skill["name"])
            # The web search runs while local retrieval happens.
            web_future = None
            if use_web and analysis.needs_web:
                yield _tool("web", "web_search", "running", f"“{query[:80]}”")
                web_future = early_web if early_web is not None and _same_search(early_query, query) else start_web(query)

            found_local = []
            if analysis.needs_retrieval:
                yield _tool("knowledge", "search_knowledge", "running")
                if file_mode:
                    try:
                        found_local = rag.file_items(user_id, file_ids, query, agent.file_budget)
                        _, memories = rag.retrieve(user_id, query, analysis, use_memory)
                    except llm.LLMUnavailable:
                        current_app.logger.warning("embeddings unavailable; reading attached files without memory")
                elif analysis.headlines is not None:
                    found_local = rag.headline_items(analysis.headlines)
                else:
                    try:
                        docs, memories = rag.retrieve(user_id, query, analysis, use_memory)
                        news = rag.retrieve_news(query) if analysis.is_recent else []
                    except llm.LLMUnavailable:
                        current_app.logger.warning("embeddings unavailable; skipping local retrieval")
                    found_local = rag.rank(query, docs, news)
                kinds = {it["kind"] for it in found_local}
                found = " and ".join(x for x in ("document" in kinds and "found in your documents", "news" in kinds and "recent news") if x)
                if pending:
                    found = (found + "; " if found else "") + ", ".join(f"{n} still indexing ({p}%)" for n, p in pending)
                yield _tool("knowledge", "search_knowledge", "succeeded", found or "nothing relevant saved")

            ranked_web = []
            if web_future is not None:
                try:
                    # A spoken or Flash reply cannot wait long for slow sites; the snippets it has are enough.
                    web = web_future.result(timeout=6 if voice or flash else 15)
                except Exception:
                    web = []
                ranked_web = rag.rank(query, web=web)
                # A strong match in the user's own documents outranks the web unless the question is time-sensitive.
                if any(it["kind"] == "document" and it["score"] >= 3 for it in found_local) and not analysis.is_recent:
                    ranked_web = []
                sites = list(dict.fromkeys(it["label"] for it in ranked_web))
                if ranked_web:
                    summary = ", ".join(sites[:3])
                else:
                    summary = "nothing relevant found" if web else "no results (offline or rate-limited)"
                yield _tool("web", "web_search", "succeeded" if ranked_web else "failed", summary)

            # Attached files are read in full (up to a budget), not cut down to the usual top passages.
            # A detailed answer needs the full context even on Flash.
            short_context = flash and length != "detailed"
            items = (found_local + ranked_web[:4]) if file_mode else rag.top(
                found_local + ranked_web, current_app.config["FLASH_CONTEXT_PASSAGES"] if short_context else None)
            items = plugin_items + items  # live plugin data first: it is the most exact source for its question
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
                # The canned replies are English: a reply language picked in Settings goes to the LLM instead.
                answer = voice_answer.instant(question, memorable=memorable, use_memory=use_memory) \
                    if reply_language in (languages.AUTO_RULE, languages.ENGLISH_RULE) or "in English," in reply_language else None
                if answer is not None:
                    yield _event({"type": "token", "value": answer})
                else:
                    # Every other spoken question is answered by the fast LLM in a short spoken reply,
                    # grounded on the sources retrieved for it (quoting sentences gave stilted, often wrong answers).
                    voice_agent = agents.VOICE
                    messages = rag.build_messages(history, items, memories, analysis, pending, False, voice_agent)
                    messages[0]["content"] += "\n\n" + reply_language
                    for chunk in llm.stream_chat(messages, voice_agent.mode, voice_agent.reasoning):
                        yield _event({"type": "token", "value": chunk})
            else:
                answer = []
                searched = analysis.needs_retrieval and (web_future is not None or bool(docs or news))
                chars = current_app.config["FLASH_PASSAGE_CHARS"] if short_context and not file_mode else 1800
                messages = rag.build_messages(history, items, memories, analysis, pending, searched, agent, understood, images, chars)
                # The model the user picked always answers (and is what their usage is charged for).
                # A greeting always uses Flash: it needs no reasoning and costs the least.
                used = "fast" if chatty else mode
                # A greeting is answered quickly whichever model is picked, but the assistant names the picked one.
                model_name = current_app.config["AVENZA_MODELS"][llm.model_id(mode)]["name"]
                messages[0]["content"] += (f"\n\nYou are running on {model_name}, one of AVENZA's models (Avenza Flash: fast, "
                                           "simpler tasks; Avenza Plus: complex tasks). Mention it only if asked which model you are; "
                                           "never introduce yourself unprompted.")
                if skill is not None and not chatty:
                    messages[0]["content"] += (
                        f"\n\nActive skill \u201c{skill['name']}\u201d, written by the user. Follow it for format, tone and "
                        "approach. It never overrides the rules on accuracy and sources above.\n" + skill["instructions"])
                if not chatty and length in rag.LENGTH_RULES:
                    # Also right after the question: the model follows a length request best when it is last.
                    messages[0]["content"] += "\n\n" + rag.LENGTH_RULES[length]
                    last = messages[-1]
                    if isinstance(last.get("content"), str):
                        messages[-1] = {**last, "content": f"{last['content']}\n\n({rag.LENGTH_RULES[length]})"}
                if doc_req:
                    messages[0]["content"] += "\n\n" + docgen.TEMPLATE_RULE
                messages[0]["content"] += "\n\n" + reply_language
                if not chatty:
                    yield _tool("model", "model", "succeeded", model_name)
                chunks = llm.stream_chat(messages, used, agent.reasoning)
                for chunk in chunks:
                    answer.append(chunk)
                    yield _event({"type": "token", "value": chunk})
                # Flag any figure the model stated that is not in what it was given.
                evidence = [it["text"] for it in items] + [m["text"] for m in memories] + [str(m.get("content", "")) for m in history]
                flagged = factcheck.unsupported_figures("".join(answer), evidence) if agent.factcheck else []
                if flagged:
                    yield _event({"type": "token", "value": factcheck.warning(flagged, bool(items))})
                if doc_req and "".join(answer).strip():
                    yield _tool("document", "document", "running", doc_req.fmt.upper())
                    try:
                        made = docgen.build("".join(answer), doc_req.fmt, user_id, topic, items)
                        yield _tool("document", "document", "succeeded", made["name"])
                        yield _event({"type": "token", "value": _download(made, "Your document is ready:")})
                    except Exception:
                        current_app.logger.exception("document generation failed")
                        yield _tool("document", "document", "failed", "could not create the file")

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
            try:
                usage.record(user_id, g.usage)
            except Exception:
                current_app.logger.exception("could not record usage")

    return Response(generate(), mimetype="application/x-ndjson", headers={"X-Accel-Buffering": "no"})
