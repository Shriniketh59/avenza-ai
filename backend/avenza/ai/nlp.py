"""Lightweight NLP: cleaning, chunking, entity extraction and query analysis.

Rule-based on purpose (fast, no extra models); the LLM does the heavy reasoning.
"""
import re
from dataclasses import dataclass, field

_WS = re.compile(r"[ \t]+")
# Candidate sentence ends: terminal punctuation (plus closing quotes/brackets) before whitespace, or a line break.
_SENT_END = re.compile(r"[.!?…]+[\"'”’)\]]*(?=\s)|\n+")
# Words that end in a period without ending the sentence ("9:53 a.m. ET", "Apple Inc. said", "U.S. inflation").
_ABBREVIATIONS = set(
    "mr mrs ms dr prof sr jr st mt vs etc inc ltd co corp plc llc no nos fig approx est dept govt rs re "
    "jan feb mar apr jun jul aug sep sept oct nov dec mon tue wed thu fri sat sun "
    "e.g i.e a.m p.m u.s u.k u.s.a u.n e.u n.a cf al viz ca".split()
)

MONEY = re.compile(r"(?:[$€£₹]\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|bn|b|million|billion|crore|lakh)?|\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|INR|GBP|dollars|rupees))", re.I)
PERCENT = re.compile(r"-?\d+(?:\.\d+)?\s?%")
TICKER = re.compile(r"(?<![\w$])\$[A-Z]{1,5}\b|\b(?:NYSE|NASDAQ|NSE|BSE):\s?[A-Z.]{1,10}\b")
DATE = re.compile(r"\b(?:Q[1-4]\s?(?:FY)?\s?\d{2,4}|FY\s?\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s\d{4})\b", re.I)

FINANCE_TERMS = {
    "revenue", "profit", "margin", "ebitda", "cash flow", "balance sheet", "income statement", "roi", "roe",
    "valuation", "dividend", "interest", "loan", "credit", "debt", "equity", "portfolio", "risk", "forecast",
    "budget", "invoice", "tax", "inflation", "stock", "bond", "liquidity", "expense", "asset", "liability",
}
# Explicit references to the user's own files. Generic phrases ("in the", "report") must not match,
# or ordinary questions ("price of gold in the US") would skip web search.
DOC_HINTS = re.compile(
    r"\b(my|our|this|that|the|these|uploaded|attached|shared)\s+(documents?|files?|pdfs?|sheets?|spreadsheets?|"
    r"excel|docx?|slides?|deck|attachments?|uploads?)\b"
    r"|\b(uploaded|attached)\b|\b(in|from|according to) (my|our|this|the attached|the uploaded) (report|statement|notes?|contract)\b",
    re.I,
)
GREETINGS = re.compile(r"^\s*(hi|hello|hey|thanks|thank you|good (morning|afternoon|evening)|ok|okay)\b[\s!.]*$", re.I)
STOPWORDS = set("a an the and or but if of to in on for with at by from is are was were be been it this that these those what which who how why when where do does did can could should would i you we they he she my your our".split())


