# Academy — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 12 · 2026-07-23

## Purpose

The academy runs the precinct's career ladder — but it does **not** impose a fixed rank list. It adopts the **server's own rank roles** (for CuffBot's home precinct, the existing leveler-bot ranks). It detects the ladder from the roles positioned under a section-header role (e.g. a `[LEVELER]` divider), ordered highest rank first, and lets the force move members up and down it. All ladder math (which rank a member holds, one-up/one-down, planning the exact roles to add/remove) is pure `lib/` logic, testable without a live guild.

## Commands

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `/promote` | Move a member one rank up (or straight to a rank role) | `target`, `to` (role) | Manage Roles | `/promote target:@user` |
| `/demote` | Move a member one rank down (or straight to a rank role) | `target`, `to` (role) | Manage Roles | `/demote target:@user to:@Regular` |
| `/ranks` | Show the detected rank ladder, highest first | none | Everyone | `/ranks` |
| `/rank-setup` | Point CuffBot at the section-header role; show the detected ladder | `header` (role) | Manage Server | `/rank-setup header:@[LEVELER]` |
| `/rank-exclude` | Add/remove a non-rank role from the ladder | `role`, `action` (add/remove) | Manage Server | `/rank-exclude role:@DJ action:add` |

### /promote and /demote

- **Options:** `target` (user, required); `to` (role, optional) — jump straight to that rank role instead of moving one rung. A rankless member promoted with no `to` is inducted at the **lowest** rank.
- **What happens:** resolves the ladder, plans the change (normalizing the member to exactly one rank role — the old rank role is removed, the new one added), checks the bot can manage those roles, then applies with an audit-log reason naming the officer.
- **Failure modes (all ephemeral, specific):** target not in the guild; ladder not configured (→ points at `/rank-setup`); already at the top/bottom; `to` not a promotion/demotion; `to` not a rank; bot lacks Manage Roles; a rank role sits at/above the bot's role (→ move CuffBot's role up).

### /ranks

Shows the detected ladder (numbered, highest first) or, if none is detected, how to configure it. Public.

### /rank-setup

- **Options:** `header` (role, optional) — the divider role your rank roles sit under. Setting it stores the header for this guild; omitting it just shows the current config + detected ladder.
- If no header is configured, the module **auto-detects** one by name (a role whose name contains "level" or "rank"). Setting it explicitly is the reliable path.

### /rank-exclude

Some roles sit under the header but are not ranks (cosmetic roles, mutes, a DJ role, sub-dividers). Exclude them so `/promote` and `/demote` skip them. `action:remove` re-includes a role.

## Events

None.

## Configuration

Per-guild, stored via `src/core/store.js` under `academyConfig` = `{ headerRoleId, excludedRoleIds[] }`. No env vars. The ladder itself is **not** stored — it is recomputed live from role positions every time, so it always reflects the server's current roles.

## Permissions & safety

- **Bot permissions needed:** *Manage Roles*, and the **CuffBot role must sit above every rank role** it should assign (Server Settings → Roles). The module checks `role.editable` and refuses with a specific message otherwise.
- **Command gates:** `/promote` `/demote` → Manage Roles; `/rank-setup` `/rank-exclude` → Manage Server; `/ranks` → everyone. All re-checked at runtime.
- **Normalization:** a promotion/demotion removes any other ladder rank roles the member holds, leaving exactly one — so multiple stacked rank roles get cleaned up.
- Managed roles (bots, boosters, integrations) and `@everyone` are never treated as ranks.

## How it works

1. `service.js → guildRolesDesc` snapshots the guild's roles ordered by position (highest first).
2. `lib/ladder.js → buildLadder` finds the header (configured id, else name heuristic), then collects the roles below it as ranks — skipping `@everyone`, managed roles, excluded roles, and stopping at the next section divider (`[...]` or a run of divider glyphs like `▬▬`).
3. `planPromotion` / `planDemotion` (pure) compute `{from, to, addRoleId, removeRoleIds}` or a specific failure `code`; `service.js → planErrorMessage` turns codes into replies.
4. `currentRank(memberRoleIds, ladder)` is exported for reuse — `/badge` (M7) reads a member's rank through it.
5. `service.js → ladderForGuild(guild)` is the interaction-free seam other modules use: **leveling** (S16) resolves the ladder through it to map XP onto ranks and seed existing members' XP from their held rank; `resolveLadder(interaction)` delegates to it. `service.js → isPinnedLadder(guildId, ladder)` tells automation whether the ladder came from the admin-pinned header (`/rank-setup`) rather than the name heuristic — leveling's auto-sync, seeding, and coupling require the pin; academy's own human-driven commands do not.
6. `/promote` and `/demote` couple the target's **XP** to the new rank via leveling's `coupleXpToRank` (S16, best-effort try/catch): promotion raises XP to the new rank's floor, demotion caps it there — so the XP system never instantly undoes a human demotion.
7. **Editing the ladder is safe (S37):** renaming rank roles is free (ids anchor everything); reordering, deleting, and adding ranks trigger leveling's quiet reconciliation sweep (see `leveling.md` → Ladder-change reconciliation). `/rank-setup` and `/rank-exclude` schedule the same sweep (best-effort seam), since they change the ladder without any role event firing.

## Files

| Path | Role |
|---|---|
| `src/modules/academy/index.js` | Manifest |
| `src/modules/academy/lib/ladder.js` | Pure: detection + promotion/demotion planning |
| `src/modules/academy/service.js` | Live role resolution, hierarchy checks, applying changes |
| `src/modules/academy/commands/*.js` | promote, demote, ranks, rank-setup, rank-exclude |
| `test/academy-ladder.test.js`, `test/academy-commands.test.js` | Coverage |

## Testing

- **Automated:** `npm test` — divider recognition, ladder detection (with header, auto-detected, excluded/managed/@everyone filtered), current-rank selection, promotion/demotion planning incl. induct-at-lowest, jump-to, and every rejection code; command smokes (permission gates, induct, one-rung, hierarchy block, exclude → ladder shrinks). No token or network needed.
- **Manual (live server) checklist:**
  1. `/rank-setup header:@<your LEVELER divider role>` → the embed lists your rank roles, highest first.
  2. If any non-rank role appears, `/rank-exclude role:@<that role>` and re-check `/ranks`.
  3. Ensure the **CuffBot role is above all rank roles** in Server Settings → Roles.
  4. `/promote target:@someone` → they gain the next rank up (or are inducted at the lowest); `/demote` moves them back.
  5. `/promote target:@someone to:@<a higher rank>` → jumps straight there; try a non-promotion `to` and confirm the refusal.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `/ranks` shows "No rank ladder detected" | Header not found | `/rank-setup header:@<divider>`; ensure the divider role exists above the rank roles |
| A non-rank role shows up as a rank | It sits under the header and isn't filtered | `/rank-exclude role:@<it>` |
| "sits at or above my highest role" | CuffBot's role is too low | Server Settings → Roles → drag CuffBot above the rank roles |
| Promotion skips a rank | That rank role is excluded, managed, or below a divider | `/ranks` to inspect; `/rank-exclude … action:remove` to re-include |

## Changelog

| Session | Change |
|---|---|
| S12 | Created: server-role rank ladder (detected under a `[LEVELER]`-style header), `/promote`, `/demote`, `/ranks`, `/rank-setup`, `/rank-exclude`. Adopts the server's existing ranks rather than a fixed police ladder. |
| S37 | Ladder edits are safe: rename free; reorder/delete/add reconcile quietly via leveling; `/rank-setup` and `/rank-exclude` schedule the sweep (config changes fire no role events). |
