"""Skills (a user's own reusable instructions) and built-in plugins (live tools switched on per account)."""
import re
import uuid

from flask import Blueprint, g, jsonify, request

from .ai import plugins
from .db import get_db
from .tokens import require_auth

bp = Blueprint("extensions", __name__)

MAX_SKILLS = 30
_LIMITS = {"name": 60, "description": 200, "instructions": 6000}


def _skill_json(row) -> dict:
    return {k: row[k] for k in ("id", "name", "description", "instructions", "created_at", "updated_at")}


def _clean(data: dict, partial: bool) -> tuple[dict, str | None]:
    out = {}
    for field, limit in _LIMITS.items():
        if field not in data:
            if not partial and field != "description":
                return {}, f"{field.capitalize()} is required."
            continue
        value = re.sub(r"[ \t]+\n", "\n", str(data[field] or "")).strip()
        if field != "description" and not value:
            return {}, f"{field.capitalize()} is required."
        if len(value) > limit:
            return {}, f"{field.capitalize()} must be at most {limit} characters."
        out[field] = value
    return out, None


def user_skill(user_id: int, skill_id: str):
    return get_db().execute("SELECT * FROM skills WHERE id = ? AND user_id = ?", (skill_id, user_id)).fetchone()


def user_skills(user_id: int) -> list:
    return get_db().execute("SELECT * FROM skills WHERE user_id = ? ORDER BY name COLLATE NOCASE", (user_id,)).fetchall()


def enabled_plugins(user_id: int) -> set[str]:
    """Plugins this account has on. A plugin the user never toggled is on."""
    off = {r["plugin_id"] for r in get_db().execute(
        "SELECT plugin_id FROM user_plugins WHERE user_id = ? AND enabled = 0", (user_id,))}
    return set(plugins.PLUGINS) - off


@bp.get("/skills")
@require_auth
def list_skills():
    return jsonify(skills=[_skill_json(r) for r in user_skills(g.user["id"])])


@bp.post("/skills")
@require_auth
def create_skill():
    fields, error = _clean(request.get_json(silent=True) or {}, partial=False)
    if error:
        return jsonify(error=error), 400
    db = get_db()
    if db.execute("SELECT COUNT(*) FROM skills WHERE user_id = ?", (g.user["id"],)).fetchone()[0] >= MAX_SKILLS:
        return jsonify(error=f"You can have up to {MAX_SKILLS} skills."), 400
    skill_id = uuid.uuid4().hex
    db.execute("INSERT INTO skills (id, user_id, name, description, instructions) VALUES (?, ?, ?, ?, ?)",
               (skill_id, g.user["id"], fields["name"], fields.get("description", ""), fields["instructions"]))
    db.commit()
    return jsonify(skill=_skill_json(user_skill(g.user["id"], skill_id))), 201


@bp.patch("/skills/<skill_id>")
@require_auth
def update_skill(skill_id: str):
    if user_skill(g.user["id"], skill_id) is None:
        return jsonify(error="Skill not found."), 404
    fields, error = _clean(request.get_json(silent=True) or {}, partial=True)
    if error:
        return jsonify(error=error), 400
    if fields:
        sets = ", ".join(f"{k} = ?" for k in fields)
        get_db().execute(f"UPDATE skills SET {sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') "
                         "WHERE id = ? AND user_id = ?", (*fields.values(), skill_id, g.user["id"]))
        get_db().commit()
    return jsonify(skill=_skill_json(user_skill(g.user["id"], skill_id)))


@bp.delete("/skills/<skill_id>")
@require_auth
def delete_skill(skill_id: str):
    cur = get_db().execute("DELETE FROM skills WHERE id = ? AND user_id = ?", (skill_id, g.user["id"]))
    get_db().commit()
    return (jsonify(ok=True), 200) if cur.rowcount else (jsonify(error="Skill not found."), 404)


@bp.get("/plugins")
@require_auth
def list_plugins():
    on = enabled_plugins(g.user["id"])
    return jsonify(plugins=[{"id": pid, **meta, "enabled": pid in on} for pid, meta in plugins.PLUGINS.items()])


@bp.patch("/plugins/<plugin_id>")
@require_auth
def toggle_plugin(plugin_id: str):
    if plugin_id not in plugins.PLUGINS:
        return jsonify(error="Plugin not found."), 404
    enabled = bool((request.get_json(silent=True) or {}).get("enabled"))
    get_db().execute("INSERT INTO user_plugins (user_id, plugin_id, enabled) VALUES (?, ?, ?) "
                     "ON CONFLICT(user_id, plugin_id) DO UPDATE SET enabled = excluded.enabled",
                     (g.user["id"], plugin_id, int(enabled)))
    get_db().commit()
    return jsonify(plugin={"id": plugin_id, **plugins.PLUGINS[plugin_id], "enabled": enabled})
