#!/usr/bin/env bash
# CuffBot Raspberry Pi setup — one script from bare Pi to running bot.
#
# What it does, in order:
#   1. apt: git, curl, ca-certificates
#   2. Node.js 22 LTS via NodeSource (skipped when Node >= 18 already present)
#   3. Clone or update this repository (skipped when run from inside a clone)
#   4. npm install
#   5. Ask for DISCORD_TOKEN / CLIENT_ID and write .env (kept if it exists)
#   6. npm test (sanity), then register the slash commands (guild-scoped)
#   7. Optional: install + start a systemd service so CuffBot survives reboots
#
# Usage (from anywhere on the Pi):
#   git clone https://github.com/Brandjuh/CuffBot.git ~/CuffBot && bash ~/CuffBot/scripts/setup-pi.sh
# Re-running is safe: it updates the repo, keeps .env, and restarts the service.
#
# Environment overrides:
#   CUFFBOT_DIR    install directory (default: ~/CuffBot)
#   CUFFBOT_BRANCH branch to check out (default: the clone's current branch, else main)
set -euo pipefail

REPO_URL="https://github.com/Brandjuh/CuffBot.git"
INSTALL_DIR="${CUFFBOT_DIR:-$HOME/CuffBot}"
NODE_MAJOR_MIN=18
SERVICE_NAME=cuffbot

say()  { printf '\n🚔 %s\n' "$*"; }
fail() { printf '\n❌ %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] && fail "Run this as a normal user, not root — sudo is used only where needed."
command -v sudo >/dev/null 2>&1 || fail "sudo is required (Raspberry Pi OS has it by default)."

# When started from inside an existing CuffBot clone, install there.
if [ -f "${BASH_SOURCE[0]%/*}/../package.json" ] && grep -q '"name": "cuffbot"' "${BASH_SOURCE[0]%/*}/../package.json" 2>/dev/null; then
  INSTALL_DIR="$(cd "${BASH_SOURCE[0]%/*}/.." && pwd)"
fi

say "Step 1/7 — base packages (apt)…"
sudo apt-get update -y
sudo apt-get install -y git curl ca-certificates

say "Step 2/7 — Node.js…"
need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$major" -ge "$NODE_MAJOR_MIN" ]; then
    need_node=0
  fi
fi
if [ "$need_node" -eq 1 ]; then
  case "$(uname -m)" in
    armv6*) fail "This Pi is armv6 (Pi 1/Zero) — Node ${NODE_MAJOR_MIN}+ has no builds for it. Use a Pi 2 or newer / a 64-bit OS." ;;
  esac
  say "Installing Node.js 22 LTS via NodeSource…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
say "Using Node $(node --version), npm $(npm --version)"

say "Step 3/7 — repository…"
if [ -d "$INSTALL_DIR/.git" ]; then
  branch="${CUFFBOT_BRANCH:-$(git -C "$INSTALL_DIR" rev-parse --abbrev-ref HEAD)}"
  say "Updating existing clone at $INSTALL_DIR (branch: $branch)…"
  git -C "$INSTALL_DIR" fetch origin "$branch"
  git -C "$INSTALL_DIR" checkout "$branch"
  git -C "$INSTALL_DIR" pull --ff-only origin "$branch"
else
  branch="${CUFFBOT_BRANCH:-main}"
  say "Cloning CuffBot into $INSTALL_DIR (branch: $branch)…"
  say "Note: the repo is private — username = your GitHub name, password = a Personal Access Token."
  git clone --branch "$branch" "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

say "Step 4/7 — npm dependencies…"
npm install --no-fund --no-audit

say "Step 5/7 — credentials (.env)…"
if [ -f .env ]; then
  say ".env already present — keeping it."
else
  echo "  Get both values from https://discord.com/developers/applications:"
  echo "   - DISCORD_TOKEN: your app → Bot → Reset Token"
  echo "   - CLIENT_ID:     your app → General Information → Application ID"
  read -rsp "  DISCORD_TOKEN (input hidden): " token; echo
  read -rp  "  CLIENT_ID: " client_id
  [ -n "$token" ] || fail "DISCORD_TOKEN may not be empty."
  case "$client_id" in
    *[!0-9]*|"") fail "CLIENT_ID must be the numeric Application ID." ;;
  esac
  umask 177
  printf 'DISCORD_TOKEN=%s\nCLIENT_ID=%s\n' "$token" "$client_id" > .env
  umask 022
  say ".env written with mode 600."
fi

say "Step 6/7 — sanity checks and command registration…"
npm test || fail "Test suite failed — not continuing with a broken checkout."

client_id_now="$(grep -E '^CLIENT_ID=' .env | cut -d= -f2 || true)"
echo
echo "  Before commands can be registered, the bot must be a MEMBER of the precinct."
echo "  If you have not invited it yet, open this URL (needs Manage Server there):"
echo "    https://discord.com/oauth2/authorize?client_id=${client_id_now}&scope=bot%20applications.commands&permissions=2048"
read -rp "  Press Enter once the bot is in the server… "

npm run deploy-commands || fail "Command registration failed — the message above names the exact cause and fix.
   Wrong credentials? Edit them with:  nano $INSTALL_DIR/.env
   Then re-run this script:            bash $INSTALL_DIR/scripts/setup-pi.sh"

say "Step 7/7 — systemd service (start on boot, restart on crash)…"
if ! command -v systemctl >/dev/null 2>&1; then
  say "No systemd on this system — start manually with: cd $INSTALL_DIR && npm start"
else
  read -rp "Install/refresh the '$SERVICE_NAME' service and start it now? [Y/n] " answer
  case "$answer" in
    [Nn]*) say "Skipped. Start manually with: cd $INSTALL_DIR && npm start" ;;
    *)
      sudo tee "/etc/systemd/system/$SERVICE_NAME.service" >/dev/null <<UNIT
[Unit]
Description=CuffBot — police-themed Discord bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$(command -v node) --env-file=.env src/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
      sudo systemctl daemon-reload
      sudo systemctl enable "$SERVICE_NAME" >/dev/null
      sudo systemctl restart "$SERVICE_NAME"
      sleep 2
      sudo systemctl --no-pager status "$SERVICE_NAME" | head -8 || true
      say "Service installed. Live logs: journalctl -u $SERVICE_NAME -f"
      ;;
  esac
fi

say "Setup complete. Try /radio-check in the precinct. 📻"
