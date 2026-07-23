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

All three also work as text commands: `!level @user`, `!leaderboard 15`, `!xp-config`.

### /level

- **Options:** `target` (user, optional, default: you) — whose card to show.
- **What happens:** fetches the member, resolves the academy ladder, and **seeds their XP record if this is the first time the system sees them** (see How it works → Seeding). Computes progress toward the next rank.
- **Reply:** public embed — XP total, current rank, next rank with the XP still needed, and a progress bar. A footer notes when the XP was seeded from an existing rank. Role/user mentions are rendered but never ping (`allowedMentions: { parse: [] }`).
- **Failure modes:** target not in the guild → ephemeral "not in the precinct"; no ladder configured → the card still shows XP and points at `/rank-setup`.

### /leaderboard

- **Options:** `size` (integer 1–25, optional, default 10).
- **What happens:** reads all XP records for the guild and sorts descending.
- **Reply:** public embed, 🥇🥈🥉 for the top three. Mentions never ping.
- **Failure modes:** no XP recorded yet → explains how XP starts flowing.

### /xp-config

- **Options (all optional; none given = view current settings):** `enabled` (bool) — master switch; `sync-roles` (bool) — auto-assign rank roles; `message-xp` (1–100) — XP per message; `voice-xp` (1–100) — XP per voice minute; `cooldown` (10–600 s) — message XP cooldown; `announce` (text channel) — where promotions are announced.
- **What happens:** patches only the options given, persists to the store, then shows the full config plus the computed XP threshold for every rank on the ladder.
- **Reply:** ephemeral embed (DM for `!xp-config`).
- **Failure modes:** missing Manage Server → refusal; no ladder → thresholds section says to run `/rank-setup`.

## Events

- `MessageCreate` (`events/message-xp.js`) — awards message XP (cooldown-gated), seeds first-sight members, then promote-syncs their rank role and announces a promotion. Ignores bots, DMs, foreign guilds, and everything when `enabled` is off. Wrapped in try/catch: XP can never break message handling.
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
  - **Promote-only.** XP sync never removes a rank someone already holds above what their XP earns — demotion stays a deliberate human act (`/demote`). A redeploy or a misconfigured ladder can never mass-strip ranks.
  - **Anti-farm (voice):** no XP in the AFK channel, alone in a channel (≥2 humans required), while self-deafened, or for bots.
  - **Anti-spam (text):** one XP award per cooldown window, no matter how many messages.
  - Promotion announcements never ping (`allowedMentions: { parse: [] }`).
  - Role changes carry audit-log reasons (`XP promotion to <rank> — by CuffBot XP via CuffBot`).

## How it works

- `lib/xp.js` — **all pure math** (no discord.js): cooldown/voice gains, thresholds, `seedXpForRankIndex`, voice eligibility, promote-only `planRankSync`, `/level` progress. The ladder comes in as a plain `{ ranks: [{roleId,name}] }`, highest-first, exactly what academy's `buildLadder` produces.
- `service.js` — store access + live role application. `awardMessageXp` / `awardVoiceMinutes` do read-modify-write via `updateGuildData` so a seed+award lands as one atomic write. Two SD-card-friendly rules: a message inside the cooldown does **no** write at all (read-only fast path — safe because the store is synchronous), and a voice tick awards **all** eligible members in one single write, not one per member. `syncMemberRank` executes a `planRankSync` plan, checking `role.editable` first and reporting `blocked` instead of throwing.
- **Seeding (owner requirement):** the first time any code path touches a member with no XP record (`readOrSeed`), their current rank is read from their live roles via academy's `currentRankIndex`, and their XP starts at that rank's threshold **floor** — the minimum XP consistent with the rank they hold. They keep their rank and still have to earn the next one in full. Members with no rank role seed at 0. `seededFromRank` is stored for transparency and shown on `/level`. Seeding happens lazily (on first message, first voice minute, or first `/level`) — no bulk migration step is needed, and members who never show up are simply never seeded.
- **Rank ↔ XP coupling:** thresholds are position-based, derived from the ladder length — `thresholds[i] = round(baseXp · (i+1)^exponent)`, lowest rank first. If the owner later inserts or removes rank roles, thresholds shift automatically with the ladder; XP itself never changes.
- **Voice XP by sweep, not by session bookkeeping:** every 60 s the sweep pays one minute to everyone eligible *right now*. No join/leave timestamps to corrupt across restarts, mutes, or channel moves; a restart loses at most 59 seconds of credit.
- The academy module owns the ladder; leveling calls `ladderForGuild(guild)` (interaction-free seam added for this module) and academy's pure `currentRankIndex`. Cross-module calls follow the seam convention (direct `lib/`/service import, try/catch at the event boundary).

