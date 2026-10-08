from flask import Blueprint, g, jsonify

from .ai import vectorstore
from .tokens import require_auth

bp = Blueprint("memory", __name__, url_prefix="/memory")


@bp.get("")
@require_auth
def summary():
    return jsonify(count=vectorstore.collection(vectorstore.MEMORY, g.user["id"]).count())


@bp.delete("")
@require_auth
def clear():
    vectorstore.drop(vectorstore.MEMORY, g.user["id"])
    return jsonify(ok=True)
