import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
# Shares the Next.js env file so one .env.local configures both apps.
load_dotenv(ROOT.parent / ".env.local")
load_dotenv(ROOT / ".env")


class Config:
    SECRET_KEY = os.environ.get("BACKEND_SECRET") or os.environ.get("AUTH_SECRET")
    DATABASE_PATH = os.environ.get("DATABASE_PATH", str(ROOT / "instance" / "avenza.db"))
    TOKEN_TTL_DAYS = int(os.environ.get("TOKEN_TTL_DAYS", "30"))
    GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
    APP_URL = os.environ.get("APP_URL", "http://localhost:3000").rstrip("/")

    # --- Text generation ---
    # AVENZA's two models, as shown to users. Each runs on the provider's "fast" or "accurate" model;
    # weight is how many usage tokens one real token costs (Plus is the larger, slower model).
    AVENZA_MODELS = {
        "flash": {"name": "Avenza Flash", "mode": "fast", "weight": float(os.environ.get("FLASH_TOKEN_WEIGHT", "0.5"))},
        "plus": {"name": "Avenza Plus", "mode": "accurate", "weight": float(os.environ.get("PLUS_TOKEN_WEIGHT", "3"))},
    }
    # --- Image generation (Gemini image models; the API free tier has no image quota, billing must be on) ---
    IMAGE_MODELS = {"fast": os.environ.get("IMAGE_FAST_MODEL", "gemini-3.1-flash-image"),
                    "accurate": os.environ.get("IMAGE_MODEL", "gemini-3-pro-image")}
    IMAGE_BASE_URL = os.environ.get("IMAGE_BASE_URL", "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
    IMAGES_PATH = os.environ.get("IMAGES_PATH", str(ROOT / "instance" / "images"))
    # --- Usage limits (per account, counted in weighted tokens) ---
    # Like Claude: a rolling 5-hour session limit plus a weekly limit that resets every Monday 00:00 UTC.
    USAGE_SESSION_HOURS = float(os.environ.get("USAGE_SESSION_HOURS", "5"))
    USAGE_SESSION_TOKENS = int(os.environ.get("USAGE_SESSION_TOKENS", "300000"))
    USAGE_WEEKLY_TOKENS = int(os.environ.get("USAGE_WEEKLY_TOKENS", "2000000"))
    _LLM_KEY = os.environ.get("LLM_API_KEY", "")
    _PRESET = os.environ.get("LLM_PROVIDER", "")
    GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY") or (_LLM_KEY if _PRESET != "deepseek" else "")
    DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY") or (_LLM_KEY if _PRESET == "deepseek" else "")
    LLM_PROVIDER = _PRESET if _PRESET in ("gemini", "deepseek") else ("deepseek" if DEEPSEEK_API_KEY and not GEMINI_API_KEY else "gemini")
    LLM_PROVIDERS = {
        "gemini": {
            "name": "Gemini",
            "key": GEMINI_API_KEY,
            "base_url": os.environ.get("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai").rstrip("/"),
            # Measured on the free tier (2026-10-05) with a grounded question: 3.5 Flash-Lite answered correctly in
            # 1-3 s; 3.8 Flash took ~5 s (it thinks before writing, "minimal" is rejected) and was often overloaded.
            # Facts come from the sources, so Fast uses the quickest model.
            "models": {"fast": os.environ.get("GEMINI_FAST_MODEL", "gemini-3.5-flash-lite"),
                       "accurate": os.environ.get("GEMINI_MODEL", "gemini-3.8-flash"),
                       # Question understanding (small JSON). Measured 2026-10-21: 3.1 Flash-Lite 2.6 s while
                       # 3.5 Flash-Lite took 18-25 s under load, so routing uses the steadier model.
                       "quick": os.environ.get("GEMINI_QUICK_MODEL", "gemini-3.1-flash-lite")},
            # Flash does not think (first word fastest; facts come from the sources). Plus thinks a little;
            # the code, maths and reasoning agents raise it to "medium".
            "extra": {"fast": {"reasoning_effort": os.environ.get("GEMINI_FAST_REASONING", "minimal")},
                      "accurate": {"reasoning_effort": os.environ.get("GEMINI_REASONING", "low")}},
            # Tried in order when the main model is overloaded (503) or out of free quota (429).
            "fallbacks": [m for m in os.environ.get("GEMINI_FALLBACK_MODELS", "gemini-3.5-flash-lite,gemini-3.1-flash-lite").split(",") if m],
        },
        "deepseek": {
            "name": "DeepSeek",
            "key": DEEPSEEK_API_KEY,
            "base_url": os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/"),
            "models": {"fast": os.environ.get("DEEPSEEK_FAST_MODEL", "deepseek-flash"),
                       "accurate": os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-pro")},
            # Thinking adds seconds before the first word; facts come from the sources instead.
            "extra": {"fast": {"thinking": {"type": "disabled"}}, "accurate": {"thinking": {"type": "disabled"}}},
            "fallbacks": [],
        },
    }
    LLM_DEFAULT_MODE = os.environ.get("LLM_DEFAULT_MODE", "fast")
    LLM_MODEL = LLM_PROVIDERS[LLM_PROVIDER]["models"][LLM_DEFAULT_MODE]
    # Unset = the provider's default; Google advises against lowering it for Gemini 3 (can cause loops).
    LLM_TEMPERATURE = float(os.environ["LLM_TEMPERATURE"]) if os.environ.get("LLM_TEMPERATURE") else None
    # Gemini counts reasoning tokens against this limit too, so leave headroom.
    LLM_MAX_TOKENS = int(os.environ.get("LLM_MAX_TOKENS", "8192"))
    # Start the next model in parallel when the current one has not written a word after this many seconds.
    LLM_HEDGE_SECONDS = float(os.environ.get("LLM_HEDGE_SECONDS", "1.2"))
    # --- Embeddings (Gemini API, uses GEMINI_API_KEY) + local retrieval (ChromaDB) ---
    # Changing the model starts new, empty collections: documents must be uploaded again.
    EMBED_MODEL = os.environ.get("EMBED_MODEL", "gemini-embedding-2")
    EMBED_DIMENSIONS = int(os.environ.get("EMBED_DIMENSIONS", "768"))
    EMBED_BASE_URL = os.environ.get("EMBED_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai").rstrip("/")
    CHROMA_PATH = os.environ.get("CHROMA_PATH", str(ROOT / "instance" / "chroma"))
    UPLOAD_MAX_MB = int(os.environ.get("UPLOAD_MAX_MB", "20"))
    RAG_TOP_K = int(os.environ.get("RAG_TOP_K", "5"))
    # Cosine-distance cut-offs, measured for gemini-embedding-2 (2026-10-24): relevant passages
    # land around 0.21-0.36, unrelated text from about 0.40 upward (median 0.50).
    RAG_MAX_DISTANCE = float(os.environ.get("RAG_MAX_DISTANCE", "0.40"))
    RAG_STRONG_DISTANCE = float(os.environ.get("RAG_STRONG_DISTANCE", "0.28"))
    RAG_KEYWORD_DISTANCE = float(os.environ.get("RAG_KEYWORD_DISTANCE", "0.48"))
    MEMORY_MAX_DISTANCE = float(os.environ.get("MEMORY_MAX_DISTANCE", "0.40"))
    # --- Live data ---
    WEB_SEARCH_RESULTS = int(os.environ.get("WEB_SEARCH_RESULTS", "5"))
    WEB_FETCH_PAGES = int(os.environ.get("WEB_FETCH_PAGES", "3"))
    WEB_PASSAGES = int(os.environ.get("WEB_PASSAGES", "4"))
    NEWS_REFRESH_MINUTES = int(os.environ.get("NEWS_REFRESH_MINUTES", "30"))
    NEWS_MAX_AGE_DAYS = int(os.environ.get("NEWS_MAX_AGE_DAYS", "7"))
    NEWS_ENABLED = os.environ.get("NEWS_ENABLED", "1") == "1"
    NEWS_MAX_DISTANCE = float(os.environ.get("NEWS_MAX_DISTANCE", "0.34"))
    # Passages handed to the model (and shown as sources), best-ranked first.
    MAX_CONTEXT_PASSAGES = int(os.environ.get("MAX_CONTEXT_PASSAGES", "8"))
    # Avenza Flash reads a shorter context: the first word comes sooner and simple questions need less.
    FLASH_CONTEXT_PASSAGES = int(os.environ.get("FLASH_CONTEXT_PASSAGES", "5"))
    FLASH_PASSAGE_CHARS = int(os.environ.get("FLASH_PASSAGE_CHARS", "1200"))
    # Rewrite each chat message as a clear question (typos, shorthand, references) before searching: ~1 s.
    UNDERSTAND_ENABLED = os.environ.get("UNDERSTAND_ENABLED", "1") == "1"
    UNDERSTAND_TIMEOUT = float(os.environ.get("UNDERSTAND_TIMEOUT", "6"))
    # --- NLP models (ONNX Runtime on CPU, downloaded once into NLP_DIR) ---
    # Cross-encoder that ranks every retrieved passage against the question.
    RERANK_MODEL = os.environ.get("RERANK_MODEL", "Xenova/ms-marco-MiniLM-L-12-v2")
    # Extractive question answering (SQuAD 2.0, so it can say "no answer"); powers the voice assistant.
    QA_MODEL = os.environ.get("QA_MODEL", "onnx-community/roberta-base-squad2-ONNX")
    NLP_ONNX_FILE = os.environ.get("NLP_ONNX_FILE", "model_quantized.onnx")
    NLP_DIR = os.environ.get("NLP_DIR", str(ROOT / "instance" / "nlp"))
    NLP_THREADS = int(os.environ.get("NLP_THREADS", str(min(os.cpu_count() or 4, 4))))
    # Passages scoring below this reranker logit are dropped as off-topic. Measured with MiniLM-L-12:
    # answering passages score about -3 and up, unrelated ones about -10.
    RERANK_MIN_SCORE = float(os.environ.get("RERANK_MIN_SCORE", "-6.0"))
    # Minimum reader confidence for a spoken answer span.
    QA_MIN_SCORE = float(os.environ.get("QA_MIN_SCORE", "0.25"))
    # --- Voice (local speech-to-text + text-to-speech) ---
    WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base")  # tiny | base | small (more accurate, slower)
    WHISPER_DIR = os.environ.get("WHISPER_DIR", str(ROOT / "instance" / "whisper"))
    VOICES_DIR = os.environ.get("VOICES_DIR", str(ROOT / "instance" / "voices"))
    DEFAULT_VOICE = os.environ.get("DEFAULT_VOICE", "en_US-lessac-medium")
    VOICE_MAX_AUDIO_MB = int(os.environ.get("VOICE_MAX_AUDIO_MB", "10"))
