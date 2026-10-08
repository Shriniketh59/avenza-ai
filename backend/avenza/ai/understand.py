"""Understand the question the way a person would before searching or answering.

Users type fast: typos ("wat is rbi repo rte"), shorthand, half sentences, "it"/"that" pointing at
earlier turns. One quick call to the fast model (minimal thinking, ~1 s) rewrites the message as a
clear question, writes a search query, notes the real goal behind it and suggests an agent. It adds
no facts. If the call fails or is slow, the rule-based path is used unchanged.
"""
import re
from dataclasses import dataclass
from datetime import datetime

from flask import current_app

from . import agents, llm

_PROMPT = """You read a user's latest chat message the way a thoughtful human expert would, so an assistant can answer what they really mean.
Today is {today}.
- Fix typos and grammar, expand abbreviations and shorthand (e.g. "qn" = question, "rte" = rate, "pls" = please).
- Resolve "it", "that", "this", "same" and follow-ups using the earlier turns.
- Keep the user's meaning, scope and numbers exactly. Never answer the question and never add facts.
- "search": a concise web search query for the facts needed, or "" if none are needed (maths, coding, writing, chit-chat, questions about attached files or images). Never add a year unless the user gave one.
- "goal": in a few words, what the user ultimately wants (e.g. "decide whether to prepay loan").
- "level": "beginner", "intermediate" or "expert", judged from how the user writes and asks.
- "agent": the best fit from: {catalog}.
Reply with JSON only: {{"question": "...", "search": "...", "goal": "...", "level": "...", "agent": "..."}}"""


@dataclass
class Understanding:
    question: str  # the message rewritten as a clear, self-contained question
    search: str  # web search query ("" = no live facts needed)
    goal: str
    level: str
    agent: str | None


def understand(history: list[dict], question: str, *, has_images: bool = False, has_files: bool = False) -> Understanding | None:
    catalog = "; ".join(f"{k} ({v})" for k, v in agents.CATALOG.items())
    earlier = [m for m in history[:-1] if m.get("role") in ("user", "assistant") and m.get("content")][-4:]
    context = "\n".join(f"{m['role']}: {str(m['content'])[:400]}" for m in earlier)
    attached = ", ".join(x for x in ("images" if has_images else "", "files" if has_files else "") if x)
    user = (f"Earlier turns:\n{context}\n\n" if context else "") + (f"[The user attached: {attached}]\n" if attached else "")
    user += f"Latest message:\n{question[:2000]}"
    out = llm.quick_json([
        {"role": "system", "content": _PROMPT.format(today=f"{datetime.now():%d %B %Y}", catalog=catalog)},
        {"role": "user", "content": user},
    ], timeout=current_app.config["UNDERSTAND_TIMEOUT"])
    if not out or not str(out.get("question", "")).strip():
        return None
    clear = str(out["question"]).strip()[:2000]
    # Keep long technical input (code, logs) intact: the rewrite is only a summary of it.
    if len(question) > 600 or "\n" in question.strip():
        clear = f"{clear}\n\nOriginal message:\n{question}"
    search = re.sub(r"\s+", " ", str(out.get("search") or "")).strip()[:200]
    if not re.search(r"\b20\d\d\b", question):
        search = re.sub(r"\b20\d\d\b", "", search).strip()  # models add stale years ("... 2024")
    agent = str(out.get("agent") or "").strip().lower() or None
    return Understanding(clear, search, str(out.get("goal") or "")[:160], str(out.get("level") or "")[:20],
                         agent if agent in agents.AGENTS else None)
