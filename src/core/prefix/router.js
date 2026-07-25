// Wires text ("!command") invocation onto MessageCreate. Red-style group
// commands (S69) dispatch through core/prefix/group.js; legacy flat commands
// reuse command.execute() via the interaction adapter.
import { Events } from 'discord.js';
import { parseCommandLine, usageFor } from './parse.js';
import { createMessageInteraction } from './adapter.js';
import { dispatchGroup } from './group.js';
import { maintenanceNotice } from '../maintenance.js';

/**
 * @param {import('discord.js').Client} client
 * @param {(command: object, interaction: object) => Promise<void>} runCommand shared error-wrapped executor
 */
export function wirePrefixRouter(client, runCommand) {
  client.on(Events.MessageCreate, async (message) => {
    // Ignore bots (incl. self), DMs, and anything not addressed to us. Unknown
    // "!words" stay silent — they are usually chatter or another bot's prefix.
    if (message.author.bot || !message.guild) return;
    const prefix = client.config.prefix;
    const parsed = parseCommandLine(message.content, prefix);
    if (!parsed) return;
    const command = client.commands.get(parsed.name);
    if (!command) return;

    // Maintenance mode (S74): a real command from anyone but the precinct
    // owner answers the notice instead of running. Unknown "!words" stayed
    // silent above — no notice spam on chatter.
    const notice = maintenanceNotice(message.guild, message.author.id);
    if (notice) {
      await message.reply({ content: notice, allowedMentions: { repliedUser: false } }).catch(() => {});
      return;
    }

    if (command.group) {
      await dispatchGroup(command.group, message, parsed.tokens, prefix);
      return;
    }

    const { errors, interaction, usage } = await createMessageInteraction(message, command, parsed);
    if (errors.length > 0) {
      const hint = usage ?? usageFor(command.data.name, command.data.toJSON().options ?? []);
      await message.reply(`🚫 ${errors.join('; ')}\nUsage: \`${prefix}${hint}\``).catch(() => {});
      return;
    }
    await runCommand(command, interaction);
  });
}