def clean_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\x00", "")
    text = _WS.sub(" ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def sentence_spans(text: str) -> list[tuple[int, int]]:
    """(start, end) character spans of the sentences in text, trimmed of surrounding whitespace.

    A period after an abbreviation, an initial ("J. Smith") or before a lowercase word does not end a sentence.
    """
    spans, start = [], 0
    for m in _SENT_END.finditer(text):
        if "\n" not in m.group():
            before = text[start:m.start()].split()
            word = before[-1].lstrip("(\"'“‘").lower() if before else ""
            nxt = text[m.end():m.end() + 2].lstrip()[:1]
            if m.group().rstrip("\"'”’)]") == "." and (
                word in _ABBREVIATIONS or (len(word) == 1 and word.isalpha()) or nxt.islower()
            ):
                continue
        spans.append((start, m.end()))
        start = m.end()
    spans.append((start, len(text)))
    out = []
    for a, b in spans:
        while a < b and text[a].isspace():
            a += 1
        while b > a and text[b - 1].isspace():
            b -= 1
        if b > a:
            out.append((a, b))
    return out


def split_sentences(text: str) -> list[str]:
    return [_WS.sub(" ", text[a:b]) for a, b in sentence_spans(text)]


def _word_tail(text: str, n: int) -> str:
    """The last ~n characters of text, starting at a word boundary (never mid-word)."""
    if len(text) <= n:
        return text
    cut = text.find(" ", len(text) - n)
    return text[cut + 1:] if cut != -1 else ""


def chunk_text(text: str, size: int = 900, overlap: int = 150) -> list[str]:
    """Paragraph/sentence-aware chunks of ~size chars with overlap, split only between words."""
    text = clean_text(text)
    if not text:
        return []
    units: list[str] = []
    for para in text.split("\n\n"):
        para = para.strip()
        if len(para) <= size:
            units.append(para)
        else:
            units.extend(split_sentences(para))

    chunks, current = [], ""
    for unit in units:
        while len(unit) > size:  # very long sentence / table row run
            cut = unit.rfind(" ", size // 2, size)
            cut = cut if cut != -1 else size
            chunks.append(unit[:cut].strip())
            unit = (_word_tail(unit[:cut], overlap) + " " + unit[cut:].strip()).strip()
        if len(current) + len(unit) + 1 > size and current:
            chunks.append(current)
            tail = _word_tail(current, overlap)
            current = f"{tail} {unit}" if tail else unit
        else:
            current = f"{current}\n{unit}" if current else unit
    if current.strip():
        chunks.append(current)
    return [c.strip() for c in chunks if len(c.strip()) > 20]


def extract_entities(text: str) -> dict[str, list[str]]:
    def uniq(xs):
        return list(dict.fromkeys(x.strip() for x in xs))[:10]

    return {
        "money": uniq(MONEY.findall(text)),
        "percent": uniq(PERCENT.findall(text)),
        "tickers": uniq(TICKER.findall(text)),
        "dates": uniq(DATE.findall(text)),
    }


def keywords(text: str, limit: int = 8) -> list[str]:
    words = re.findall(r"[A-Za-z][A-Za-z\-]{2,}", text.lower())
    freq: dict[str, int] = {}
    for w in words:
        if w not in STOPWORDS:
            freq[w] = freq.get(w, 0) + 1
    return [w for w, _ in sorted(freq.items(), key=lambda kv: -kv[1])[:limit]]


RECENCY = re.compile(
    r"\b(latest|today|tonight|yesterday|now|current(ly)?|recent(ly)?|this (week|month|year|quarter)|news|live|"
    r"price|rate|stock|share|market|sensex|nifty|nasdaq|dow|bitcoin|crypto|forex|usd|inr|weather|score|election|"
    r"20(2[4-9]|3\d)|announced|launched|released|who is the (ceo|president|prime minister|pm|chairman))\b",
    re.I,
)
CODE_OR_TASK = re.compile(r"\b(write|code|function|script|regex|sql|translate|rewrite|summari[sz]e (this|the following)|fix (this|my))\b", re.I)


CLOCK = re.compile(
    r"\b(what('s| is)? (the )?(date|time|day)( is it| today| now)?|what time is it|time (is it )?now|"
    r"today'?s date|current (date|time)|what day is (it|today))\b",
    re.I,
)
# Questions about the user themselves: answered from saved memory and documents, never the web.
PERSONAL = re.compile(
    r"\b(who am i|what('s| is| are) my|where do i|what do i|how old am i|do you (know|remember) (me|my|who|what|where)|"
    r"tell me (about )?my|my (name|age|birthday|job|role|company|employer|email|phone|address|city|hobbies))\b",
    re.I,
)
# "latest news", "today's business headlines", "what's happening in the markets": a request for headlines, not a fact.
_NEWS_ASK = re.compile(r"\b(news|headlines?|happening|updates?)\b", re.I)
_NEWS_FILLER = set(
    "latest today todays today's top recent current breaking any some news headline headlines happening update updates "
    "tell give show read me us please what whats what's is are going on in the of for about from new".split()
)
NEWS_TOPICS = {
    "business": ("business", "finance", "economy", "markets"),
    "finance": ("finance", "markets", "business"),
    "market": ("markets",),
    "markets": ("markets",),
    "stock": ("markets",),
    "stocks": ("markets",),
    "economy": ("economy",),
    "economic": ("economy",),
    "tech": ("technology",),
    "technology": ("technology",),
    "world": ("world",),
    "global": ("world",),
    "international": ("world",),
}


def headline_topic(text: str) -> tuple[str, ...] | None:
    """Feed categories for a generic headlines request, () for all news, None if it asks something specific."""
    if not _NEWS_ASK.search(text):
        return None
    words = re.findall(r"[a-z']+", text.lower())
    rest = [w for w in words if w not in _NEWS_FILLER and w not in STOPWORDS]
    if any(w not in NEWS_TOPICS and w not in ("india", "indian") for w in rest):
        return None
    return tuple(dict.fromkeys(c for w in rest for c in NEWS_TOPICS.get(w, ())))


@dataclass
class QueryAnalysis:
    intent: str  # "smalltalk" | "document_question" | "finance_question" | "personal" | "general"
    needs_retrieval: bool
    entities: dict = field(default_factory=dict)
    keywords: list = field(default_factory=list)
    needs_web: bool = False
    is_recent: bool = False
    headlines: tuple | None = None  # set for "latest news" requests: feed categories to read from


def analyze_query(text: str) -> QueryAnalysis:
    lowered = text.lower()
    entities = extract_entities(text)
    if GREETINGS.match(text):
        return QueryAnalysis("smalltalk", False, entities, [])
    # Date/time questions are answered from the system clock.
    if CLOCK.search(text):
        return QueryAnalysis("general", False, entities, [])
    if PERSONAL.search(text):
        return QueryAnalysis("personal", True, entities, keywords(text), needs_web=False)
    topic = headline_topic(text)
    if topic is not None:
        return QueryAnalysis("general", True, entities, keywords(text), needs_web=False, is_recent=True, headlines=topic)
    finance = any(t in lowered for t in FINANCE_TERMS) or any(entities.values())
    doc = bool(DOC_HINTS.search(text))
    intent = "document_question" if doc else "finance_question" if finance else "general"
    recent = bool(RECENCY.search(text))
    # Search the web for factual questions; skip pure tasks (code, rewriting) unless they ask about recent facts.
    needs_web = not doc and (recent or not CODE_OR_TASK.search(text))
    return QueryAnalysis(intent, True, entities, keywords(text), needs_web=needs_web, is_recent=recent)
