# Hunting — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 66 · 2026-07-25

## Purpose

The crook hunt, rebuilt in S66 (M16.1) on the model of vrt-cogs/hunting — the owner: "this is what I actually want, but police-with-crooks themed and STOP POLICE." Crooks with their own shouts appear in the hunt channels at random intervals; the first officer to shout **STOP POLICE** (or press 🚨 in reaction mode) cuffs them for a donut bounty. One special: the **undercover officer** must be saluted (🫡), never cuffed. Catches are scored per crook type with an arrest leaderboard. Replaces the S38 activity-roll hunt and the S56 timed hunt.

## Commands

| Command | What it does | Who |
|---|---|---|
| `/hunting` | Config + status: channels, timing, mode, rewards, test spawn | Admin (Manage Server) |
| `/hunt-stats [member]` | A hunter's arrest record per crook type | Everyone |
| `/hunt-board` | Top 25 hunters by total catches | Everyone |

### /hunting (admin)

- **Options:** `enabled`, `add-channel`/`remove-channel` (the hunt-channel list; text or announcement), `mode` (words = STOP POLICE / reaction = 🚨), `show-time` (append the response time to catches), `undercover` (the salute special on/off), `reward-min`/`reward-max` (bounty range), `interval-min`/`interval-max` (seconds between crooks; floors 60/120), `timeout` (seconds before escape; floor 10), `test-spawn` (channel — one crook right now).
- **Reply:** ephemeral status — channels, timing, catch mode + bounty, undercover state, when the next crook can appear, the wanted board, and the intent line.

## Events

| Event | Handler | What it does |
|---|---|---|
| `MessageCreate` | `events/watch.js` | Words-mode shouts/salutes at the open hunt (checked FIRST — a shout never doubles as scheduler activity), then the vrt scheduler. |
| `MessageReactionAdd` | `events/reactions.js` | Reaction-mode catches: 🚨/💥 cuffs, 🫡 salutes the officer. Fetches partials; works without Message Content. |

## Configuration

Stored per guild under `huntingConfig` (sparse overrides; defaults in code):

| Key | Default | Effect |
|---|---|---|
| `enabled` | `true` | Master switch |
| `channels` | `['412354971170897921']` | Hunt channels (S56 owner channel carried over as the committed default) |
| `intervalMinS` / `intervalMaxS` | `900` / `3600` | Random gap between crooks (vrt defaults: 15–60 min) |
| `catchTimeoutS` | `20` | Seconds before the crook escapes |
| `mode` | `words` | `words` (STOP POLICE) or `reaction` (🚨) |
| `showTime` | `false` | Append " in 3.2s" to catch lines |
| `undercover` | `true` | The undercover-officer special spawns |
| `rewardMin` / `rewardMax` | `100` / `300` | Bounty per catch (kept from the S38 hunt) |
| `escapeStealMin` / `escapeStealMax` | `50` / `250` | What an escaped crook pickpockets into the pot |

Scores per member under `huntingScores` (`{ total, byCrook }`).

## Permissions & safety

- **Intents:** words mode needs **Message Content** (without it, spawning is disabled outright — an uncatchable crook is an unwinnable game, S38 rule — and `/hunting` names the fix); **reaction mode works without it** (the degrade path).
- Every outbound line sets `allowedMentions: { parse: [] }`; economy money moves through the `adjustBalance`/`addToPot` seams wrapped in try/catch — a broken economy never breaks the hunt message.
- The undercover fine and the escape steal both land in the **donut pot** (owner's lost-donuts rule) — recorded deviation from the cog, which just withdraws/ends.

## How it works

- `lib/hunt.js` (pure): the CROOKS board (7 crooks + the undercover officer, uniform pick), the **2/17 fumble roll** (byte-faithful: `randrange(0,17) > 1` hits), spawn-delay roll, salute matching, the `resolveShout` outcome matrix, inclusive reward roll (deviation: the cog's `randint(min, max+1)` off-by-one is not ported), score merging.
- `service.js`: the **vrt scheduler, ported exactly** — a message in a hunt channel first ARMS the guild clock (now + random interval); once a later message finds the clock elapsed, the channel locks, the clock re-arms, and the crook appears after ANOTHER random interval. Active hunt per channel with an escape timer; escape = pickpocket into the pot (undercover officer just leaves); catches pay, record, and announce (optionally with the response time).
- A restart forgets the RAM scheduling — the next message in a hunt channel re-arms it; scores are persistent.

## Files

```
src/modules/hunting/
  index.js            manifest (3 commands, 2 events)
  service.js          scheduler, active hunts, resolution, scores
  lib/hunt.js         pure rules (board, fumble, delays, outcomes)
  commands/hunting.js /hunting (admin)
  commands/hunt-stats.js · commands/hunt-board.js
  events/watch.js     shouts + scheduler
  events/reactions.js reaction-mode catches
```

## Testing

- `test/hunting.test.js`: committed defaults (channel, vrt timings), crook board + undercover gating, the exact 2/17 fumble boundaries, spawn-delay bounds, salute matching, the full resolveShout matrix, scheduler states (armed/waiting/scheduled/busy/off/unavailable), words-vs-reaction availability, catch end-to-end (pay + score + close), undercover fine-to-pot and salute-pays, fumble-without-pay, ignored-salute-keeps-hunt-open, escape-steal-to-pot (and the officer stealing nothing), leaderboard ordering.
- **Manual (live server) checklist:**
  1. `/hunting` → status shows the hunt channel and "words" mode.
  2. `/hunting test-spawn:#channel` → a crook appears; shout **STOP POLICE** → GOTCHA + bounty.
  3. Test the officer: `/hunting test-spawn:` until 🕵️ appears → salute 🫡 → reward; (or cuff them → fine).
  4. `/hunt-stats` and `/hunt-board` show the catch.
  5. `/hunting mode:reaction` → next crook gets a 🚨 reaction; pressing it cuffs.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| No crooks ever appear | Words mode without Message Content, disabled, or no channels | `/hunting` status names all three |
| Crooks appear very rarely | The vrt clock: two random intervals pass between hunts | Lower `interval-min`/`interval-max` |
| STOP POLICE does nothing | No open hunt (escaped already), or reaction mode is on | `/hunting` shows the mode |
| Cuffing the 🕵️ cost donuts | By design — salute the undercover officer | `🫡` or the word "salute" |

## Changelog

| Session | Change |
|---|---|
| S66 | Created (M16.1): the vrt-cogs/hunting port, precinct edition — crook variety + undercover-officer salute special, 2/17 fumble, words/reaction modes, multi-channel vrt scheduling (900–3600 s, 20 s window), per-type scores + leaderboard. Replaces the S38 activity hunt and S56 timed hunt; escape/fine donuts land in the pot (recorded deviation). |
