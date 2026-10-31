import sqlite3
from pathlib import Path

from flask import current_app, g

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    google_sub    TEXT UNIQUE,
    avatar_url    TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE TABLE IF NOT EXISTS documents (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    mime_type   TEXT,
    size_bytes  INTEGER NOT NULL,
    chunks      INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'ready',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE TABLE IF NOT EXISTS usage_events (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    at             REAL NOT NULL,
    model          TEXT NOT NULL,
    input_tokens   INTEGER NOT NULL,
    output_tokens  INTEGER NOT NULL,
    weighted       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_events_user_at ON usage_events(user_id, at);
CREATE TABLE IF NOT EXISTS doc_chunks (
    document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL,
    idx          INTEGER NOT NULL,
    text         TEXT NOT NULL,
    page         INTEGER,
    PRIMARY KEY (document_id, idx)
);
CREATE INDEX IF NOT EXISTS doc_chunks_user ON doc_chunks(user_id);
CREATE TABLE IF NOT EXISTS skills (
    id            TEXT PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    instructions  TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS skills_user ON skills(user_id);
CREATE TABLE IF NOT EXISTS user_plugins (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plugin_id  TEXT NOT NULL,
    enabled    INTEGER NOT NULL,
    PRIMARY KEY (user_id, plugin_id)
);
CREATE TABLE IF NOT EXISTS password_resets (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  INTEGER NOT NULL
);
"""


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(current_app.config["DATABASE_PATH"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db(app):
    Path(app.config["DATABASE_PATH"]).parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(app.config["DATABASE_PATH"]) as conn:
        conn.executescript(SCHEMA)
        # Lightweight migrations for columns added after the first release.
        cols = {r[1] for r in conn.execute("PRAGMA table_info(documents)")}
        if "indexed" not in cols:
            conn.execute("ALTER TABLE documents ADD COLUMN indexed INTEGER NOT NULL DEFAULT 0")
            conn.execute("UPDATE documents SET indexed = chunks")
        if "error" not in cols:
            conn.execute("ALTER TABLE documents ADD COLUMN error TEXT")
        # Skills: switched off without deleting; source_url is where an imported skill is updated from.
        cols = {r[1] for r in conn.execute("PRAGMA table_info(skills)")}
        if "enabled" not in cols:
            conn.execute("ALTER TABLE skills ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1")
        if "source_url" not in cols:
            conn.execute("ALTER TABLE skills ADD COLUMN source_url TEXT")
        # Indexing jobs live in memory; anything unfinished at shutdown cannot resume. A camera scan keeps its
        # pages' text (keyword search still finds them), so it stays usable.
        conn.execute("UPDATE documents SET status = 'ready' WHERE status = 'indexing' AND mime_type = 'application/x-avenza-scan'")
        conn.execute(
            "UPDATE documents SET status = 'error', error = 'Indexing was interrupted. Please upload the file again.' "
            "WHERE status = 'indexing'"
        )
    app.teardown_appcontext(close_db)


def user_to_json(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "avatar_url": row["avatar_url"],
        "created_at": row["created_at"],
    }
