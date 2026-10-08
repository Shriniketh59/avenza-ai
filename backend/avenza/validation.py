import re

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def normalize_email(value) -> str:
    return str(value or "").strip().lower()


def validate_email(email: str):
    return None if EMAIL_RE.match(email) else "Enter a valid email address"


def validate_password(pw: str):
    """Mirrors the frontend rules in src/lib/validations.ts."""
    if len(pw) < 8:
        return "Password must be at least 8 characters"
    if len(pw) > 128:
        return "Password is too long"
    if not re.search(r"[A-Z]", pw):
        return "Password needs an uppercase letter"
    if not re.search(r"[a-z]", pw):
        return "Password needs a lowercase letter"
    if not re.search(r"\d", pw):
        return "Password needs a number"
    return None


def validate_name(name: str):
    return None if 2 <= len(name) <= 80 else "Name must be 2–80 characters"
