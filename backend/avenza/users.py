from flask import Blueprint, g, jsonify, request

from .db import get_db, user_to_json
from .tokens import require_auth
from .validation import validate_name

bp = Blueprint("users", __name__, url_prefix="/users")


@bp.get("/me")
@require_auth
def me():
    return jsonify(user=user_to_json(g.user))


@bp.patch("/me")
@require_auth
def update_me():
    name = str((request.get_json(silent=True) or {}).get("name", "")).strip()
    error = validate_name(name)
    if error:
        return jsonify(error=error, fields={"name": error}), 400
    db = get_db()
    db.execute("UPDATE users SET name = ? WHERE id = ?", (name, g.user["id"]))
    db.commit()
    return jsonify(user=user_to_json(db.execute("SELECT * FROM users WHERE id = ?", (g.user["id"],)).fetchone()))
