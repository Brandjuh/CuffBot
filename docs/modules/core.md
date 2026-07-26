# Core — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 96 · 2026-07-25

## Purpose

Core is the precinct's front desk: it proves the bot is alive (`!radiocheck`) and enforces CuffBot's single-precinct design — the bot serves exactly one guild (the *home precinct*, set in `config.json`) and automatically leaves any other server it is invited to. Every other module builds on the loader/config/logger plumbing this module exercises.

## Text invocation: `!command` and `!group sub`

**S68 (owner mandate): CuffBot is TEXT-ONLY.** Every command is a text command (`!radiocheck`) handled centrally by `src/core/prefix/` — slash commands are gone (the deploy script now clears the guild's application-command roster, and the doctor treats any registered slash command as stale). Message components (buttons/selects/modals) remain — they are not slash commands. NOTE: **as of S96 every manual has been swept** — M17.3 converted all 45 remaining commands and corrected each module's manual on the way. If you still find a `/command` example anywhere, it is a bug.

- The prefix is `config.json → prefix` (default `!`).
- Text arguments are positional and the last text option is greedy: `!detain @user 2h being a repeat offender` maps to `target`, `duration`, then `reason`.
- **A `!command` never answers by DM (S54, owner mandate).** Every reply lands **in the channel**, as a reply to the invoking message that pings nobody (`allowedMentions: { repliedUser: false }`). Deliberate moderation DMs (citation copy to the offender, patrol removal notice) are separate features and unaffected. Consequence: formerly-ephemeral output (rap sheets, admin config views) is visible in the channel.
- **Text commands need the Message Content intent** (privileged). Without it the bot boots but can read no messages, so **ALL commands are off** — a startup warning and `npm run doctor` both name the fix (Bot → Privileged Gateway Intents → Message Content Intent). See Troubleshooting.

### Group commands (S69, Red-style — the M17 target structure)

New and converted commands use the group structure of the Red-DiscordBot cogs the owner pointed at: one `!group` command with subcommands, instead of one command with many optional options.

- `!group` (bare) → a status + subcommand overview embed. `!group unknownsub` → the same overview with an "unknown subcommand" footer.
- `!group sub <args>` → runs exactly one subcommand. Subcommand names match case-insensitively; aliases are supported (`!youtube follow` = `!youtube add`).
- A group command file exports `{ group: { name, aliases?, description, emoji?, permission?, status(ctx)?, subcommands[] } }`. Each subcommand is `{ name, aliases?, description, permission?, args: [{ name, type, required?, greedy?, choices? }], run(ctx, values) }`.
- **Group-level `aliases` (S70)** register extra command names for the same group — retired names keep working (`!memorial-config` still reaches `!memorial`); `!help` lists only the primary name.
- **Group `fallback` (S71):** a group may name one sub as its fallback — when the first token matches no subcommand, that sub receives the WHOLE token list, so game invocations read naturally (`!connect4 @user` = `!connect4 play @user`). Named subs always win; bare `!group` stays the overview. The loader boot-fails when `fallback` names a nonexistent sub.
- Arg types: `string`, `integer`, `number`, `boolean` (accepts true/yes/on/ja/1 and false/no/off/nee/0), `user`, `role`, `channel` (mention or raw id; cache first, API fetch fallback). The last `string` arg may be `greedy` and absorbs the rest of the line. `choices` validate case-insensitively. A `channel` arg with **`postable: true` (S70)** additionally refuses anything that is not a text or announcement channel — the S55 post-target rule, enforced in one place.
- `permission` (a `PermissionFlagsBits` flag) on the group gates everything including the overview; on a subcommand it overrides the group's gate for that sub. Refusals, arg errors (with a usage line), and crashes (the standard 📻 malfunction apology) are all handled by the framework — `run()` only implements the happy path.
- `ctx` = `{ message, client, guild, channel, member, user, prefix, reply() }`; `reply()` is the S54 no-ping in-channel reply and falls back to `channel.send` when the invoking message was deleted. Because its `allowedMentions` names no `parse` list, role/user mentions in confirmations render but never ping.
- The reference conversion is `src/modules/youtube/commands/youtube.js`. M17.2 and M17.3 converted every other command; M17 is complete as of S96.

### Flat commands (S93, M17.3 — for single-purpose commands)

A group models a *family* (`!youtube channel`, `!youtube add`, …). Most commands are not families: `!badge`, `!daily`, `!rapsheet` do exactly one thing, and turning them into groups would rename what the precinct types every day. They use the **flat shape** instead, which shares everything the group framework already does:

```js
export default {
  command: {
    name: 'rapsheet', aliases: [], description: '…', emoji: '📋',
    permission: PermissionFlagsBits.ModerateMembers,   // optional; omit = open to all
    args: [{ name: 'target', type: 'user', required: true }],
    async run(ctx, { target }) { await ctx.reply('…'); },
  },
};
```

- Same `ctx`, same arg types, same permission gate, same 📻 malfunction apology as a group subcommand — `run()` is happy-path only. `dispatchCommand` returns `'ran' | 'refused' | 'usage-error' | 'crashed'`.
- **There are exactly TWO command shapes (S96, M17.3 complete).** The router picks per command: `{ group }` → group dispatch, `{ command }` → flat dispatch. The third path — an adapter that rebuilt an interaction out of a message so pre-S69 `execute(interaction)` commands could run — was deleted with the last command that needed it, along with `assignOptions`, the `runCommand` wrapper and `ensureInvokerPermission`.
- **Arg bounds (S93):** `min` / `max` on `integer`/`number` and `maxLength` on `string` replace the slash builders' `setMinValue`/`setMaxValue`/`setMaxLength`, so a converted command still refuses out-of-range input — with the range stated in the refusal.
- **Trailing args after a greedy one (S93):** specs declared *after* the greedy arg are claimed from the END of the line, so `!911 @member they keep shouting yes` fills `target`, `reason` and the trailing `anonymous` flag. An **optional** trailing arg only claims its token when the value fits the type, so a reason ending in an ordinary word stays whole. This replaces the per-command `textGreedyArg` hint the adapter needed. A plain **string** never qualifies (unless it declares `choices`) — every word "fits" one, so an optional trailing string would steal the reason's last word; reach those by keyword instead.
- **Keyword args, `name:value` (S94):** any token whose part before the first colon names a declared arg binds that arg, and takes every token up to the next keyword — so `!cite @x loud music penalty:FINAL WARNING` works even though only one arg can be greedy. Order is free, validation still applies, and a colon in ordinary text (`https://…`, `10:30`) is untouched because it does not name an arg. This is how the bot has been *telling* people to type since S12 — `!ranks setup header:@[LEVELER]`, `!dispatch locker action:set`, in the manuals, in STATE's owner-action list and in `!ranks` / `!level` / `!911` replies — while the text path only accepted positional args and answered "`header` should be a mention or id". Both forms work now.
- **`ctx.typing()` replaces `deferReply()` (S93):** a message command has no 3-second interaction deadline, so a slow command (avatar fetch, AI call) shows the typing indicator and answers once, instead of posting a "🚔 Working…" placeholder and editing it.
- **Permission refusals name the right permission (S93):** before this, every refusal said "You need **Manage Server**" regardless of the actual gate — wrong for `!maintenance` (Administrator), `!russianroulette force` (Manage Messages) and `!hammertime role` (Manage Roles). The label map lives in `src/core/prefix/permissions.js`; an unmapped flag degrades to "elevated permissions".

## Commands

> **`!help` is a group** (S109). Bare `!help` still opens your own category menu, unchanged. `!help panel [#channel]` posts a **permanent panel** anyone can press — the menu without typing anything — and `!help unpanel` takes it down. Both are Manage Server.
>
> **A panel lists every category and answers every press privately.** It has no single viewer, so filtering it would hide categories from the whole precinct forever; instead each press replies with *that* member's own filtered roster. The panel advertises categories, the private reply advertises commands — nothing leaks either way. This is the S98 non-originator rule with the originator removed: with nobody to update in place, the private path is the only correct one, and editing a pinned panel would rewrite it for everybody.
>
> The panel is a **published post** (selfroles S59/S64, rules S97): tracked message id, edited in place on a refresh, re-posted if somebody deletes it, and the old copy removed when it moves channel.


| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `!radiocheck` | Confirms the bot is on the air and reports round-trip latency | none | Everyone | `!radiocheck` |
| `!help` | Shows every command the viewer can use, grouped by category | none | Everyone | `!help` |
| `!update` | Updates the bot from GitHub with live status in Discord; restarts only when the tests pass | none | Administrators / guild owner | `!update` |
| `!restart` | Restarts the bot to reload `.env`/configuration, reports back when on duty | none | Administrators / guild owner | `!restart` |
| `!maintenance` | Maintenance mode: only the **bot owner** can run commands; everyone else gets an English notice (S74/S75) | `on` / `off` / `message <text…>` / `nomessage` | **Bot owner only** (admin-visible) | `!maintenance on` |

### /radio-check

- **Options:** none.
- **What happens:** the bot replies immediately with "📻 Radio check…", measures the round-trip time between your invocation and its own reply message, then edits the reply with a verdict.
- **Reply:** visible to the channel (not ephemeral). Verdict bands: under 150 ms "Loud and clear", under 400 ms "Reading you with a bit of static", otherwise "Signal is rough out there" — always with the measured milliseconds.
- **Failure modes:** none specific. If the bot does not respond at all, it is offline or commands were never registered — see Troubleshooting.

### !help

- **Args:** none.
- **What happens:** generates the command roster from the modules that are actually loaded (never a hand-maintained list) and posts **one message with a button per category** (S98, owner request). The landing view names each category with a count, so the buttons explain themselves; pressing one swaps the embed to that category's commands, and the open category's button is disabled — that is how the menu shows where you are without spending a line of text on it. A `↩ All categories` button goes back.
- **This replaced the paged form (S39 → S98).** The roster does not fit one embed — Discord caps an embed at **6000 characters in total** — so `!help` used to post several embeds back to back. One message with buttons is the same information without the wall.
- **Categorized & viewer-filtered (S43):** commands are grouped by PURPOSE — 🛡️ Moderation, 🎮 Games & Economy, 🎉 Fun, 📈 Ranks & XP, 🎂 Community, 📻 Info, ⚙️ Setup & Admin — not by module, one clear line per command. The menu only lists what the viewer can actually use: commands declaring permissions the member lacks are hidden, as are the runtime-gated admin commands (`!update`, `!restart`, whose gate lives inside `run()`). **The filter also decides which BUTTONS you are offered**, so the menu never advertises a category you would find empty. The category map lives in `core/help.js` (`COMMAND_CATEGORIES`); a loader-walking test fails the build when a new command is left uncategorized.
- **Anyone may press (S98).** A help message is public, and the roster is per-viewer, so the pump distinguishes two cases: the person who asked gets the message **updated in place** (it is their menu), and anyone else gets **their own filtered view, privately**, with buttons keyed to them so they can keep browsing. Editing the shared message for a stranger would rewrite what the asker is reading; showing them the asker's roster would leak which commands that member can use. A component interaction can still be ephemeral — only `!command` replies lost that (S54/S68) — so the private answer is genuinely private.

### /update

- **Options:** none. **Who:** Administrators or the guild owner only (checked at runtime, not just by the command's default visibility).
- **What happens:** triggers the same test-gated self-updater the timer uses (`scripts/update.sh`: fetch → tests must pass → deploy-commands → restart), so a manual update is exactly as safe as an automatic one — a red suite rolls back and the running bot is untouched. Prefers the `cuffbot-update` systemd unit (runs outside the bot's own lifecycle); falls back to a detached script run.
- **Live status in Discord (S25):** the reply updates as the update progresses — `✅ Already up to date` when nothing is new; `🔄 New version fetched (old → new), tests running…` when something arrived; `🚨 FAILED its tests and was rolled back` when the gate refused it. When the update succeeds, the restart kills the bot mid-command — the order is remembered in the store, and right after boot the bot posts **"✅ Update complete: `old` → `new` — back on duty"** in the channel where `/update` was typed, pinging the admin who ordered it (core's `update-report` boot event; stale orders >30 min are dropped silently).
- **Reliability:** wants the systemd update unit + the scoped sudoers drop-in that `setup-pi.sh` step 8 installs. Without them it still attempts a detached run. One update order at a time — a second `/update` while one runs is refused.

### /restart

- **Permission:** administrators / guild owner (runtime-checked, like `/update`).
- **What happens (S28):** for when the owner edits `.env` (API keys, overrides) — the process must restart to re-read it. Replies "Restarting to reload the configuration", stores the order, then runs `sudo -n systemctl restart cuffbot` (the exact command the sudoers drop-in allows). After boot, the `update-report` event posts **"🔄 Restart complete — configuration reloaded, back on duty"** in the same channel, pinging the requester.
- **Fallback without sudoers:** the process exits with a failure code — the unit runs `Restart=on-failure` with `RestartSec=5`, so systemd revives it within seconds either way.
- **Failure modes:** non-admin → ephemeral refusal, nothing happens. Note `!restart` (text) requires the Message Content intent like every `!command`.

### !maintenance (S74, owner request; S75 correction: BOT owner, not guild owner)

One switch that closes the command desk: with maintenance ON, every `!command` from anyone but the **bot owner** — the owner of the Discord APPLICATION, resolved structurally via `client.application.owner` (for a team-owned app every team member counts; never a raw id) — answers the notice instead of running. The guild owner gets the notice like everyone else. The gate sits in the prefix router BEFORE both dispatch paths (groups and flat commands), so no command slips through; unknown `!words` stay silent (no notice spam). Only commands are gated — events, sweeps, and running games/buttons continue.

- `!maintenance on` / `off` — the switch. **Bot-owner-only at runtime** (anyone else who could enable it would lock themselves out, since only the bot owner is exempt — the gate matches the exemption exactly). The group is Administrator-gated for visibility, so regular members never see it in `!help`.
- `!maintenance message <text…>` — a custom notice (greedy, clamped 500); `nomessage` restores the default: *"🚧 CuffBot is under maintenance. Only the bot owner can use commands right now — back on duty soon."*
- **The bot's STATUS says which mode it is in (S98 = M22, owner request),** so nobody has to run a command to find out:

  | Mode | Presence |
  |---|---|
  | Normal duty | 🟢 Online · *Watching the precinct 🚔* |
  | Maintenance | ⛔ Do Not Disturb · *🔧 Maintenance — bot owner only* |

  The status is set on every `on`/`off` **and at boot** — read from **storage**, not from a variable, so a bot that restarts while in maintenance still looks like it. Maintenance is stored per guild but a presence is per BOT and global; CuffBot serves exactly one precinct by design (S1), so the home guild's state is the whole truth. Setting a presence is cosmetic and never throws: a gateway hiccup logs a warning and leaves the toggle itself successful.
- Config: `maintenanceConfig` `{ enabled: false, message: null }` in the guild store (`src/core/maintenance.js`). The owner lookup runs only while maintenance is ON (one application fetch, cached on success, retried on failure — a transient API error can never permanently lock the owner out).

## Events

| Event | Handler | What it does |
|---|---|---|
| `ClientReady` (once) | `events/on-duty.js` | Logs "🚔 CuffBot on duty", leaves every guild that is not the home precinct (covers invites received while offline), and warns if the bot is not in the home precinct yet. |
| `GuildCreate` | `events/guild-lockdown.js` | If the bot is added to any guild other than the home precinct while running, it logs the event and leaves immediately. |

## Configuration

| Setting | Where | Required | Meaning |
|---|---|---|---|
| `DISCORD_TOKEN` | `.env` | yes | Bot token from the Developer Portal. Secret — never committed. |
| `CLIENT_ID` | `.env` | yes | Application id from the Developer Portal. |
| `homeGuildId` | `config.json` | yes | The one guild CuffBot serves (currently `411157175948541954`). Non-secret product setting, committed on purpose. |
| `LOG_LEVEL` | environment (optional) | no | `debug`, `info` (default), `warn`, or `error`. |

Boot fails fast with a named-variable error message when required settings are missing or malformed.

## Permissions & safety

- **Bot permissions needed:** none beyond being in the guild — `/radio-check` replies in-channel via the interaction, which needs no channel permissions. The invite link in the README requests *Send Messages* as a sane baseline for future modules.
- **Default member permissions:** `/radio-check` is available to everyone by design (it is diagnostic and harmless).
- **Safety rails:** the guild lockdown (see Events) is the module's main rail: the bot cannot silently spread to servers the owner never intended. Leaving a guild is not destructive — the bot can always be re-invited.
- **Intents:** only `Guilds` (no privileged intents). Member/message-content intents are deliberately postponed until a module needs them.

## How it works

1. `src/index.js` loads config (fail-fast), creates the client with the `Guilds` intent, exposes config as `client.config`, and asks the loader to wire everything.
2. `src/core/loader.js` scans `src/modules/*/index.js`, validates each manifest (`{ name, description, commands[], events[] }`), registers commands into a `Collection`, and attaches event handlers with an error-logging wrapper. Duplicate command names fail the boot on purpose.
3. The prefix router (`src/core/prefix/router.js`) parses each message once, then hands it to one of two dispatchers: `src/core/prefix/group.js` for a group, `src/core/prefix/command.js` for a flat command. Each owns its own permission refusals, arg errors and in-theme crash apology, so `run()` only ever describes the happy path.
4. Pure logic lives in `lib/` (`precinct.js` jurisdiction check, `radio.js` latency verdicts) with no discord.js imports, so tests run without a token.
5. `src/deploy-commands.js` now **clears** the guild's application-command roster (S68) — text-only means zero registered slash commands, and `npm run doctor` flags any that reappear as stale.

## Files

| Path | Role |
|---|---|
| `src/modules/core/index.js` | Manifest |
| `src/modules/core/commands/radio-check.js` | `/radio-check` command |
| `src/modules/core/commands/help.js` | `/help` — generated command roster |
| `src/modules/core/commands/update.js` | `/update` — manual self-update (admin-only) |
| `src/modules/core/events/on-duty.js` | Ready log + offline-invite sweep |
| `src/modules/core/events/guild-lockdown.js` | Live jurisdiction enforcement |
| `src/core/prefix/{parse,router}.js` | Text (`!command`) line splitting, MessageCreate router |
| `src/core/prefix/{group,command}.js` | The two dispatchers: `!group sub …` and `!command …` |
| `src/core/prefix/{context,permissions}.js` | The shared `ctx` both dispatchers build, and the permission gate + label map |
| `src/core/prefix/group.js` | Red-style group commands (S69): overview, arg resolution, permission gates, dispatch |
| `src/core/maintenance.js` | Maintenance mode (S74/S75): the bot-owner-exempt command gate + config |
| `src/core/help.js` | Pure help-roster construction and the two menu views (`helpOverview`, `helpCategory`) — no discord.js |
| `src/modules/core/lib/help-menu.js` | Turning a view into an embed + button rows, and the shared per-viewer filter |
| `src/modules/core/events/help-buttons.js` | The `help:` component pump |
| `src/modules/core/lib/presence.js` · `service-presence.js` | The two bot statuses (pure) and the one call that applies them |
| `src/modules/core/lib/precinct.js` | Pure: home-guild check |
| `src/modules/core/lib/radio.js` | Pure: latency verdict formatting |
| `src/core/{config,logger,loader}.js` | Plumbing exercised by this module |
| `test/{config,loader,core-lib}.test.js` | Automated coverage |

## Testing

- **Automated:** `npm test` (11 tests) — config fail-fast validation and settings parsing (`test/config.test.js`), manifest/command/event integrity and duplicate-name detection (`test/loader.test.js`), jurisdiction + latency-verdict logic (`test/core-lib.test.js`). No token or network needed.
- **Manual (live server) checklist:**
  1. Complete README → Quickstart (fill `.env`, `npm install`, `npm run deploy-commands`, `npm start`).
  2. Console shows `🚔 CuffBot on duty as <bot tag>` and no warnings.
  3. In the home precinct, run `/radio-check` → reply appears and edits into a latency verdict.
  4. Invite the bot to a throwaway test server → console logs "Out of jurisdiction … leaving" and the bot leaves it within seconds.
  5. Stop the bot, invite it to a foreign server while it is offline, start it → the on-duty sweep leaves that server at boot.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Boot exits with "Missing required environment variables" | No `.env` or empty values | `cp .env.example .env`, fill in token + client id |
| Boot exits with "homeGuildId must be a Discord guild id" | `config.json` edited/broken | Restore a 17–20 digit guild id in `config.json` |
| `/radio-check` not in the command picker | Commands never registered, or registered before the bot joined | Run `npm run deploy-commands`; give Discord a few seconds; re-open the client |
| "The application did not respond" | Bot process not running (registration ≠ being online) | `npm start` and watch for the on-duty log line |
| Login fails with `TokenInvalid` / registration says Unauthorized | Wrong or rotated token, or token belongs to a different application than `CLIENT_ID` | `npm run doctor` — it checks the token against Discord and names the exact mismatch |
| `!commands` do nothing (but `/commands` work) | Message Content intent not enabled | Developer Portal → Bot → Privileged Gateway Intents → Message Content Intent → ON, then restart. The startup log warns when this is the cause. |
| `/update` replies but nothing happens | Update unit/sudoers not installed, or already up to date | Re-run `setup-pi.sh` step 8; check `journalctl -u cuffbot-update`. "Up to date" is a no-op by design. |
| **`!commands` don't work, slash commands do** | Message Content intent disabled in the portal — the bot cannot READ message text, so `!help` is invisible to it | `/radio-check` shows it (❌ Text commands OFF), `npm run doctor` verifies the portal flag. Fix: Developer Portal → your app → Bot → Privileged Gateway Intents → **Message Content Intent** ON → Save → `sudo systemctl restart cuffbot` |
| Bot leaves a server immediately | That server is not the home precinct — working as designed | Change `config.json → homeGuildId` only if the precinct itself moves |

## Changelog

| Session | Change |
|---|---|
| S1 | Created: `/radio-check`, on-duty sweep, guild lockdown, core plumbing (config/logger/loader), tests. |
| S9 | Added dual invocation (`/x` + `!x`) via `src/core/prefix/`, `/help` (generated roster), `/update` (manual self-update), Message Content intent with graceful slash-only fallback. |
| S25 | `/update` got a feedback loop: live status edits (up-to-date / fetched+testing / rolled-back) and a post-restart "back on duty" report in the invoking channel via the `update-report` boot event + a store marker. |
| S26 | `/radio-check` now reports whether `!` text commands are live (Message Content fallback made visible in Discord); the doctor decodes the portal's intent flags and names the exact portal fix. |
| S27 | `/update`'s "already up to date" is now verified against origin: an updater that never STARTED is reported as such (with the fix), instead of masquerading as up-to-date. |
| S28 | `/restart` added (reload `.env` from Discord, with a post-boot "Restart complete" report via the shared marker, `kind: 'restart'`). |
| S39 | `/help` fixed for the 18-module roster: Discord's 6000-char TOTAL embed cap broke it — now paginated into numbered ephemeral embeds (DM pages via `!help`), only visible to the asker. |
| S43 | `/help` rebuilt: grouped by purpose categories (Moderation/Games/Fun/Ranks/Community/Info/Admin), one line per command, and viewer-filtered — members only see commands they can actually use. |
| S46 | Text-command DM failures diagnosed honestly: 50007 → per-server privacy-setting guidance; anything else → "failed on my end" + logged error code (was: every failure claimed "your DMs are closed"). |
| S54 | Owner mandate "no DMs after a `!command`": the DM path is gone — every ephemeral answers in-channel as a no-ping reply (S46 diagnostics and the S50 `textInChannel` marker retired with it); `!help` pages post in-channel. |
| S55 | Owner report "admin rights but can't post in a channel": every post-target picker was GuildText-only, making Announcement (news) channels unselectable — all pickers now take both; new `core/channels.js` `resolveSendableChannel` (cache → API fallback, send-capable check) backs every posting module; the text-path type error names both types. |
| S68 | TEXT-ONLY (owner mandate): the slash router and registration are gone — every command is `!command`; deploy-commands de-registers; doctor inverted (zero registered = healthy); help renders text usage only; components stay. Red-style restructure queued as M17. |
| S69 | Red-style group commands (M17.1): new `src/core/prefix/group.js` (`!group sub <args>`, bare `!group` = status+overview embed, typed args incl. greedy/choices, per-group and per-sub permission gates, framework-owned errors); loader accepts `{ group }` commands and validates their shape; router dispatches groups before the legacy adapter (retired in S96); `help.js summarizeCommand` puts groups in the menu; `!youtube` converted as the reference. |
| S70 | Framework extensions for the M17.2 conversion wave: group-level `aliases` (retired command names keep working — the loader registers every alias to the same group and boot-fails on collisions) and the `postable: true` channel-arg flag (S55 text/announcement rule enforced in `resolveArg`). All 13 config commands converted to groups; `!channellist` absorbed `!channellist`. |
| S71 | Group `fallback` subs: unmatched first tokens route into a designated sub with the full token list (`!connect4 @user` → `play`); loader validates the fallback names a real sub. First consumer: the connect4 module (M16.3). |
| S74 | Maintenance mode (owner request): `src/core/maintenance.js` + a router gate before both dispatch paths — with the switch on, only the exempt owner runs commands; everyone else gets the (customizable) English notice. `!maintenance` group: admin-visible, owner-only to operate (on/off/message/nomessage). Events/sweeps/components unaffected. |
| S75 | Owner correction: the exempt party is the **BOT owner** (`client.application.owner`, team members included), NOT the guild owner — the guild owner is now gated like everyone else. Owner ids cached on first successful application fetch, retried on failure. |
| S96 | **M17.3 complete.** The last four legacy commands (`!radiocheck`, `!restart`, `!update`, `!help`) converted to the flat shape, then the legacy path deleted: `prefix/adapter.js` (167 lines), `assignOptions` and the slash-option machinery in `prefix/parse.js` (172 → 47 lines), the router's and loader's legacy branches, `index.js`'s `runCommand` wrapper, `summarizeCommand`'s `cmd.data` branch, the shape-agnostic `replyEither` shim and `ensureInvokerPermission`. `!restart`/`!update` keep a hand-written gate because it admits the GUILD OWNER, which a `permission` flag cannot express — that is now the shared `isAdminOrOwner`. |
| S98 | `!help` is **one message with a button per category** (M19, owner request) instead of sequential embed pages — the S43 viewer filter now also decides which buttons you are offered, the asker's presses edit the message in place and anyone else gets their own filtered view privately. Plus M22: **maintenance mode shows in the bot's status** (Online · Watching the precinct ↔ Do Not Disturb · 🔧 Maintenance), set on every toggle and at boot from storage so it survives a restart. |
