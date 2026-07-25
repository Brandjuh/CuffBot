// Wires text ("!command") invocation onto MessageCreate.
//
// S96 (M17.3 slice D): there are exactly TWO command shapes now — Red-style
// groups (S69, `{ group }`) and flat commands (S93, `{ command }`) — and both
// dispatch here. The third path, which rebuilt an interaction out of a message
// so pre-S69 `execute(interaction)` commands could run, is gone with the last
// command that needed it.
import { Events } from 'discord.js';
import { parseCommandLine } from './parse.js';
import { dispatchGroup } from './group.js';
import { dispatchCommand } from './command.js';
import { maintenanceNotice } from '../maintenance.js';

/** @param {import('discord.js').Client} client */
export function wirePrefixRouter(client) {
  client.on(Events.MessageCreate, async (message) => {
    // Ignore bots (incl. self), DMs, and anything not addressed to us. Unknown
    // "!words" stay silent — they are usually chatter or another bot's prefix.
    if (message.author.bot || !message.guild) return;
    const prefix = client.config.prefix;
    const parsed = parseCommandLine(message.content, prefix);
    if (!parsed) return;
    const command = client.commands.get(parsed.name);
    if (!command) return;

    // Maintenance mode (S74/S75): a real command from anyone but the BOT
    // owner answers the notice instead of running. Unknown "!words" stayed
    // silent above — no notice spam on chatter.
    const notice = await maintenanceNotice(client, message.guild.id, message.author.id);
    if (notice) {
      await message.reply({ content: notice, allowedMentions: { repliedUser: false } }).catch(() => {});
      return;
    }

    if (command.group) await dispatchGroup(command.group, message, parsed.tokens, prefix);
    else await dispatchCommand(command.command, message, parsed.tokens, prefix);
  });
}
