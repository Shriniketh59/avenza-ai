"""Per-account usage, counted in API tokens like Claude's plans.

Every chat turn records the tokens the API reported, weighted by model (Avenza Plus costs more than Flash).
Two limits apply: a session window that starts with the first message after the last one ended
(USAGE_SESSION_HOURS long), and a weekly limit that resets every Monday 00:00 UTC.
"""
import time
from datetime import datetime, timedelta, timezone

from flask import Blueprint, current_app, g, jsonify

from .db import get_db
from .tokens import require_auth

bp = Blueprint("usage", __name__)


def _week_start(now: float) -> float:
    day = datetime.fromtimestamp(now, timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return (day - timedelta(days=day.weekday())).timestamp()


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _weighted(r, models: dict) -> int:
    """Usage charged for one row, at the model's current weight (so a change applies to past usage too)."""
    return round((r["input_tokens"] + r["output_tokens"]) * models[r["model"]]["weight"])


def summary(user_id: int) -> dict:
    cfg = current_app.config
    models = cfg["AVENZA_MODELS"]
    now = time.time()
    week_start = _week_start(now)
    window = cfg["USAGE_SESSION_HOURS"] * 3600
    rows = get_db().execute(
        "SELECT at, model, input_tokens, output_tokens, weighted FROM usage_events WHERE user_id = ? AND at >= ? ORDER BY at",
        (user_id, min(week_start, now - 2 * window)),
    ).fetchall()

    # Sessions: each one starts at the first event after the previous session ended.
    session_start = None
    for r in rows:
        if session_start is None or r["at"] >= session_start + window:
            session_start = r["at"]
    if session_start is not None and now >= session_start + window:
        session_start = None
    weighted = {id(r): _weighted(r, models) for r in rows}
    session_used = sum(weighted[id(r)] for r in rows if session_start is not None and r["at"] >= session_start)

    week = [r for r in rows if r["at"] >= week_start]
    by_model = {}
    for key, m in cfg["AVENZA_MODELS"].items():
        mine = [r for r in week if r["model"] == key]
        by_model[key] = {
            "name": m["name"],
            "input_tokens": sum(r["input_tokens"] for r in mine),
            "output_tokens": sum(r["output_tokens"] for r in mine),
            "weighted": sum(weighted[id(r)] for r in mine),
            "weight": m["weight"],
        }
    week_used = sum(weighted[id(r)] for r in week)
    return {
        "session": {
            "used": session_used,
            "limit": cfg["USAGE_SESSION_TOKENS"],
            "resets_at": _iso(session_start + window) if session_start is not None else None,
            "hours": cfg["USAGE_SESSION_HOURS"],
        },
        "weekly": {"used": week_used, "limit": cfg["USAGE_WEEKLY_TOKENS"], "resets_at": _iso(week_start + 7 * 86400)},
        "models": by_model,
        "messages_this_week": len({round(r["at"], 3) for r in week}),
    }


def blocked(user_id: int) -> str | None:
    """Why this account cannot send another message right now, or None."""
    s = summary(user_id)
    for key, label in (("weekly", "weekly"), ("session", "session")):
        part = s[key]
        if part["used"] >= part["limit"]:
            when = datetime.strptime(part["resets_at"], "%Y-%m-%dT%H:%M:%SZ").strftime("%a %d %b, %H:%M UTC")
            return f"You've reached your {label} usage limit. It resets {when}. See Settings → Usage."
    return None


def record(user_id: int, tally: dict) -> None:
    """Store the tokens one chat turn used. tally = {"flash": {"input": n, "output": n}, "plus": {...}}."""
    models = current_app.config["AVENZA_MODELS"]
    now = time.time()
    db = get_db()
    for key, t in tally.items():
        if not (t["input"] or t["output"]):
            continue
        weighted = round((t["input"] + t["output"]) * models[key]["weight"])
        db.execute(
            "INSERT INTO usage_events (user_id, at, model, input_tokens, output_tokens, weighted) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, now, key, t["input"], t["output"], weighted),
        )
    db.commit()


@bp.get("/usage")
@require_auth
def get_usage():
    return jsonify(usage=summary(g.user["id"]))
