# CuffBot — Roadmap

Milestones sized so one focused session can finish one (build + tests + manual + state). Sessions pick the first unchecked milestone unless `STATE.md`'s resume point or the owner says otherwise. Acceptance criteria are the contract — a milestone is done when every box checks, not when the code "looks done". Update this file when scope changes, and record why in `SESSION_LOG.md`.

Theme reference: `.claude/skills/run-skill-generator/references/architecture.md → Police theme vocabulary`.

- [x] **M0 — Build system** *(Session 0)*
  The `run-skill-generator` skill, state files, roadmap, manual template, docs index.

- [x] **M1 — Bot core: on the air** 📻 *(Session 1)*
  `package.json` (ESM; scripts `start` / `test` / `deploy-commands`), `src/index.js`, `src/core/{config,logger,loader}.js`, `src/deploy-commands.js`, module `core` with `/radio-check` (latency check), `.env.example`, loader smoke test.
  *Accept when:* `npm test` passes; `node --check` clean on all files; boot fails fast with a clear message when `.env` is missing; `docs/modules/core.md` complete per template; README quickstart section written.

- [x] **M2 — Enforcement: arm of the law** 🚨 *(Session 7 — includes the owner-requested Papers-Please-style citation tickets)*
  Module `enforcement`: `/cite` (warn, delivered as a generated ticket image), `/detain` (timeout with duration option), `/release` (lift timeout / unban), `/arrest` (ban, with message-deletion window option). Hierarchy + permission checks per `discord-reference.md`; audit-log reasons always set; duration parsing in `lib/` with tests.
  *Accept when:* all four commands registered and syntax-clean; lib tests pass (incl. duration edge cases: `10m`, `2h`, `7d`, invalid); every failure mode replies specifically; `docs/modules/enforcement.md` complete incl. owner's live-test checklist.

