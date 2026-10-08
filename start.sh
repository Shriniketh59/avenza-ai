#!/usr/bin/env bash
# AVENZA AI: one-command setup and start.
#
#   ./start.sh               set up whatever is missing, then run the app on http://localhost:3000
#   ./start.sh --setup-only  set up only (dependencies, .env.local, models), do not start
#
# Safe to run every time: each step is skipped when it is already done.
set -euo pipefail
cd "$(dirname "$0")"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die() { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }
hash_of() { python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$1"; }
env_get() { grep -E "^$1=" .env.local 2>/dev/null | tail -1 | cut -d= -f2- || true; }
env_set() { # replace or append KEY=VALUE in .env.local
  python3 - "$1" "$2" <<'PY'
import re, sys
key, value = sys.argv[1], sys.argv[2]
text = open(".env.local").read()
line = f"{key}={value}"
text = re.sub(rf"^{key}=.*$", line, text, count=1, flags=re.M) if re.search(rf"^{key}=", text, re.M) else text.rstrip("\n") + f"\n{line}\n"
open(".env.local", "w").write(text)
PY
}

SETUP_ONLY=0
[[ "${1:-}" == "--setup-only" ]] && SETUP_ONLY=1

bold "1/6 Checking prerequisites"
command -v node >/dev/null || die "Node.js 20+ is required: https://nodejs.org"
[[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]] || die "Node.js 20+ is required (found $(node -v))."
ok "Node.js $(node -v)"
command -v python3 >/dev/null || die "Python 3.11+ is required: https://www.python.org"
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' || die "Python 3.11+ is required (found $(python3 -V))."
ok "$(python3 -V)"
command -v ollama >/dev/null || die "Ollama is required for local embeddings: curl -fsSL https://ollama.com/install.sh | sh"
ok "Ollama $(ollama -v 2>/dev/null | awk '{print $NF}')"

bold "2/6 Configuration (.env.local)"
if [[ ! -f .env.local ]]; then
  cp .env.example .env.local
  ok "created .env.local from .env.example"
fi
if [[ -z "$(env_get AUTH_SECRET)" ]]; then
  env_set AUTH_SECRET "$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
  ok "generated AUTH_SECRET"
fi
[[ -z "$(env_get FLASK_API_URL)" ]] && env_set FLASK_API_URL "http://127.0.0.1:5000"
if [[ -z "$(env_get LLM_API_KEY)$(env_get GEMINI_API_KEY)$(env_get DEEPSEEK_API_KEY)" ]]; then
  if [[ -n "${LLM_API_KEY:-}" ]]; then
    env_set LLM_API_KEY "$LLM_API_KEY"
    ok "LLM_API_KEY taken from the environment"
  elif [[ -t 0 ]]; then
    read -r -s -p "  Paste your LLM API key (Enter to skip): " key; echo
    if [[ -n "$key" ]]; then env_set LLM_API_KEY "$key"; ok "saved LLM_API_KEY"; fi
  fi
fi
if [[ -z "$(env_get LLM_API_KEY)$(env_get GEMINI_API_KEY)$(env_get DEEPSEEK_API_KEY)" ]]; then
  warn "no LLM_API_KEY yet: the app runs, but chat replies need it (add it to .env.local, then restart)"
else
  ok "LLM API key set"
fi

bold "3/6 Python backend (backend/.venv)"
if [[ ! -x backend/.venv/bin/python ]]; then
  python3 -m venv backend/.venv || die "Could not create a virtualenv. On Debian/Ubuntu: sudo apt install python3-venv"
  ok "created virtualenv"
fi
REQ_HASH="$(hash_of backend/requirements.txt)"
if [[ "$(cat backend/.venv/.requirements.sha256 2>/dev/null)" != "$REQ_HASH" ]]; then
  echo "  installing Python packages (first run takes a few minutes)…"
  # Unpack on the project disk: /tmp is often a small RAM disk and these packages need ~1 GB.
  mkdir -p backend/.venv/.tmp
  TMPDIR="$PWD/backend/.venv/.tmp" backend/.venv/bin/python -m pip install -q --upgrade pip
  TMPDIR="$PWD/backend/.venv/.tmp" backend/.venv/bin/python -m pip install -q -r backend/requirements.txt
  rm -rf backend/.venv/.tmp
  echo "$REQ_HASH" > backend/.venv/.requirements.sha256
fi
ok "Python packages installed"

bold "4/6 Frontend (node_modules)"
LOCK_HASH="$(hash_of package-lock.json)"
if [[ ! -d node_modules || "$(cat node_modules/.package-lock.sha256 2>/dev/null)" != "$LOCK_HASH" ]]; then
  echo "  installing npm packages…"
  npm ci --no-audit --no-fund --loglevel=error
  echo "$LOCK_HASH" > node_modules/.package-lock.sha256
fi
ok "npm packages installed"

bold "5/6 Local models"
mkdir -p backend/instance
if ! curl -sf -m 2 http://127.0.0.1:11434/api/tags >/dev/null; then
  nohup ollama serve > backend/instance/ollama.log 2>&1 &
  for _ in $(seq 1 30); do curl -sf -m 1 http://127.0.0.1:11434/api/tags >/dev/null && break; sleep 0.5; done
  curl -sf -m 2 http://127.0.0.1:11434/api/tags >/dev/null || die "Ollama did not start; see backend/instance/ollama.log"
  ok "started Ollama"
fi
EMBED_MODEL="$(env_get EMBED_MODEL)"; EMBED_MODEL="${EMBED_MODEL:-nomic-embed-text}"
if ! curl -sf http://127.0.0.1:11434/api/tags | grep -q "\"$EMBED_MODEL"; then
  ollama pull "$EMBED_MODEL"
fi
ok "embedding model $EMBED_MODEL"
VOICE="$(env_get DEFAULT_VOICE)"; VOICE="${VOICE:-en_US-lessac-medium}"
if [[ ! -f "backend/instance/voices/$VOICE.onnx" ]]; then
  mkdir -p backend/instance/voices
  backend/.venv/bin/python -m piper.download_voices "$VOICE" --data-dir backend/instance/voices >/dev/null 2>&1 \
    && ok "voice $VOICE downloaded" || warn "could not download voice $VOICE (voice replies will be silent)"
else
  ok "voice $VOICE"
fi
ok "reranker, QA and speech-to-text models download automatically on first start (~300 MB, once)"

if [[ $SETUP_ONLY -eq 1 ]]; then
  bold "Setup complete. Start with: ./start.sh"
  exit 0
fi

bold "6/6 Starting AVENZA AI"
for port in 3000 5000; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    die "port $port is already in use (is AVENZA AI already running?). Stop it, then run ./start.sh again."
  fi
done
echo "  web  http://localhost:3000   (Ctrl+C stops everything)"
exec npm run dev
