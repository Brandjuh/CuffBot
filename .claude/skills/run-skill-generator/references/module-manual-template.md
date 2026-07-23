# Module Manual Template

**When to use this file:** every time you create a bot module, and every time you change one (update its manual in the same session — a manual that lags the code is worse than no manual, because readers trust it).

**How to use it:** copy everything below the horizontal rule into `docs/modules/<module-name>.md` and fill in every section. Delete no section: if one does not apply, write `None — <one-line reason>`. Future sessions read a missing section as "forgotten", not "not applicable". Keep the exact heading names and order — uniform manuals let a reader (human or Claude) know where information lives before opening the file. Add the module to the table in `docs/README.md` when the manual is created.

---

# <Module Name> — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** planned | in progress | stable
**Last updated:** Session <N> · <YYYY-MM-DD>

## Purpose

What this module does, why it exists, and how it maps onto the police theme (one short paragraph — e.g. "Enforcement is the precinct's arm of the law: it wraps Discord moderation actions in citation/arrest vocabulary…").

## Commands

Overview table first, then one subsection per command with full detail.

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `/example` | … | `target`, `reason` | Moderators (Kick Members) | `/example target:@user reason:spam` |

### /example

- **Options:** `target` (user, required) — who the action applies to; `reason` (string, optional, default "No reason given") — recorded in the rap sheet.
- **What happens:** step by step, including what is stored and what is posted where.
- **Reply:** what the invoker sees (and whether it is ephemeral); what the target or a log channel sees.
- **Failure modes:** what the command says when the target is missing, hierarchy blocks the bot, permissions are insufficient, etc.

## Events

Listeners this module registers (event name → what the handler does), or `None — <reason>`.

## Configuration

Every setting this module reads: env vars (name, required?, example value — placeholders only, never real secrets) and `config.json` keys (key, default, effect). Or `None — <reason>`.

## Permissions & safety

- Discord permissions the **bot** needs, and why each one.
- Default member permissions per command, and how execute-time checks differ.
- Safety rails: hierarchy checks, self/owner targeting, rate limits, irreversible actions and their confirmations.

## How it works

The internals a maintainer needs before touching the code: file-by-file flow, where pure logic lives (`lib/`), what is stored under which key, and any non-obvious decisions with their reasons.

## Files

| Path | Role |
|---|---|
| `src/modules/<name>/index.js` | Manifest |
| … | … |

## Testing

- **Automated:** which `test/*.test.js` files cover this module and what they prove; the command to run them (`npm test`).
- **Manual (live server) checklist:** exact steps for the owner — invoke X, expect Y — covering the happy path and the main failure modes. This is the part only a human with a live guild can do; make it copy-paste easy.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| … | … | … |

## Changelog

| Session | Change |
|---|---|
| S<N> | Created. |
