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

**The legacy shape (pre-S69, being migrated in M17):** `{ data, execute }` — `data` a `SlashCommandBuilder` (kept as the option/permission schema for the text adapter), `execute(interaction)` receives an adapter-built interaction from the parsed `!command` line. Don't write new commands this way; convert to a group when touching one materially.

The loader (`src/core/loader.js`) imports every `src/modules/*/index.js`, registers both shapes in a `Collection` keyed by command/group name (validating group shape at boot), and wires event listeners. Keep discovery logic in the loader only — modules never self-register.

**Timed multiplayer games use the io-injected engine** (proven S73/S79/S81): the whole match lives in `runGame(game, io)` where `io` = `{ say/askX/sleep/… }` — production wires `channel.send` plus a promise bridge the button pump resolves; tests script entire matches with seeded randomness and zero real waiting. Timers in these engines are `unref()`'d (never block shutdown) — consequence for tests: **a test that genuinely awaits an unref'd timer needs an explicit event-loop keep-alive** (`setInterval` in a try/finally), or node:test cancels the whole file with "Promise resolution is still pending" (bit S73 and S81).

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
