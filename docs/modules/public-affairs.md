# Public Affairs — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 14 · 2026-07-23

## Purpose

Public Affairs is the precinct's community desk: the member-facing, mostly-for-fun commands. `!badge` shows an officer's card, `!wanted` puts up a playful poster, `!donut` hands out a treat, and `!911` lets any member report someone to the force. It reuses other modules read-only (academy for rank, records for record count, dispatch for the evidence locker) and degrades gracefully if any of them is unavailable.

## Commands

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `!badge` | Show a member's card: rank, record count, join date | `[target]` (default: you) | Everyone | `!badge` |
| `!wanted` | A playful WANTED poster | `<target> [crime…]` | Everyone | `!wanted @user` |
| `!donut` | Hand someone a donut 🍩 | `[target]` (default: you) | Everyone | `!donut @friend` |
| `!911` | Report a member to the force (→ evidence locker) | `<target> <reason…> [anonymous]` | Everyone | `!911 @user spamming the lobby yes` |

### !badge

Builds an embed with the member's current **rank** (via academy's `currentRank`), **record count** (via records' `recordsFor`), and time on the force (join date). Both cross-module reads are wrapped — if academy or records errors, the badge still renders (Unranked / 0 entries). Public.

### !wanted

Renders a **real WANTED poster image** (`wanted.png`) with the member's **profile picture composited into the center** — headline, DEAD OR ALIVE, framed photo, name, crime, and a donut reward. The crime and bounty are **deterministic per target** unless you pass a custom crime (everything after the target, up to 150 characters). Pure fun — changes nothing. If the avatar can't be fetched/decoded, the poster still renders with a NO PHOTO placeholder. The poster is drawn in pure JS (own PNG decoder + encoder + pixel font), so it needs no native image libraries and runs on the Pi.

### !donut

Hands a donut to the target (or yourself). The donut variety is deterministic per (giver, target). Pure fun.

### !911

- **Args:** `<target>` (member, required), `<reason…>` (the rest of the line, required, max 500 chars), `[anonymous]` (a trailing yes/no, default no).
- **Reading the line (S93):** the reason is greedy but the anonymity flag comes *after* it, so `!911 @user spamming the lobby yes` files "spamming the lobby" anonymously. A reason that simply *ends* in an ordinary word keeps that word — the trailing flag is only claimed when the last token actually reads as yes/no.
- **What happens:** builds a report embed and sends it to the **evidence locker** (dispatch's `sendToEvidenceLocker`). Only the short confirmation lands in the channel — the report itself is never echoed publicly. With the flag set, the reporter's identity is omitted from the embed entirely.
- **Failure mode:** if no evidence locker is configured, the reporter is told to ask an admin to set one — the report simply has nowhere to go.

## Events

None.

## Configuration

None of its own. Reads the evidence-locker channel (dispatch config) for `!911`.

## Permissions & safety

- **Bot permissions:** none beyond membership for `!badge` `!wanted` `!donut`; `!911` needs the bot to be able to post in the evidence-locker channel (handled by dispatch's checks).
- **No permission gates** — these are community commands. `!911` is safe for everyone because the channel only ever sees a short confirmation; the report itself goes only to the mod-only evidence locker.
- **Anonymity:** a trailing `yes` on `!911` guarantees the reporter's id never appears in the report embed (covered by a test).
- The fun commands (`!wanted`, `!donut`) change no state and file no records.

## How it works

1. `lib/cards.js` (pure): `badgeEmbed`, `wantedEmbed` (+ `pickCrime`/`pickBounty`), `pickDonut`, `reportEmbed`, and a deterministic `hashSeed` — all plain data, fully testable.
2. Commands resolve live data (member, avatar, rank, records) and hand it to the pure builders, then reply.
3. Cross-module reads (academy `currentRank`, records `recordsFor`, dispatch `sendToEvidenceLocker`) are wrapped so a downstream problem never breaks a community command.

## Files

| Path | Role |
|---|---|
| `src/modules/public-affairs/index.js` | Manifest |
| `src/modules/public-affairs/lib/cards.js` | Pure: badge/report embeds + deterministic pickers |
| `src/modules/public-affairs/lib/png-decode.js` | Pure: PNG decoder + avatar fetch + RGB resize |
| `src/modules/public-affairs/lib/poster.js` | Pure: WANTED poster compositing (avatar + text) |
| `src/modules/public-affairs/commands/{badge,wanted,donut,911}.js` | The four commands |
| `test/public-affairs-cards.test.js`, `test/public-affairs-commands.test.js`, `test/wanted-poster.test.js` | Coverage |

## Testing

- **Automated:** `npm test` — deterministic hashing/pickers, badge embed (full + graceful fallbacks), wanted (in-range bounty, stable crime), donut, report embed anonymity (reporter id never present when anonymous), and command smokes driven through the real `dispatchCommand` path (badge with/without records, donut to self and to another, the wanted poster's typing indicator and single reply, `!911` delivery + confirmation + no-locker path, and both readings of a trailing anonymity flag). No token or network needed.
- **Manual (live server) checklist:**
  1. `!badge` on yourself and `!badge @member` → rank + record count + join date look right.
  2. Give a member some infractions via enforcement, then `!badge @them` → record count reflects it.
  3. `!wanted @friend` and `!donut @friend` → playful embeds, no state changes. The poster appears as ONE message (no "🚔 Working…" that gets edited).
  4. Set an evidence locker (`!dispatch locker action:set`), then `!911 @someone test report yes` → the channel shows only the confirmation; the report appears in the locker with the reporter shown as Anonymous and the reason as "test report".
  5. `/911` with no locker configured → you're told to ask an admin to set one.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `/badge` shows "Unranked" for a ranked member | Academy ladder not configured/ detected | `/rank-setup` (see academy.md) |
| `/badge` record count is 0 unexpectedly | Records store unreadable (logged) | `journalctl -u cuffbot`; check `data/` permissions |
| `/911` says no locker configured | Evidence locker unset | Admin runs `/evidence-locker action:set` |
| `/wanted` avatar missing | User has no custom avatar | Cosmetic only; Discord shows the default |

## Changelog

| Session | Change |
|---|---|
| S14 | Created: `!badge`, `!wanted`, `!donut`, `!911` (with anonymity); reuses academy/records/dispatch read-only with graceful fallbacks. |
| S93 | All four converted to the flat `{ command }` shape (M17.3 slice A). `!911`'s trailing anonymity flag is now a framework rule instead of a per-command adapter hint; `!wanted` shows the typing indicator rather than posting a "🚔 Working…" placeholder it then edits (a message command has no 3-second deadline). Manual corrected: the `/`-form invocations and the "ephemeral" reply claims had been wrong since S68/S54. |
