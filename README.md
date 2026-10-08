# AVENZA AI — Frontend

Next.js 16 (App Router) · TypeScript (strict) · Tailwind CSS 4 · shadcn/ui-style components · Lucide icons.

## Run

```bash
npm install
cp .env.example .env.local   # fill in values
npm run dev                  # http://localhost:3000
npm run lint && npx tsc --noEmit
npm run build && npm start
```

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `AUTH_SECRET` | yes | 32+ chars, encrypts the session cookie (`openssl rand -base64 48`) |
| `APP_URL` | yes in prod | Public URL, used for the Google redirect URI |
| `FLASK_API_URL` | for auth + chat | Flask backend base URL (server-side only) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | for Google sign-in | OAuth web client; redirect URI `${APP_URL}/api/auth/google/callback` |

## AI stack

| Piece | Where | Default |
| --- | --- | --- |
| LLM (text chat only) | DeepSeek API (`LLM_PROVIDER=deepseek`) or Gemini API (`gemini`) | DeepSeek: Fast `deepseek-flash` (V4 Flash), Accurate `deepseek-v4-pro`, thinking off. Gemini (default): Fast `gemini-3.5-flash-lite`, Accurate `gemini-3.8-flash`, automatic fallback to other Flash-Lite models when busy |
| Embeddings | Ollama, local | `nomic-embed-text` (`EMBED_MODEL`) |
| Reranker | ONNX Runtime, local | `Xenova/ms-marco-MiniLM-L-12-v2` cross-encoder (`RERANK_MODEL`) |
| Extractive QA | ONNX Runtime, local | `onnx-community/roberta-base-squad2-ONNX` (`QA_MODEL`) |
| Vector DB | ChromaDB, persistent | `backend/instance/chroma` |
| NLP | `backend/avenza/ai/nlp.py` | chunking, entities, intent (document / personal / headlines / web) |
| RAG | `backend/avenza/ai/rag.py` | retrieval → cross-encoder rerank → grounded, cited prompt |

Setup once: put `DEEPSEEK_API_KEY` (paid, top up at https://platform.deepseek.com) or `GEMINI_API_KEY` (free tier, https://aistudio.google.com/apikey) in `.env.local`, then `ollama pull nomic-embed-text` and keep `ollama serve` running (embeddings only).
The NLP models download once into `backend/instance/nlp` on first start (~160 MB).

Pipeline per message: query analysis → search query built from *this* question (previous turn only added for real follow-ups like "and in 2025?") → documents + memory + news (ChromaDB) and live web search in parallel → every passage reranked against the question, off-topic ones dropped → top passages sent to the LLM with "answer from these sources and cite [n]" → streamed reply.
The LLM is used for fast writing only: facts must come from the cited sources, and any figure in a reply that is not in the sources is flagged under the answer. Questions, document passages and web results are sent to the chosen provider's servers.

## Voice assistant (local)

| Piece | Tech | Notes |
| --- | --- | --- |
| Speech-to-text | faster-whisper `base`, int8 CPU (`WHISPER_MODEL`) | ~1-2 s per utterance; auto language detect with English fallback for short clips |
| Text-to-speech | Piper voices in `backend/instance/voices` (`DEFAULT_VOICE`) | ~0.2 s per sentence; replies spoken sentence by sentence while streaming |
| Answers (no LLM) | `backend/avenza/ai/voice_answer.py` + `reader.py` | same retrieval + reranking as chat, then the extractive QA model quotes the answer span and its sentence, with the source named; open questions read the most relevant sentences; "latest news" reads headlines |
| Voice NLP | `backend/avenza/ai/voice_nlp.py` | transcript cleanup (fillers, "AVENZA" mishearings), spoken commands, Markdown to speakable text |
| UI | `src/components/voice/voice-mode.tsx`, `voice-glow.tsx` | gradient pills follow your mic and the real voice output, live one-sentence captions, tap to interrupt, Esc to close |

Spoken commands: "new chat", "stop", "search the web for ...", "turn on/off web search", "goodbye". Typical spoken answer: 1–6 s (mostly web search).
Add voices: `backend/.venv/bin/python -m piper.download_voices <voice-id> --data-dir backend/instance/voices` (list: https://huggingface.co/rhasspy/piper-voices).
The microphone only works on `http://localhost:3000` or https (browser security rule).

## Flask contract expected

The browser only calls Next.js route handlers (`/api/*`); they call Flask server-to-server.

| Flask endpoint | Body | Returns |
| --- | --- | --- |
| `POST /auth/login` | `{email, password}` | `{user:{id,name,email,avatar_url?,created_at?}, token}` |
| `POST /auth/register` | `{name, email, password}` | same as login |
| `POST /auth/forgot-password` | `{email}` | `{}` |
| `POST /auth/oauth/google` | `{id_token}` (already verified by Next) | same as login |
| `PATCH /users/me` | `{name}` (Bearer token) | `{}` |
| `POST /chat` | `{conversationId, messages[], user_id}` (Bearer token) | NDJSON stream of `{"type":"token","value"}`, `{"type":"tool","tool"}`, `{"type":"done"}`, `{"type":"error","message"}` |
| `GET /health` | – | 200 when up |

Errors: non-2xx with `{"error": "message"}`.

## Preview mode (no backend)

With `FLASK_API_URL` unset the app runs entirely in the browser — no API requests:

- Sign up / sign in use accounts stored in this browser's localStorage (PBKDF2-hashed passwords). Not secure auth; for building the UI only.
- Conversations are saved per user in localStorage.
- Sending a message shows a "model not connected" notice — no fake AI replies.
- Password reset is unavailable (needs email from the backend).

Set `FLASK_API_URL` (+ `AUTH_SECRET`) and everything switches to the real server-side flow automatically.

## Status

- Route guard: `src/proxy.ts` (optimistic) + `requireUser()` in the workspace layout.
- Sessions: encrypted (JWE) httpOnly cookie; "remember me" = 30 days, otherwise browser session.
- Google OAuth: real authorization-code + PKCE flow with ID-token verification against Google JWKS. Works without Flask; links to a Flask account when `FLASK_API_URL` is set.
- Without the Flask backend, auth and chat run in preview mode (see above); with it, they go through the server-side `/api` routes.
- Conversations are saved in localStorage per user until a conversation API exists.
- Agents, document analysis, ChromaDB memory, financial tools and the voice assistant are flagged "coming soon" in `src/config/features.ts`. The mic button uses browser dictation only.
