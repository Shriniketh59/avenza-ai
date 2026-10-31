#!/usr/bin/env bash
# AVENZA AI backend: one-time setup on an Oracle Cloud "Always Free" Ubuntu 24.04 server.
#
#   1. Put your backend settings in ~/avenza.env (paste the contents of .env.render from your laptop).
#   2. Run:  bash setup.sh            (or: DOMAIN=api.example.com bash setup.sh)
#
# It installs the backend in /opt/avenza, keeps its data in /var/data, runs it as a service that restarts
# on failure and on reboot, and serves it over HTTPS with Caddy. Without DOMAIN it uses <ip>.sslip.io,
# a free name that points at this server, so HTTPS works with no domain to buy.
# Safe to run again: each step is skipped or refreshed.
set -euo pipefail

REPO="${REPO:-https://github.com/Shriniketh59/avenza-ai.git}"
BRANCH="${BRANCH:-avenza-models-plugins}"
APP=/opt/avenza
DATA=/var/data
ENV_SRC="$HOME/avenza.env"
RUN_USER="$(id -un)"

step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ -f "$ENV_SRC" ]] || die "Missing $ENV_SRC. Paste the contents of .env.render into it first: nano ~/avenza.env"
grep -q '^GEMINI_API_KEY=.\+' "$ENV_SRC" || die "GEMINI_API_KEY is empty in $ENV_SRC."
grep -q '^BACKEND_SECRET=.\{32,\}' "$ENV_SRC" || die "BACKEND_SECRET must be at least 32 characters in $ENV_SRC."

IP="$(curl -fsS -4 https://ifconfig.me || curl -fsS -4 https://api.ipify.org)"
DOMAIN="${DOMAIN:-${IP//./-}.sslip.io}"

step "1/6 System packages"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git python3-venv python3-dev build-essential \
  caddy iptables-persistent >/dev/null

step "2/6 Code ($BRANCH)"
if [[ -d "$APP/.git" ]]; then
  git -C "$APP" fetch -q origin "$BRANCH" && git -C "$APP" checkout -q "$BRANCH" && git -C "$APP" reset -q --hard "origin/$BRANCH"
else
  sudo mkdir -p "$APP" && sudo chown "$RUN_USER:" "$APP"
  git clone -q --branch "$BRANCH" "$REPO" "$APP"
fi

step "3/6 Python packages (first run takes several minutes)"
sudo mkdir -p "$DATA" && sudo chown "$RUN_USER:" "$DATA"
[[ -x "$APP/backend/.venv/bin/python" ]] || python3 -m venv "$APP/backend/.venv"
mkdir -p "$DATA/.tmp"
TMPDIR="$DATA/.tmp" "$APP/backend/.venv/bin/pip" install -q --upgrade pip
TMPDIR="$DATA/.tmp" "$APP/backend/.venv/bin/pip" install -q -r "$APP/backend/requirements.txt"
rm -rf "$DATA/.tmp"

step "4/6 Settings and voice"
install -m 600 "$ENV_SRC" "$APP/backend/.env"
VOICE="$(grep -E '^DEFAULT_VOICE=' "$ENV_SRC" | cut -d= -f2- || true)"; VOICE="${VOICE:-en_US-lessac-medium}"
mkdir -p "$DATA/voices"
[[ -f "$DATA/voices/$VOICE.onnx" ]] || "$APP/backend/.venv/bin/python" -m piper.download_voices "$VOICE" \
  --data-dir "$DATA/voices" >/dev/null 2>&1 || echo "  (could not download voice $VOICE; voice replies will be silent)"

step "5/6 Backend service"
sudo tee /etc/systemd/system/avenza-api.service >/dev/null <<EOF
[Unit]
Description=AVENZA AI backend (Flask + gunicorn)
After=network-online.target
Wants=network-online.target

[Service]
User=$RUN_USER
WorkingDirectory=$APP/backend
# One process with threads: document indexing jobs and the news scheduler live in this process's memory.
ExecStart=$APP/backend/.venv/bin/gunicorn --workers 1 --threads 8 --bind 127.0.0.1:5000 --timeout 300 "avenza:create_app()"
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now avenza-api >/dev/null 2>&1
sudo systemctl restart avenza-api

step "6/6 HTTPS ($DOMAIN) and firewall"
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$DOMAIN {
	request_body {
		max_size 30MB
	}
	reverse_proxy 127.0.0.1:5000 {
		# Chat replies stream word by word: send each piece at once.
		flush_interval -1
	}
}
EOF
sudo systemctl reload caddy || sudo systemctl restart caddy
# Oracle's Ubuntu image blocks everything but SSH in iptables; open HTTP (certificate check) and HTTPS.
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
done
sudo netfilter-persistent save >/dev/null

for _ in $(seq 1 60); do curl -fsS -m 3 http://127.0.0.1:5000/health >/dev/null 2>&1 && break; sleep 3; done
curl -fsS -m 3 http://127.0.0.1:5000/health >/dev/null || die "The backend did not start. See: journalctl -u avenza-api -n 50"

printf '\n\033[32m✓ Backend running.\033[0m\n'
echo "  Address for Vercel (FLASK_API_URL):  https://$DOMAIN"
echo "  Check it in a browser:               https://$DOMAIN/health"
echo "  Logs:                                journalctl -u avenza-api -f"
echo "  If https does not load: open ports 80 and 443 in Oracle Cloud → your subnet's Security List."
