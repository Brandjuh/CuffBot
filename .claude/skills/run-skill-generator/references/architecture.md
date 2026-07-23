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
│   ├── deploy-commands.js    # registers slash commands (guild-scoped in dev)
│   ├── core/
│   │   ├── config.js         # reads .env + config.json, validates, exports config
│   │   ├── logger.js         # leveled console logger (single place to change later)
│   │   └── loader.js         # discovers modules, collects commands/events, wires client
│   └── modules/
│       └── <module-name>/
│           ├── index.js      # module manifest: { name, description, commands, events }
│           ├── commands/     # one file per slash command
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
  commands: [cite, arrest], // slash command objects (see below)
  events: [],               // { name, once?, execute } listeners
};
```

A command file exports `{ data, execute }` — `data` is a `SlashCommandBuilder`, `execute` receives the interaction:

```js
// src/modules/core/commands/radio-check.js
import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('radio-check')
    .setDescription('Check that CuffBot is on the air (latency check).'),
  async execute(interaction) {
    const sent = await interaction.reply({ content: '📻 Radio check…', withResponse: true });
    const latency = sent.resource.message.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply(`📻 Loud and clear. Round-trip: ${latency} ms.`);
  },
};
```

The loader (`src/core/loader.js`) imports every `src/modules/*/index.js`, registers commands in a `Collection` keyed by command name, wires event listeners onto the client, and warns on duplicate command names. `deploy-commands.js` reuses the same discovery to push `data.toJSON()` to the API. Keep discovery logic in the loader only — modules never self-register.

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

- **Errors:** every `execute` is wrapped by the loader in a try/catch that logs via `logger` and answers the user with an ephemeral in-theme apology ("📻 Dispatch, we have a malfunction…"). Commands still handle *expected* failures themselves (missing permissions, target not found) with specific messages.
- **Permissions:** set `setDefaultMemberPermissions` on moderation commands *and* re-check at execute time (`interaction.memberPermissions`) — UI defaults can be overridden by server admins. Check the bot's own ability too (`member.moderatable` / `.bannable`) before acting, and reply honestly when the hierarchy blocks an action.
- **Config:** secrets (`DISCORD_TOKEN`, `CLIENT_ID`) come from `.env`; non-secret product settings come from committed `config.json` — most importantly `homeGuildId`. `config.js` validates on boot and fails fast with a clear message listing what is missing. Never log the token; never commit `.env`; keep `.env.example` in sync.
- **Single-guild by design (owner decision, S1):** CuffBot serves exactly one precinct — `config.json → homeGuildId` (currently `411157175948541954`). Slash commands register guild-scoped there only (instant, no global registration), and the `core` module enforces jurisdiction: leave foreign guilds on join and sweep them at boot. New modules may assume home-precinct context; per-guild data structures still key by guild id so a future multi-guild pivot stays cheap.
- **Storage (implemented S8):** modules read/write through `src/core/store.js`: `getGuildData` / `setGuildData` / `updateGuildData` (read-modify-write for compound state), JSON files under `data/<guildId>.json`, atomic write (temp file + rename), corrupt files moved aside as `*.corrupt-<ts>` and started fresh. `CUFFBOT_DATA_DIR` overrides the directory (tests use this — never let tests write the repo's `data/`).
- **Cross-module calls (decided S8):** when module A needs module B's functionality, call **B's `lib/` API directly** (plain import) — never B's commands or manifest. The caller wraps the call in try/catch so a broken/missing auxiliary module degrades the reply (e.g. no case number) instead of blocking the primary action. Document the seam in both manuals. (Chosen over an event bus: explicit, greppable, and testable; revisit only if module count makes the import graph painful.)
- **Style:** small files, one export per command file, `camelCase` functions, `kebab-case` command names and filenames, JSDoc on lib functions. Comments explain *constraints*, not narration.

## Verification habits for bot code

You cannot click around a live Discord server from this environment, so build confidence in layers — and say in the session log which layers you reached:

1. `node --check` every file you wrote (catches syntax errors instantly).
2. `npm test` — lib logic fully covered.
3. Boot smoke test without a token: importing the loader and asserting modules/commands resolve must not require logging in (`node scripts/smoke.js` once it exists).
4. Live test — only the owner can do this. Write down in the module manual's *Testing* section exactly what they should click and expect.
