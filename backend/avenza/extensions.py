"""Skills (a user's own reusable instructions) and built-in plugins (live tools switched on per account).

Skills work like Claude's: a name, a description saying when to use it, and instructions. They can be written by
hand, drafted by the model from a one-line request, or imported from a SKILL.md file or a GitHub link, and an
imported skill can be updated from its source later.
"""
import json
import re
import uuid

import yaml
from flask import Blueprint, g, jsonify, request

from .ai import github, llm, plugins
from .db import get_db
from .tokens import require_auth

bp = Blueprint("extensions", __name__)

MAX_SKILLS = 30
MAX_IMPORT = 10  # SKILL.md files taken from one repository link
_LIMITS = {"name": 60, "description": 300, "instructions": 20000}


def _skill_json(row) -> dict:
    out = {k: row[k] for k in ("id", "name", "description", "instructions", "created_at", "updated_at", "source_url")}
    return {**out, "enabled": bool(row["enabled"]), "command": command_name(row["name"])}


def parse_skill_md(text: str) -> dict:
    """{"name", "description", "instructions"} from a SKILL.md: YAML frontmatter (name, description), then the body."""
    text = text.lstrip("\ufeff").replace("\r\n", "\n")
    meta, body = {}, text
    m = re.match(r"^---\n(.*?)\n---\n?(.*)$", text, re.S)
    if m:
        try:
            meta = yaml.safe_load(m[1]) or {}
        except yaml.YAMLError:
            meta = {}
        meta = meta if isinstance(meta, dict) else {}
        body = m[2]
    name = str(meta.get("name") or "").strip()
    if not name:  # no frontmatter: the first heading names it
        h = re.search(r"^#\s+(.+)$", body, re.M)
        name = h[1].strip() if h else ""
    # Claude skill names are kebab-case ("pdf-report"); show them as words.
    if re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)+", name):
        name = name.replace("-", " ").capitalize()
    desc = re.sub(r"\s+", " ", str(meta.get("description") or "")).strip()
    return {"name": name[:60], "description": desc[:300], "instructions": body.strip()[:20000]}


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


def user_skills(user_id: int, enabled_only: bool = False) -> list:
    sql = "SELECT * FROM skills WHERE user_id = ?" + (" AND enabled = 1" if enabled_only else "") + " ORDER BY name COLLATE NOCASE"
    return get_db().execute(sql, (user_id,)).fetchall()


def command_name(name: str) -> str:
    """The slash command that runs a skill: "Equity research note" -> "equity-research-note"."""
    return re.sub(r"[^\w]+", "-", name.lower()).strip("-_") or "skill"


def skill_command(user_id: int, text: str):
    """(skill, rest of the message) when the message starts with /<skill command>, like Claude's slash commands;
    else (None, text). An explicit command runs the skill even when it is switched off."""
    m = re.match(r"^\s*/([\w-]+)(?:\s+|$)", text)
    if not m:
        return None, text
    skill = next((s for s in user_skills(user_id) if command_name(s["name"]) == m[1].lower()), None)
    return (skill, text[m.end():].strip()) if skill else (None, text)


def pick_skill(question: str, skills: list) -> str | None:
    """The skill whose description fits this question, chosen by the quick model (like Claude choosing a skill
    from its description); None when none fits or the model does not answer in time."""
    listed = [{"id": s["id"], "name": s["name"], "description": s["description"]} for s in skills if s["description"]]
    if not listed:
        return None
    out = llm.quick_json([
        {"role": "system", "content": "You route a user's message to one of their saved skills. A skill fits only when "
         "its description clearly covers what the message asks for. Reply as JSON: {\"skill\": \"<id>\"} or {\"skill\": null}."},
        {"role": "user", "content": f"Skills: {json.dumps(listed, ensure_ascii=False)}\n\nMessage: {question[:1500]}"},
    ], timeout=3.0, max_tokens=60)
    chosen = (out or {}).get("skill")
    return chosen if any(s["id"] == chosen for s in listed) else None


def _count_ok(user_id: int, adding: int = 1) -> bool:
    return get_db().execute("SELECT COUNT(*) FROM skills WHERE user_id = ?", (user_id,)).fetchone()[0] + adding <= MAX_SKILLS


def _insert(user_id: int, fields: dict, source_url: str | None = None) -> str:
    skill_id = uuid.uuid4().hex
    get_db().execute("INSERT INTO skills (id, user_id, name, description, instructions, source_url) VALUES (?, ?, ?, ?, ?, ?)",
                     (skill_id, user_id, fields["name"], fields.get("description", ""), fields["instructions"], source_url))
    return skill_id


def _from_github(url: str) -> list[tuple[str, dict]]:
    """[(source url, parsed skill)] for a GitHub link to a SKILL.md, a skill folder, or a whole repository."""
    loc = github.parse_url(url)
    if loc is None:
        raise github.GitHubError("Paste a github.com link to a SKILL.md file, a skill folder or a repository.")
    owner, repo, path = loc["owner"], loc["repo"], loc["path"] or ""
    if loc["kind"] == "blob" and path.lower().endswith(".md"):
        ref, paths = loc["ref"], [path]
    else:
        ref, paths = github.find_files(owner, repo, loc["ref"], path, "SKILL.md", MAX_IMPORT)
        if not paths:
            raise github.GitHubError("No SKILL.md file was found at that link.")
    out = []
    for p in paths:
        parsed = parse_skill_md(github.file_text(owner, repo, p, ref))
        if not parsed["name"]:  # the folder names it: skills/pdf-report/SKILL.md -> "Pdf report"
            folder = p.rsplit("/", 2)[-2] if "/" in p else repo
            parsed["name"] = folder.replace("-", " ").replace("_", " ").capitalize()[:60]
        if parsed["instructions"]:
            out.append((f"https://github.com/{owner}/{repo}/blob/{ref}/{p}", parsed))
    return out


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
    if not _count_ok(g.user["id"]):
        return jsonify(error=f"You can have up to {MAX_SKILLS} skills."), 400
    skill_id = _insert(g.user["id"], fields)
    get_db().commit()
    return jsonify(skill=_skill_json(user_skill(g.user["id"], skill_id))), 201


