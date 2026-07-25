// S95 (M17.3 slice C): converted to the flat { command } shape.
import { PermissionFlagsBits } from 'discord.js';
import { getPatrolConfig, setPatrolConfig } from '../service.js';

export default {
  command: {
    name: 'patrol-term',
    description: 'Add or remove a banned term from the patrol list.',
    emoji: '👮',
    permission: PermissionFlagsBits.ManageGuild,
    args: [
      { name: 'action', type: 'string', required: true, choices: ['add', 'remove'] },
      // Greedy: a banned term may be a phrase. Matched evasion-aware.
      { name: 'term', type: 'string', required: true, greedy: true, maxLength: 100 },
    ],
    async run(ctx, { action, term: raw }) {
      const term = raw.trim().toLowerCase();
      const config = getPatrolConfig(ctx.guild.id);
      const terms = new Set(config.bannedTerms);

      let message;
      if (action === 'remove') {
        message = terms.delete(term)
          ? `👮 Removed banned term. ${terms.size} remain.`
          : 'That term was not on the banned-term list.';
      } else if (terms.has(term)) {
        message = 'That term is already on the list.';
      } else {
        terms.add(term);
        message = `👮 Added banned term. ${terms.size} now on the list.`;
      }
      config.bannedTerms = [...terms];
      setPatrolConfig(ctx.guild.id, config);
      // The term itself is never echoed — the reply lands in a public channel
      // now (S54: no ephemerals on the text path), so repeating it would post
      // the very word the admin is trying to suppress.
      await ctx.reply(message);
    },
  },
};
