import hashlib
import secrets
import time

import requests
from flask import Blueprint, current_app, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

from .db import get_db, user_to_json
from .tokens import issue_token
from .validation import normalize_email, validate_email, validate_name, validate_password

bp = Blueprint("auth", __name__, url_prefix="/auth")

# Same cost whether or not the email exists, so timing does not leak accounts.
_DUMMY_HASH = generate_password_hash("timing-equaliser")


def _auth_response(row, status=200):
    return jsonify(user=user_to_json(row), token=issue_token(row["id"])), status


@bp.post("/register")
def register():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    email = normalize_email(data.get("email"))
    password = str(data.get("password", ""))

    fields = {k: v for k, v in {
        "name": validate_name(name),
        "email": validate_email(email),
        "password": validate_password(password),
    }.items() if v}
    if fields:
        return jsonify(error="Check the highlighted fields.", fields=fields), 400

    db = get_db()
    if db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        return jsonify(error="An account with this email already exists.", fields={"email": "Email already registered"}), 409

    cur = db.execute(
        "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
        (name, email, generate_password_hash(password)),
    )
    db.commit()
    row = db.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    return _auth_response(row, 201)


@bp.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    email = normalize_email(data.get("email"))
    password = str(data.get("password", ""))

    row = get_db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    stored = row["password_hash"] if row and row["password_hash"] else _DUMMY_HASH
    if not check_password_hash(stored, password) or not row or not row["password_hash"]:
        return jsonify(error="Invalid email or password."), 401
    return _auth_response(row)


@bp.post("/forgot-password")
def forgot_password():
    data = request.get_json(silent=True) or {}
    email = normalize_email(data.get("email"))
    db = get_db()
    row = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if row:
        token = secrets.token_urlsafe(32)
        db.execute(
            "INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
            (hashlib.sha256(token.encode()).hexdigest(), row["id"], int(time.time()) + 3600),
        )
        db.commit()
        # No email provider is configured yet: log the link for local development.
        current_app.logger.warning(
            "Password reset requested for %s. Email delivery not configured. Link: %s/reset-password?token=%s",
            email, current_app.config["APP_URL"], token,
        )
    # Same response either way so account existence is not revealed.
    return jsonify(ok=True)


@bp.post("/oauth/google")
def oauth_google():
    client_id = current_app.config["GOOGLE_CLIENT_ID"]
    if not client_id:
        return jsonify(error="Google sign-in is not configured on the backend."), 503
    id_token = (request.get_json(silent=True) or {}).get("id_token")
    if not id_token:
        return jsonify(error="Missing id_token."), 400

    # Independent server-side verification (the Next.js layer verified it too).
    res = requests.get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": id_token}, timeout=5)
    if res.status_code != 200:
        return jsonify(error="Invalid Google token."), 401
    claims = res.json()
    if claims.get("aud") != client_id or claims.get("email_verified") not in ("true", True):
        return jsonify(error="Google token rejected."), 401

    sub, email = claims["sub"], normalize_email(claims["email"])
    db = get_db()
    row = db.execute("SELECT * FROM users WHERE google_sub = ? OR email = ?", (sub, email)).fetchone()
    if row is None:
        cur = db.execute(
            "INSERT INTO users (name, email, google_sub, avatar_url) VALUES (?, ?, ?, ?)",
            (claims.get("name") or email, email, sub, claims.get("picture")),
        )
        user_id = cur.lastrowid
    else:
        user_id = row["id"]
        db.execute(
            "UPDATE users SET google_sub = ?, avatar_url = COALESCE(avatar_url, ?) WHERE id = ?",
            (sub, claims.get("picture"), user_id),
        )
    db.commit()
    return _auth_response(db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())
