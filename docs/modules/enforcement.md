# Enforcement — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 7 · 2026-07-23

## Purpose

Enforcement is the precinct's arm of the law: it wraps Discord moderation in citation/arrest vocabulary. Citations are formal warnings delivered as **Papers-Please-style ticket images** (generated in pure JS — no native image libraries, so it runs on the Pi); detainment is a timeout, arrest is a ban, release lifts either. Infraction *storage* (the rap sheet) intentionally arrives in M3 — this module acts through Discord itself and leaves a trail in the guild audit log.

Concept credit for the ticket: the `citation` cog in TrustyJAID/Trusty-cogs (originally commissioned by this project's owner), itself crediting gitlab.com/Saphire/citations. This implementation shares no code or assets with either.

## Commands

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `/cite` | Issues a citation: posts a generated ticket + DMs a copy | `target`, `reason` (required), `penalty` | Moderate Members | `/cite target:@user reason:spam` |
| `/detain` | Timeout ("holding cell") | `target`, `duration` (required), `reason` | Moderate Members | `/detain target:@user duration:2h` |
| `/release` | Lifts a timeout, or lifts a ban | `target`, `reason` | Moderate Members (timeout) / Ban Members (ban) | `/release target:@user` |
| `/arrest` | Ban, with optional message wipe | `target`, `reason`, `wipe` | Ban Members | `/arrest target:@user wipe:Wipe last 24 hours` |

### /cite

- **Options:** `target` (user, required); `reason` (string ≤ 200, required) — printed on the ticket; `penalty` (string ≤ 100, optional, default `OFFICIAL WARNING`).
- **What happens:** renders the pink pixel-art ticket (header, TO, VIOLATION, PENALTY, OFFICER, DATE, barcode derived from the target's user id) and posts it publicly in the channel; then attempts a DM copy to the target.
- **Reply:** public, with the PNG attached. If the DM fails (closed DMs), the officer gets an ephemeral note — that is informational, not an error.
- **Failure modes:** missing permission → ephemeral "not your jurisdiction"; citing yourself or the bot → refused with an in-theme reply. No Discord state is changed by a citation in M2.

### /detain

- **Options:** `target` (user, required); `duration` (string, required) — `10m`, `2h`, `7d`, compounds like `1h30m`; `reason` (string ≤ 400, optional).
- **What happens:** validates the duration (unparseable → guidance; over Discord's 28-day cap → suggests `/arrest`), fetches the member, checks hierarchy (`moderatable`), then applies the timeout with an audit-log reason that embeds the acting officer.
- **Reply:** public confirmation with the human-readable duration; all refusals are ephemeral and specific.
- **Failure modes:** target not in the server; hierarchy block (bot role too low) → tells you to move the CuffBot role up; missing permission.

### /release

- **What happens:** if the member has an active timeout → lifts it (Moderate Members). Otherwise, if the user is banned → unbans (**requires Ban Members** — lifting a ban is a bigger power). Otherwise says there is nothing to release.
- **Reply:** public on success; ephemeral and specific otherwise.

### /arrest

- **Options:** `target` (user, required); `reason` (≤ 400, optional); `wipe` (choice: none / 1h / 6h / 24h / 3d / 7d of message history).
- **What happens:** checks permission and hierarchy (`bannable`) when the target is still a member; **works by id when they already left**. Refuses when already banned. Bans with the officer-embedded audit reason and the chosen `deleteMessageSeconds`.
- **Reply:** public confirmation incl. wipe note; refusals ephemeral and specific.

## Events

None — this module only adds commands. (Automated screening arrives with M6 patrol.)

## Configuration

None beyond the core module's settings — see `docs/modules/core.md → Configuration`.

## Permissions & safety

- **Bot permissions needed (grant in Server Settings → Roles → CuffBot):** *Moderate Members* (timeouts) and *Ban Members* (bans/unbans). Alternative: re-invite with `https://discord.com/oauth2/authorize?client_id=412676658991071243&scope=bot%20applications.commands&permissions=1099511629828`.
- **Role position:** the CuffBot role must sit **above** the roles of members it should act on; the guild owner is never actionable. When hierarchy blocks an action the bot says so instead of failing silently.
- **Double permission checks:** builder-level defaults control who *sees* a command; every command re-checks the invoker's actual permission at runtime (admins can override visibility).
- **Safety rails:** no self-targeting; the bot refuses action against itself; every action writes an audit-log reason `"<reason> — by <officer> via CuffBot"` (truncated to Discord's 512-char limit); `/detain` cannot exceed Discord's 28-day cap; `/arrest` message wipe is capped at Discord's 7 days by the choice list itself.
- **Reversibility:** timeouts expire or are lifted with `/release`; bans are lifted with `/release`. Message wipes are **not** reversible — the choice defaults to "Keep all messages".

## How it works

1. Commands are thin: parse options → run guards → call the Discord API → reply. Shared guard logic lives in `guards.js` (invoker permission, sensible-target, member fetch, hierarchy reply).
2. Pure logic lives in `lib/` with no discord.js imports: `duration.js` (parse/format, 28-day cap constant), `audit.js` (officer-embedded audit reasons), and the ticket pipeline — `pixel-font.js` (original 5×7 glyphs) → `citation-card.js` (layout, wrapping, barcode, palette) → `png.js` (zero-dependency PNG encoder over `node:zlib`).
3. The ticket renderer takes the date as an input (never reads the clock) so rendering is deterministic and snapshot-testable.

## Files

| Path | Role |
|---|---|
| `src/modules/enforcement/index.js` | Manifest |
| `src/modules/enforcement/commands/{cite,detain,release,arrest}.js` | The four commands |
| `src/modules/enforcement/guards.js` | Shared Discord-facing checks |
| `src/modules/enforcement/lib/duration.js` | Pure: duration parse/format + cap |
| `src/modules/enforcement/lib/audit.js` | Pure: audit-log reason building |
| `src/modules/enforcement/lib/{pixel-font,citation-card,png}.js` | Pure: ticket rendering pipeline |
| `test/enforcement-lib.test.js`, `test/citation-card.test.js`, `test/enforcement-commands.test.js` | Coverage |

## Testing

- **Automated:** `npm test` — duration edge cases (`10m`/`2h`/`7d`/compounds/invalid/28d cap), audit truncation, text wrapping, PNG structural validity (signature, IHDR, CRC, inflate roundtrip), deterministic ticket rendering, and command smoke tests against fake interactions (guard order, replies, audit reasons, ban/unban calls). No token or network needed.
- **Manual (live server) checklist:**
  1. Grant the bot *Moderate Members* + *Ban Members* and put its role above a test member's role.
  2. `/cite` a test member → pink ticket appears in-channel; the member receives a DM copy (or you get an ephemeral "DMs closed" note).
  3. `/detain duration:1m` → member is timed out; audit log shows the reason with your name; `/release` lifts it early.
  4. `/detain duration:29d` → refused with the 28-day explanation.
  5. `/arrest` a throwaway account with `wipe: Keep all messages` → banned; `/release` on the same account → unbanned.
  6. As a member **without** moderation permissions, try `/cite` → ephemeral "not your jurisdiction".
  7. Try `/detain` on someone whose role is above the bot → ephemeral hierarchy explanation.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "their highest role is at or above mine" | Role hierarchy | Server Settings → Roles → drag **CuffBot** above the target roles |
| `Missing Permissions` in logs on detain/arrest | Bot lacks *Moderate Members* / *Ban Members* | Grant them on the CuffBot role (or re-invite with the URL above) |
| Commands not in the picker after update | Commands changed but not re-registered | `npm run deploy-commands` (the self-updater does this automatically) |
| Ticket image missing but text posted | Attachment upload blocked | Check the bot's *Attach Files* permission in that channel |
| DM copy never arrives | Target has DMs closed for this server | Working as designed — the officer sees an ephemeral note |

## Changelog

| Session | Change |
|---|---|
| S7 | Created: `/cite` (with ticket renderer), `/detain`, `/release`, `/arrest`, guards, pure libs, 26 new tests. |
