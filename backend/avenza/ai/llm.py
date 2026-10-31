"""Text generation (Avenza Flash / Avenza Plus) and embeddings, all through the LLM API (Gemini or DeepSeek).

Every API call adds its token counts to g.usage (when a request set it up), so chat.py can bill the account.
"""
import itertools
import json
import re
import time
from collections.abc import Iterator
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, TimeoutError, as_completed, wait

import requests
from flask import current_app, g

# One pooled HTTPS connection to the provider: skips a TLS handshake on every message.
_http = requests.Session()


class LLMUnavailable(RuntimeError):
    pass


def provider() -> dict:
    return current_app.config["LLM_PROVIDERS"][current_app.config["LLM_PROVIDER"]]


def resolve_mode(mode: str | None) -> str:
    """"flash" / "plus" (or the older "fast" / "accurate") -> the provider mode "fast" / "accurate"."""
    models = current_app.config["AVENZA_MODELS"]
    if mode in models:
        return models[mode]["mode"]
    return mode if mode in ("fast", "accurate") else current_app.config["LLM_DEFAULT_MODE"]


def model_id(mode: str) -> str:
    """The Avenza model ("flash" | "plus") that runs on a provider mode."""
    return next(k for k, m in current_app.config["AVENZA_MODELS"].items() if m["mode"] == mode)


def _count(mode: str, prompt: int, completion: int) -> None:
    """Add one API call's tokens to the request's usage tally, if the request keeps one."""
    tally = g.get("usage")
    if tally is None:
        return
    row = tally.setdefault(model_id(mode), {"input": 0, "output": 0})
    row["input"] += prompt
    row["output"] += completion


