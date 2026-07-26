# Goals — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 103 · 2026-07-26

## Purpose

The goal tracker (M14). Something the precinct is working towards, with a progress bar and an announcement when it gets there — and the same thing for individual members, because *"goal tracker"* was never narrowed down and both readings are useful.

- **Precinct goals** — "1000 Members", "100 Cases closed". Anyone can see them; only Manage Server can set them. Milestones at 25/50/75/100% are announced.
- **Personal goals** — "Read 30 books". Anyone can keep up to ten, log progress against them, and appear on a board of who has finished the most.

**Precinct goals and personal goals are the same structure with a different owner.** That is not a shortcut: one shape answers both readings of the request instead of forcing a guess, and the only real differences are who may edit and where milestones go.

## Commands

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `!goal` | Status: how many goals are open and reached, on both sides | none | Everyone | `!goal` |
| `!goal list` | The precinct's goals with progress bars | none | Everyone | `!goal list` |
| `!goal mine` | Your goals (or someone else's) | `[member]` | Everyone | `!goal mine @friend` |
| `!goal new` | Start a goal of your own | `<target> <name…>` `unit:` | Everyone | `!goal new 30 Read 30 books unit:books` |
| `!goal log` | Add progress to one of your goals | `<amount> <name…>` | Everyone | `!goal log 3 books` |
| `!goal done` | Mark one of your goals reached | `<name…>` | Everyone | `!goal done books` |
| `!goal drop` | Delete one of your goals | `<name…>` | Everyone | `!goal drop books` |
| `!goal board` | Who has finished the most goals | `[size]` (1–25, default 10) | Everyone | `!goal board 5` |
| `!goal create` | Start a precinct goal | `<target> <name…>` `unit:` `track:` | Manage Server | `!goal create 1000 Members track:members` |
| `!goal set` | Set a precinct goal's value | `<value> <name…>` | Manage Server | `!goal set 40 Cases` |
| `!goal bump` | Add to a precinct goal's value | `<amount> <name…>` | Manage Server | `!goal bump 5 Cases` |
| `!goal track` | What a precinct goal counts | `<manual\|members\|boosts> <name…>` | Manage Server | `!goal track members Members` |
| `!goal remove` | Delete a precinct goal | `<name…>` | Manage Server | `!goal remove Cases` |
| `!goal channel` | Where milestones are announced | `[channel]` (omit = wherever it happened) | Manage Server | `!goal channel #announcements` |
| `!goal announce` | Milestone announcements on/off | `<true\|false>` | Manage Server | `!goal announce false` |
| `!goal reset` | Wipe every goal, precinct **and** personal | `confirm` | Manage Server | `!goal reset confirm` |

Aliases: the group answers to `!goals` and `!target`; `list` takes `precinct`/`server`, `mine` takes `me`, `log` takes `add`/`progress`, `done` takes `complete`, `drop` takes `delete`, `board` takes `leaderboard`/`top`.

**Naming a goal is tolerant.** `!goal log 3 books` finds "Read 30 books" by substring. If a fragment matches more than one goal the bot **names them and asks again** rather than picking — silently logging progress against the wrong goal is worse than one extra message.

### Auto-tracked goals

A precinct goal can count itself. `track:members` and `track:boosts` read the number **straight off the guild**, so there is no counter to maintain, nothing to drift, and nothing to rebuild after a restart — the value is already correct the first time anyone looks.

| Source | Counts | Notes |
|---|---|---|
| `manual` | Whatever you `set` or `bump` | The default |
| `members` | Members in the precinct | Updated on every sweep and every read |
| `boosts` | Server boosts | Same |

`!goal set` on an auto-tracked goal is **refused, with the fix named** (`!goal track manual …`). Accepting it would look like it worked right up until the next sweep silently undid it.

## Events

`ClientReady` — catches up on anything that changed while the bot was offline, then arms a **15-minute sweep**. The sweep exists only for auto-tracked goals: nobody runs a command when the 1000th member joins, so something has to look. Fifteen minutes is deliberate — an auto-tracked number changes slowly, and a tighter loop would only mean more writes to the Pi's SD card for the same answer.

Reads also refresh before answering (`!goal`, `!goal list`), so the numbers a human sees are never stale between sweeps.

## Configuration

No env vars, no `config.json` keys. Per-guild settings live under `goalsConfig` and are **sparse** (S35).

| Key | Default | Effect |
|---|---|---|
| `enabled` | `true` | Whether milestones are **announced**. Progress is tracked either way. |
| `announceChannelId` | `null` | Where milestones go. `null` = wherever the progress was made. |
| `milestones` | `[25, 50, 75, 100]` | Which percentages get an announcement. |
| `perMemberLimit` | `10` | How many goals one member may keep open. |

Goals themselves live under `guildGoals` (one map) and `memberGoals` (a map per member).

## Permissions & safety

- **Bot permissions needed:** Send Messages in the announcement channel, plus View Channel wherever the commands are used. No privileged intent beyond what every `!command` already needs.
- **Member permissions:** everything personal is open to everyone; every precinct goal and every setting requires Manage Server.
- **No pings.** Every reply and every announcement carries `allowedMentions: { parse: [] }`, so the board renders mentions without notifying anyone.
- **A milestone is announced once, ever.** The crossed marks are written into the goal **in the same write that moves the progress** (S22 claim-before-send). A failed announcement means one missed milestone; the alternative — announcing on every sweep forever — would be far worse. Falling back below a mark and climbing again does not re-announce either.
- **`!goal reset confirm` deletes everyone's personal goals too**, and the refusal message says so before you can run it.

## How it works

- **`lib/goals.js` (pure, no discord.js, `now` injected):** `slugify`, `createGoal`, `applyProgress`, `percentOf`, `progressBar`, `formatGoal`, `findGoal`, `sortGoals`, `currentFromSource`, `milestoneMessage`, `goalBoard`.
- **`applyProgress` returns a new goal plus which milestones that move crossed** — it never writes anything. The service decides whether to persist, which is what lets the announcement and the progress land in one atomic write.
- **Progress is clamped at both ends and completion is sticky.** `completedAt` keeps its **original** timestamp when a finished goal is touched again — the goal was reached then, not now — but a goal that falls back below its target does reopen.
- **The bar floors rather than rounds.** 99/100 must not print a full bar; the whole point of the feature is seeing that you are not done.
- **A jump past several marks announces once.** Crossing 25% and 50% in one step is one piece of news, so the service posts only the highest.
- **The sweep is free when nothing changed.** `refreshTrackedGoals` compares the guild's number to the stored one and returns without a write if they match — which is what makes a fifteen-minute loop cost nothing.

## Files

| Path | Role |
|---|---|
| `src/modules/goals/index.js` | Manifest |
| `src/modules/goals/lib/goals.js` | Pure goal logic, milestones, bars, board |
| `src/modules/goals/service.js` | Storage, announcements, the auto-tracked sweep |
| `src/modules/goals/events/ready.js` | Catch-up at boot + arms the sweep |
| `src/modules/goals/commands/goal.js` | The `!goal` group |
| `test/goals.test.js` | Coverage |

## Testing

- **Automated:** `npm test` — `test/goals.test.js` (24 tests): slugging, every creation validation and the duplicate-name refusal; clamping at both ends, sticky completion keeping its original timestamp, and reopening below the line; milestones announced once, a multi-mark jump reported together, and a drop-and-climb **not** re-announcing; the bar never rounding 99% up to full; tolerant name lookup with an **ambiguous match refused rather than guessed**; sort order; auto sources returning `null` for manual so a hand-kept number is never overwritten; the board excluding the empty-handed. Then the service: sparse config, per-member isolation, `moveGoal` posting only the highest mark and never twice, announcements off while tracking continues, and a sweep that updates exactly the auto-tracked goals and writes nothing when the guild has not changed. Then the command surface: the public/gated split, a full personal goal from `new` to `drop`, the per-member limit, an auto-tracked goal showing its real number **immediately** rather than sitting at zero until the first sweep, `set` refused on an auto goal with the fix named, and `reset` needing the word.
- **Manual (live server) checklist:**
  1. `!goal create 1000 Members track:members` → the reply already shows the real member count, not 0.
  2. `!goal list` → the goal with a bar.
  3. `!goal create 100 Cases closed unit:cases`, then `!goal bump 30 Cases` twice → at 50 the milestone is announced once. Bump again → nothing new is announced.
  4. `!goal channel #announcements` → the next milestone lands there instead.
  5. `!goal new 30 Read 30 books unit:books`, `!goal log 3 books`, `!goal mine` → your own bar moves.
  6. `!goal log 100 books` → completes and clamps at 30, not 103.
  7. `!goal board` → you appear with 1 reached, pinging nobody.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| An auto-tracked goal shows 0 | The guild's member count was not cached at boot | It corrects on the next read or sweep; `!goal list` forces one |
| `!goal set` is refused | The goal counts itself | `!goal track manual <name>` first — the refusal says so |
| A milestone was never announced | Announcements are off, or the channel is gone / unwritable | `!goal` shows the channel; `!goal announce true` |
| A milestone was announced late | The sweep runs every 15 minutes | Expected. A read (`!goal list`) refreshes immediately |
| "That matches 2 goals" | The fragment is ambiguous | Use more of the name — the message lists the candidates |
| A member cannot add a goal | They are at `perMemberLimit` open goals | They finish or drop one; the limit is per guild in `goalsConfig` |
| Every goal vanished | Someone ran `!goal reset confirm` | Irreversible by design, and the confirmation warned that personal goals go too |

## Changelog

| Session | Change |
|---|---|
| S103 | Created (M14). Precinct goals with progress bars and 25/50/75/100% milestone announcements, plus personal goals and a board — one structure for both, because the request never said which was meant. Auto-tracked sources (`members`, `boosts`) read straight off the guild, so they cost nothing to keep and are correct on the first read. Milestones are recorded in the same write as the progress, making announcements idempotent across a 15-minute sweep. |
