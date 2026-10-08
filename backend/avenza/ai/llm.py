"""Text generation through the Gemini or DeepSeek API; embeddings through local Ollama."""
import json
import time
from collections.abc import Iterator

import requests
from flask import current_app

# One pooled HTTPS connection to the provider: skips a TLS handshake on every message.
_http = requests.Session()


class LLMUnavailable(RuntimeError):
    pass


def provider() -> dict:
    return current_app.config["LLM_PROVIDERS"][current_app.config["LLM_PROVIDER"]]


def resolve_mode(mode: str | None) -> str:
    cfg = current_app.config
    return mode if mode in ("fast", "accurate") else cfg["LLM_DEFAULT_MODE"]


def _error_message(res: requests.Response) -> str:
    try:
        body = res.json()
        body = body[0] if isinstance(body, list) and body else body
        return str(body.get("error", {}).get("message") or body)[:240]
    except ValueError:
        return res.text[:240]


class _Retry(Exception):
    """The provider is busy or out of quota for this model: try again or move to the next model."""


def _open_stream(p: dict, body: dict) -> requests.Response:
    name = p["name"]
    try:
        res = _http.post(
            f"{p['base_url']}/chat/completions",
            headers={"Authorization": f"Bearer {p['key']}", "Accept": "text/event-stream"},
            json=body,
            stream=True,
            timeout=(5, 120),
        )
    except requests.RequestException as exc:
        raise LLMUnavailable(f"Cannot reach the {name} API. Check your internet connection.") from exc
    if res.ok:
        return res
    detail = _error_message(res)
    res.close()
    if res.status_code in (500, 502, 503, 504, 429):
        raise _Retry(f"{res.status_code}: {detail}")
    if res.status_code == 400 and "thinking level" in detail.lower() and "reasoning_effort" in body:
        raise _Retry("unsupported reasoning level")
    if res.status_code in (401, 403) or "API key" in detail:
        raise LLMUnavailable(f"{name} rejected the API key. Check LLM_API_KEY in .env.local.")
    if res.status_code == 402:
        raise LLMUnavailable(f"Your {name} account has no balance left.")
    if res.status_code == 404:
        raise _Retry(f"model '{body['model']}' not available")
    raise LLMUnavailable(f"{name} error ({res.status_code}): {detail}")


def stream_chat(messages: list[dict], mode: str | None = None, reasoning: str | None = None) -> Iterator[str]:
    """Yield text chunks as they are generated (OpenAI-compatible SSE stream).

    Busy or rate-limited models are skipped in favour of the provider's fallback models, in order.
    reasoning overrides the provider's reasoning effort ("low" | "medium" | "high") where it has one.
    """
    cfg = current_app.config
    p = provider()
    name = p["name"]
    if not p["key"]:
        raise LLMUnavailable("The LLM API is not configured. Add LLM_API_KEY to .env.local and restart the app.")
    mode = resolve_mode(mode)
    extra = dict(p["extra"][mode])
    if reasoning and "reasoning_effort" in extra:
        extra["reasoning_effort"] = reasoning
    base = {"messages": messages, "stream": True, "max_tokens": cfg["LLM_MAX_TOKENS"], **extra}
    if cfg["LLM_TEMPERATURE"] is not None:
        base["temperature"] = cfg["LLM_TEMPERATURE"]

    # Busy models answer 503 within ~2 s; moving straight to the next model is faster than waiting to retry.
    attempts = [p["models"][mode]] + [m for m in p.get("fallbacks", []) if m != p["models"][mode]]
    res, last = None, ""
    for model in attempts:
        body = {**base, "model": model}
        try:
            res = _open_stream(p, body)
            break
        except _Retry as exc:
            last = str(exc)
            if last == "unsupported reasoning level":
                base.pop("reasoning_effort", None)
                try:
                    res = _open_stream(p, {**base, "model": model})
                    break
                except _Retry as exc2:
                    last = str(exc2)
            current_app.logger.warning("%s %s unavailable (%s); trying next", name, model, last)
    if res is None:
        if last.startswith("429"):
            raise LLMUnavailable(f"{name} free-tier limit reached on every model. Wait a minute and try again.")
        raise LLMUnavailable(f"{name} is overloaded right now. Try again in a few seconds.")

    res.encoding = "utf-8"  # SSE is UTF-8; without a charset header requests would assume Latin-1 (₹ -> â‚¹)
    with res:
        for raw in res.iter_lines(decode_unicode=True):
            if not raw or not raw.startswith("data:"):
                continue  # blank separators and ": keep-alive" comments
            payload = raw[5:].strip()
            if payload == "[DONE]":
                break
            data = json.loads(payload)
            if isinstance(data, list):
                data = data[0] if data else {}
            if data.get("error"):
                raise LLMUnavailable(str(data["error"].get("message", data["error"])))
            for choice in data.get("choices", []):
                chunk = (choice.get("delta") or {}).get("content")
                if chunk:
                    yield chunk