- [x] **M3 — Records: the rap sheet** 📋 *(Session 8)*
  `src/core/store.js` (atomic JSON per guild, gitignored `data/`), module `records`: infractions written by enforcement actions, `/rapsheet` (view a member's history, ephemeral), retention/clear command for admins.
  *Accept when:* store has tests (concurrent-ish writes, missing file, corrupt file recovery); enforcement writes records; `/rapsheet` paginates or truncates gracefully; manual complete.

- [x] **M4 — Dispatch: the evidence locker** 🗄️ *(Session 11)*
  Module `dispatch`: configurable log channel (evidence locker) receiving enforcement/records events; `/dispatch` announcement command for the force.
  *Accept when:* log channel configurable per guild via command + stored in records store; missing-channel and missing-permission cases handled; manual complete.

- [x] **M5 — Academy: ranks** 🎖️ *(Session 12 — adopts the server’s existing leveler ranks, not a fixed ladder)*
  Module `academy`: rank ladder (Cadet → Chief) mapped to guild roles via config, `/promote`, `/demote`, `/ranks`. Role-hierarchy safety per `discord-reference.md`.
  *Accept when:* ladder logic lives in `lib/` with tests; misconfigured/missing roles reported clearly; manual complete.

- [x] **M6 — Patrol: automod** 👮 *(Session 13)*
  Module `patrol`: message screening (banned terms, invite links, basic spam heuristic) with actions routed through enforcement/records; `/patrol` to view/toggle rules. Needs `MessageContent` privileged intent — document the portal steps in the manual.
  *Accept when:* screening logic in `lib/` with tests; per-guild toggle stored; false-positive story documented; manual complete.

- [x] **M7 — Public Affairs: community** 🍩 *(Session 14)*
  Module `public-affairs`: `/badge` (member card: join date, rank, record count), `/wanted` (playful poster embed), `/donut` (fun), `/911` (report to the force → evidence locker).
  *Accept when:* commands work without privileged intents where possible; `/911` respects anonymity choice; manual complete.

- [x] **M8 — Deployment & operations** 🚀 *(large slices delivered early: S2 Pi installer + runbook, S5 doctor, S7 test-gated self-update timer; S15 backup/rotation docs + final audit)*
  Remaining: token rotation runbook polish, troubleshooting FAQ sweep.
  *Accept when:* a competent non-expert can take the repo to a live bot using `docs/` alone; ops runbook reviewed against `discord-reference.md → Token hygiene`.

---

## Backlog — owner feature requests (M9+, not yet scheduled)

Captured from the owner; each becomes its own milestone (build + tests + manual + state) when scheduled. Several are independent and could be reordered.

- [x] **M9 — AI conversation** 🕵️ *(Session 17 — module `detective`)* — `/ask` + `/ai-config` + reply-when-mentioned via a free-tier provider (Groq or Gemini, auto-picked by whichever API key the owner puts in `.env`; `CUFFBOT_AI_PROVIDER`/`CUFFBOT_AI_MODEL` overrides). **Owner rate-limit spec implemented exactly: GLOBAL budget shared by everyone combined — 1 AI message / 7 s and 62 / rolling hour** — checked before any tokens are spent. Per-channel conversation memory (8 exchanges, 30 min, RAM-only). Zero new dependencies. Owner setup: one key in `.env` + restart (`docs/modules/detective.md`).
- [x] **M10 — Birthdays** 🎂 *(Session 19 — module `birthdays`)* — `/birthday-set` (day+month+IANA timezone, no birth year stored), `/birthday-remove`, `/birthdays` (upcoming, per-member timezone), `/birthday-config` (admin: channel+enabled). 10-minute idempotent sweep instead of a missable midnight job; announces on the member's own calendar day, once per local year (stamp-before-send); Feb 29 → Mar 1 in non-leap years.
- [x] **M11 — Police trivia** ❓ *(Session 20 — module `trivia`)* — `/trivia [set]` buttoned rounds (first correct answer wins, one guess each, 20 s reveal with facts), `/trivia-scores` persistent leaderboard, `/trivia-sets`. Question banks are plain JSON files in `data/` (validated at load, invalid files skipped loudly); ships with `police-codes` + `world-police` (10 questions each). New sets appear in the picker on the next deploy.
- [x] **M12 — Fallen tracker** 🕯️ *(Session 21 — module `memorial`)* — polls `firehero.org/feed/` (→ role `627943529544417300`) and `odmp.org/feed` (→ role `451095508560379934`) every 30 min with a zero-dep RSS parser. **Baseline on first sweep** (no history flood), oldest-first posting capped at 5/feed/sweep, seen-store with retry-until-delivered, role tag with scoped allowedMentions. `/memorial-config` (admin: enabled/channel/preview).
- [x] **M13 — Starboard** ⭐ *(Session 22 — module `starboard`)* — ⭐-reaction watcher (`GuildMessageReactions` intent + partials for pre-boot messages): at the configurable threshold the message reposts to the board channel (author, clamped text, first image, jump link, star count). Claim-before-send dedupe (exactly once, rollback on failed send), bounded boarded-map, `/starboard-config` (enabled/channel/threshold).
- [ ] **M14 — Goal tracker** 🎯 — track goals/progress (scope to define with the owner).
- [x] **M15 — Chat starter** 💬 *(Session 23 — module `chat-starter`)* — after the configured idle window (15–1440 min, default 180) the bot posts an open-ended question in the configured channel. 40-question bank (no-repeat ring of 10) + optional AI generation via the detective's provider (list fallback). **Never monologues** (a human must speak between starters) and is **off by default**. `/chat-starter-config` (enabled/channel/idle-minutes/use-ai/preview).

---

## M16 — The Games Arcade (S65 intake; owner batch request 2026-07-25)

The owner requested 12 new game modules ported from Red-DiscordBot cogs, plus two reworks of existing systems. Sources are public repos, cloned per session into the scratchpad (see STATE.md → Game-cog sources). Porting rule (skill 0.5.1): read the cog, port behavior faithfully, police-theme the flavor; pure logic in `lib/` with tests; zero new dependencies. One game = one session = one PR unless marked otherwise.

**Reworks first (owner priority — "this is what I actually want"):**

- [x] **M16.1 — Hunting rework** 🦹 *(Session 66 — module `hunting`)* *(vrt-cogs/hunting model, police/crooks theme, STOP POLICE)* — replaces the S38/S56 spawn model: per-guild **enabled-channels list** (hunt start/stop; owner hunt channel `412354971170897921` stays the committed default), spawns gated on channel activity at a random interval (defaults 900–3600 s, configurable timing incl. catch timeout default 20 s); **crook VARIETY** — multiple crook types each with emoji + shout line, caught by STOP POLICE (word mode) or 🚨 reaction (mode toggle); **~11.8% fumble chance** (2/17, faithful to the cog) where the crook escapes despite the shout; **undercover-officer special** (eagle port, toggleable): cuffing them = fine, SALUTING (🫡/"salute") = reward; optional response-time display; donut reward range per catch; per-member catch stats per crook type + total; `/hunt-stats`, `/hunt-board` (top 50). Escape still pickpockets into the pot (owner's own S38/S41 economy wiring — kept).
  *Accept when:* spawn scheduling/variety/fumble/undercover rules live in `lib/` with tests; multi-channel config + timing knobs work; stats persist; manual complete.

- [x] **M16.2 — Claims rework (payday model + crack-the-pot)** 🍩 *(Session 67)* — the /daily system grows into payday-style **multi-interval claims**: hour/day/week/month/quarter/year, each with a configurable amount (0 = off; committed defaults keep today's behavior: day = 25 🍩, rest off) and an optional **streak bonus** (flat or percentage) earned by claiming within [interval, 2× interval) — lapse past double the window and the streak resets, exactly like the cog. `/claims` overview (all timers + your crack-pot attempt state in one view) + claim-all; `/daily` keeps working (claims the day interval, now streak-aware). Crack-the-pot stays the pot ritual and is surfaced in the overview.
  *Accept when:* interval/streak math in `lib/` with tests (window edges!); config knobs appended last; /daily backward compatible; manual complete.

**New games (scoping from the S65 survey; order = suggested build order, small → large):**

- [x] **M16.3 — Connect 4** 🔴🔵 (S71, phen-cogs port) — `!connect4 @officer` (group, alias `!c4`, fallback sub `play`): challenge → accept (60 s) → 7×6 emoji board with digit buttons, ≥4-run win scan, 120 s inactivity forfeit, guild stats + top-3 medals (`!connect4 stats`). Both cog fixes shipped: full-column press politely refused (turn kept), ties actually persisted. Framework grew group `fallback` subs. Module `connect4`, manual `connect4.md`.
- [x] **M16.4 — Hangman** 🪢 (S72, FlameCogs port) — `!hangman play`/`stop` + admin `edit <on|off>`: typed single-letter guesses by the starter (60 s each), the cog's 7 gallows frames byte-for-byte, free repeats, auto-revealed non-letters, 6 misses = loss, bundled 4,554-word list (packaging-tested), edit-in-place mode with guess tidy-up. Deviations recorded: `stop` sub added, custom wordlists not ported, admin gate = Manage Server. Module `hangman`, manual `hangman.md`.
- [x] **M16.5 — Russian roulette** 🔫 (S73, AAA3A port) — `!russianroulette play` (alias `!rr`, mod-gate Manage Messages per-sub): button lobby (join/leave/players/start/cancel, max 30, host auto-joins), shuffled rounds with one chambered shot, 5 s Shoot turns (AFK = the bot shoots you), 90/10 misfire onto a random other player, last-standing winner. Engine io-injected (whole games scripted in tests). Upstream fixes: AFK skip bug (snapshot iteration) + everyone-AFK crash (last survivor wins outright). Pings limited to turn prompts + winner (deviation). Module `russianroulette`, manual `russianroulette.md`.
- [x] **M16.6 — Split or Steal** 🤝 (S79, AAA3A port) — `!splitorsteal play` (aliases `!sos`): fixed 60 s button lobby (never ends early), two contestants drawn choice-remove-choice, secret Split/Steal with quiet confirmations, the classic matrix, 60 s choice timeout. Event-driven choice bridge (no 1 s polling). Deviations: "loose" typo fixed; pings only on the contestant announcement. Module `splitorsteal`, manual `splitorsteal.md`.
- [x] **M16.7 — Guess the Candy** 🍬 (S80, AAA3A port) — `!guessthecandy play [5–23]` (alias `!gtc`, play fallback → `!gtc 8`): scrambled candy name + name buttons (answer always aboard via sample-then-choice), first correct press wins with two-decimal timing, free retries, 180 s rounds, parallel rounds per message, winner pinged. Recorded deviation: the 46 branded PNGs NOT bundled (license risk from the S65 survey) — per-word name scramble instead; the 23-name pool verbatim. Module `guessthecandy`, manual `guessthecandy.md`.
- [x] **M16.8 — Rollout** 🎲 (S81, AAA3A port) — `!rollout play` (group; play/leaderboard public, prize/economy/resetleaderboard ManageGuild): 50-player lobby, 25-number rounds (30 s, early end when all picked, live board feedback), cog-exact eliminations + all three survey edge cases (round restart keeps the number enabled; all-timeout abort; **the 24-disabled tie the cog crashed on — fixed**), prize 2500 code-default (help-text lie documented), economy payout via adjustBalance seam, score/wins/games leaderboard. Module `rollout`, manual `rollout.md`.
- [x] **M16.9 — Memory** 🧠 *(Session 82 — module `memory`)* — single-player pairs grid (3x3/4x4/5x5, cog-exact layouts + 12-emoji pool, center blank on odd grids), 1 s red flash on mismatch (same-tile-twice quirk kept), decayed prize bit-for-bit (base 5000 scaled with Python int() order), optional `maxwrong` loss cap, score/wins/games leaderboard + admin knobs, economy payout via the adjustBalance seam. Cog's double-counted games bug NOT ported (count once); bot-owner press backdoor dropped (recorded deviations).
- [x] **M16.10 — Wordle** 🟩 *(Session 83 — module `wordle`)* — typed guesses vs the cog's EN dictionary verbatim (invalid = ❌ + free retry), emoji grid replaces Pillow (board edits in place), length 4–11 / attempts 5–10, per-member concurrency 1, stats + guess distribution, cancel word/button, 5-min guess timeout. Naive yellow rule copied exactly (double-yellow divergence pinned in a test); **the hardcoded-6 loss check fixed to respect max attempts** (recorded deviation); lists diacritic-folded at load so every secret stays typeable.
- [x] **M16.11 — Hammertime** ⏰ *(Session 84 — module `hammertime`)* — per-member timezone registry (city/zone/abbreviation/offset queries, select disambiguation, role defaults + the cog's ambiguity rule), natural-language time → all 7 Discord timestamp styles (cog-verbatim block), member-list mode (west→east — the cog's no-op sort fixed), optional auto-convert listener with the cog's am/pm inference quirk. dateutil/pytz replaced by hand-rolled Intl parsers: relative regex verbatim, wall-clock DST semantics preserved, calendar-safe months, simplified fuzzy absolute parser (gibberish refuses instead of today-midnight — recorded deviation).
- [x] **M16.12 — Heist** 💰 *(maxcogs; LARGE, staged across Sessions 85–88 — **slice A (S85)**: the 74 items / 28 recipes / 24 jobs verbatim + machine-diffed against the source, the 120-level XP curve, the pure `resolveHeist`, crafting. **Slice B (S86)**: storage, the full `!heist` group (play/jobs/shop/buy/equip/inventory/sell/craft/bail/paydebt/level), the cog's gate order and the economy seam — playable, with results settling lazily on the player's next command. **Slice C (S87)**: the job scheduler — results announce themselves in the channel they started from, and a `ClientReady` boot catch-up re-arms running jobs while settling those that finished during downtime. **Slice D (S88)**: crew robbery (level-20 organiser, 4-seat lobby, one shared roll, split pot, per-officer police rolls, a single leader-driven settlement) + the admin surface (`!heist admin show/set/reset/price/event`, sparse overrides with the cog's range guards). **Complete.**)* — 25 timed heists with cooldowns, tools/shields (single-use), debt + 20% tax, police rolls + heat (+2%/heat, decay 1/2 h), jail + bail (+15% tax), materials → 28 craft recipes, levels 1–120 (+0.5%/level success cap +20%), crew robbery (4 × level ≥20, split pot). Stages: data tables → pure resolveHeist(rng) → views → restart-surviving scheduler.
- [x] **M16.13 — City crime RPG** 🌃 *(CalaMari; LARGE, staged across Sessions 89–92 — **slice A landed in Session 89**: the 5 crimes with the cog's numbers, the 96 events dumped verbatim from source, the pure resolver (draw → modifier fold → roll → reward/fine/jail) incl. streaks and the step-by-step rounding. **Slice B (S90)**: storage, the `!crime` group (pickpocket/mug/store/bank/stats) with the cog's gate order, real money via the economy seam, the victim clamp and the event/maths result card — playable. **Slice C (S91)**: bail (the cog's exact formula), the one-shot jailbreak with its 14 scripts, and `!crime random` over the 46 scenarios — both tables dumped from source with their constants resolved. **Slice D (S92)**: the black market (permanent −20% sentence perk + get-out-of-jail card, with a member inventory), six leaderboards and the `!crime admin` surface. **Complete.**)* — the /crime underworld: 5 crime types with events (96), streaks (+5%/success cap +25%), jail/bail/jailbreak (35% base, +30% fail), 46 random scenarios, black market, 6-category leaderboard. Slices: non-targeted crimes → events → jail suite → targeted crimes → streaks → scenarios → market → boards.
- [ ] **M16.14 — Mafia** 🕴️ *(AAA3A; VERY LARGE, staged)* — Werewolf-class night/day engine (weighted votes, defense/judgement, win conditions), fresh game channel with overwrites, secret role DMs. Stage 1 = engine + the 5 classic roles (min 5 players); the other ~50 roles, modes, anomalies, achievements follow. Needs Manage Channels.

Full mechanics live in `docs/porting/S65-cog-surveys.md` (S65 survey — the porting reference).

*Standing acceptance for every game:* pure rules in `lib/` with tests (deterministic via injectable random/now), economy integration through `adjustBalance`/`addToPot` seams where the cog used Red bank, component interactions via the module-owned pump pattern, help category `games`, manual per module, README counts current.

---

## M17 — Text-only restructure, Red-DiscordBot style (S68 owner mandate)

S68 removed slash commands entirely (text-only engine switch: router, deregistration, doctor, help). The owner's structural directive: some commands were de-facto slash-only (many named options — unusable positionally), so EVERYTHING gets one uniform structure modeled on the S65 source cogs: **`!group subcommand <args>`**, bare `!group` = status/overview (the Red convention).

- [x] **M17.1 — The subcommand framework** (S69) — `src/core/prefix/group.js`: `!group sub <args>` with typed positional args (string/integer/number/boolean/user/role/channel, greedy + choices), auto-generated bare-`!group` status/overview embeds, permission per group/subcommand, framework-owned refusals/usage errors/crash apologies; loader validates `{ group }` commands, router dispatches them before the legacy adapter, `!help` renders them via `summarizeCommand`. **youtube converted as the reference group** (on/off, channel, add/follow, remove/unfollow, preview, pingrole, noping). Legacy flat commands keep working during the migration.
- [x] **M17.2 — Convert the worst offenders** (S70) — every config command is a group: `!selfroles`, `!memorial`, `!hunting`, `!logbook`, `!claims-config`, `!economy`, `!xp`, `!ai`, `!birthday`, `!chat-starter`, `!starboard`, `!welcome`, and `!channel-list` (absorbed `channel-list-config`). Retired `-config` names live on as group aliases (loader-registered). Framework grew group `aliases` + the `postable` channel-arg flag (S55 rule in one place).
- [ ] **M17.3 — Convert the rest + retire the legacy path**; patrol wizard returns as `!patrol-wizard` (public message + owner-gated components); full docs sweep rides along per converted module.

*Accept when:* every command follows the group convention, `!help` shows it, all manuals match, and the legacy flat adapter path is gone.

M16 (the games) resumes AFTER M17.1 so every new game lands in the final structure.
