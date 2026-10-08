"""Spoken answers without an LLM.

Built only from NLP models and the retrieved sources: the extractive reader pulls the exact
answer span and its sentence out of a passage, then explains it with the sentences that follow
it in that source and the best on-topic sentence from another source. When a question has no
short answer ("tell me about…") the reranker picks the most relevant source sentences instead.
Every sentence spoken is quoted from a source and cited.
"""
import re
from datetime import datetime

from flask import current_app

from . import reader
from .nlp import CODE_OR_TASK, GREETINGS, split_sentences

_THANKS = re.compile(r"^\s*(thanks|thank you|thx|cheers|great|awesome|perfect|nice)\b[\s\w!.,]*$", re.I)
_IDENTITY = re.compile(r"\b(who|what) are you\b|\byour name\b|\bwhat can you do\b|\bintroduce yourself\b", re.I)
_TIME = re.compile(r"\bwhat('s| is)? (the )?time\b|\bcurrent time\b|\btime is it\b", re.I)
_DATE = re.compile(r"\b(what('s| is)? (the |today'?s )?(date|day)|today'?s date|current date|what day is it)\b", re.I)
_ABOUT_USER = re.compile(r"\b(my|me|i|mine)\b", re.I)
# Questions that want an explanation, not just a fact: answered with more supporting sentences.
_EXPLAIN = re.compile(r"^\s*(please )?(explain|describe|tell me (more )?about|define|what (is|are|does|do)\b|what's|how|why)\b", re.I)


def reply(question: str, query: str, analysis, items: list[dict], memories: list[dict], *,
          memorable: bool, use_memory: bool, web_enabled: bool) -> str:
    q = question.strip()
    if memorable:
        return "Got it. I'll remember that." if use_memory else "Noted. Memory is turned off, so I won't keep it after this chat."
    if _THANKS.match(q):
        return "You're welcome."
    if GREETINGS.match(q):
        return "Hello! Ask me about your documents, the markets or the latest news."
    if _IDENTITY.search(q):
        return ("I'm AVENZA AI. By voice I answer straight from your documents, your saved memory, "
                "recent news and the web, and tell you where each answer came from.")
    now = datetime.now().astimezone()
    if _TIME.search(q):
        return f"It's {now:%I:%M %p}".replace(" 0", " ") + "."
    if _DATE.search(q):
        return f"Today is {now:%A, %d %B %Y}."
    if CODE_OR_TASK.search(q) and not items:
        return "Writing and coding tasks work best in the text chat. By voice, ask me a question and I'll find the answer in your sources."

    passages = _passages(q, items, memories)
    if not passages:
        if analysis.intent == "personal":
            return ("I don't have that saved yet. Tell me, for example, “my name is …” or “I work at …”, "
                    "and I'll remember it." if use_memory else "Memory is turned off, so I don't know that about you.")
        where = "your documents, saved news or the web" if web_enabled else "your documents or saved news"
        tip = "" if web_enabled else " Web search is off. Say turn on web search and ask again."
        return f"I couldn't find anything about that in {where}.{tip}"

    # Follow-ups ("and in 2025?") only make sense together with the previous question.
    ask = q if len(q.split()) >= 4 or query == q else query
    explain = bool(_EXPLAIN.search(q))
    answer = _extract(ask, passages, prefer_news=analysis.is_recent, explain=explain)
    if answer:
        return answer
    return _summarise(ask, passages, explain)


def _passages(question: str, items: list[dict], memories: list[dict]) -> list[dict]:
    mem = [{"kind": "memory", "text": m["text"], "label": "memory"} for m in memories]
    # Questions about the user ("what's my name?") are answered from memory first.
    return (mem + items) if _ABOUT_USER.search(question) else (items + mem)


