"""Live web search: DuckDuckGo (no API key) -> fetch pages -> pick the passages most relevant to the question."""
import math
import re
import time
import unicodedata
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse

import requests
import trafilatura
from ddgs import DDGS
from flask import current_app

from . import nlp

_HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"}


def _search(query: str, n: int) -> list[dict]:
    for attempt in range(2):  # DuckDuckGo intermittently returns nothing under rate limiting
        try:
            results = list(DDGS().text(query, max_results=n, safesearch="moderate"))
            if results:
                return results
        except Exception as exc:  # rate limits / network
            current_app.logger.warning("web search failed (attempt %d): %s", attempt + 1, exc)
        time.sleep(0.5)
    return []


# Wikipedia-style reference markers ("[82]", "[citation needed]") break sentence boundaries.
_REFS = re.compile(r"\[(?:\d+|[a-z]|citation needed|note \d+)\]", re.I)
# Search engines prefix snippets with a page date ("Jun 22, 2026 · ", "5 days ago · "); it is not part of the text.
_SNIPPET_DATE = re.compile(
    r"^\s*(?:[A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}|\d{1,2} [A-Z][a-z]{2,8}\.? \d{4}|\d+ (?:minutes?|hours?|days?|weeks?|months?) ago)"
    r"\s*[·—–-]\s*"
)


_TABLE_SEPARATOR = re.compile(r"^\|?(\s*:?-{2,}:?\s*\|)+\s*:?-*:?\s*$")


def _cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def _flatten_tables(text: str) -> str:
    """Markdown table rows as sentences ("Gold price per ounce: Price (USD) $4,129.10, Change +$19.20."),
    so the reader, the sentence splitter and the reranker can use the figures in them."""
    lines, out, header = text.split("\n"), [], None
    for i, line in enumerate(lines):
        s = line.strip()
        if not (s.startswith("|") and s.endswith("|")):
            header = None
            out.append(line)
            continue
        if _TABLE_SEPARATOR.match(s):
            continue
        cells = _cells(s)
        if header is None and i + 1 < len(lines) and _TABLE_SEPARATOR.match(lines[i + 1].strip()):
            header = cells
            continue
        label, values = cells[0], cells[1:]
        names = header[1:] if header else [""] * len(values)
        pairs = [f"{n} {v}".strip() for n, v in zip(names, values) if v]
        if label and pairs:
            out.append(f"{label}: {', '.join(pairs)}.")
        elif label or pairs:
            out.append((label or ", ".join(pairs)) + ".")
    return "\n".join(out)


def _tidy(text: str) -> str:
    """Page text ready for sentence splitting: no reference markers, odd spaces, tables or "rate.The" run-ons."""
    text = unicodedata.normalize("NFKC", _REFS.sub("", text)).replace("​", "")
    return _flatten_tables(re.sub(r"(?<=[a-z%)])\.(?=[A-Z][a-z])", ". ", text))


def _snippet(r: dict) -> str:
    title = r.get("title", "").strip().rstrip(".")
    return _tidy(f"{title}. {_SNIPPET_DATE.sub('', r.get('body', ''))}")


def _fetch(url: str) -> str:
    try:
        res = requests.get(url, headers=_HEADERS, timeout=(2, 4))
        if not res.ok or "text/html" not in res.headers.get("Content-Type", ""):
            return ""
        # Without a charset header requests assumes Latin-1 and UTF-8 pages turn into "Â"/"â€™" garbage.
        html = res.text
        if "charset" not in res.headers.get("Content-Type", "").lower():
            try:
                html = res.content.decode("utf-8")
            except UnicodeDecodeError:
                html = res.content.decode(res.apparent_encoding or "latin-1", errors="replace")
        text = trafilatura.extract(html, include_comments=False, include_tables=True, favor_precision=True) or ""
        return _tidy(text)
    except requests.RequestException:
        return ""


_TOKEN = re.compile(r"[a-z0-9][a-z0-9.%$-]*")


def _tokens(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(text.lower()) if t not in nlp.STOPWORDS]


def _bm25(query: str, docs: list[str], k1: float = 1.4, b: float = 0.75) -> list[float]:
    """BM25 scores. Milliseconds on CPU, unlike embedding every chunk."""
    q = set(_tokens(query))
    toks = [_tokens(d) for d in docs]
    avg = sum(map(len, toks)) / max(len(toks), 1)
    df = Counter(t for ts in toks for t in set(ts) if t in q)
    n = len(docs)
    scores = []
    for ts in toks:
        tf = Counter(ts)
        s = 0.0
        for t in q:
            if tf[t]:
                idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
                s += idf * tf[t] * (k1 + 1) / (tf[t] + k1 * (1 - b + b * len(ts) / (avg or 1)))
        # Favour passages with numbers when the question is about figures.
        if re.search(r"\d", " ".join(q)) or any(w in q for w in ("rate", "price", "how", "much", "many")):
            s *= 1.15 if re.search(r"\d", " ".join(ts)) else 1.0
        scores.append(s)
    return scores


def search(query: str, fast: bool = False) -> list[dict]:
    """Return passages: {"text", "title", "url", "site"} ranked by relevance to the query.

    fast (voice): read fewer pages under a shorter deadline; search snippets still cover the rest.
    """
    cfg = current_app.config
    results = _search(query, cfg["WEB_SEARCH_RESULTS"])
    if not results:
        return []

    # Snippets are always available; full pages add depth when they load.
    passages = [
        {"text": _snippet(r), "title": r.get("title", ""), "url": r.get("href", "")}
        for r in results
        if r.get("body")
    ]
    top = results[: 2 if fast else cfg["WEB_FETCH_PAGES"]]
    pool = ThreadPoolExecutor(max_workers=len(top) or 1)
    # Not a context manager: we must not wait on sites that miss the deadline.
    futures = {pool.submit(_fetch, r["href"]): r for r in top if r.get("href")}
    try:
        for fut in as_completed(futures, timeout=2.5 if fast else 4):
            r = futures[fut]
            try:
                text = fut.result()
            except Exception:
                continue
            for chunk in nlp.chunk_text(text, size=600, overlap=80)[:30]:
                passages.append({"text": chunk, "title": r.get("title", ""), "url": r["href"]})
    except TimeoutError:
        pass  # slow sites are skipped; snippets still cover them
    pool.shutdown(wait=False, cancel_futures=True)

    if not passages:
        return []
    scores = _bm25(query, [p["text"] for p in passages])
    ranked = [p for _s, p in sorted(zip(scores, passages), key=lambda sp: -sp[0])]

    # BM25 is only a cheap first cut; the cross-encoder reranker makes the final choice from these.
    picked, per_url = [], {}
    for p in ranked:
        if per_url.get(p["url"], 0) >= 3:  # keep sources diverse
            continue
        per_url[p["url"]] = per_url.get(p["url"], 0) + 1
        picked.append({**p, "site": urlparse(p["url"]).netloc.removeprefix("www.")})
        if len(picked) >= cfg["WEB_PASSAGES"] * 3:
            break
    return picked
