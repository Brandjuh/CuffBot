// Hammertime auto mode (S84): with the toggle on, a chat message containing
// "at 5" / "in 20 min" gets a quiet subtext timestamp reply — the cog's
// on_message, gated the same way (never on !ht invocations, never without a
// resolvable timezone, at most one bare "at H" per message).
import { Events } from 'discord.js';
import { parseAutoMessage } from '../lib/parse.js';
import { getAutoTime, resolveTimezone } from '../service.js';

export default {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author?.bot || !message.guild) return;
    if (!getAutoTime(message.guild.id)) return;
    const content = message.content ?? '';
    const prefix = message.client?.config?.prefix ?? '!';
    if (content.trim().toLowerCase().startsWith(`${prefix}hammertime`) || content.trim().toLowerCase().startsWith(`${prefix}ht`)) {
      return;
    }

    const member = message.member;
    const resolved = resolveTimezone(message.guild.id, message.author.id, [...(member?.roles?.cache?.keys() ?? [])]);
    if (resolved.error) return;

    const epochMs = parseAutoMessage(content, resolved.zone, Date.now());
    if (epochMs === null) return;
    const ts = Math.floor(epochMs / 1000);
    await message
      .reply({ content: `-# <t:${ts}:F> (<t:${ts}:R>)`, allowedMentions: { repliedUser: false } })
      .catch(() => {});
  },
};
