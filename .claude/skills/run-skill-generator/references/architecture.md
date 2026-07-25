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
│   │   └── prefix/           # !command parsing, group dispatch (group.js), legacy adapter
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

**The legacy shape (pre-S69, being migrated in M17.3):** `{ data, execute }` — `data` a `SlashCommandBuilder` (kept as the option/permission schema for the text adapter), `execute(interaction)` receives an adapter-built interaction from the parsed `!command` line. Don't write new commands this way; convert when touching one materially — to a **group** if it belongs to a family, otherwise to the **flat shape**.

The loader (`src/core/loader.js`) imports every `src/modules/*/index.js`, registers all three shapes in a `Collection` keyed by command/group name (validating group and flat shape at boot), and wires event listeners. Keep discovery logic in the loader only — modules never self-register.

**Converting a command surface? First grep for how it is ADVERTISED, and make that string work.** A conversion is the one moment the promise and the parser are read side by side, so it is where the check belongs — search the manuals, `STATE.md`, and `src/` (the bot's own replies tell members what to type). S94: `!rank-setup header:@[LEVELER]` appears in four manuals, in STATE's owner-action list and in three command replies, and had been the owner's #1 pending action since S12 — while never working at all, because the text path was purely positional and answered "`header` should be a mention or id". S68 made the bot text-only and nobody re-checked the syntax the docs kept promising; 26 sessions passed. Fix such a gap **generally** (S94 added `name:value` keyword args to the framework) rather than per command, and prefer making the documented string work over rewriting the docs to match the code — the docs are what the owner has already been told.

**Grep for surface tests too — a feature gated on "which surface am I?" is a time bomb.** `interaction.isTextCommand`, `isChatInputCommand()`, "slash only for now" branches: a platform decision flips every one of them at once, and the feature behind the gate dies silently. S95 found `!patrol-wizard` gated on `isTextCommand` with a "being rebuilt for text-only mode" notice — S68 made *every* invocation a text command, so the wizard died that session and stayed dead for eleven more, invisible because a command that always answers with a polite notice looks alive, and its only test asserted exactly that notice. Re-decide each such branch during a conversion (the wizard needed no slash command at all: components attach to a *message*), and give any deliberately-disabled branch a test asserting the **disabled** behavior, so that deleting it shows up as a changed test rather than as nothing.

**Converting a command surface? Convert its tests to the real dispatch path, not just its code.** The old tests hand-built an interaction and called `execute(it)` — which meant the arg parsing and the permission gate were *simulated by the test*, so neither was ever actually covered. Rewriting them onto `dispatchCommand`/`dispatchGroup` with a fake **message** (`test/fixtures/fake-message.js`) makes the framework part of what each test proves; it is what caught that every refusal named "Manage Server" no matter the gate (S93). Two consequences worth expecting: entity args need real 15–21 digit snowflakes, because the resolver applies Discord's own id rule; and a conversion regularly turns up commands with no test at all (`!xp-ladder`, `!hunt-stats`, `!hunt-board` in S93) — write those before moving on, they are the reason the slice found anything.

**Timed multiplayer games use the io-injected engine** (proven S73/S79/S81): the whole match lives in `runGame(game, io)` where `io` = `{ say/askX/sleep/… }` — production wires `channel.send` plus a promise bridge the button pump resolves; tests script entire matches with seeded randomness and zero real waiting. Timers in these engines are `unref()`'d (never block shutdown) — consequence for tests: **a test that genuinely awaits an unref'd timer needs an explicit event-loop keep-alive** (`setInterval` in a try/finally), or node:test cancels the whole file with "Promise resolution is still pending" (bit S73 and S81).

**Porting from another runtime? Transcribe the SEMANTICS, and pin them in tests before wiring.** The ported unit is the source language's observable behavior, not its API — and that includes arithmetic artifacts. Python `int()` truncates toward zero *after* the whole float expression, so `int(max_prize / 3 * 2)` is 3333 where `floor(x/3)*2` is 3332 (S82), and `int(1000 * (1 - 0.07))` is **929**, not 930, because `1 - 0.07` is `0.9299999999999999` (S85). Use `Math.trunc` for `int()`, keep the operation order, and pin the asymmetric cases — the values where a "cleaner" rewrite would differ — in tests. The same rule covers library replacements: when dateutil/pytz became hand-rolled Intl code (S84), what carried over was *weekday = next occurrence including today*, *fuzzy = skip unknown tokens*, and *aware-datetime + timedelta = wall-clock* (a day across spring-forward is 23 real hours) — each written as a test first. For a large port, get the source's data tables out **mechanically**, never by retyping. Two grades: dump them and commit the dump as a fixture to diff a hand transcription against (S85), or — better when the data is inert — **ship the dump itself as the module's data file** (S89/S91: 96 crime events, 46 scenarios and 14 prison-break scripts, loaded straight from JSON), so there is no transcription to drift and the tests assert shape rather than values. If the source stores values as named constants, resolve the names during the dump (a ten-line AST walk) rather than giving up and typing them out.

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
