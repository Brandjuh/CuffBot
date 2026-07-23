# Dispatch — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 11 · 2026-07-23

## Purpose

Dispatch runs the precinct's radio and its paper trail. The **evidence locker** is a channel you designate to receive an embed for every enforcement action (citation, detainment, arrest, release), so the force has one auditable feed. `/dispatch` broadcasts an announcement embed to the precinct. This module is the sink other modules log to, via the cross-module convention.

## Commands

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `/evidence-locker` | Set (to the current channel), show, or clear the log channel | `action` (set / status / clear) | Manage Server | `/evidence-locker action:set` |
| `/dispatch` | Broadcast an announcement embed in the current channel | `message` (required) | Manage Messages | `/dispatch message:All units, code 3` |

### /evidence-locker

- **Options:** `action` — `set` (use the channel the command is run in), `status` (default — show the current locker), or `clear` (stop logging to a channel).
- **Why no channel option:** "set" designates the channel you run it in. This keeps the command identical as a text command (the `!` adapter does not resolve channel mentions) and matches the familiar "run this in your log channel" convention.
- **Reply:** ephemeral (configuration is for the force, not the whole precinct).
- **Failure modes:** missing Manage Server → ephemeral refusal.

### /dispatch

- **Options:** `message` (string ≤ 1800, required).
- **What happens:** posts a 📣 Dispatch embed (with the issuing officer in the footer) to the current channel, then confirms ephemerally.
- **Failure modes:** missing Manage Messages → ephemeral refusal.

## Events

None — this module adds commands and a library other modules call.

## Configuration

Per-guild, stored via `src/core/store.js` under `evidenceLockerChannelId`. No env vars, no `config.json` keys. (`CUFFBOT_DATA_DIR` overrides the storage directory in tests.)

## Permissions & safety

- **Bot permissions needed:** *Send Messages* (and *Embed Links*) in the evidence-locker channel. `resolveLocker` checks the bot's Send Messages permission and silently declines rather than throwing if it is missing.
- **Command gates:** `/evidence-locker` → Manage Server (configuring logging is a management act); `/dispatch` → Manage Messages. Both re-check at runtime.
- **Best-effort logging:** enforcement calls the locker wrapped in try/catch — a missing/misconfigured locker, or one the bot cannot post to, **never blocks or fails a moderation action**. The action still happens and is still recorded on the rap sheet; only the channel echo is skipped.

## How it works

1. `lib/format.js` (pure) builds plain APIEmbed objects — `enforcementEmbed` (typed, colored per action, with officer / case / reason / extra fields) and `announcementEmbed`. Pure, so formatting is fully testable.
2. `lib/api.js` holds the store helpers (`get/set/clearEvidenceLocker`), `resolveLocker` (resolve the channel or report `not-configured` / `channel-missing` / `no-permission`), and `logEnforcement` (build embed → resolve → send, best-effort).
3. Enforcement's `cite`/`detain`/`release`/`arrest` call `logEnforcement(interaction.guild, {…})` after replying, each wrapped in try/catch — the **cross-module seam** from `architecture.md → Cross-module calls`.

## Files

| Path | Role |
|---|---|
| `src/modules/dispatch/index.js` | Manifest |
| `src/modules/dispatch/commands/{evidence-locker,dispatch}.js` | The two commands |
| `src/modules/dispatch/lib/format.js` | Pure: embed construction |
| `src/modules/dispatch/lib/api.js` | Store helpers + channel resolution + logEnforcement |
| `test/{dispatch,dispatch-commands}.test.js` | Coverage |

## Testing

- **Automated:** `npm test` — embed construction (typed fields, case padding, blank-reason default, unknown-type rejection, announcement), store set/status/clear roundtrip, `resolveLocker` reason codes, `logEnforcement` delivery + graceful no-op, and command smokes (permission gates, set/status/clear, announcement posting). No token or network needed.
- **Manual (live server) checklist:**
  1. In your desired log channel, run `/evidence-locker action:set` → ephemeral confirm.
  2. `/cite` (or `/detain`/`/arrest`/`/release`) a test member → a matching embed appears in the evidence locker with officer, case number, and reason.
  3. `/evidence-locker action:status` → shows the channel; `action:clear` → stops the logging; repeat step 2 to confirm no embed is posted (the action still works).
  4. `/dispatch message:All units, code 3` → the announcement embed appears in the current channel.
  5. Remove the bot's Send Messages permission in the locker channel and run `/cite` → the citation still succeeds; no embed is posted, no error to the user.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| No embeds in the evidence locker | Not configured, or bot lacks Send Messages there | `/evidence-locker action:status`; grant the bot Send Messages / Embed Links |
| "No evidence locker configured" after setting it | `/evidence-locker action:set` was run in a different channel | Run `set` in the exact channel you want, or check `status` |
| Enforcement works but nothing logs | Working as designed when the locker is unset or unreachable | Configure it; logging is best-effort and never blocks actions |
| Announcement not posting | Bot lacks Send Messages / Embed Links in that channel | Grant the permissions, or run `/dispatch` where the bot can post |

## Changelog

| Session | Change |
|---|---|
| S11 | Created: evidence locker (`/evidence-locker`), `/dispatch`, pure embed formatting, `logEnforcement` seam wired into all four enforcement actions, 14 new tests. |
