# Patrol — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 13 · 2026-07-23

## Purpose

Patrol is the precinct's automated beat cop (automod): it screens every message for **banned terms**, **invite links**, and **spam**, removes offenders, warns the author, and files the incident on the rap sheet and in the evidence locker. All the matching is pure `lib/` logic, so it is exhaustively testable without a live gateway. Patrol is **off by default** — an admin turns it on and tunes it.

> **Requires the Message Content intent** (privileged). Without it, patrol simply does not run and `/patrol` shows a warning — the rest of the bot is unaffected (see core.md → Dual invocation).

## Commands

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `/patrol` | View patrol status, or switch it on/off | `action` (status/on/off) | Manage Server | `/patrol action:on` |
| `/patrol-rule` | Switch a rule category on/off | `rule`, `state` | Manage Server | `/patrol-rule rule:invites state:off` |
| `/patrol-term` | Add/remove a banned term | `action`, `term` | Manage Server | `/patrol-term action:add term:slur` |

### /patrol

Shows an ephemeral status card (patrol on/off, each rule on/off, banned-term count) and, with `action:on`/`off`, flips the whole patrol. Warns if the Message Content intent is unavailable.

### /patrol-rule

Toggles one of `bannedTerms`, `invites`, `spam` independently.

### /patrol-term

Adds or removes a banned term. The term is stored lowercased and matched **evasion-aware** (see below). The reply is ephemeral and deliberately does **not** echo the term back.

## Events

| Event | Handler | What it does |
|---|---|---|
| `MessageCreate` | `events/patrol.js` | Screens non-moderator messages in the home guild; on a violation deletes the message, DMs the author, files a rap-sheet record (officer = CuffBot), and logs to the evidence locker. Never throws into the gateway. |

## Configuration

Per-guild, stored via `src/core/store.js` under `patrolConfig` = `{ enabled, rules:{bannedTerms,invites,spam}, bannedTerms:[] }`. Managed entirely through the commands. (`CUFFBOT_DATA_DIR` overrides the storage directory in tests.)

## Permissions & safety

- **Bot permissions needed:** *Manage Messages* (to delete offending messages). The Message Content intent must be enabled in the portal.
- **Command gates:** all three commands require Manage Server, re-checked at runtime.
- **Moderator exemption:** members with *Manage Messages* are never screened — mods and admins can post freely (and post examples for tuning).
- **Scope:** only the home guild; bots and DMs are ignored.
- **Best-effort routing:** deletion, the DM, the record, and the locker log are each wrapped so a failure in one never throws into the gateway or blocks the others.

## The false-positive story

Banned-term matching is deliberately **aggressive** so it can't be dodged with spacing or leetspeak: text is normalized (lowercase, diacritics stripped, common leet folded — `0→o`, `@→a`, `4→a`, …, then all non-alphanumerics removed) before a **substring** check. This catches `b@d w0rd` and `b.a.d.w.o.r.d`, but the trade-off is real: a term is matched even inside a larger word (banning `ass` would flag `class`). Mitigations:

- Choose **specific** terms (full slurs/phrases), not short fragments.
- Moderators are exempt, so false positives never hit staff, and a wrongly-removed message can be reposted by a mod.
- Every removal is logged (rap sheet + evidence locker), so false positives are auditable and the term list can be tuned.
- Invite detection targets known invite hosts only; spam uses conservative thresholds (>5 mentions, or a character repeated 10+ times).

## How it works

1. `lib/screen.js` (pure): `normalizeForMatch`, `detectBannedTerms`, `detectInvites`, `detectSpam`, and `screenMessage(content, config) → violations[]`, plus `summarizeViolations`.
2. `events/patrol.js`: gates on `client.messageContentAvailable`, skips bots/DMs/foreign guilds/moderators, screens, and on a hit removes + warns + records + logs (cross-module seams to records and dispatch).
3. `service.js`: `getPatrolConfig` / `setPatrolConfig` with defaults merged.

## Files

| Path | Role |
|---|---|
| `src/modules/patrol/index.js` | Manifest |
| `src/modules/patrol/lib/screen.js` | Pure: normalization + all detectors + screenMessage |
| `src/modules/patrol/service.js` | Config get/set over the store |
| `src/modules/patrol/events/patrol.js` | MessageCreate screening handler |
| `src/modules/patrol/commands/*.js` | patrol, patrol-rule, patrol-term |
| `test/patrol-screen.test.js`, `test/patrol-event.test.js`, `test/patrol-commands.test.js` | Coverage |

## The setup wizard — `/patrol-wizard` (S47)

A guided, fully **ephemeral** 3-step flow (admin, Manage Server) — the clear path to a working patrol without memorizing three commands:

1. **Overview** — what patrol does (delete → DM → rap sheet → evidence locker; moderators exempt) and the current status, with a Start button.
2. **Choose rules** — a multi-select over the three categories (banned terms / invite links / spam), preselected with the current config.
3. **Review & save** — the chosen setup summarized; **✏️ Edit banned terms** opens a modal (comma- or newline-separated, prefilled, deduped, ≤100 terms of ≤64 chars); then **🚨 Save & turn ON** or **💾 Save, keep OFF**.

- The draft starts from the LIVE config (re-running the wizard edits, never resets) and lives in RAM for 10 minutes — nothing is written until Save; Cancel and expiry change nothing.
- Interactive components need real interactions, so `!patrol-wizard` points at the slash form.
- Implementation: pure logic in `lib/wizard.js` (term parsing, selection mapping, summaries), rendering in `wizard-ui.js`, one module-owned InteractionCreate pump filtering `patrol-wizard:` customIds (trivia pattern) in `events/wizard.js`.

## Testing

- **Automated:** `npm test` — normalization/evasion, each detector (banned via spacing+leet, invites across forms and spacing, spam floods/runs), `screenMessage` rule toggles, the event handler (removes + records on a hit; no-op for mods, disabled, missing intent, clean, bots), and command smokes (permission gate, on/off, intent warning, rule toggle, term add/remove without echo). No token or network needed.
- **Manual (live server) checklist:**
  1. Enable the Message Content intent in the portal; restart. `/patrol` should not show the intent warning.
  2. `/patrol action:on`; `/patrol-term action:add term:<a test word>`.
  3. As a **non-mod** account, post the test word → the message is removed, you get a DM, and it appears on `/rapsheet` and in the evidence locker.
  4. Post `discord.gg/whatever` as a non-mod → removed. Post it as a mod → not removed (exemption).
  5. `/patrol-rule rule:invites state:off` → invite links are no longer removed.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Patrol never acts | Intent off, patrol off, or user is a mod | `/patrol` (check status + intent warning); enable intent; test as a non-mod |
| Legit messages removed | A banned term is too short/generic | `/patrol-term action:remove term:<it>`; use specific full terms |
| Messages not deleted | Bot lacks Manage Messages in that channel | Grant the permission |
| No record/locker entry for a removal | Records/locker unreachable (logged) | Check `journalctl -u cuffbot`; removal still happened |

## Changelog

| Session | Change |
|---|---|
| S47 | `/patrol-wizard`: guided 3-step ephemeral setup (rule multi-select, banned-terms modal, review + enable/save), RAM draft with 10-min TTL. |
| S13 | Created: pure screener (banned terms/invites/spam), MessageCreate handler (mod-exempt, cross-module routing), `/patrol`, `/patrol-rule`, `/patrol-term`; false-positive story documented. |