def complete(messages: list[dict], mode: str | None = None) -> str:
    return "".join(stream_chat(messages, mode))


def quick_json(messages: list[dict], timeout: float = 2.5, max_tokens: int = 400) -> dict | None:
    """One small JSON answer from the fast model with minimal thinking, for routing-type decisions.

    Returns None on any failure or after timeout seconds: callers fall back to rules, never block on it.
    """
    p = provider()
    if not p["key"]:
        return None
    extra = dict(p["extra"]["fast"])
    if "reasoning_effort" in extra:
        extra["reasoning_effort"] = "minimal"  # measured 0.8-1.6 s on Flash-Lite; "none" is rejected
    body = {"model": p["models"]["fast"], "messages": messages, "max_tokens": max_tokens,
            "response_format": {"type": "json_object"}, **extra}
    try:
        res = _http.post(f"{p['base_url']}/chat/completions", headers={"Authorization": f"Bearer {p['key']}"},
                         json=body, timeout=(2, timeout))
        if not res.ok:
            current_app.logger.warning("quick_json: %s %s", res.status_code, _error_message(res))
            return None
        data = res.json()
        data = data[0] if isinstance(data, list) and data else data
        text = data["choices"][0]["message"]["content"] or ""
        text = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```")
        out = json.loads(text)
        return out if isinstance(out, dict) else None
    except (requests.RequestException, ValueError, KeyError, IndexError, TypeError) as exc:
        current_app.logger.warning("quick_json failed: %s", exc)
        return None


def _ollama(path: str) -> str:
    return f"{current_app.config['OLLAMA_URL']}{path}"


def embed(texts: list[str], purpose: str = "document") -> list[list[float]]:
    """Embed texts locally. purpose is "document" (stored) or "query" (search)."""
    if not texts:
        return []
    model = current_app.config["EMBED_MODEL"]
    if model.startswith("nomic-embed"):
        # nomic-embed-text is trained with task prefixes; without them recall drops.
        prefix = "search_query: " if purpose == "query" else "search_document: "
        texts = [prefix + t for t in texts]
    try:
        res = requests.post(
            _ollama("/api/embed"),
            json={"model": model, "input": texts, "keep_alive": current_app.config["OLLAMA_KEEP_ALIVE"]},
            timeout=(5, 120),
        )
    except requests.RequestException as exc:
        raise LLMUnavailable("Cannot reach Ollama for embeddings. Start it with `ollama serve`.") from exc
    if not res.ok:
        raise LLMUnavailable(f"Embedding model '{current_app.config['EMBED_MODEL']}' unavailable ({res.status_code}).")
    return res.json()["embeddings"]


_balance_cache: dict = {"at": 0.0, "ok": None}


def _has_balance(p: dict) -> bool | None:
    """DeepSeek only: whether the account can pay for requests. Cached 5 minutes; None if unknown."""
    if p["name"] != "DeepSeek" or not p["key"]:
        return None
    if time.time() - _balance_cache["at"] < 300:
        return _balance_cache["ok"]
    try:
        res = _http.get(f"{p['base_url']}/user/balance", headers={"Authorization": f"Bearer {p['key']}"}, timeout=3)
        ok = bool(res.json().get("is_available")) if res.ok else None
    except (requests.RequestException, ValueError):
        ok = None
    _balance_cache.update(at=time.time(), ok=ok)
    return ok


def status() -> dict:
    """Whether the API key is set and the local embedding model is available."""
    cfg = current_app.config
    p = provider()
    out = {"provider": p["name"], "llm": cfg["LLM_MODEL"], "llm_ready": bool(p["key"]), "balance_ok": _has_balance(p)}
    try:
        tags = requests.get(_ollama("/api/tags"), timeout=2).json().get("models", [])
    except requests.RequestException:
        return {**out, "ollama": "offline", "embed_ready": False}
    names = {m["name"] for m in tags} | {m["name"].split(":")[0] for m in tags if m["name"].endswith(":latest")}
    return {**out, "ollama": "online", "embed_ready": cfg["EMBED_MODEL"] in names}
