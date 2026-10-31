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
hash_of() { "$PY" -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$1"; }
env_get() { grep -E "^$1=" .env.local 2>/dev/null | tail -1 | cut -d= -f2- || true; }
env_set() { # replace or append KEY=VALUE in .env.local
  "$PY" - "$1" "$2" <<'PY'
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
# Node 20+. The system Node can be older (Linux Mint ships 18): use the one installed with nvm when it is.
node_ok() { command -v node >/dev/null && [[ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" -ge 20 ]]; }
if ! node_ok && [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  set +u; source "$HOME/.nvm/nvm.sh" >/dev/null; node_ok || nvm use --silent default >/dev/null 2>&1 || true; set -u
  if ! node_ok; then
    latest="$(ls -d "$HOME"/.nvm/versions/node/v* 2>/dev/null | sort -V | tail -1)"
    [[ -n "$latest" ]] && export PATH="$latest/bin:$PATH"
  fi
fi
node_ok || die "Node.js 20+ is required (found $(node -v 2>/dev/null || echo none)): https://nodejs.org"
ok "Node.js $(node -v)"
# Python 3.13 from uv, kept in the home folder. System Pythons differ between shells (the desktop's and a
# sandboxed editor's), and some lack venv, so the backend's environment is built on this one: it then works in
# every shell, without sudo.
export UV_PYTHON_INSTALL_DIR="$HOME/.local/share/uv/python"
UV="$(command -v uv || echo "$HOME/.local/bin/uv")"
if [[ ! -x "$UV" ]]; then
  echo "  installing uv (Python manager, ~20 MB, once)…"
  mkdir -p "$HOME/.local/bin"
  curl -fsSL https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz \
    | tar -xz --strip-components=1 -C "$HOME/.local/bin" || die "Could not download uv. Check the internet connection."
  UV="$HOME/.local/bin/uv"
fi
PY="$("$UV" python find 3.13 --managed-python 2>/dev/null || true)"
if [[ -z "$PY" ]]; then
  echo "  installing Python 3.13 (~30 MB, once)…"
  "$UV" python install 3.13 >/dev/null 2>&1 || die "Could not install Python 3.13 with uv."
  PY="$("$UV" python find 3.13 --managed-python)"
fi
ok "Python $("$PY" -c 'import platform; print(platform.python_version())') (uv)"

bold "2/6 Configuration (.env.local)"
if [[ ! -f .env.local ]]; then
  cp .env.example .env.local
  ok "created .env.local from .env.example"
fi
if [[ -z "$(env_get AUTH_SECRET)" ]]; then
  env_set AUTH_SECRET "$("$PY" -c 'import secrets; print(secrets.token_urlsafe(48))')"
  ok "generated AUTH_SECRET"
fi
[[ -z "$(env_get FLASK_API_URL)" ]] && env_set FLASK_API_URL "http://127.0.0.1:5000"
if [[ -z "$(env_get LLM_API_KEY)$(env_get GEMINI_API_KEY)$(env_get DEEPSEEK_API_KEY)" ]]; then
  warn "no LLM API key yet: add GEMINI_API_KEY to .env.local, then restart"
else
  ok "LLM API key set"
fi

bold "3/6 Python backend (backend/.venv)"
# The environment must be built on uv's Python: one made by another Python (an older AVENZA, or a different
# shell's system Python) fails in shells that cannot run that Python ("No module named 'flask'").
if ! grep -q "^home = $UV_PYTHON_INSTALL_DIR/" backend/.venv/pyvenv.cfg 2>/dev/null || ! backend/.venv/bin/python -V >/dev/null 2>&1; then
  if [[ -d backend/.venv ]]; then
    warn "rebuilding backend/.venv on the shared Python 3.13 (it was made by another Python)"
    rm -rf backend/.venv
  fi
  "$UV" venv --quiet --python "$PY" backend/.venv || die "Could not create backend/.venv."
  ok "created virtualenv"
fi
REQ_HASH="$(hash_of backend/requirements.txt)"
if [[ "$(cat backend/.venv/.requirements.sha256 2>/dev/null)" != "$REQ_HASH" ]] || ! backend/.venv/bin/python -c "import flask" 2>/dev/null; then
  echo "  installing Python packages (first run takes a few minutes)…"
  # Unpack on the project disk: /tmp is often a small RAM disk and these packages need ~1 GB.
  mkdir -p backend/.venv/.tmp
  TMPDIR="$PWD/backend/.venv/.tmp" "$UV" pip install --quiet --python backend/.venv/bin/python -r backend/requirements.txt \
    || die "Installing the Python packages failed (see the messages above)."
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
EMBED_MODEL="$(env_get EMBED_MODEL)"
ok "embeddings: Gemini API (${EMBED_MODEL:-gemini-embedding-2}, uses GEMINI_API_KEY)"
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