def _estimate(messages: list[dict]) -> int:
    """~4 characters per token, used only when the provider does not report usage."""
    chars = 0
    for m in messages:
        c = m.get("content")
        chars += len(c) if isinstance(c, str) else sum(len(p.get("text", "")) + (1000 if p.get("type") == "image_url" else 0) for p in c or [])
    return chars // 4 + 1


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
            # A free-tier request sometimes hangs without a byte; 45 s still covers Plus thinking before its first word.
            timeout=(5, 45),
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
    # Flash never thinks harder than "low", whatever the agent asks for: speed is the point of it.
    if reasoning and "reasoning_effort" in extra:
        extra["reasoning_effort"] = reasoning if mode == "accurate" or reasoning in ("minimal", "low") else "low"
    base = {"messages": messages, "stream": True, "stream_options": {"include_usage": True},
            "max_tokens": cfg["LLM_MAX_TOKENS"], **extra}
    if cfg["LLM_TEMPERATURE"] is not None:
        base["temperature"] = cfg["LLM_TEMPERATURE"]

    # Hedged requests: the free tier's first word takes anywhere from 1 to 10 s on the same model, and busy models
    # answer 503 after ~2 s. If the current model has not written a word within HEDGE_SECONDS (or fails), the next
    # model starts too, and whichever writes first answers; the others are closed.
    attempts = [p["models"][mode]] + [m for m in p.get("fallbacks", []) if m != p["models"][mode]]
    pool = ThreadPoolExecutor(max_workers=len(attempts))
    running, winner, last, nxt, fatal = {}, None, "", 0, None

    def launch():
        nonlocal nxt
        model = attempts[nxt]
        nxt += 1
        running[pool.submit(_first_chunk, p, {**base, "model": model})] = model

    launch()
    try:
        while winner is None and running:
            wait_for = cfg["LLM_HEDGE_SECONDS"] if nxt < len(attempts) else None
            done, _ = wait(running, timeout=wait_for, return_when=FIRST_COMPLETED)
            if not done:
                launch()  # slow to start: race the next model
                continue
            for fut in done:
                model = running.pop(fut)
                try:
                    winner = fut.result()
                    break
                except _Retry as exc:
                    last = str(exc)
                    current_app.logger.warning("%s %s unavailable (%s); trying next", name, model, last)
                except LLMUnavailable as exc:  # bad key, no balance, no connection: another model may still answer
                    fatal = exc
            if winner is None and not running and nxt < len(attempts):
                launch()
    finally:
        # Close the streams that lost the race (when they open) without waiting for them.
        for fut in running:
            fut.add_done_callback(lambda f: f.exception() is None and f.result()[0].close())
        pool.shutdown(wait=False)
    if winner is None:
        if fatal is not None:
            raise fatal
        if last.startswith("429"):
            raise LLMUnavailable(f"{name} free-tier limit reached on every model. Wait a minute and try again.")
        raise LLMUnavailable(f"{name} is overloaded right now. Try again in a few seconds.")

    res, first, events = winner
    # Tokens are counted even when the reader stops early (the user pressed Stop): the provider still billed them.
    usage, written = None, 0
    try:
        with res:
            try:
                for kind, value in itertools.chain(first, events):
                    if kind == "usage":
                        usage = value
                    else:
                        written += len(value)
                        yield value
            except requests.RequestException as exc:  # the free tier sometimes drops a reply halfway
                raise LLMUnavailable(f"The connection to {name} dropped in the middle of the answer. Please ask again.") from exc
    finally:
        if usage:
            _count(mode, int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0))
        else:
            _count(mode, _estimate(messages), written // 4 + 1)


def _events(res: requests.Response) -> Iterator[tuple[str, object]]:
    """("chunk", text) and ("usage", dict) events from an OpenAI-compatible SSE stream."""
    res.encoding = "utf-8"  # SSE is UTF-8; without a charset header requests would assume Latin-1 (₹ -> â‚¹)
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
        if data.get("usage"):
            yield "usage", data["usage"]
        for choice in data.get("choices", []):
            chunk = (choice.get("delta") or {}).get("content")
            if chunk:
                yield "chunk", chunk


def _first_chunk(p: dict, body: dict):
    """Open a stream and read up to its first word (worker thread: no Flask context).

    Returns (response, events read so far, the rest of the events). Raises _Retry when this model cannot answer.
    """
    try:
        res = _open_stream(p, body)
    except _Retry as exc:
        if str(exc) != "unsupported reasoning level":
            raise
        res = _open_stream(p, {k: v for k, v in body.items() if k != "reasoning_effort"})
    events = _events(res)
    first = []
    try:
        for ev in events:
            first.append(ev)
            if ev[0] == "chunk":
                break
    except (requests.RequestException, LLMUnavailable) as exc:
        res.close()
        raise _Retry(str(exc)) from exc
    return res, first, events


def complete(messages: list[dict], mode: str | None = None) -> str:
    return "".join(stream_chat(messages, mode))


def _post_json(p: dict, body: dict, timeout: float) -> tuple[dict, dict]:
    """One non-streamed JSON completion. Runs in a worker thread, so it must not touch the Flask context."""
    res = _http.post(f"{p['base_url']}/chat/completions", headers={"Authorization": f"Bearer {p['key']}"},
                     json=body, timeout=(2, timeout))
    if not res.ok:
        raise ValueError(f"{res.status_code} {_error_message(res)}")
    data = res.json()
    data = data[0] if isinstance(data, list) and data else data
    text = data["choices"][0]["message"]["content"] or ""
    text = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```")
    out = json.loads(text)
    if not isinstance(out, dict):
        raise ValueError("not a JSON object")
    return out, data.get("usage") or {}


def quick_json(messages: list[dict], timeout: float = 6.0, max_tokens: int = 400) -> dict | None:
    """One small JSON answer for routing-type decisions, from the provider's quick and fast models at once.

    Gemini's lite models answer in ~1 s but spike to 3+ s under load, so both are asked in parallel and the first
    good reply wins. Returns None on any failure or after timeout seconds: callers fall back to rules.
    """
    p = provider()
    if not p["key"]:
        return None
    extra = dict(p["extra"]["fast"])
    if "reasoning_effort" in extra:
        extra["reasoning_effort"] = "minimal"  # measured 0.8-1.6 s on Flash-Lite; "none" is rejected
    models = list(dict.fromkeys(m for m in (p["models"].get("quick"), p["models"]["fast"]) if m))
    pool = ThreadPoolExecutor(max_workers=len(models))
    futures = [pool.submit(_post_json, p, {"model": m, "messages": messages, "max_tokens": max_tokens,
                                           "response_format": {"type": "json_object"}, **extra}, timeout)
               for m in models]
    try:
        for done in as_completed(futures, timeout=timeout):
            try:
                out, u = done.result()
            except (requests.RequestException, ValueError, KeyError, IndexError, TypeError) as exc:
                current_app.logger.warning("quick_json: %s", exc)
                continue
            _count("fast", int(u.get("prompt_tokens") or _estimate(messages)), int(u.get("completion_tokens") or 0))
            return out
    except TimeoutError:
        current_app.logger.warning("quick_json: no reply within %.1f s", timeout)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    return None


def embed(texts: list[str], purpose: str = "document") -> list[list[float]]:
    """Embed texts with the Gemini embedding API. purpose is "document" (stored) or "query" (search).

    Same vectors for both purposes (the OpenAI-compatible endpoint has no task type); kept for callers.
    The free tier allows about 100 texts a minute: indexing ("document") waits out a rate limit so no text is
    dropped, while a search ("query") gives up quickly so a chat reply is never held up.
    """
    if not texts:
        return []
    cfg = current_app.config
    key = cfg["GEMINI_API_KEY"]
    if not key:
        raise LLMUnavailable("Embeddings need GEMINI_API_KEY in .env.local.")
    patient = purpose != "query"
    tries = 15 if patient else 2
    out: list[list[float]] = []
    for i in range(0, len(texts), 100):
        body = {"model": cfg["EMBED_MODEL"], "input": texts[i:i + 100], "dimensions": cfg["EMBED_DIMENSIONS"]}
        for attempt in range(tries):
            try:
                res = _http.post(f"{cfg['EMBED_BASE_URL']}/embeddings", headers={"Authorization": f"Bearer {key}"},
                                 json=body, timeout=(5, 60))
            except requests.RequestException as exc:
                if attempt == tries - 1:
                    raise LLMUnavailable("Cannot reach the Gemini API for embeddings. Check your internet connection.") from exc
                time.sleep(1 + attempt)
                continue
            if res.ok:
                break
            if res.status_code in (429, 500, 502, 503, 504) and attempt < tries - 1:
                delay = 1.0
                if res.status_code == 429 and patient:
                    m = re.search(r"retry(?:Delay)?\D{0,6}([\d.]+)\s*s", res.text, re.I)
                    delay = min(float(m.group(1)) + 1, 65) if m else 30
                    current_app.logger.warning("embedding rate limit; waiting %.0f s", delay)
                time.sleep(delay)
                continue
            raise LLMUnavailable(f"Embedding model '{cfg['EMBED_MODEL']}' failed ({res.status_code}): {_error_message(res)}")
        data = res.json()["data"]
        if len(data) != len(body["input"]):
            raise LLMUnavailable(f"Embedding API returned {len(data)} vectors for {len(body['input'])} texts.")
        out.extend(d["embedding"] for d in sorted(data, key=lambda d: d.get("index", 0)))  # in input order
    return out


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
    """Whether the API keys for generation and embeddings are set."""
    cfg = current_app.config
    p = provider()
    default = cfg["AVENZA_MODELS"][model_id(cfg["LLM_DEFAULT_MODE"])]["name"]
    out = {"provider": p["name"], "llm": default, "llm_ready": bool(p["key"]), "balance_ok": _has_balance(p)}
    return {**out, "embed_ready": bool(cfg["GEMINI_API_KEY"])}
