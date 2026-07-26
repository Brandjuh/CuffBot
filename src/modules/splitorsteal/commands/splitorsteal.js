// The !splitorsteal group (S79 = M16.6, AAA3A port): a 60 s open lobby, two
// randomly drawn contestants, one secret Split-or-Steal choice each. Game
// texts are the cog's (its "loose" typo corrected — recorded deviation).
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { createSosGame, endSosGame, getSosGame, runSosGame } from '../service.js';
import { logger } from '../../../core/logger.js';

const GOLD = 0xc9a227;

const timeField = (label, endsAtMs) => {
  const unix = Math.floor(endsAtMs / 1000);
  return { name: label, value: `<t:${unix}:T> (<t:${unix}:R>)` };
};

export const joinComponents = (game, { disabled = false } = {}) => [
  new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`sos:join:${game.id}`)
      .setEmoji('🎮')
      .setLabel('Join Game')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
  ),
];

const chooseComponents = (game) => [
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sos:join:${game.id}`).setEmoji('🎮').setLabel('Join Game').setStyle(ButtonStyle.Success).setDisabled(true),
    new ButtonBuilder().setCustomId(`sos:split:${game.id}`).setLabel('Split').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`sos:steal:${game.id}`).setLabel('Steal').setStyle(ButtonStyle.Secondary),
  ),
];

/** The runner's Discord surface (embeds/texts cog-faithful). */
export function buildIo(game, channel) {
  const noPing = { allowedMentions: { parse: [] } };
  return {
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    async openLobby(endsAtMs) {
      const embed = new EmbedBuilder()
        .setColor(GOLD)
        .setTitle('Split Or Steal Game')
        .setDescription('Join the game by clicking on the button below. 2 players will be selected randomly.')
        .addFields(timeField('End time for joining:', endsAtMs));
      game.message = await channel
        .send({ embeds: [embed], components: joinComponents(game) })
        .catch(() => null);
    },
    async notEnough() {
      await game.message?.edit({ components: joinComponents(game, { disabled: true }) }).catch(() => {});
      await channel.send('At least two players are needed to play.').catch(() => {});
    },
    async showChoices(a, b, endsAtMs) {
      const embed = new EmbedBuilder()
        .setColor(GOLD)
        .setTitle('Split Or Steal Game')
        .setDescription(
          [
            `The two players are <@${a}> and <@${b}>.`,
            'You have to click the button that you choose (`split` or `steal`).',
            '• If you both choose `split` both of you win.',
            '• If you both choose `steal`, both of you lose.',
            '• If one of you chooses `split` and one of you chooses `steal`, the one who chose `steal` will win.',
          ].join('\n'),
        )
        .addFields(timeField('End time for play:', endsAtMs));
      await game.message
        ?.edit({
          embeds: [embed],
          components: chooseComponents(game),
          // The two contestants are pinged deliberately — 60 s to act.
          allowedMentions: { users: [a, b] },
        })
        .catch(() => {});
    },
    async timedOut() {
      await game.message?.edit({ components: [] }).catch(() => {});
      await channel.send('At least one player has stopped playing.').catch(() => {});
    },
    async result(kind, a, b) {
      await game.message?.edit({ components: [] }).catch(() => {});
      const lines = {
        'both-win': `<@${a}> and <@${b}>, you both chose \`split\` and therefore both win. 🤝`,
        'both-lose': `<@${a}> and <@${b}>, you both chose \`steal\` and therefore both lose. 💥`,
        'a-steals': `<@${a}> chose \`steal\` and <@${b}> chose \`split\` — <@${a}> wins. 🕶️`,
        'b-steals': `<@${b}> chose \`steal\` and <@${a}> chose \`split\` — <@${b}> wins. 🕶️`,
      };
      await channel.send({ content: lines[kind], ...noPing }).catch(() => {});
    },
  };
}

export default {
  group: {
    name: 'splitorsteal',
    aliases: ['sos', 'splitorstealgame'],
    description: 'Split or Steal: two random contestants, one secret choice each.',
    emoji: '🤝',
    status(ctx) {
      const open = getSosGame(ctx.channel.id);
      return [
        `Start a match with \`${ctx.prefix}splitorsteal play\` — a 60 s lobby opens, two joiners are drawn at random, and each secretly picks Split or Steal. Split+split: both win. Steal+steal: both lose. Steal beats split.`,
        '',
        open
          ? `**This channel:** a match is ${open.state === 'join' ? 'gathering players' : 'in progress'} — one at a time.`
          : '**This channel:** free.',
      ];
    },
    // S117: the source cog is a PLAIN command — `[p]splitorsteal` starts a game.
    // Ours was a group from birth (S72–S83), so the S106 sweep that added
    // `invokeWithoutSubcommand` never looked at it and bare `!splitorsteal` answered
    // with a menu instead of playing. `!splitorsteal help` still lists the family.
    invokeWithoutSubcommand: true,
    fallback: 'play',
    subcommands: [
      {
        name: 'play',
        aliases: ['start'],
        description: 'Open a 60-second lobby for a match.',
        args: [],
        async run(ctx) {
          const result = createSosGame(ctx.channel.id, ctx.guild.id);
          if (result.error === 'busy') {
            await ctx.reply('🚫 A match is already running in this channel — one at a time.');
            return;
          }
          // The runner owns the game from here; it cleans up in its finally.
          runSosGame(result.game, buildIo(result.game, ctx.channel)).catch((error) => {
            logger.error('Split-or-steal match crashed:', error);
            endSosGame(ctx.channel.id);
          });
        },
      },
    ],
  },
};