## Files

| Path | Role |
|---|---|
| `src/modules/leveling/index.js` | Manifest |
| `src/modules/leveling/lib/xp.js` | Pure XP math: gains, thresholds, seeding, eligibility, sync plan |
| `src/modules/leveling/service.js` | Store access, seeding, role application, announcements |
| `src/modules/leveling/commands/level.js` | `/level` card |
| `src/modules/leveling/commands/leaderboard.js` | `/leaderboard` |
| `src/modules/leveling/commands/xp-config.js` | `/xp-config` admin settings |
| `src/modules/leveling/events/message-xp.js` | Message XP + promotion announce |
| `src/modules/leveling/events/voice-sweep.js` | 60-second voice XP sweep |

## Testing

- **Automated:** `test/leveling-xp.test.js` (pure math: cooldown, thresholds, seeding floors, no-instant-promotion invariant, voice eligibility, promote-only sync), `test/leveling-service.test.js` (store: seed-once semantics, cooldown persistence, leaderboard, sync execution/blocked), `test/leveling-commands.test.js` (commands + both events end-to-end against fake guilds, incl. the seeding paths and anti-farm sweeps). Run with `npm test`.
- **Manual (live server) checklist:**
  1. `/xp-config` → confirm the ladder thresholds match your `[LEVELER]` ranks, highest rank = highest XP.
  2. As a member who **already has a rank role**: `/level` → XP must equal that rank's threshold (footer says "seeded from existing rank"), not 0.
  3. As a member with **no rank**: `/level` → 0 XP.
  4. Send a message → `/level` shows +15 XP; send five more quickly → still only +15 (cooldown).
  5. Join a voice channel **with a second human**, wait ~2 minutes → `/level` shows voice XP added. Alone or self-deafened → nothing.
  6. Let a low-rank member cross the next threshold → bot swaps their rank role and announces the promotion; check the audit log entry.
  7. Manually `/promote` someone above their XP, let them earn a message → their higher rank must **stay** (promote-only).
  8. `/xp-config sync-roles:False`, cross a threshold → no role change; `/level` notes sync is off.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Ranked member shows 0 XP | Their record predates the rank (they were seeded rankless, then ranked by hand) | Expected: seeding runs once. Their XP now grows normally; or clear their entry from `xpUsers` in `data/<guild>.json` to re-seed |
| Nobody earns voice XP | `GuildVoiceStates` intent missing (old process) or everyone is alone/deafened | Restart the bot (intent ships in the base set); check the anti-farm rules |
| No promotions happen | `sync-roles` off, or CuffBot's role below the rank roles | `/xp-config` to check; move the CuffBot role above the rank roles |
| Promotions to wrong ranks | Ladder mis-detected | `/ranks` to inspect; fix with `/rank-setup` / `/rank-exclude` |
| Message XP not flowing | XP disabled, or bot lacks the `GuildMessages` intent (old process) | `/xp-config enabled:True`; restart the bot |

## Changelog

| Session | Change |
|---|---|
| S16 | Created: message + voice XP, seeding from existing rank roles, promote-only auto-rank, `/level`, `/leaderboard`, `/xp-config`. |
