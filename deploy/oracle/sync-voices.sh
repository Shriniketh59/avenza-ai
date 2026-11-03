#!/usr/bin/env bash
# Copy the installed voices (Piper voices and the converted Tamil MMS voice) from this computer to the server.
# The Tamil voice cannot be downloaded on the server (it is converted once, see backend/tools/export_mms_voice.py).
#
#   deploy/oracle/sync-voices.sh ubuntu@<server-ip> [ssh key file]
set -euo pipefail
cd "$(dirname "$0")/../.."
[[ $# -ge 1 ]] || { echo "Usage: $0 user@server [ssh-key]"; exit 1; }
SSH=(ssh); [[ -n "${2:-}" ]] && SSH=(ssh -i "$2")
rsync -az --info=progress2 --exclude '*.part' --exclude 'catalog.json' -e "${SSH[*]}" \
  backend/instance/voices/ "$1:/var/data/voices/"
"${SSH[@]}" "$1" 'sudo systemctl restart avenza-api'
echo "✓ Voices copied and the backend restarted."
