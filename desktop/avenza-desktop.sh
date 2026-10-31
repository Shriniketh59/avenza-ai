#!/usr/bin/env bash
# AVENZA AI desktop app: starts AVENZA on this computer if it is not running, then opens it in its own window.
#
#   desktop/avenza-desktop.sh         open AVENZA (starting the servers first when needed)
#   desktop/avenza-desktop.sh --stop  stop the AVENZA servers
#
# The window is Chrome (or Chromium/Edge/Brave) in app mode: no tabs or address bar, and the camera and
# microphone work because the page is on localhost. Logs: ~/.cache/avenza-ai/server.log
set -uo pipefail
APP_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
URL="http://localhost:3000/chat"
LOG_DIR="$HOME/.cache/avenza-ai"
mkdir -p "$LOG_DIR"

notify() { command -v notify-send >/dev/null && notify-send -i avenza-ai "AVENZA AI" "$1" || echo "$1"; }
up() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

if [[ "${1:-}" == "--stop" ]]; then
  pkill -f "$APP_DIR/backend/run.py" ; pkill -f "next dev" ; pkill -f "concurrently -k -n web,api"
  notify "AVENZA stopped."
  exit 0
fi

# Started from the app menu, PATH has the system Node (often too old) and not the one installed with nvm.
node_ok() { command -v node >/dev/null && [[ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" -ge 20 ]]; }
if ! node_ok && [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh" >/dev/null
  node_ok || nvm use --silent default >/dev/null 2>&1 || true
  if ! node_ok; then  # nvm's default is old too: the newest installed version
    latest="$(ls -d "$HOME"/.nvm/versions/node/v* 2>/dev/null | sort -V | tail -1)"
    [[ -n "$latest" ]] && PATH="$latest/bin:$PATH"
  fi
fi
node_ok || { notify "AVENZA needs Node.js 20 or newer (found $(node -v 2>/dev/null || echo none))."; exit 1; }

if ! up 3000 || ! up 5000; then
  if up 3000 || up 5000; then
    notify "Part of AVENZA is already running. Stop it first (right-click the app: Stop AVENZA)."
    exit 1
  fi
  notify "Starting AVENZA…"
  (cd "$APP_DIR" && setsid ./start.sh >"$LOG_DIR/server.log" 2>&1 &)
  for _ in $(seq 1 360); do  # first start can install packages; usually ready in ~10 s
    up 3000 && up 5000 && break
    if grep -q "✗" "$LOG_DIR/server.log" 2>/dev/null; then
      notify "AVENZA could not start. See $LOG_DIR/server.log"
      exit 1
    fi
    sleep 0.5
  done
  up 3000 || { notify "AVENZA did not start in time. See $LOG_DIR/server.log"; exit 1; }
fi

for b in google-chrome google-chrome-stable /opt/google/chrome/google-chrome chromium chromium-browser \
         microsoft-edge brave-browser; do
  if command -v "$b" >/dev/null || [[ -x "$b" ]]; then
    exec "$b" --app="$URL" --class=AvenzaAI --start-maximized
  fi
done
xdg-open "$URL"  # no Chromium-based browser: a normal browser tab
