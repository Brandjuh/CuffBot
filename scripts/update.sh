#!/usr/bin/env bash
# CuffBot self-update — called by cuffbot-update.timer (as root) or manually.
#
#   update.sh [run-as-user] [repo-dir]
#
# Fetches the tracked branch; when new commits exist it fast-forwards,
# installs dependencies, and runs the test suite. Only a green suite gets
# restarted into — a red suite is rolled back to the previous commit and the
# old bot keeps serving. That gate is what makes unattended updates safe.
set -uo pipefail

RUN_AS="${1:-}"
REPO_DIR="${2:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LOG_TAG="cuffbot-update"

say() { echo "$LOG_TAG: $*"; }

# When the timer runs this as root, repo git/npm work happens as the owning
# user (root-owned files in the checkout would break later manual pulls).
run() {
  if [ -n "$RUN_AS" ] && [ "$(id -u)" -eq 0 ]; then
    runuser -u "$RUN_AS" -- "$@"
  else
    "$@"
  fi
}

cd "$REPO_DIR" || { say "repo dir $REPO_DIR missing"; exit 1; }

BRANCH="$(run git rev-parse --abbrev-ref HEAD)" || exit 1
run git fetch --quiet origin "$BRANCH" || { say "fetch failed (network? credentials?)"; exit 1; }

LOCAL="$(run git rev-parse HEAD)"
REMOTE="$(run git rev-parse "origin/$BRANCH")"
if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0 # nothing new — stay silent for the journal's sake
fi

say "updating $LOCAL -> $REMOTE"
run git merge --ff-only --quiet "origin/$BRANCH" || { say "fast-forward failed — local edits in the checkout?"; exit 1; }

if ! run npm install --no-fund --no-audit --loglevel=error; then
  say "npm install failed — rolling back to $LOCAL"
  run git reset --hard --quiet "$LOCAL"
  exit 1
fi

TEST_LOG="$(mktemp /tmp/cuffbot-update-tests.XXXXXX.log)"
if ! run npm test >"$TEST_LOG" 2>&1; then
  say "TESTS FAILED on $REMOTE — rolling back to $LOCAL (log: $TEST_LOG)"
  run git reset --hard --quiet "$LOCAL"
  run npm install --no-fund --no-audit --loglevel=error
  exit 1
fi
rm -f "$TEST_LOG"

# Re-register slash commands (new/changed commands need it; harmless when not).
# A registration failure must be LOUD in the journal: the restart below still
# happens (tested code beats stale code), but until deploy-commands succeeds,
# new commands simply do not exist in Discord — the #1 "where is /x?" cause.
DEPLOY_LOG="$(run node src/deploy-commands.js 2>&1)"
if [ $? -ne 0 ]; then
  say "ERROR: command registration FAILED — new/changed commands are NOT visible in Discord."
  say "deploy-commands said: $DEPLOY_LOG"
  say "fix and re-run manually: node src/deploy-commands.js   (diagnose with: npm run doctor)"
else
  say "commands re-registered"
fi

if command -v systemctl >/dev/null 2>&1; then
  if [ "$(id -u)" -eq 0 ]; then
    systemctl restart cuffbot 2>/dev/null || say "warn: could not restart cuffbot service"
  else
    sudo -n systemctl restart cuffbot 2>/dev/null || say "warn: run 'sudo systemctl restart cuffbot' to load the update"
  fi
  # A restart that lands in a crash-loop looks identical to success from here
  # unless we check: give the service a moment, then verify it is actually up.
  sleep 5
  STATE="$(systemctl is-active cuffbot 2>/dev/null || sudo -n systemctl is-active cuffbot 2>/dev/null || echo unknown)"
  if [ "$STATE" = "active" ]; then
    say "cuffbot service is active after update"
  else
    say "ERROR: cuffbot service is '$STATE' after update — the bot may be DOWN. Check: journalctl -u cuffbot -n 30"
  fi
fi

say "updated to $REMOTE"
