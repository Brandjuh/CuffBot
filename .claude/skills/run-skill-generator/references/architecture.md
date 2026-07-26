# CuffBot Architecture

**When to read this:** before writing or changing any bot code, and when reviewing whether existing code follows conventions. If you change a convention here, migrate existing code in the same session or record the debt in `STATE.md`.

## Stack — and why

| Choice | Rationale |
|---|---|
| Node.js ≥ 18 (container has v22) | Verified available in the build environment (Session 0); discord.js requires ≥ 18. |
| discord.js v14 | The de-facto standard Discord library; 14.27.0 verified installable through the environment proxy (Session 0). |
| ESM (`"type": "module"`) | Modern default on Node 22; discord.js v14 supports it fully. |
| `node:test` + `node:assert` for tests | Built into Node — tests run even if npm installs ever fail. No extra dependency to break. |
| JSON file storage under `data/` (gitignored) | Zero dependencies for early milestones. The storage layer is isolated behind one module so it can be swapped for SQLite later without touching features. |
| No web framework, no ORM, no build step | The bot is the product. Every dependency is a liability for a project maintained in short sessions. |

Re-verify environment facts (Node version, npm reachability) against `STATE.md` → *Environment facts* at the start of a session rather than assuming this table is still true.

## Repository layout

```
CuffBot/
├── src/
│   ├── index.js              # entry: builds client, loads modules, logs in
│   ├── deploy-commands.js    # CLEARS the slash-command roster (S68: text-only bot)
│   ├── core/
│   │   ├── config.js         # reads .env + config.json, validates, exports config
│   │   ├── logger.js         # leveled console logger (single place to change later)
│   │   ├── loader.js         # discovers modules, collects commands/events, wires client
│   │   └── prefix/           # !command parsing + the two dispatchers (group.js, command.js)
│   └── modules/
│       └── <module-name>/
│           ├── index.js      # module manifest: { name, description, commands, events }
│           ├── commands/     # one file per command (text-only since S68)
│           ├── events/       # one file per event listener (optional)
│           └── lib/          # pure logic, no discord.js imports (optional)
├── test/                     # *.test.js, run by `npm test` (node --test)
├── docs/
│   ├── README.md             # manual index
│   └── modules/<name>.md     # one manual per module (see template)
├── data/                     # runtime JSON storage — gitignored
├── .env.example              # every env var the bot reads, with placeholder values
├── config.json               # non-secret product settings (homeGuildId, colors, limits)
└── package.json              # scripts: start, test, deploy-commands
```

## Module pattern

A module is a folder under `src/modules/` that exports a manifest from its `index.js`:

```js
// src/modules/enforcement/index.js
import cite from './commands/cite.js';
import arrest from './commands/arrest.js';

export default {
  name: 'enforcement',
  description: 'Law-enforcement actions: citations, detainment, arrests.',
  commands: [cite, arrest], // command objects (see below)
  events: [],               // { name, once?, execute } listeners
};
```

