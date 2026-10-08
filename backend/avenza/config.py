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

    # --- Text generation: Gemini or DeepSeek API (both OpenAI-compatible) ---
    # LLM_API_KEY is the provider-neutral setting: it is used for the selected provider preset
    # (LLM_PROVIDER, default "gemini"). Provider-specific variables still work and take precedence.
    _LLM_KEY = os.environ.get("LLM_API_KEY", "")
    _PRESET = os.environ.get("LLM_PROVIDER", "")
    GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY") or (_LLM_KEY if _PRESET != "deepseek" else "")
    DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY") or (_LLM_KEY if _PRESET == "deepseek" else "")
    # Whichever key is set; the default preset wins when both are.
    LLM_PROVIDER = _PRESET or ("deepseek" if DEEPSEEK_API_KEY and not GEMINI_API_KEY else "gemini")
    LLM_PROVIDERS = {
        "gemini": {
            "name": "Gemini",
            "key": GEMINI_API_KEY,
            "base_url": os.environ.get("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai").rstrip("/"),
            # Measured on the free tier (2026-10-05) with a grounded question: 3.5 Flash-Lite answered correctly in
            # 1-3 s; 3.8 Flash took ~5 s (it thinks before writing, "minimal" is rejected) and was often overloaded.
            # Facts come from the sources, so Fast uses the quickest model.
            "models": {"fast": os.environ.get("GEMINI_FAST_MODEL", "gemini-3.5-flash-lite"),
                       "accurate": os.environ.get("GEMINI_MODEL", "gemini-3.8-flash")},
            "extra": {"fast": {"reasoning_effort": os.environ.get("GEMINI_FAST_REASONING", "low")},
                      "accurate": {"reasoning_effort": os.environ.get("GEMINI_REASONING", "medium")}},
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
    # --- Local embeddings + retrieval (Ollama, no LLM) ---
    OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
    EMBED_MODEL = os.environ.get("EMBED_MODEL", "nomic-embed-text")
    OLLAMA_KEEP_ALIVE = os.environ.get("OLLAMA_KEEP_ALIVE", "60m")
    CHROMA_PATH = os.environ.get("CHROMA_PATH", str(ROOT / "instance" / "chroma"))
    UPLOAD_MAX_MB = int(os.environ.get("UPLOAD_MAX_MB", "20"))
    RAG_TOP_K = int(os.environ.get("RAG_TOP_K", "5"))
    # Cosine-distance cut-offs, tuned for nomic-embed-text: relevant passages
    # land around 0.25-0.40, unrelated text from about 0.43 upward.
    RAG_MAX_DISTANCE = float(os.environ.get("RAG_MAX_DISTANCE", "0.42"))
    RAG_STRONG_DISTANCE = float(os.environ.get("RAG_STRONG_DISTANCE", "0.30"))
    RAG_KEYWORD_DISTANCE = float(os.environ.get("RAG_KEYWORD_DISTANCE", "0.52"))
    MEMORY_MAX_DISTANCE = float(os.environ.get("MEMORY_MAX_DISTANCE", "0.42"))
    # --- Live data ---
    WEB_SEARCH_RESULTS = int(os.environ.get("WEB_SEARCH_RESULTS", "5"))
    WEB_FETCH_PAGES = int(os.environ.get("WEB_FETCH_PAGES", "3"))
    WEB_PASSAGES = int(os.environ.get("WEB_PASSAGES", "4"))
    NEWS_REFRESH_MINUTES = int(os.environ.get("NEWS_REFRESH_MINUTES", "30"))
    NEWS_MAX_AGE_DAYS = int(os.environ.get("NEWS_MAX_AGE_DAYS", "7"))
    NEWS_ENABLED = os.environ.get("NEWS_ENABLED", "1") == "1"
    NEWS_MAX_DISTANCE = float(os.environ.get("NEWS_MAX_DISTANCE", "0.36"))
    # Passages handed to the model (and shown as sources), best-ranked first.
    MAX_CONTEXT_PASSAGES = int(os.environ.get("MAX_CONTEXT_PASSAGES", "8"))
    # Rewrite each chat message as a clear question (typos, shorthand, references) before searching: ~1 s.
    UNDERSTAND_ENABLED = os.environ.get("UNDERSTAND_ENABLED", "1") == "1"
    UNDERSTAND_TIMEOUT = float(os.environ.get("UNDERSTAND_TIMEOUT", "2.5"))
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