def _source_phrase(used: list[dict]) -> str:
    """Where the answer came from, read out after it: "That's from kitco.com and your document Q1.pdf."."""
    names = []
    for p in used:
        if p["kind"] == "memory":
            name = "what you told me earlier"
        elif p["kind"] == "document":
            name = f"your document {p['label']}"
        else:
            name = p["label"].replace(" · ", ", ")
        if name not in names:
            names.append(name)
    if names == ["what you told me earlier"]:
        return "You told me that earlier."
    return "That's from " + (" and ".join(names) if len(names) <= 2 else ", ".join(names[:-1]) + " and " + names[-1]) + "."


def _cite(items_index: int | None) -> str:
    return f" [{items_index + 1}]" if items_index is not None else ""


# A short answer is only quoted from a passage the reranker judged clearly on-topic (memory is exempt).
_ANSWER_MIN_RERANK = -3.5
# A supporting sentence must itself be on-topic for the question (cross-encoder logit, MiniLM-L-12).
_SUPPORT_MIN_RERANK = 0.0


def _extract(question: str, passages: list[dict], prefer_news: bool = False, explain: bool = False) -> str | None:
    """The exact answer from the best source, then supporting sentences from the sources that explain it."""
    cfg = current_app.config
    candidates = [p for p in passages if p["kind"] == "memory" or p.get("score", 0.0) >= _ANSWER_MIN_RERANK][:4]
    if not candidates:
        return None
    answers = [
        a for a in reader.read(question, [p["text"] for p in candidates])
        if a.score >= cfg["QA_MIN_SCORE"]
        and (candidates[a.passage]["kind"] == "memory" or _readable(_without_title(_clean(a.sentence), candidates[a.passage])))
    ]
    if not answers:
        return None
    # For time-sensitive questions a dated news item beats an undated web page.
    if prefer_news:
        news = [a for a in answers if candidates[a.passage]["kind"] == "news" and a.score >= 0.4]
        if news:
            answers = news + [a for a in answers if a not in news]
    best = answers[0]
    p = candidates[best.passage]
    # A span can run across the page title ("Jensen Huang - NVIDIA. Jensen Huang"): keep its last sentence.
    short = _without_title(split_sentences(best.text)[-1], p).rstrip(".") or best.text
    sentence = _without_title(_clean(best.sentence), p) or short
    # Lead with the short answer when its sentence is long ("Jensen Huang. Jensen Huang founded NVIDIA..."),
    # but not for definitions, where the sentence itself is the answer, or when the sentence opens with it.
    opens_with = _norm(sentence).startswith(_norm(short))
    lead = "" if explain or opens_with or len(short) >= 0.6 * len(sentence) else f"**{short}**. "
    parts, used, said = [f"{lead}{_trim(sentence)}{_cite(p.get('n'))}"], [p], [sentence]
    # A second source with a different answer is worth hearing (e.g. figures that disagree).
    for other in answers[1:]:
        o = candidates[other.passage]
        if other.score >= 0.5 and _norm(other.text) != _norm(best.text) and o.get("label") != p.get("label"):
            other_sentence = _without_title(_clean(other.sentence), o) or other.text
            parts.append(f"{o['label'].replace(' · ', ', ')} says: {_trim(other_sentence)}{_cite(o.get('n'))}")
            used.append(o)
            said.append(other_sentence)
            break
    # Explanations continue with what the same source says next, then add other sources that bear on it.
    for s in _following(p, sentence, 2 if explain else 0, said):
        parts.append(f"{_trim(s)}{_cite(p.get('n'))}")
        said.append(s)
    for s, src in _supporting(question, candidates, said, 1, _SUPPORT_MIN_RERANK):
        parts.append(f"{_trim(s)}{_cite(src.get('n'))}")
        used.append(src)
    return f"{' '.join(parts)} {_source_phrase(used)}"