@bp.post("/skills/import")
@require_auth
def import_skills():
    """Import from {"url": GitHub link} (one SKILL.md, a folder, or every SKILL.md in a repository) or {"content": SKILL.md text}."""
    data = request.get_json(silent=True) or {}
    url, content = str(data.get("url") or "").strip(), str(data.get("content") or "")
    try:
        found = _from_github(url) if url else [(None, parse_skill_md(content))]
    except github.GitHubError as exc:
        return jsonify(error=str(exc)), 400
    except Exception:
        return jsonify(error="Could not reach GitHub. Try again shortly."), 502
    cleaned = []
    for source, parsed in found:
        fields, error = _clean(parsed, partial=False)
        if error:
            return jsonify(error=f"{source or 'SKILL.md'}: {error}"), 400
        cleaned.append((source, fields))
    if not cleaned:
        return jsonify(error="The file has no instructions."), 400
    existing = {r["source_url"]: r["id"] for r in user_skills(g.user["id"]) if r["source_url"]}
    new = [c for c in cleaned if c[0] not in existing]
    if not _count_ok(g.user["id"], len(new)):
        return jsonify(error=f"You can have up to {MAX_SKILLS} skills."), 400
    ids = []
    for source, fields in cleaned:
        if source in existing:  # imported before: update it in place
            _update(existing[source], fields)
            ids.append(existing[source])
        else:
            ids.append(_insert(g.user["id"], fields, source))
    get_db().commit()
    return jsonify(skills=[_skill_json(user_skill(g.user["id"], i)) for i in ids]), 201


@bp.post("/skills/<skill_id>/refresh")
@require_auth
def refresh_skill(skill_id: str):
    """Update an imported skill from its GitHub source."""
    row = user_skill(g.user["id"], skill_id)
    if row is None:
        return jsonify(error="Skill not found."), 404
    if not row["source_url"]:
        return jsonify(error="This skill was not imported, so there is nothing to update it from."), 400
    try:
        found = _from_github(row["source_url"])
    except github.GitHubError as exc:
        return jsonify(error=str(exc)), 400
    except Exception:
        return jsonify(error="Could not reach GitHub. Try again shortly."), 502
    fields, error = _clean(found[0][1], partial=False)
    if error:
        return jsonify(error=error), 400
    changed = any(fields[k] != row[k] for k in fields)
    if changed:
        _update(skill_id, fields)
        get_db().commit()
    return jsonify(skill=_skill_json(user_skill(g.user["id"], skill_id)), changed=changed)


@bp.post("/skills/generate")
@require_auth
def generate_skill():
    """Draft a skill (name, description, instructions) from what the user wants it to do. Nothing is saved."""
    goal = str((request.get_json(silent=True) or {}).get("prompt") or "").strip()[:2000]
    if len(goal) < 8:
        return jsonify(error="Describe what the skill should do in a sentence or two."), 400
    out = llm.quick_json([
        {"role": "system", "content": (
            "You write skills for an AI assistant, in the style of Anthropic's Claude Agent Skills. A skill is reusable "
            "instructions the assistant follows whenever a message matches it. Reply as JSON with:\n"
            "- name: 2-5 words, Title case, at most 50 characters\n"
            "- description: one or two sentences, at most 250 characters, saying what it does AND when to use it "
            "(the trigger: kinds of requests, keywords), because the assistant picks skills by this description\n"
            "- instructions: Markdown, 150-600 words: goal, step-by-step workflow, output format (a template if useful), "
            "style and tone, and a short checklist of things to avoid. Write instructions only: never invent facts, "
            "figures or sources, and never tell the assistant to ignore its accuracy rules.")},
        {"role": "user", "content": goal},
    ], timeout=25.0, max_tokens=1800)
    if not out:
        return jsonify(error="Could not draft the skill right now. Try again, or write it yourself."), 502
    draft = {k: str(out.get(k) or "").strip() for k in ("name", "description", "instructions")}
    fields, error = _clean(draft, partial=False)
    if error:
        return jsonify(error="The draft came back incomplete. Try again."), 502
    return jsonify(draft={**fields, "description": fields.get("description", "")})


@bp.patch("/skills/<skill_id>")
@require_auth
def update_skill(skill_id: str):
    if user_skill(g.user["id"], skill_id) is None:
        return jsonify(error="Skill not found."), 404
    fields, error = _clean(request.get_json(silent=True) or {}, partial=True)
    if error:
        return jsonify(error=error), 400
    data = request.get_json(silent=True) or {}
    if "enabled" in data:
        fields["enabled"] = int(bool(data["enabled"]))
    if fields:
        _update(skill_id, fields)
        get_db().commit()
    return jsonify(skill=_skill_json(user_skill(g.user["id"], skill_id)))


def _update(skill_id: str, fields: dict) -> None:
    sets = ", ".join(f"{k} = ?" for k in fields)  # keys come from _LIMITS or "enabled", never from the request
    get_db().execute(f"UPDATE skills SET {sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') "
                     "WHERE id = ? AND user_id = ?", (*fields.values(), skill_id, g.user["id"]))


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