**CuffBot is TEXT-ONLY (S68 owner mandate): every command is `!command`; slash commands are gone** (deploy-commands.js clears the guild's roster; the doctor flags any that reappear). Commands come in two shapes:

**The target shape (S69+, Red-DiscordBot style — use for ALL new and converted commands):** a group command file exports `{ group }`, dispatched by `src/core/prefix/group.js`. `!group sub <args>`; bare `!group` renders status + subcommand overview; the framework owns permission refusals, arg errors, and crash apologies — `run()` is happy-path only. Reference implementation: `src/modules/youtube/commands/youtube.js`; full contract in `docs/modules/core.md` § Group commands.

```js
export default {
  group: {
    name: 'youtube', description: '…', emoji: '📺',
    permission: PermissionFlagsBits.ManageGuild, // gates group + overview; subs may override
    async status(ctx) { return ['**Enabled:** yes']; }, // bare-!group state lines
    subcommands: [{
      name: 'channel', description: '…',
      args: [{ name: 'channel', type: 'channel', required: true }],
      async run(ctx, { channel }) { /* setConfig…; */ await ctx.reply('✅ …'); },
    }],
  },
};
```

A roadmap item that says "convert everything to shape X" is a *goal*, not a spec: check what carrying it out literally would do to the user before doing it. M17.3 read "convert the remaining flat commands to Red-style groups", and obeying that would have renamed 34 commands the precinct types daily — `!rank-setup` among them, which was a pending owner action. **Prefer adding a new shape over bending an existing one when the existing one would change user-visible behavior**; the flat shape below cost one small file and left every invocation intact.

**The flat shape (S93+, for commands that are not families):** `export default { command: { name, aliases?, description, emoji?, permission?, args, run(ctx, values) } }` — a group without subcommands, dispatched by `src/core/prefix/command.js`. Use it whenever a command does exactly one thing (`!badge`, `!daily`, `!rapsheet`): forcing those into groups would rename what the precinct types daily, and the flat shape already shares the group's ctx, arg types, permission gate and crash handling. Arg specs additionally take `min`/`max` (numbers) and `maxLength` (strings); specs declared *after* a greedy arg are claimed from the end of the line — that is what retired the adapter's per-command `textGreedyArg` hint — and any arg can also be given by name as `name:value` (S94), which takes the rest of the line and is the only way to reach a second free-text field. **A plain optional string must never claim a positional tail token:** every word "fits" one, so it would steal the greedy span's last word (`!cite @x Donut theft` filing reason "Donut", penalty "theft"). The legacy parser guarded against this, S93's rewrite dropped the guard, and S94 restored it — keep it in any future reimplementation. `ctx.typing()` replaces `deferReply()`: a message command has no 3-second deadline, so slow work shows the typing indicator and answers once.

There is no third shape. A pre-S69 `{ data, execute }` form existed, with an adapter that rebuilt an interaction out of a message; M17.3 converted all 45 of those commands (S93–S96) and S96 deleted the adapter. If you find code referring to it, that code is stale.

The loader (`src/core/loader.js`) imports every `src/modules/*/index.js`, registers both shapes in a `Collection` keyed by command/group name (validating each at boot), and wires event listeners. Keep discovery logic in the loader only — modules never self-register.

**A migration is finished when the SCAFFOLDING is gone, not when the last caller is converted.** Plan the deletion slice from the start and name in it exactly what dies — S96's list ran to eight items (the adapter, `assignOptions` and its option machinery, two dispatch branches, an executor wrapper, a summarizer branch, a shape-agnostic shim, a now-unused guard) plus the adapter's whole test file. Expect the **test count to go down**, and say so: 790 → 769 in S96 was the evidence the layer was really gone, not a regression, because those tests described a translation layer that no longer existed. Skip the deletion slice and the layer survives indefinitely — this one sat in `STATE.md` as "dead weight every future session has to reason about" for 27 sessions before M17.3 was sliced.

**Converting a command surface? First grep for how it is ADVERTISED, and make that string work.** A conversion is the one moment the promise and the parser are read side by side, so it is where the check belongs — search the manuals, `STATE.md`, and `src/` (the bot's own replies tell members what to type). S94: `!rank-setup header:@[LEVELER]` appears in four manuals, in STATE's owner-action list and in three command replies, and had been the owner's #1 pending action since S12 — while never working at all, because the text path was purely positional and answered "`header` should be a mention or id". S68 made the bot text-only and nobody re-checked the syntax the docs kept promising; 26 sessions passed. Fix such a gap **generally** (S94 added `name:value` keyword args to the framework) rather than per command, and prefer making the documented string work over rewriting the docs to match the code — the docs are what the owner has already been told.

**Grep for surface tests too — a feature gated on "which surface am I?" is a time bomb.** `interaction.isTextCommand`, `isChatInputCommand()`, "slash only for now" branches: a platform decision flips every one of them at once, and the feature behind the gate dies silently. S95 found `!patrol-wizard` gated on `isTextCommand` with a "being rebuilt for text-only mode" notice — S68 made *every* invocation a text command, so the wizard died that session and stayed dead for eleven more, invisible because a command that always answers with a polite notice looks alive, and its only test asserted exactly that notice. Re-decide each such branch during a conversion (the wizard needed no slash command at all: components attach to a *message*), and give any deliberately-disabled branch a test asserting the **disabled** behavior, so that deleting it shows up as a changed test rather than as nothing.

**Slicing a large port across sessions? Slice by FEATURE DEPTH, not by layer.** "Pure logic this session, commands next session" is not an available slice for a **new** module: the loader requires an `index.js` manifest for every directory under `src/modules/`, so a lib-only module fails discovery and has nowhere legal to live (S105 planned exactly that and hit the wall). Heist and city could slice by layer only because they were slicing *within* a module that already had a manifest. The slice that always works is depth — ship the smallest complete, playable version and add capability in later slices, each of which could be the last one.

**The loader's invariants bound which slices EXIST, so check them while planning (S116).** Two are load-bearing: every directory under `src/modules/` needs an `index.js` manifest, and command names **and aliases** are unique across all modules. The second one means **"build the replacement alongside the original and swap later" is not an available slice** — S116 planned exactly that for the connect4 → minigames replacement, both modules registered `!connect4`, and the old one had to be deleted a slice early; because that would have removed the scoreboard, its stats had to be pulled forward too. One unenforceable plan assumption re-scoped two slices. When a milestone replaces a module rather than extending it, the deletion and anything the old module was the only source of belong in the SAME slice.

**The larger reason, found by playing the result (S115): when the source is PANEL-DRIVEN, a layer slice ships the scaffolding as the product.** The intermediate command surface exists only to make the engine reachable — but it is genuinely usable, so every later slice adds features *to the commands that already exist*, and by the last slice nobody remembers that a panel was the point. The panel is never dropped; it is never scheduled. Heist and city were each sliced this way over four sessions, and they are the only two of thirteen games whose interaction model does not match its source: heist kept 1 of the source's 8 panels, city 0 of 48 UI references. The owner found city by playing it (*"dat werkt met panelen niet enkel met commands"*), and its source puts a `Bail Out!` button on screen **during** an attempt — so what went missing was a player decision, not decoration. **If the source is panel-driven, the panel belongs in the first slice a player can touch**; after the features it is a rewrite instead of a starting point.

**Converting a command surface? Convert its tests to the real dispatch path, not just its code.** The old tests hand-built an interaction and called `execute(it)` — which meant the arg parsing and the permission gate were *simulated by the test*, so neither was ever actually covered. Rewriting them onto `dispatchCommand`/`dispatchGroup` with a fake **message** (`test/fixtures/fake-message.js`) makes the framework part of what each test proves; it is what caught that every refusal named "Manage Server" no matter the gate (S93). Two consequences worth expecting: entity args need real 15–21 digit snowflakes, because the resolver applies Discord's own id rule; and a conversion regularly turns up commands with no test at all (`!xp-ladder`, `!hunt-stats`, `!hunt-board` in S93) — write those before moving on, they are the reason the slice found anything.

**Timed multiplayer games use the io-injected engine** (proven S73/S79/S81): the whole match lives in `runGame(game, io)` where `io` = `{ say/askX/sleep/… }` — production wires `channel.send` plus a promise bridge the button pump resolves; tests script entire matches with seeded randomness and zero real waiting. Timers in these engines are `unref()`'d (never block shutdown) — consequence for tests: **a test that genuinely awaits an unref'd timer needs an explicit event-loop keep-alive** (`setInterval` in a try/finally), or node:test cancels the whole file with "Promise resolution is still pending" (bit S73 and S81).

**Porting from another runtime? Transcribe the SEMANTICS, and pin them in tests before wiring.** The ported unit is the source language's observable behavior, not its API — and that includes arithmetic artifacts. Python `int()` truncates toward zero *after* the whole float expression, so `int(max_prize / 3 * 2)` is 3333 where `floor(x/3)*2` is 3332 (S82), and `int(1000 * (1 - 0.07))` is **929**, not 930, because `1 - 0.07` is `0.9299999999999999` (S85). Use `Math.trunc` for `int()`, keep the operation order, and pin the asymmetric cases — the values where a "cleaner" rewrite would differ — in tests. The same rule covers library replacements: when dateutil/pytz became hand-rolled Intl code (S84), what carried over was *weekday = next occurrence including today*, *fuzzy = skip unknown tokens*, and *aware-datetime + timedelta = wall-clock* (a day across spring-forward is 23 real hours) — each written as a test first. For a large port, get the source's data tables out **mechanically**, never by retyping. Two grades: dump them and commit the dump as a fixture to diff a hand transcription against (S85), or — better when the data is inert — **ship the dump itself as the module's data file** (S89/S91: 96 crime events, 46 scenarios and 14 prison-break scripts, loaded straight from JSON), so there is no transcription to drift and the tests assert shape rather than values. If the source stores values as named constants, resolve the names during the dump (a ten-line AST walk) rather than giving up and typing them out.

**The published-post pattern** (selfroles S59/S64, rules S97): when a feature's output is "one tidy post that stays current" — a self-role list, a rulebook, anything the precinct should find at a stable link — the bot owns the message and **edits it in place**. Copy the existing shape rather than rebuilding it, because the value is in its four hard parts, all found the expensive way: track the message **ids** in the store (an array — content outgrows one embed sooner than you think); **delete the surplus** when the content shrinks; **re-post** when a fetch fails, since a human deleting the bot's message must not lose the data (the store holds the truth, the message is only a rendering); and **clean up the old channel** on a move, or the guild ends up with two copies disagreeing. Add a per-guild promise lock so two commands landing together cannot race into duplicates. S97 built the whole rules publisher in minutes because S64 had already paid for these.

**A public message with components must decide what a NON-originator's press does.** Every component feature hits this: the message sits in a channel, so anyone can click. There are exactly three honest answers, and the right one follows from whether the content is per-viewer. **Update in place** — correct when the message is the presser's own (the help asker swapping category). **Answer privately** (`flags: 64` — a component interaction can still be ephemeral, unlike a `!command` reply since S54/S68) — correct when the content differs per viewer: editing the shared message would rewrite what the originator is reading, and showing a stranger the originator's view can leak what that member is allowed to see (S98, help). **Refuse visibly** — correct when the action is privileged (S95 gave the patrol wizard a Manage Server re-check, because falling through to "your draft expired" told a non-admin nothing true). Never let a stranger's press silently mutate someone else's message.

**Pure logic goes in `lib/`.** Anything with rules worth testing (duration parsing, rap-sheet formatting, rank math) lives in `src/modules/<name>/lib/*.js` with **no discord.js imports**, so `test/` can exercise it without a token or network. Command files stay thin: parse options → call lib → reply.

## Police theme vocabulary

CuffBot's personality is a professional-but-playful police department. Use this vocabulary consistently in command names, replies, and manuals — a themed feature with an off-theme name is a bug:

| Discord concept | CuffBot term |
|---|---|
| the server | the precinct |
| moderation team | the force |
| bot online/latency check | `/radio-check` |
| user info card | `/badge` |
| warn | citation (`/cite`) |
| timeout | detain in the holding cell (`/detain`, `/release`) |
| ban / unban | arrest (`/arrest`) / release (`/release`) |
| infraction history | rap sheet (`/rapsheet`) |
| mod-log channel | evidence locker |
| announcements | dispatch (`/dispatch`) |
| report to mods | `/911` |
| automod | patrol |
| role ladder | ranks: Cadet → Officer → Detective → Sergeant → Lieutenant → Captain → Chief |
| fun/community features | public affairs (e.g. `/wanted` poster, `/donut`) |

Replies are short, in-character, and always in English. Emoji sparingly (🚔 📻 🚨 📋). Never let the theme obscure what actually happened — "🚨 Arrested @user (banned, reason: …)" keeps both.

## Conventions

- **Errors:** a crashing command answers an in-theme apology ("📻 Dispatch, we have a malfunction…") while the real error is logged — the group framework does this for `run()`, the legacy executor wrapper for `execute()`. Commands still handle *expected* failures themselves (missing permissions, target not found) with specific messages.
- **Permissions:** groups declare `permission` (a `PermissionFlagsBits` flag) on the group and/or per subcommand — the framework refuses before `run()`. Legacy commands set `setDefaultMemberPermissions` *and* re-check at execute time (`interaction.memberPermissions`). Either way, check the bot's own ability too (`member.moderatable` / `.bannable`) before acting, and reply honestly when the hierarchy blocks an action. Replies never ping (S54): text replies are no-ping in-channel replies; group `ctx.reply` does this automatically.
- **Config:** secrets (`DISCORD_TOKEN`, `CLIENT_ID`) come from `.env`; non-secret product settings come from committed `config.json` — most importantly `homeGuildId`. `config.js` validates on boot and fails fast with a clear message listing what is missing. Never log the token; never commit `.env`; keep `.env.example` in sync.
- **Single-guild by design (owner decision, S1):** CuffBot serves exactly one precinct — `config.json → homeGuildId` (currently `411157175948541954`). The `core` module enforces jurisdiction: leave foreign guilds on join and sweep them at boot. New modules may assume home-precinct context; per-guild data structures still key by guild id so a future multi-guild pivot stays cheap.
- **Owner decisions become committed defaults (promoted S35):** when the owner names a concrete id or value in chat (a channel, a role, a timezone, an interval), commit it as the module's **code default** with a comment naming the session — never leave it as "configure after deploy". The feature then works the moment the Pi self-updates, with zero setup, and `/…-config` store overrides still win because config storage is sparse (store only what an admin explicitly set; defaults stay live in code, so improving a default later reaches every guild that never overrode it). Confirmed five times: memorial feeds (S21), chat-starter channel (S30), birthday channel (S31), welcome lobby (S34), logbook channels (S35).
- **Storage (implemented S8):** modules read/write through `src/core/store.js`: `getGuildData` / `setGuildData` / `updateGuildData` (read-modify-write for compound state), JSON files under `data/<guildId>.json`, atomic write (temp file + rename), corrupt files moved aside as `*.corrupt-<ts>` and started fresh. `CUFFBOT_DATA_DIR` overrides the directory (tests use this — never let tests write the repo's `data/`).
- **Cross-module calls (decided S8):** when module A needs module B's functionality, call **B's `lib/` API directly** (plain import) — never B's commands or manifest. The caller wraps the call in try/catch so a broken/missing auxiliary module degrades the reply (e.g. no case number) instead of blocking the primary action. Document the seam in both manuals. (Chosen over an event bus: explicit, greppable, and testable; revisit only if module count makes the import graph painful.)
- **Style:** small files, one export per command file, `camelCase` functions, `kebab-case` command names and filenames, JSDoc on lib functions. Comments explain *constraints*, not narration.

## Verification habits for bot code

You cannot click around a live Discord server from this environment, so build confidence in layers — and say in the session log which layers you reached:

1. `node --check` every file you wrote (catches syntax errors instantly).
2. `npm test` — lib logic fully covered.
   **Never use top-level `await` in a test file** (e.g. `await import(...)` between `test()` registrations): the Pi's older node:test runner executes tests registered after an await interleaved/twice via `processPendingSubtests` — a test's first assertion can see its own later writes. It passes on newer Node, so only the Pi's update gate catches it (S78). Import statically at the top of the file.
3. Boot smoke test without a token: importing the loader and asserting modules/commands resolve must not require logging in (`node scripts/smoke.js` once it exists).
4. Live test — only the owner can do this. Write down in the module manual's *Testing* section exactly what they should click and expect.

**Verify the check before you believe its result.** A failing check is a claim about your code, and it is wrong often enough to test first — especially when the code has independent evidence behind it. Three instances in eight sessions: S100's fixtures asserted the wrong board (a red test describing a bug that did not exist); S106's extraction regex matched nothing and "nothing" looked like a legitimate empty value (a silent green); S107's clean-checkout simulation ran `git init` instead of `git clone`, so a test asserting "every data file is git-tracked" failed for a reason that cannot happen on the Pi, and a behaviour assertion truncated its input to 160 characters before matching. The two halves: **when a check disagrees with well-evidenced code, suspect the check first**, and **when a check passes, confirm it could have failed** — a simulation that does not reproduce the real environment produces confident nonsense in both directions.

**A check that derives its expected value from the thing under test cannot fail.** This is the sharpest form of the rule above, and it does not look like a mistake while you are making it — the check reads like verification, runs, and prints a green. But reading a value back off the object you are checking, re-deriving an expectation from the same function, or round-tripping a value through its own serializer all compare a thing with itself. S111 committed four owner-given channel ids as an object literal with **unquoted** 18-digit keys; JavaScript's `Number` cannot hold `411633952961593345`, so it silently became `411633952961593340` and the lookup would never have matched a real channel. The verification iterated `Object.entries()` and looked each key back up — reading the already-rounded key and finding it, every time. **Restate the truth independently**: from the owner's message, from a fixture, from a literal typed out a second time. The test that finally caught it spells all four ids out again as string literals, which is the only form that *can* disagree. (A related habit for the specific trap: **Discord snowflakes are strings, always** — an unquoted one is a rounded one, and nothing anywhere throws.)

**A sweep only inspects what it is CHANGING, so anything already in the target shape is invisible to it.** This is the blind spot that survives even a careful mechanical refactor, because nothing about it looks like a mistake: the sweep did its job on every file it opened. S106 added `invokeWithoutSubcommand` while folding flat commands into groups — but seven game modules were already groups (S72–S83), so the sweep never opened them, and `!hangman`, `!wordle`, `!memory`, `!rollout`, `!russianroulette`, `!splitorsteal` and `!guessthecandy` all answered with a menu where their source cogs start a game. The owner found it by playing (*"hangman werkt niet zoals het hoort"*); S115 found the same shape for panel-driven ports. **After a sweep, enumerate every member of the target CATEGORY and check each one — not just the items the sweep edited — and write the enumeration as a test.** Doing that in S117 immediately turned up an eighth defect nobody had reported (bare `!dispatch` answering with a usage error), which is the whole argument for a test over a one-off audit.

**And say what your method actually checked.** S115's audit compared `discord.ui` reference counts and labelled hangman *faithful*; the evidence only supported *same interaction model*. A verdict that claims more than the measurement closes a question that is still open.

**Refactoring mechanically? Audit the result field-by-field against the pre-change source.** A script that rewrites code fails *silently*: a regex that does not match extracts nothing, and "nothing" is usually indistinguishable from a legitimate empty value. S106 folded 19 commands into groups with a helper whose `args:` pattern did not allow a trailing comment — four modules lost their arg specs, `args: []` looked entirely normal, and the bug reached the test suite rather than the diff (`!dispatch locker set` stored nothing; `!donuts @member` ignored the mention). The defence is cheap and mandatory: after the script runs, read every original back out with `git show HEAD:<path>` and compare each extracted field. Do it even when the tests pass — S106's repair pass then over-matched and gave three subcommands their *neighbour's* args, which only the same audit caught. Never trust a rewrite you verified by reading its output.

**Emitting a binary format? Verify it against a FOREIGN implementation, not just your own reader.** A test written by whoever wrote the encoder proves self-consistency and nothing else — and the dangerous failures here are the ones that pass every structural check. S102's Ogg muxer is the sharp case: Ogg's CRC is its own variant (poly `0x04c11db7`, init 0, no reflection, no final xor), and the plausible wrong answer — zlib's CRC-32 — produces bytes that look perfect to our own parser and are rejected by every real decoder, with no error anywhere in our stack. The fix was to run the output through **mutagen**, an unrelated Ogg implementation installed in the container purely to disagree: re-serialising its parse produced byte-identical pages (proving the CRC), and its duration matched to the millisecond (proving the granule and pre-skip). Do this once, in the session that writes the encoder, and record the result — then the committed suite can use its own reader, written **independently of the writer** so two mirrors of one mistake cannot agree with each other. The same applies before adopting a library helper: check the *installed* version has it. S102 planned to use prism-media's `OggLogicalBitstream` and found `@discordjs/voice` bundles prism-media 1.3.5, where it does not exist.

**Hand-written state fixtures are guesses until the code confirms them.** When a test pins behavior against a *constructed* state — a board, a queue, a stored config — two things go wrong that a normal assertion cannot catch, because a wrong fixture fails loudly for the wrong reason or (worse) passes for one. First, **the state may be unreachable**: S100's tie board had its one gap at the bottom of a column, which Connect 4 can never produce (pieces fall) and which `legalMoves` correctly reported as *full* — the test was asking about a position the game cannot enter. Second, **the expected answer may not be the only one**: the "diagonal win-in-one" fixture turned out to have *two* winning columns, so any hand-written single answer was arbitrary. The fix is the same both times — **have the test compute the answer from the code under test** (`winningColumns(board, disc)` and assert membership) and **build the fixture the way the system builds state** (or assert it is legal before using it). Verify a suspect fixture with a throwaway node one-liner before trusting a red test's story about what is broken; twice in S100 the fixture was wrong and the implementation was right.