def _summarise(question: str, passages: list[dict], explain: bool = False) -> str:
    """No short answer exists: read out the most relevant sentences, or headlines for news questions."""
    news = [p for p in passages if p["kind"] == "news" and p.get("title")]
    if news and passages[0]["kind"] == "news":
        heads = "; ".join(f"{p['title'].rsplit(' - ', 1)[0]}{_cite(p.get('n'))}" for p in news[:3])
        return f"Here are the latest headlines. {heads}."
    picked = _supporting(question, passages[:3], [], 2, current_app.config["RERANK_MIN_SCORE"])
    if not picked:
        return "I found related sources but no clear answer in them. Try asking more specifically."
    if explain:
        first, src = picked[0]
        picked[1:1] = [(s, src) for s in _following(src, first, 2, [s for s, _ in picked])]
    text = " ".join(f"{_trim(s)}{_cite(src.get('n'))}" for s, src in picked)
    return f"{text} {_source_phrase([src for _, src in picked])}"


def _supporting(question: str, passages: list[dict], said: list[str], k: int, min_score: float) -> list[tuple[str, dict]]:
    """Up to k source sentences that best answer the question, skipping ones already said or repeated."""
    if k <= 0:
        return []
    candidates: list[tuple[str, dict]] = []
    for p in passages:
        for s in split_sentences(p["text"]):
            s = _without_title(_clean(s), p)
            if 30 <= len(s) <= 400 and not s.endswith("?") and not _heading(s) and not _repeats(s, said + [c for c, _ in candidates]):
                candidates.append((s, p))
    if not candidates:
        return []
    scores = reader.rerank(question, [s for s, _ in candidates])
    ranked = sorted(zip(scores, range(len(candidates))), reverse=True)
    return [candidates[i] for score, i in ranked[:k] if score >= min_score]


def _following(p: dict, sentence: str, n: int, said: list[str]) -> list[str]:
    """Up to n sentences that come right after sentence in passage p, stopping at a heading or fragment."""
    if n <= 0:
        return []
    sentences = [_without_title(_clean(s), p) for s in split_sentences(p["text"])]
    at = next((i for i, s in enumerate(sentences) if s and (s in sentence or sentence in s)), None)
    out: list[str] = []
    for s in sentences[at + 1:] if at is not None else []:
        if len(out) >= n or not _readable(s) or s.endswith("?"):
            break
        if not _repeats(s, said + out):
            out.append(s)
    return out


_LEAD_JUNK = re.compile(r"^(?:[-–—*•·|>#]+\s*)+")


def _clean(sentence: str) -> str:
    """A source sentence fit to read aloud: no list bullets or table rows."""
    s = _LEAD_JUNK.sub("", re.sub(r"\s+", " ", sentence)).strip()
    return "" if s.count("|") >= 2 else s


def _without_title(sentence: str, p: dict) -> str:
    """Drop the page title that web snippets start with ("Jensen Huang - NVIDIA. Jensen Huang founded...")."""
    title = (p.get("title") or "").strip().rstrip(".")
    if title and sentence.startswith(title):
        return sentence[len(title):].lstrip(" .:-–—|").strip()
    return sentence


def _readable(sentence: str) -> bool:
    """A real sentence worth reading out, not a stray fragment ("2026.") or a heading."""
    return len(sentence.split()) >= 4 and not _heading(sentence)


def _heading(sentence: str) -> bool:
    """A page heading rather than a sentence: short and mostly Capitalised Words ("Gold Price Today — Per Ounce")."""
    words = re.findall(r"[A-Za-z][\w'’-]*", sentence)
    if not words or len(words) > 14:
        return False
    return sum(w[0].isupper() for w in words) / len(words) >= 0.6


def _repeats(sentence: str, others: list[str]) -> bool:
    """Whether sentence says nearly the same as one already chosen (same words, or contained in it)."""
    words = set(_norm_words(sentence))
    for o in others:
        ow = set(_norm_words(o))
        if not words or not ow:
            continue
        if len(words & ow) / len(words | ow) >= 0.6 or words <= ow or ow <= words:
            return True
    return False


def _norm_words(s: str) -> list[str]:
    return re.findall(r"[a-z0-9$₹%.,]+", s.lower())


def _trim(sentence: str, words: int = 45) -> str:
    parts = sentence.split()
    s = " ".join(parts[:words]) + ("…" if len(parts) > words else "")
    return s if s.endswith((".", "!", "?", "…")) else s + "."


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9.]", "", s.lower())
