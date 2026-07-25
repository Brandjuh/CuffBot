# Kill Counter — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 99 · 2026-07-25

## Purpose

Chat kills (M20, owner request: *"zodra het 30 seconden stil is nadat een persoon wat heeft gezegd krijgt die persoon 1 punt op de kill counter"*). Say something, and if the channel then goes quiet for 30 seconds, you killed the conversation and the precinct credits you for it. There is a leaderboard, because someone is always proudest of this.

It is a joke feature with a real timing rule underneath, so the rule is where all the care went: only the **last** speaker before a silence scores, one point per silence, and channels are independent.

## Commands

Reading is public; every knob is **Manage Server**.

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `!killcounter` | Status: on/off, the silence needed, the scope, your tally | none | Everyone | `!killcounter` |
| `!killcounter me` | Your kill count and rank | `[member]` | Everyone | `!killcounter me @friend` |
| `!killcounter board` | The leaderboard | `[size]` (1–25, default 10) | Everyone | `!killcounter board 5` |
| `!killcounter on` / `off` | Start / stop counting | none | Manage Server | `!killcounter off` |
| `!killcounter silence` | How long the quiet must last | `<seconds>` (5–3600) | Manage Server | `!killcounter silence 60` |
| `!killcounter channel` | Toggle a channel in the counted list | `<channel>` | Manage Server | `!killcounter channel #general` |
| `!killcounter everywhere` | Count in every channel again | none | Manage Server | `!killcounter everywhere` |
| `!killcounter reset` | Wipe every score | `confirm` | Manage Server | `!killcounter reset confirm` |

Aliases: the group answers to `!kills` and `!chatkills`; `me` takes `stats`, `board` takes `leaderboard`/`top`. **`!killcounter @member` works** — the group's `fallback` routes an unmatched first token into `me`.

### The rule, exactly

1. Someone posts a message in a counted channel.
2. That message **replaces** whatever was pending in that channel — the replacement *is* the reset, which is why a busy channel never scores: only the final speaker before the silence is holding the knife.
3. If **30 seconds** (configurable) pass with no new eligible message in that channel, the pending speaker gets **1 point**.
4. Awarding clears the pending, so a silence can only ever score once.

### What does not count

- **Bots**, including CuffBot itself.
- **Commands** (`!something`) — that is talking to the bot, not to the room, and counting it would hand out points for running commands into a quiet channel. An admin can switch this off in storage (`ignoreCommands`), though there is no command for it because nobody has wanted it.
- **Channels outside the configured list**, if one is configured. An **empty list means everywhere**, which is the default.

## Events

`MessageCreate` — hands every guild message to the service, which decides eligibility and re-arms that channel's timer. The handler itself contains no rules on purpose: the eligibility and the timing both live where they can be tested.

## Configuration

No env vars, no `config.json` keys. Per-guild settings live under `killCounterConfig` and are **sparse** (S35).

