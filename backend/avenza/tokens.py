from datetime import datetime, timedelta, timezone
from functools import wraps

import jwt
from flask import current_app, g, jsonify, request

from .db import get_db


def issue_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user_id), "iat": now, "exp": now + timedelta(days=current_app.config["TOKEN_TTL_DAYS"])}
    return jwt.encode(payload, current_app.config["SECRET_KEY"], algorithm="HS256")


def require_auth(view):
    """Bearer-token guard. Sets g.user to the users row."""

    @wraps(view)
    def wrapper(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return jsonify(error="Authentication required."), 401
        try:
            payload = jwt.decode(header[7:], current_app.config["SECRET_KEY"], algorithms=["HS256"])
        except jwt.PyJWTError:
            return jsonify(error="Session expired. Sign in again."), 401
        user = get_db().execute("SELECT * FROM users WHERE id = ?", (int(payload["sub"]),)).fetchone()
        if user is None:
            return jsonify(error="Account not found."), 401
        g.user = user
        return view(*args, **kwargs)

    return wrapper
