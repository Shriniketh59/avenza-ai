#!/usr/bin/env bash
# Add AVENZA AI to the app menu and the desktop (Linux, freedesktop.org menus: Cinnamon, GNOME, KDE, XFCE…).
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# Always the real home folders: an editor sandbox (Flatpak VS Code) points XDG_DATA_HOME into itself.
APPS="$HOME/.local/share/applications"
ICONS="$HOME/.local/share/icons/hicolor"
mkdir -p "$APPS" "$ICONS/512x512/apps" "$ICONS/192x192/apps"
cp "$APP_DIR/public/icon-512.png" "$ICONS/512x512/apps/avenza-ai.png"
cp "$APP_DIR/public/icon-192.png" "$ICONS/192x192/apps/avenza-ai.png"
chmod +x "$APP_DIR/desktop/avenza-desktop.sh"

cat > "$APPS/avenza-ai.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=AVENZA AI
Comment=Finance and technology assistant with documents, voice and camera scanning
Exec="$APP_DIR/desktop/avenza-desktop.sh"
Icon=avenza-ai
Terminal=false
Categories=Office;
StartupWMClass=AvenzaAI
Actions=stop;

[Desktop Action stop]
Name=Stop AVENZA
Exec="$APP_DIR/desktop/avenza-desktop.sh" --stop
DESKTOP
chmod +x "$APPS/avenza-ai.desktop"

DESK="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
if [[ -d "$DESK" ]]; then
  cp "$APPS/avenza-ai.desktop" "$DESK/avenza-ai.desktop"
  chmod +x "$DESK/avenza-ai.desktop"
  # Cinnamon/GNOME ask before running an untrusted launcher; mark ours trusted (on the host when run from a
  # Flatpak editor's terminal, where gio would only write the sandbox's metadata).
  if command -v flatpak-spawn >/dev/null && [[ -f /.flatpak-info ]]; then
    flatpak-spawn --host gio set "$DESK/avenza-ai.desktop" metadata::trusted true 2>/dev/null || true
  elif command -v gio >/dev/null; then
    gio set "$DESK/avenza-ai.desktop" metadata::trusted true 2>/dev/null || true
  fi
fi
command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" 2>/dev/null || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q "$ICONS" 2>/dev/null || true
echo "AVENZA AI added to the app menu${DESK:+ and $DESK}."
