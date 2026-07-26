#!/usr/bin/env bash
# CuffBot self-update — run BY THE BOT ITSELF (S127), or by hand on the Pi.
#
#   update.sh [run-as-user] [repo-dir]
#
# S127: pass CUFFBOT_NO_RESTART=1 and the script does everything EXCEPT the
# restart. That is how the bot uses it: the bot awaits this script, and then
# exits itself so systemd (`Restart=always`) brings it back on the new code.
# No sudo anywhere in that path — which is the point, because every failure of
# this chain from S7 to S126 was a sudo or systemd-unit problem.
#
# The last line is machine-readable so the bot can classify the run without
# parsing prose:
#   CUFFBOT_RESULT=<up-to-date|updated|fetch-failed|merge-failed|install-failed|tests-failed> <from> <to>
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

# The one line the bot reads. Always the LAST thing printed, on every path —
# a script that can exit without saying what happened is a script the caller
# has to guess about, and guessing is what produced "the updater never ran".
FROM=""
TO=""
result() { echo "CUFFBOT_RESULT=$1 ${FROM:-unknown} ${TO:-unknown}"; }

# When the timer runs this as root, repo git/npm work happens as the owning
# user (root-owned files in the checkout would break later manual pulls).
run() {
  if [ -n "$RUN_AS" ] && [ "$(id -u)" -eq 0 ]; then
    runuser -u "$RUN_AS" -- "$@"
  else
    "$@"
  fi
}

cd "$REPO_DIR" || { say "repo dir $REPO_DIR missing"; result fetch-failed; exit 1; }

BRANCH="$(run git rev-parse --abbrev-ref HEAD)" || { result fetch-failed; exit 1; }
FROM="$(run git rev-parse --short HEAD)"
if ! run git fetch --quiet origin "$BRANCH"; then
  say "fetch failed (network? credentials?)"
  result fetch-failed
  exit 1
fi

LOCAL="$(run git rev-parse HEAD)"
REMOTE="$(run git rev-parse "origin/$BRANCH")"
TO="$(run git rev-parse --short "origin/$BRANCH")"
if [ "$LOCAL" = "$REMOTE" ]; then
  result up-to-date
  exit 0 # nothing new — stay quiet for the journal's sake
fi

say "updating $LOCAL -> $REMOTE"
if ! run git merge --ff-only --quiet "origin/$BRANCH"; then
  say "fast-forward failed — local edits in the checkout?"
  result merge-failed
  exit 1
fi

if ! run npm install --no-fund --no-audit --loglevel=error; then
  say "npm install failed — rolling back to $LOCAL"
  run git reset --hard --quiet "$LOCAL"
  result install-failed
  exit 1
fi

# The log is created AS THE USER (S77): when the timer runs this as root, a
# bare mktemp left root-owned 0600 files the owner could not read — 37 of
# them piled up unreadable. Old runs' logs are swept; evidence now lives in
# data/last-update-failure.log anyway.
rm -f /tmp/cuffbot-update-tests.*.log 2>/dev/null || true
TEST_LOG="$(run mktemp /tmp/cuffbot-update-tests.XXXXXX.log)"
if ! run npm test >"$TEST_LOG" 2>&1; then
  say "TESTS FAILED on $REMOTE — rolling back to $LOCAL"
  # The failure evidence must reach the operator, not die in /tmp (S76):
  # the tail goes into the journal, the full log is kept where the doctor
  # finds it (data/ is gitignored — survives the rollback below).
  say "---- last 40 lines of the failing test run ----"
  tail -n 40 "$TEST_LOG" | while IFS= read -r line; do say "  $line"; done
  say "---- end of test log (evidence saved to data/last-update-failure.log) ----"
  run mkdir -p "$REPO_DIR/data"
  {
    echo "failed update: $LOCAL -> $REMOTE at $(date -u +%FT%TZ)"
    cat "$TEST_LOG"
  } | run tee "$REPO_DIR/data/last-update-failure.log" >/dev/null 2>&1 || true
  rm -f "$TEST_LOG"
  run git reset --hard --quiet "$LOCAL"
  run npm install --no-fund --no-audit --loglevel=error
  result tests-failed
  exit 1
fi
rm -f "$TEST_LOG"
# A green gate clears any stale failure evidence.
run rm -f "$REPO_DIR/data/last-update-failure.log"

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

# S127: the bot sets this and restarts ITSELF by exiting, so the section below
# — the only part that ever needed sudo — is skipped entirely on that path.
if [ "${CUFFBOT_NO_RESTART:-}" = "1" ]; then
  say "updated to $REMOTE (restart left to the caller)"
  result updated
  exit 0
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
result updated
