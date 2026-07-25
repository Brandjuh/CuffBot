# Records — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 8 · 2026-07-23

## Purpose

Records is the precinct archive: every enforcement action (citation, detainment, arrest, release) is filed on the target's **rap sheet** with a sequential **case number** — the same number the enforcement reply shows. `!rapsheet` reads a member's history; `!expunge` erases it. Storage is per-guild JSON behind `src/core/store.js`, the single seam a later SQLite swap would touch.

## Commands

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `!rapsheet` | Shows a member's record | `<target>` | Moderate Members | `!rapsheet @user` |
| `!expunge` | Erases records — one case or the whole sheet | `<target> [case]` | **Manage Server** | `!expunge @user 7` |

### !rapsheet

- **Args:** `<target>` (member, required — @mention or id).
- **What happens:** reads the member's entries and replies with counts per type plus the 10 most recent entries — case number, type, date, reason, filing officer. Older entries stay on file and are noted as a count.
- **Where the reply lands:** in the channel, pinging nobody. It is **not** private. The command asks for Moderate Members precisely because the sheet is the force's business — run it in a staff channel, not in general.
- **Failure modes:** missing permission → a refusal naming **Moderate Members** (S93 — before that, every refusal said "Manage Server"). A member with no records gets a friendly "clean sheet".

### !expunge

- **Args:** `<target>` (member, required); `[case]` (integer ≥ 1, optional) — one case number, or omit to erase the member's entire sheet. A `case` below 1 is refused by the arg spec with the range stated.
- **What happens:** removes matching entries permanently and confirms the count. Case numbers are **never reused** — the counter only moves forward, so an old case number in chat history can never point at a newer, different case.
- **Failure modes:** requires **Manage Server** (erasing history is a tier above day-to-day moderation); misses reply specifically ("not on the sheet" / "already clean").

## Events

None — this module only adds commands and a library other modules call.

## Configuration

| Setting | Where | Required | Meaning |
|---|---|---|---|
| `CUFFBOT_DATA_DIR` | environment (optional) | no | Overrides the storage directory (default `data/`). Used by tests; normal operation needs nothing. |

## Permissions & safety

- **Bot permissions needed:** none beyond membership — records are local files, no Discord state is touched.
- Replies land in the channel and ping nobody (S54: a `!command` never DMs). A rap sheet is therefore visible to whoever can read that channel — the Moderate Members gate controls who can *pull* one, not who can *see* it. Pull sheets in a staff channel.
- `!expunge` is irreversible and gated behind Manage Server; the reply names exactly what was erased.
- Records live in `data/<guildId>.json`, which is **gitignored** — member history never lands in the repository. Back up `data/` when you back up the Pi (M8 note).

## How it works

1. `src/core/store.js` — atomic per-guild JSON (temp file + rename, so a crash cannot half-write), corrupt files are moved aside as `*.corrupt-<timestamp>` and the store restarts fresh (one bad byte never bricks the bot). Sync IO serializes access without locks.
2. `lib/api.js` — the rap-sheet API: `addRecord` (stamps case number + ISO timestamp in one atomic update), `recordsFor`, `expungeRecords`. **This is the cross-module seam**: enforcement calls these functions directly (`architecture.md → Cross-module calls`) and wraps them in try/catch so a records problem never blocks an enforcement action — the reply then simply lacks a case number and a warning is logged.
3. `lib/format.js` — pure formatting: counts per type, latest-first entries, hard cap under Discord's 2000-char message limit.

## Files

| Path | Role |
|---|---|
| `src/core/store.js` | Atomic per-guild JSON storage (shared seam) |
| `src/modules/records/index.js` | Manifest |
| `src/modules/records/commands/{rapsheet,expunge}.js` | The two commands |
| `src/modules/records/lib/api.js` | Rap-sheet API used by enforcement |
| `src/modules/records/lib/format.js` | Pure rap-sheet rendering |
| `test/{store,records,records-commands}.test.js` | Coverage |

## Testing

- **Automated:** `npm test` — store roundtrips, corrupt-file recovery (backup preserved, store usable after), atomicity (no temp leftovers), case-number sequencing (never reused after expunge), expunge one-vs-all, formatting incl. truncation and the 2000-char cap, command smokes through the real `dispatchCommand` path (permission tiers naming the right permission, arg bounds, usage errors, filed-records display). Enforcement smokes assert that actions reply with a case number.
- **Manual (live server) checklist:**
  1. `!cite` a test member → the reply shows `Case #N`.
  2. `!rapsheet @member` in a staff channel → the citation is listed with the same case number.
  3. `!detain @member 1m` + `!release @member` → both appear on the sheet.
  4. `!expunge @member N` → that case disappears from `!rapsheet`; `!expunge @member` without a case empties the sheet.
  5. As a moderator **without** Manage Server, try `!expunge` → refused, and the refusal says **Manage Server**.
  6. As a member without Moderate Members, try `!rapsheet` → refused, and the refusal says **Moderate Members**.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Enforcement replies lack a case number | Records write failed (see bot logs) | `journalctl -u cuffbot` — most likely a filesystem permission issue on `data/` |
| `!rapsheet` shows fewer entries than expected | Only the 10 newest are rendered | The counts line + "older record(s)" note carry the rest; they are still on file |
| Sheet suddenly empty | `data/<guildId>.json` was corrupt and moved aside | Look for `data/*.corrupt-*` — the old data is preserved there for manual recovery |
| Records survive a member leaving/rejoining | By design — records are keyed by user id | Use `!expunge` if the precinct's policy is forgive-on-return |

## Changelog

| Session | Change |
|---|---|
| S8 | Created: store seam, rap-sheet API + case numbers, `!rapsheet`, `!expunge`, enforcement wiring, 14 new tests. |
| S93 | Converted to the flat `{ command }` shape (M17.3 slice A): `!rapsheet` now refuses with **Moderate Members** instead of the wrong "Manage Server", `case < 1` is caught by the arg spec, and the tests run through the real dispatch path. Manual corrected — replies were documented as ephemeral, which stopped being true in S54. |
