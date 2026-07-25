// The commendation-board admin group (S70 = M17.2, `!starboard` — the old
// `!starboard-config` name stays as an alias).
import { PermissionFlagsBits } from 'discord.js';
import { displayEmoji, parseEmojiInput } from '../lib/board.js';
import { getBoardedData, getStarboardConfig, setStarboardConfig } from '../service.js';

export default {
  group: {
    name: 'starboard',
    aliases: ['starboard-config'],
    description: 'The commendation board: channel, threshold, emoji (admin).',
    emoji: '⭐',
    permission: PermissionFlagsBits.ManageGuild,
    status(ctx) {
      const config = getStarboardConfig(ctx.guild.id);
      const boardedCount = (getBoardedData(ctx.guild.id).order ?? []).length;
      return [
        `**Enabled:** ${config.enabled ? 'yes' : 'no'}`,
        `**Channel:** ${config.channelId ? `<#${config.channelId}>` : '⚠️ not set — nothing is boarded until an admin picks one'}`,
        `**Threshold:** ${config.threshold} × ${displayEmoji(config.emoji)}`,
        `**Boarded so far:** ${boardedCount}`,
        '',
        `React with ${displayEmoji(config.emoji)} on any message; at ${config.threshold} reactions it earns a spot on the board. Each message boards once.`,
      ];
    },
    subcommands: [
      {
        name: 'on',
        description: 'Turn the starboard on.',
        args: [],
        async run(ctx) {
          setStarboardConfig(ctx.guild.id, { enabled: true });
          await ctx.reply('✅ The commendation board is **open**.');
        },
      },
      {
        name: 'off',
        description: 'Turn the starboard off.',
        args: [],
        async run(ctx) {
          setStarboardConfig(ctx.guild.id, { enabled: false });
          await ctx.reply('📴 The commendation board is **closed**.');
        },
      },
      {
        name: 'channel',
        description: 'Channel where starred messages are reposted.',
        args: [{ name: 'channel', type: 'channel', required: true, postable: true }],
        async run(ctx, { channel }) {
          setStarboardConfig(ctx.guild.id, { channelId: channel.id });
          await ctx.reply(`✅ Commendations land in <#${channel.id}>.`);
        },
      },
      {
        name: 'threshold',
        description: 'Stars needed to board a message (1–25).',
        args: [{ name: 'stars', type: 'integer', required: true }],
        async run(ctx, { stars }) {
          if (stars < 1 || stars > 25) {
            await ctx.reply('🚫 The threshold must be 1–25 stars.');
            return;
          }
          setStarboardConfig(ctx.guild.id, { threshold: stars });
          await ctx.reply(`✅ Messages board at **${stars}** reactions.`);
        },
      },
      {
        name: 'emoji',
        description: 'Reaction that counts: a unicode emoji (🌟) or a custom server emoji.',
        args: [{ name: 'emoji', type: 'string', required: true }],
        async run(ctx, { emoji }) {
          const parsed = parseEmojiInput(emoji);
          if (!parsed.ok) {
            await ctx.reply(
              `🚫 \`${emoji}\` is not an emoji I can watch for. Use a unicode emoji (like 🌟 or 🍩) ` +
                'or pick a custom server emoji from the emoji picker so it looks like `<:name:id>`.',
            );
            return;
          }
          setStarboardConfig(ctx.guild.id, { emoji: parsed.value });
          await ctx.reply(`✅ The board now counts ${displayEmoji(parsed.value)} reactions.`);
        },
      },
    ],
  },
};
