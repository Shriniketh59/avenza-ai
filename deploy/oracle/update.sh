#!/usr/bin/env bash
# AVENZA AI backend: install the latest code from GitHub and restart. Run on the server: bash update.sh
set -euo pipefail
APP=/opt/avenza
BRANCH="${BRANCH:-$(git -C "$APP" rev-parse --abbrev-ref HEAD)}"

git -C "$APP" fetch -q origin "$BRANCH"
git -C "$APP" reset -q --hard "origin/$BRANCH"
"$APP/backend/.venv/bin/pip" install -q -r "$APP/backend/requirements.txt"
sudo systemctl restart avenza-api
for _ in $(seq 1 60); do curl -fsS -m 3 http://127.0.0.1:5000/health >/dev/null 2>&1 && break; sleep 3; done
curl -fsS -m 3 http://127.0.0.1:5000/health >/dev/null && echo "✓ Updated to $(git -C "$APP" log --oneline -1)" \
  || { echo "✗ Backend did not start. See: journalctl -u avenza-api -n 50"; exit 1; }
