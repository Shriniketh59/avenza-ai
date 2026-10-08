"""Background news ingestion: RSS feeds -> ChromaDB (shared 'news' collection), refreshed periodically."""
import hashlib
import threading
import time
from datetime import datetime, timedelta, timezone

import feedparser

from . import vectorstore

NEWS_OWNER = 0  # shared collection, not tied to a user

FEEDS = {
    "Google News · Business": "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-IN&gl=IN&ceid=IN:en",
    "Google News · Technology": "https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-IN&gl=IN&ceid=IN:en",
    "Google News · World": "https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-IN&gl=IN&ceid=IN:en",
    "Economic Times · Markets": "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
    "Economic Times · Economy": "https://economictimes.indiatimes.com/news/economy/rssfeeds/1373380680.cms",
    "Livemint · Markets": "https://www.livemint.com/rss/markets",
    "CNBC · Finance": "https://www.cnbc.com/id/10000664/device/rss/rss.html",
}

_last_refresh: dict = {"at": None, "added": 0}
# Set while a chat is generating, so background embedding does not steal CPU from it.
chat_active = threading.Event()


def _published(entry) -> datetime:
    parsed = entry.get("published_parsed") or entry.get("updated_parsed")
    return datetime(*parsed[:6], tzinfo=timezone.utc) if parsed else datetime.now(timezone.utc)


def refresh(app) -> int:
    """Fetch every feed and add unseen items. Returns number of new items."""
    with app.app_context():
        col = vectorstore.collection(vectorstore.NEWS, NEWS_OWNER)
        cutoff = datetime.now(timezone.utc) - timedelta(days=app.config["NEWS_MAX_AGE_DAYS"])
        added = 0
        for source, url in FEEDS.items():
            while chat_active.is_set():
                time.sleep(2)
            try:
                feed = feedparser.parse(url, agent="AVENZA-AI/1.0")
            except Exception:
                continue
            items = []
            for e in feed.entries[:40]:
                published = _published(e)
                link = e.get("link", "")
                if not link or published < cutoff:
                    continue
                items.append((hashlib.sha1(link.encode()).hexdigest(), e, published, link))
            if not items:
                continue
            existing = set(col.get(ids=[i[0] for i in items], include=[])["ids"])
            fresh = [i for i in items if i[0] not in existing]
            if not fresh:
                continue
            texts = [
                f"{e.get('title', '')}. {_strip(e.get('summary', ''))} (Published {p:%d %b %Y %H:%M} UTC, {source})"
                for _id, e, p, _l in fresh
            ]
            metas = [
                {"title": e.get("title", ""), "url": link, "source": source, "published_ts": int(p.timestamp())}
                for _id, e, p, link in fresh
            ]
            try:
                vectorstore.add(vectorstore.NEWS, NEWS_OWNER, [i[0] for i in fresh], texts, metas)
                added += len(fresh)
            except Exception as exc:
                app.logger.warning("news embed failed for %s: %s", source, exc)
        # Drop stale headlines so answers stay current.
        col.delete(where={"published_ts": {"$lt": int(cutoff.timestamp())}})
        _last_refresh.update(at=datetime.now(timezone.utc).isoformat(), added=added)
        app.logger.info("news refresh: %d new items", added)
        return added


def _strip(html: str) -> str:
    import re

    return re.sub(r"<[^>]+>", " ", html or "").replace("&nbsp;", " ").strip()[:600]


def start_scheduler(app):
    if not app.config["NEWS_ENABLED"]:
        return

    def loop():
        while True:
            try:
                refresh(app)
            except Exception:
                app.logger.exception("news refresh failed")
            time.sleep(app.config["NEWS_REFRESH_MINUTES"] * 60)

    threading.Thread(target=loop, name="news-refresh", daemon=True).start()


def status() -> dict:
    return dict(_last_refresh)
