"""Book lookup from a photographed cover: details from Open Library (and Google Books with a key), and the full
text from Project Gutenberg when the book is in the public domain.

The camera can only see the cover, so this is how a scan "reads" the rest of the book. Copyrighted books have no
free full text: for them only the description and details are loaded, and the user scans the pages they need.
"""
import re
from dataclasses import dataclass, field

import requests
from flask import current_app

_http = requests.Session()
_http.headers["User-Agent"] = "AVENZA-AI (book lookup)"
MAX_TEXT = 1_500_000  # characters of full text kept (War and Peace is ~3.2 M; most novels are under 1 M)


@dataclass
class Book:
    title: str
    authors: list[str]
    info: str  # description and details, cited as "Book details"
    sources: list[str] = field(default_factory=list)
    full_text: str = ""  # whole book, when it is public domain
    full_text_source: str = ""


def _words(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", s.lower()) if w not in {"the", "a", "an", "of", "and", "by"}}


def _same_book(found_title: str, found_authors: list[str], title: str, author: str) -> bool:
    """A search hit counts only when it clearly is the photographed book (most title words, and the author)."""
    want, got = _words(title), _words(found_title)
    if not want or len(want & got) / len(want) < 0.6:
        return False
    if author:
        last = (re.findall(r"[a-z]+", author.lower()) or [""])[-1]
        return any(last in a.lower() for a in found_authors)
    return True


def _open_library(title: str, author: str, isbn: str) -> dict | None:
    params = {"limit": 3, "fields": "title,author_name,first_publish_year,key,number_of_pages_median,subject,"
                                    "publisher,isbn,id_project_gutenberg"}
    params |= {"isbn": isbn} if isbn else {"title": title, **({"author": author} if author else {})}
    docs = _http.get("https://openlibrary.org/search.json", params=params, timeout=12).json().get("docs") or []
    doc = next((d for d in docs if isbn or _same_book(d.get("title", ""), d.get("author_name") or [], title, author)), None)
    if doc is None:
        return None
    desc = ""
    try:
        work = _http.get(f"https://openlibrary.org{doc['key']}.json", timeout=10).json()
        desc = work.get("description") or ""
        desc = desc.get("value", "") if isinstance(desc, dict) else str(desc)
    except (requests.RequestException, ValueError):
        pass
    return {**doc, "description": desc.strip(), "url": f"https://openlibrary.org{doc['key']}"}


def _google_books(title: str, author: str, isbn: str) -> dict | None:
    key = current_app.config.get("GOOGLE_BOOKS_API_KEY")
    if not key:  # the keyless quota is shared by everyone and is usually used up
        return None
    q = f"isbn:{isbn}" if isbn else f"intitle:{title}" + (f"+inauthor:{author}" if author else "")
    items = _http.get("https://www.googleapis.com/books/v1/volumes", params={"q": q, "maxResults": 3, "key": key},
                      timeout=10).json().get("items") or []
    for it in items:
        v = it.get("volumeInfo", {})
        if isbn or _same_book(v.get("title", ""), v.get("authors") or [], title, author):
            return {**v, "url": v.get("infoLink")}
    return None


def _download(gid: str) -> tuple[str, str]:
    """(text, page url) of a Project Gutenberg book, without the licence header and footer."""
    r = _http.get(f"https://www.gutenberg.org/cache/epub/{gid}/pg{gid}.txt", timeout=40)
    r.raise_for_status()
    r.encoding = "utf-8"
    text = r.text
    start = re.search(r"\*\*\* ?START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*?\*\*\*", text, re.I)
    end = re.search(r"\*\*\* ?END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK", text, re.I)
    return text[start.end() if start else 0:end.start() if end else len(text)].strip()[:MAX_TEXT], \
        f"https://www.gutenberg.org/ebooks/{gid}"


def _gutenberg_id(title: str, author: str) -> str | None:
    """Fallback search on Gutendex when Open Library has no Gutenberg id. It is slow, so one short try."""
    title = re.sub(r"\[.*?\]|\(.*?\)", " ", title).strip()  # "Gitanjali (song offerings)"
    last = (re.findall(r"[A-Za-z]+", author) or [""])[-1]
    res = _http.get("https://gutendex.com/books/", params={"search": f"{title} {last}".strip()}, timeout=15).json()
    for b in res.get("results") or []:
        names = [x.get("name", "") for x in b.get("authors") or []]
        if not b.get("copyright") and _same_book(b.get("title", ""), names, title, author):
            return str(b["id"])
    return None


def lookup(title: str, author: str = "", isbn: str = "") -> Book | None:
    """The book on a photographed cover, or None when it cannot be identified with confidence."""
    isbn = re.sub(r"[^0-9X]", "", isbn.upper())
    isbn = isbn if len(isbn) in (10, 13) else ""
    if not title and not isbn:
        return None
    ol = gb = None
    try:
        ol = _open_library(title, author, isbn)
    except (requests.RequestException, ValueError) as exc:
        current_app.logger.warning("Open Library lookup failed: %s", exc)
    try:
        gb = _google_books(title, author, isbn)
    except (requests.RequestException, ValueError) as exc:
        current_app.logger.warning("Google Books lookup failed: %s", exc)
    if ol is None and gb is None:
        return None
    name = (ol or {}).get("title") or (gb or {}).get("title") or title
    name = re.sub(r"\s*\[[^\]]*\]", "", name).strip() or name  # "… Holmes [12 stories]"
    authors = (ol or {}).get("author_name") or (gb or {}).get("authors") or ([author] if author else [])
    lines = [f"Book: {name}" + (f" by {', '.join(authors[:3])}" if authors else "") + "."]
    if ol:
        if ol.get("first_publish_year"):
            lines.append(f"First published: {ol['first_publish_year']}.")
        if ol.get("number_of_pages_median"):
            lines.append(f"Pages (typical edition): {ol['number_of_pages_median']}.")
        if ol.get("subject"):
            lines.append("Subjects: " + ", ".join(ol["subject"][:12]) + ".")
    if gb:
        for k, label in (("publisher", "Publisher"), ("publishedDate", "Published"), ("pageCount", "Pages")):
            if gb.get(k):
                lines.append(f"{label} (Google Books): {gb[k]}.")
        if gb.get("categories"):
            lines.append("Categories: " + ", ".join(gb["categories"]) + ".")
    desc = (gb or {}).get("description") or (ol or {}).get("description") or ""
    if desc:
        lines.append("Description: " + re.sub(r"<[^>]+>|\s+", " ", desc).strip())
    book = Book(name, authors, "\n".join(lines), [u for u in ((ol or {}).get("url"), (gb or {}).get("url")) if u])
    # Public domain = on Project Gutenberg: load the whole book.
    try:
        ids = (ol or {}).get("id_project_gutenberg") or []
        gid = ids[0] if ids else _gutenberg_id(title or name, author or (authors[0] if authors else ""))
        if gid:
            book.full_text, book.full_text_source = _download(gid)
    except (requests.RequestException, ValueError) as exc:  # the book details still help
        current_app.logger.warning("Project Gutenberg lookup failed: %s", exc)
    return book
