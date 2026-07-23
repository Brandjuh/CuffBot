# discord.js v14 — Essentials & Pitfalls

**When to read this:** before your first bot-code session, and whenever Discord behavior surprises you. This file is distilled knowledge, not documentation scripture — versions move. When reality contradicts it: trust reality, fix the code, then **update this file** (that's retro question 6). Official sources when needed: https://discord.js.org and https://discordjs.guide.

## Client & intents

```js
import { Client, GatewayIntentBits } from 'discord.js';
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.login(process.env.DISCORD_TOKEN);
```

- `Guilds` is the baseline intent; slash commands work with it alone.
- `GuildMembers`, `MessageContent`, `GuildPresences` are **privileged**: they must also be enabled in the Developer Portal → Bot → Privileged Gateway Intents, or login fails with "Used disallowed intents". Request them only when a feature truly needs them (patrol/automod will need more than core does).
- Missing intents don't always error — they show up as **empty caches and events that never fire**. If "nothing happens", suspect intents first.

## Slash command registration

- Commands are *defined* in code but must be *registered* with Discord via REST (`deploy-commands.js`). Code changes to `execute` apply on restart; changes to `data` (name/options) require re-running deploy.
- **Guild-scoped** registration (`Routes.applicationGuildCommands(clientId, guildId)`) is instant — use it for the dev guild. **Global** (`Routes.applicationCommands(clientId)`) can take up to ~1 hour to propagate — production only.
- Registering the same name twice replaces it; removing a command from the payload removes it from Discord.

## Interaction lifecycle — the 3-second rule

- You have **3 seconds** to `reply()` or `deferReply()`, otherwise the interaction fails with "The application did not respond".
- Anything that might be slow (storage, fetches): `await interaction.deferReply()` first, then `editReply()` when done.
- One initial response per interaction. A second `reply()` throws `InteractionAlreadyReplied` — use `followUp()` for extra messages.
- Ephemeral replies: `interaction.reply({ content, flags: MessageFlags.Ephemeral })`. The older `ephemeral: true` option is deprecated in current v14 — prefer flags.
- In newer v14, `fetchReply: true` is deprecated in favor of `withResponse: true` (the reply then lives at `response.resource.message`).

## Moderation APIs (enforcement module)

| Action | Call | Notes |
|---|---|---|
| Ban ("arrest") | `member.ban({ reason, deleteMessageSeconds })` | `deleteMessageSeconds` max 604800 (7 days) |
| Unban ("release") | `guild.members.unban(userId, reason)` | Target is a user id, not a member |
| Timeout ("detain") | `member.timeout(ms, reason)` | Max 28 days; `null` duration lifts it |
| Kick | `member.kick(reason)` | |

- **Hierarchy rules:** the bot can only act on members whose highest role is *below* the bot's highest role, and never on the guild owner. Check `member.moderatable` (timeout/kick) or `member.bannable` before acting and reply honestly when blocked — a silent failure looks like a bug.
- The invoking *user's* permission is a separate question from the *bot's* ability — check both.
- `reason` strings appear in the guild audit log — always pass one.

## Permissions

- `setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)` on the builder controls who *sees* the command by default — but server admins can override that in Integration settings. Re-check at runtime: `interaction.memberPermissions.has(...)`.
- The bot's own permissions in the *channel* matter too (`guild.members.me.permissionsIn(channel)`) — a bot can be muted per-channel.

## Common pitfalls

| Symptom | Cause |
|---|---|
| Login throws `TokenInvalid` | Wrong/rotated token, or `.env` not loaded (import order!) — load env before anything reads it (Node 20+: `node --env-file=.env`, no dotenv dependency needed) |
| "Used disallowed intents" | Privileged intent in code but not enabled in the portal |
| Command not appearing | Deploy script not run, wrong guild id, or global registration still propagating |
| "The application did not respond" | Forgot to reply/defer within 3 s |
| `InteractionAlreadyReplied` | Double `reply()` — use `followUp()`/`editReply()` |
| Empty `guild.members.cache` | Missing `GuildMembers` intent; use `guild.members.fetch(id)` for one-offs |
| `Missing Permissions` (50013) | Role hierarchy or channel overrides — check `moderatable`/`bannable` first |

## Testing without a live bot

- Never require a token in `npm test`. Pure logic lives in `lib/` (no discord.js imports) and is tested directly.
- Command `execute` functions can be smoke-tested with a hand-rolled fake interaction object (`{ options: { getUser: () => … }, reply: async () => … }`) — assert on what was replied, not on Discord internals.
- A loader smoke test (import all modules, assert manifests well-formed, command names unique) catches wiring mistakes without any network.

## Token hygiene

- Token only in `.env` (gitignored) and the Developer Portal. Never in code, config.json, logs, manuals, or eval fixtures.
- If a token ever lands in a commit or log: treat it as leaked, tell the owner to regenerate it in the portal, and note it in `SESSION_LOG.md`.
