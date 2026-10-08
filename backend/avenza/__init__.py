from flask import Flask, jsonify

from .config import Config
from .db import init_db


def create_app(config: type = Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config)
    if not app.config["SECRET_KEY"] or len(app.config["SECRET_KEY"]) < 32:
        raise RuntimeError("Set AUTH_SECRET (32+ chars) in .env.local before starting the backend.")

    init_db(app)

    from . import auth, chat, documents, memory, users, voice
    from .ai import llm

    for module in (auth, users, chat, documents, memory, voice):
        app.register_blueprint(module.bp)

    from .ai import news

    news.start_scheduler(app)

    from .ai import speech

    speech.warm_up(app)

    @app.get("/health")
    def health():
        return jsonify(status="ok", ai=llm.status(), news=news.status())

    @app.errorhandler(404)
    def not_found(_e):
        return jsonify(error="Not found."), 404

    @app.errorhandler(500)
    def server_error(_e):
        return jsonify(error="Internal server error."), 500

    return app
