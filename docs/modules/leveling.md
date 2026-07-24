# Leveling — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 16 · 2026-07-23

## Purpose

Leveling is CuffBot's own XP system, built to **replace the old leveler bot**: members earn XP by chatting and by spending time in voice channels, and the academy's rank ladder (the server's own `[LEVELER]` roles) is awarded automatically as XP grows. Existing members do **not** restart at zero — on first sight, a member's XP is seeded from the rank role they already hold, so the switch from the old leveler is seamless. Only genuinely new members start at 0.

## Commands

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `/level` | XP card: rank, progress bar, next rank | `target` | Everyone | `/level target:@user` |
| `/leaderboard` | Top officers by XP | `size` | Everyone | `/leaderboard size:15` |
| `/xp-config` | View/change XP settings | `enabled`, `sync-roles`, `message-xp`, `voice-xp`, `cooldown`, `announce` | Admins (Manage Server) | `/xp-config message-xp:20` |
| `/xp-ladder` | The XP list: which XP total earns which rank (S42), with a "you are here" marker | none | Everyone | `/xp-ladder` |

All three also work as text commands: `!level @user`, `!leaderboard 15`, `!xp-config`.

### /level

- **Options:** `target` (user, optional, default: you) — whose card to show.
- **What happens:** fetches the member, resolves the academy ladder, and **seeds their XP record if this is the first time the system sees them** (see How it works → Seeding). Computes progress toward the next rank.
- **Reply:** public embed — XP total, current rank, next rank with the XP still needed, and a progress bar. A footer notes when the XP was seeded from an existing rank. When XP has earned a rank the member doesn't hold, the card explains why (ladder not pinned / sync off / pending or hierarchy-blocked). Role/user mentions are rendered but never ping (`allowedMentions: { parse: [] }`).
- **Failure modes:** target is a bot → refused, no record is created ("K9 units are paid in treats"); target not in the guild → ephemeral "not in the precinct"; no ladder configured → the card still shows XP and points at `/rank-setup`.

### /leaderboard

- **Options:** `size` (integer 1–25, optional, default 10).
- **What happens:** reads all XP records for the guild and sorts descending.
- **Reply:** public embed, 🥇🥈🥉 for the top three. Mentions never ping.
- **Failure modes:** no XP recorded yet → explains how XP starts flowing.

### /xp-config

- **Options (all optional; none given = view current settings):** `enabled` (bool) — master switch; `sync-roles` (bool) — auto-assign rank roles; `message-xp` (1–100) — XP per message; `voice-xp` (1–100) — XP per voice minute; `cooldown` (10–600 s) — message XP cooldown; `announce` (text channel) — where promotions are announced; `clear-announce` (bool) — reset announcements back to "the channel where it happened".
- **What happens:** patches only the options given (only overrides are stored — future default rebalances still apply), persists, then shows the full config, whether the ladder is **pinned**, and the computed XP threshold for every rank.
- **Reply:** ephemeral embed (DM for `!xp-config`).
- **Failure modes:** missing Manage Server → refusal; no ladder → thresholds section says to run `/rank-setup`; unpinned ladder → a ⚠️ line explains auto-rank and seeding stay idle until `/rank-setup` is run.

## Events

- `MessageCreate` (`events/message-xp.js`) — awards message XP (cooldown-gated), seeds first-sight members, then promote-syncs their rank role and announces a promotion. Ignores bots, system messages (joins/boosts), DMs, foreign guilds, and everything when `enabled` is off. Wrapped in try/catch: XP can never break message handling.
- `ClientReady` (`events/voice-sweep.js`, once) — arms a 60-second interval. Each tick awards one minute of voice XP to every **eligible** member currently in a voice/stage channel of the home guild. The timer is `unref`ed so it never keeps the process alive.

## Configuration

Stored per guild in the JSON store under `xpConfig` (no env vars):

| Key | Default | Effect |
|---|---|---|
| `enabled` | `true` | Master switch for all XP earning |
| `syncRoles` | `true` | Auto-assign rank roles when XP earns them (promote-only) |
| `messageXp` | `15` | XP per message outside the cooldown |
| `messageCooldownMs` | `60000` | Window in which further messages pay 0 XP |
| `voiceXpPerMin` | `10` | XP per eligible voice minute |
| `baseXp` | `100` | XP required for the lowest rank |
| `exponent` | `1.6` | Rank N (from the bottom) costs `round(baseXp · N^1.6)` |
| `announceChannelId` | `null` | Promotion announcement channel (`null` = where it happened; voice promotions then stay silent) |

XP records live under `xpUsers`: `{ [userId]: { xp, lastMessageAt, seededFromRank } }`.

## Permissions & safety

- **Bot permissions:** Manage Roles (assign rank roles — the CuffBot role must sit above the rank roles); Send Messages in the announce channel. Gateway intents: `GuildMessages` (message XP needs only the event, **not** the privileged Message Content intent) and `GuildVoiceStates` (see who is in voice) — both non-privileged, in the base intent set with a documented fallback in `src/index.js`.
- **Member permissions:** `/level` and `/leaderboard` are public; `/xp-config` requires Manage Server (builder default + execute-time check).
- **Safety rails:**
  - **Pinned ladder required for automation.** Seeding from a rank, auto rank sync, and XP coupling only act when the ladder header was explicitly pinned by an admin (`/rank-setup`, academy's `isPinnedLadder`). A name-heuristic ladder is fine for humans reading `/ranks`, but automation acting on a *guessed* header could hand out decoy roles and write wrong XP. When unpinned: XP still accrues, sync stays idle (one log warning per boot), `/xp-config` and `/level` say so.
  - **Promote-only.** XP sync never removes a rank someone already holds above what their XP earns — demotion stays a deliberate human act (`/demote`). A redeploy or a misconfigured ladder can never mass-strip ranks.
  - **Self-healing seeds.** If a member was first seen while the ladder was broken/unpinned (seeded 0 despite holding a rank), the record heals automatically: on their next award or `/level` under a pinned ladder, XP is raised to their held rank's floor. Monotonic — healing never lowers XP.
  - **Human rank changes couple XP** (cross-module seam): `/promote` raises the member's XP to the new rank's floor; `/demote` caps it at the demoted-to rank's floor — otherwise their old XP would re-earn the higher rank on the next message, making the demotion meaningless.
  - **No duplicate promotions:** a per-member in-flight guard stops the message handler and the voice sweep from executing the same promotion (and announcing it) twice when both cross the threshold in the same instant.
  - **Anti-farm (voice):** no XP in the AFK channel, alone in a channel (≥2 humans required), while self-deafened, or for bots.
  - **Anti-spam (text):** one XP award per cooldown window, no matter how many messages; system messages never pay.
  - Promotion announcements never ping (`allowedMentions: { parse: [] }`).
  - Role changes carry audit-log reasons (`XP promotion to <rank> — by CuffBot XP via CuffBot`).

## How it works

- `lib/xp.js` — **all pure math** (no discord.js): cooldown/voice gains, thresholds, `seedXpForRankIndex`, voice eligibility, promote-only `planRankSync`, `/level` progress. The ladder comes in as a plain `{ ranks: [{roleId,name}] }`, highest-first, exactly what academy's `buildLadder` produces.
- `service.js` — store access + live role application. `awardMessageXp` / `awardVoiceMinutes` do read-modify-write via `updateGuildData` so a seed+award lands as one atomic write. Two SD-card-friendly rules: a message inside the cooldown does **no** write at all (read-only fast path — safe because the store is synchronous), and a voice tick awards **all** eligible members in one single write, not one per member. `syncMemberRank` executes a `planRankSync` plan, checking `role.editable` first and reporting `blocked` instead of throwing.
- **Seeding (owner requirement):** the first time any code path touches a member with no XP record (`readOrSeed`), their current rank is read from their live roles via academy's `currentRankIndex`, and their XP starts at that rank's threshold **floor** — the minimum XP consistent with the rank they hold. They keep their rank and still have to earn the next one in full. Members with no rank role seed at 0. `seededFromRank` is stored for transparency and shown on `/level`. Seeding happens lazily (on first message, first voice minute, or first `/level`) — no bulk migration step is needed, and members who never show up are simply never seeded. Rank-based seeding requires the **pinned** ladder; under an unpinned/broken ladder members seed at 0 and `reconcile()` heals them (raises XP to the held rank's floor) as soon as a pinned ladder is back — a temporary detection failure can never permanently reset anyone.
- **Rank ↔ XP coupling:** thresholds are position-based, derived from the ladder length — `thresholds[i] = round(baseXp · (i+1)^exponent)`, lowest rank first. If the owner later inserts or removes rank roles, thresholds shift automatically with the ladder; XP itself never changes.
- **Voice XP by sweep, not by session bookkeeping:** every 60 s the sweep pays one minute to everyone eligible *right now*. No join/leave timestamps to corrupt across restarts, mutes, or channel moves; a restart loses at most 59 seconds of credit.
- **Ladder-change reconciliation (S37):** the owner can rename, reorder, delete, and add rank roles freely. A stored snapshot (the ordered rank-id list, `ladderSnapshot`) detects structural change — on role position/create/delete events (debounced 15 s; a UI drag fires one event per shifted role), after `/rank-setup`/`/rank-exclude`, and at boot (offline changes). The sweep then quietly re-applies the exact rules the live system already enforces, so the sweep and a member's next message can never disagree:
  - **Rename** → free; role ids anchor everything, nothing runs.
  - **Reorder** → held ranks stay put; XP heals UP to the held rank's new floor (never down). A member whose XP now earns a higher position than they hold is promoted to it.
  - **Delete** → Discord strips the role from holders; the sweep gives each ex-holder the rank their XP earns under the new thresholds ("desnoods een andere rol"). The first pinned baseline seeds every rank holder precisely so later deletions still have XP records to restore people from.
  - **Add** → nobody changes role immediately (promote-only keeps held ranks at/above target); higher floors heal holders' XP; the new rank gets earned normally.
  - **Quiet by design:** no announcements — only audit-log reasons ("ladder-change reconciliation"); role writes are spaced 400 ms apart for rate limits, with a 300-write cap as a runaway brake (the rest heals on activity). Human demotions survive: `/demote` capped the member's XP, so their reconciliation target IS the demoted rank.
- The academy module owns the ladder; leveling calls `ladderForGuild(guild)` (interaction-free seam added for this module) and academy's pure `currentRankIndex`. Cross-module calls follow the seam convention (direct `lib/`/service import, try/catch at the event boundary); since S37 academy's `/rank-setup` and `/rank-exclude` call back into `scheduleLadderReconcile` the same way.

## Files

| Path | Role |
|---|---|
| `src/modules/leveling/index.js` | Manifest |
| `src/modules/leveling/lib/xp.js` | Pure XP math: gains, thresholds, seeding, eligibility, sync plan |
| `src/modules/leveling/service.js` | Store access, seeding, role application, announcements |
| `src/modules/leveling/commands/level.js` | `/level` card |
| `src/modules/leveling/commands/leaderboard.js` | `/leaderboard` |
| `src/modules/leveling/commands/xp-config.js` | `/xp-config` admin settings |
| `src/modules/leveling/commands/xp-ladder.js` | `/xp-ladder` — the XP-per-rank list |
| `src/modules/leveling/events/message-xp.js` | Message XP + promotion announce |
| `src/modules/leveling/events/voice-sweep.js` | 60-second voice XP sweep |
| `src/modules/leveling/events/ladder-watch.js` | Ladder-change detection (role events + boot) → quiet reconciliation |

## Testing

- **Automated:** `test/leveling-xp.test.js` (pure math: cooldown, thresholds, seeding floors, no-instant-promotion invariant, voice eligibility, promote-only sync), `test/leveling-service.test.js` (store: seed-once semantics, cooldown persistence, leaderboard, sync execution/blocked), `test/leveling-commands.test.js` (commands + both events end-to-end against fake guilds, incl. the seeding paths and anti-farm sweeps), `test/ladder-reconcile.test.js` (baseline seeding, rename = no-op, delete → quiet reassignment, reorder → XP heal without role writes, add → heal only, human-demotion survival, unpinned/disabled refusals, debounce burst → one sweep). Run with `npm test`.
- **Manual (live server) checklist:**
  0. **Pin the ladder first:** `/rank-setup header:@[LEVELER]` (and `/rank-exclude` the two non-rank roles). `/xp-config` must show **Ladder pinned: yes** — auto-rank and rank seeding stay idle until it does.
  1. `/xp-config` → confirm the ladder thresholds match your `[LEVELER]` ranks, highest rank = highest XP.
  2. As a member who **already has a rank role**: `/level` → XP must equal that rank's threshold (footer says "seeded from existing rank"), not 0.
  3. As a member with **no rank**: `/level` → 0 XP.
  4. Send a message → `/level` shows +15 XP; send five more quickly → still only +15 (cooldown).
  5. Join a voice channel **with a second human**, wait ~2 minutes → `/level` shows voice XP added. Alone or self-deafened → nothing.
  6. Let a low-rank member cross the next threshold → bot swaps their rank role and announces the promotion; check the audit log entry.
  7. Manually `/promote` someone above their XP → `/level` shows their XP raised to the new rank's floor; their higher rank **stays** on later messages (promote-only).
  8. Manually `/demote` someone → `/level` shows XP capped at the lower rank's floor; their next message must **not** re-promote them.
  9. `/xp-config sync-roles:False`, cross a threshold → no role change; `/level` notes sync is off. Re-enable with `sync-roles:True`.
  10. **Ladder change (S37):** rename a rank role → nothing happens (expected). Then delete a test rank someone holds → within ~15 s they quietly receive the rank their XP earns (audit log shows "ladder-change reconciliation", no announcement anywhere).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Ranked member shows 0 XP | First seen while the ladder was unpinned/broken | Self-heals: on their next message/voice minute/`/level` under a pinned ladder, XP rises to their rank's floor. Pin with `/rank-setup` if needed |
| Member's XP is below their (hand-given) rank | Promoted by hand before S16's coupling, or healed record pending | Same self-heal as above — next activity raises XP to the rank floor |
| No promotions happen | Ladder not **pinned** (`/xp-config` shows ⚠️), `sync-roles` off, or CuffBot's role below the rank roles | Run `/rank-setup header:@<divider>`; `/xp-config` to check; move the CuffBot role above the rank roles |
| Nobody earns voice XP | `GuildVoiceStates` intent missing (old process) or everyone is alone/deafened | Restart the bot (intent ships in the base set); check the anti-farm rules |
| Promotions to wrong ranks | Ladder mis-detected | `/ranks` to inspect; fix with `/rank-setup` / `/rank-exclude` |
| Message XP not flowing | XP disabled, or bot lacks the `GuildMessages` intent (old process) | `/xp-config enabled:True`; restart the bot |
| Dead mentions on `/leaderboard` | Member left the guild (their XP record remains) | Harmless; remove their entry from `xpUsers` in `data/<guild>.json` if it bothers you |

## Changelog

| Session | Change |
|---|---|
| S16 | Created: message + voice XP, seeding from existing rank roles, promote-only auto-rank, `/level`, `/leaderboard`, `/xp-config`. |
| S16 (audit) | Pinned-ladder gate for all automation + self-healing seeds (HIGH fix); `/promote`/`/demote` now couple XP; duplicate-promotion guard; bot `/level` refusal; system messages excluded; `clear-announce`; sparse config storage; text-path min/max + channel-type enforcement (framework-wide). |
| S37 | Ladder-change reconciliation: rename/reorder/delete/add rank roles safely — snapshot-based detection (events + boot + config commands), quiet spaced role writes, XP heals, baseline seeding of all rank holders. |