| Key | Default | Effect |
|---|---|---|
| `enabled` | `true` | Whether kills are counted at all. Turning it off keeps existing scores. |
| `silenceMs` | `30000` | How long the quiet must last (owner's 30 seconds). |
| `channelIds` | `[]` | **Empty = every channel.** A non-empty list restricts counting to exactly those. |
| `ignoreCommands` | `true` | Whether a `!command` can be a last word. |

**On the default scope:** the owner's request did not say whether this should run everywhere or in a chosen set of channels. It ships counting **everywhere**, with `!killcounter channel #x` to narrow it — the knob answers the question either way, and turning it on precinct-wide is the reading that needs no setup.

## Permissions & safety

- **Bot permissions needed:** View Channel and Read Message History in the channels being counted (it must see messages arrive), plus Send Messages wherever the commands are used. Reading messages needs the **Message Content intent**, which is already required for every `!command` (S57: all intents are enabled).
- **Member permissions:** `me` and `board` are open to everyone; every configuration subcommand requires Manage Server.
- **Nothing is announced.** A kill is scored silently — the bot does not post "you killed the chat", because that message would itself break the silence it is reporting on, and would make every quiet channel noisy.
- **No pings.** Both replies carry `allowedMentions: { parse: [] }`, so the leaderboard renders mentions without notifying 25 people.
- `!killcounter reset` is the only irreversible action and requires an explicit `confirm`.

## How it works

- **`lib/killcounter.js` (pure, no discord.js, `now` injected):** `isEligible` (the four exclusions above), `noteSpeaker`, `resolveSilence` (the timing rule), `addKill` (returns a new map, never mutates), `leaderboard`, `standingFor`.
- **`resolveSilence(pending, now, silenceMs)` returns `{ pending, award }` and clears the pending as it awards.** That is what makes scoring idempotent: a stray extra timer tick, a manual re-fire, a race — none of them can score the same silence twice.
- **`service.js`** holds one entry per channel in a `Map`: `{ pending, timer }`. A new eligible message disarms the old timer and arms a new one — one timer per channel, never a growing pile. The timers are **RAM-only and `unref()`'d** by design: a pending kill lost to a restart is one point in a joke game, and persisting a countdown would mean writing to the Pi's SD card on every message in the precinct. Scores themselves are persisted immediately.
- **Timers are injectable** (`setTimer`/`clearTimer`), which is why the whole suite runs without waiting: tests arm through fakes and call `fireSilence` with the `now` they want. No `setTimeout` in a test, no flake.

## Files

| Path | Role |
|---|---|
| `src/modules/killcounter/index.js` | Manifest |
| `src/modules/killcounter/lib/killcounter.js` | Pure eligibility, timing rule, scoring, leaderboard |
| `src/modules/killcounter/service.js` | Storage + the per-channel timers |
| `src/modules/killcounter/events/message.js` | `MessageCreate` watcher |
| `src/modules/killcounter/commands/killcounter.js` | The `!killcounter` group |
| `test/killcounter.test.js` | Coverage |

## Testing

- **Automated:** `npm test` — `test/killcounter.test.js` (27 tests) with **no real waiting anywhere**: the four eligibility exclusions incl. the router's own "a lone `!` is not a command" rule; the timing boundary (one millisecond early scores nothing, exactly on time scores); idempotence (a second fire awards nothing); scoring that never mutates the input map; leaderboard ranking with the recency tiebreak and zero-kill members excluded; `standingFor` reporting `null` rather than `#0` for someone unranked. Then the service: speaking arms a timer, a new message **replaces** the pending kill and disarms the old timer, an ineligible message neither arms nor disturbs what is pending, channels are independent, firing early leaves the kill pending, a duplicate fire cannot double-score, and a scoped guild ignores everything outside its list. Plus the command surface and the permission split.
- **Manual (live server) checklist:**
  1. Say something in a quiet channel, wait 30 s, then `!killcounter` → your tally went up by one.
  2. Say something, have someone else reply within 30 s, then let it go quiet → **they** score, not you.
  3. Post a `!command` into a quiet channel and wait → nobody scores.
  4. `!killcounter silence 10` → the status line and the board footer both say 10 s.
  5. `!killcounter channel #general` → the status shows only that channel; kill a conversation elsewhere and nothing is scored. `!killcounter everywhere` puts it back.
  6. `!killcounter board` → ranked, with medals, pinging nobody.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Nobody ever scores | The counter is off, or the channel is outside a configured list | `!killcounter` shows both — `on`, and `everywhere` or `channel #x` |
| Everybody's score reset to zero | Someone ran `!killcounter reset confirm` | Irreversible by design; the scores are gone |
| Scores stopped after a bot restart | Only the **pending** kill is lost on a restart (RAM by design), never a scored one | Nothing to fix — the next message re-arms that channel |
| A member scores when they think they should not | They had the last word before a silence, including a one-word reply | That is the rule; `!killcounter silence <seconds>` makes it harder |
| Kills counted in a channel nobody talks in | An empty channel list means everywhere | `!killcounter channel #x` per channel to narrow it |

## Changelog

| Session | Change |
|---|---|
| S99 | Created (M20, owner request): 30 s of silence after a message credits the speaker, per-channel and idempotent; the `!killcounter` group with `me`/`board` public and the knobs on Manage Server; configurable silence and channel scope, defaulting to everywhere. Timers are injectable, so all 27 tests run without waiting. |
