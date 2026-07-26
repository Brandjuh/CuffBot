// The !rollout group (S81 = M16.8, AAA3A port): a big-lobby elimination game
// — every round, pick one of 25 numbers before the clock; the bot's rolled
// number takes out everyone who picked it (and everyone who hesitated).
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { MAX_PLAYERS, MIN_PLAYERS, NUMBERS, PRIZE_MAX, PRIZE_MIN } from '../lib/game.js';
import {
  createRolloutLobby,
  endRolloutGame,
  getRolloutConfig,
  getRolloutGame,
  getRolloutStats,
  resetRolloutStats,
  setRolloutConfig,
  topRollout,
} from '../service.js';

const TEAL = 0x11806a;

export function lobbyEmbed(game) {
  return new EmbedBuilder()
    .setColor(TEAL)
    .setTitle('Rollout Game')
    .setDescription(`Click the button below to **join the party**! Please note that the maximum amount of players is **${MAX_PLAYERS}**.`)
    .addFields({
      name: 'Rules:',
      value:
        `- At each round, select a number between 1 and ${NUMBERS} within 30 seconds.\n` +
        '- If the bot rolls the number you selected, you lose.\n' +
        '- The last player standing wins the game!',
    })
    .setFooter({ text: `Hosted by <@${game.hostId}> · players: ${game.players.length}` });
}

export function lobbyComponents(game) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ro:join:${game.id}`).setEmoji('🎮').setLabel('Join Game').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`ro:leave:${game.id}`).setLabel('Leave').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`ro:players:${game.id}`).setLabel(`View Players (${game.players.length})`).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`ro:start:${game.id}`).setLabel('Start Game!').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`ro:cancel:${game.id}`).setEmoji('✖️').setStyle(ButtonStyle.Danger),
    ),
  ];
}

/**
 * The 25-number board. Picked numbers restyle primary with a count when
 * shared (the cog's live feedback); disabled numbers stay off; the rolled
 * number turns danger on reveal.
 */
export function numberComponents(game, disabled, { locked = false, revealed = null } = {}) {
  const counts = {};
  for (const number of Object.values(game.roundChoices)) counts[number] = (counts[number] ?? 0) + 1;
  const rows = [];
  for (let start = 1; start <= NUMBERS; start += 5) {
    rows.push(
      new ActionRowBuilder().addComponents(
        Array.from({ length: 5 }, (_, offset) => {
          const n = start + offset;
          const picked = counts[n] ?? 0;
          return new ButtonBuilder()
            .setCustomId(`ro:pick:${game.id}:${n}`)
            .setLabel(picked > 1 ? `${n} (${picked})` : String(n))
            .setStyle(
              revealed === n
                ? ButtonStyle.Danger
                : picked > 0
                  ? ButtonStyle.Primary
                  : ButtonStyle.Secondary,
            )
            .setDisabled(locked || disabled.includes(n));
        }),
      ),
    );
  }
  return rows;
}

export function roundEmbed(round, endsAtMs) {
  return new EmbedBuilder()
    .setColor(TEAL)
    .setTitle(`Rollout Game — Round ${round}`)
    .setDescription(`Select a number between 1 and ${NUMBERS}. Choose is limited to 30 seconds.`)
    .addFields({ name: 'Time Left:', value: `<t:${Math.floor(endsAtMs / 1000)}:R>` });
}

/** The runner's Discord surface. */
export function buildIo(game, channel) {
  const noPing = { allowedMentions: { parse: [] } };
  const state = { roundMessage: null, disabled: [] };
  return {
    async openRound(round, alive, disabled, endsAtMs) {
      state.disabled = disabled;
      state.roundMessage = await channel
        .send({
          content: alive.map((id) => `<@${id}>`).join(', '),
          embeds: [roundEmbed(round, endsAtMs)],
          components: numberComponents(game, disabled),
          // One deliberate scoped ping per round: 30 seconds to act.
          allowedMentions: { users: alive.slice(0, 50) },
        })
        .catch(() => null);
      game.roundMessage = state.roundMessage;
    },
    async revealNumber(number) {
      await state.roundMessage
        ?.edit({ components: numberComponents(game, state.disabled, { locked: true, revealed: number }) })
        .catch(() => {});
    },
    async nobodyAnswered() {
      await channel.send({ content: 'No one has answered in time. The game ends...', ...noPing }).catch(() => {});
    },
    async roundRestart(number) {
      await channel
        .send({
          content: `The bot has rolled the number **${number}**! However, since all remaining players have been eliminated, the round will be restarted.`,
          ...noPing,
        })
        .catch(() => {});
    },
    async results(round, number, numberEliminated, timeoutEliminated, survivors) {
      const eliminated = [...numberEliminated, ...timeoutEliminated];
      const lines = [
        `The bot has rolled the number **${number}**!`,
        '',
        eliminated.length === 0
          ? '**No one has been eliminated this round.**'
          : eliminated.length === 1
            ? '**1 player has been eliminated this round:**'
            : `**${eliminated.length} players have been eliminated this round:**`,
        ...numberEliminated.map((id) => `- <@${id}> — Selected the number ${number}.`),
        ...timeoutEliminated.map((id) => `- <@${id}> — Did not select a number in time.`),
        '',
        `**${survivors.length}** player${survivors.length === 1 ? '' : 's'} left.`,
      ];
      await channel
        .send({
          content: eliminated.length ? '💀' : undefined,
          embeds: [
            new EmbedBuilder().setColor(TEAL).setTitle(`Round ${round} — Results`).setDescription(lines.join('\n')),
          ],
          ...noPing,
        })
        .catch(() => {});
    },
    async tie() {
      await channel
        .send({
          embeds: [new EmbedBuilder().setColor(TEAL).setTitle("It's a tie! No one won the game.")],
          ...noPing,
        })
        .catch(() => {});
    },
    async winner(winnerId, prize, paid) {
      await channel
        .send({
          content: `<@${winnerId}>`,
          embeds: [
            new EmbedBuilder()
              .setColor(TEAL)
              .setTitle('Congratulations! You won the game!')
              .setDescription(
                `<@${winnerId}> is the last officer standing. 🏆\n**+${prize.toLocaleString('en-US')}** scoreboard points${paid ? ` and **${prize.toLocaleString('en-US')} 🍩** paid out` : ''}.`,
              ),
          ],
          allowedMentions: { users: [winnerId] },
        })
        .catch(() => {});
    },
  };
}

export default {
  group: {
    name: 'rollout',
    aliases: ['rolloutgame'],
    description: 'Rollout: pick a number each round — the bot’s roll eliminates you.',
    emoji: '🎲',
    status(ctx) {
      const config = getRolloutConfig(ctx.guild.id);
      const open = getRolloutGame(ctx.channel.id);
      const mine = getRolloutStats(ctx.guild.id).players[ctx.user.id];
      return [
        `Open a lobby with \`${ctx.prefix}rollout play\` (up to ${MAX_PLAYERS} players). Each round: pick one of ${NUMBERS} numbers within 30 seconds — the bot's rolled number eliminates everyone who picked it AND everyone who hesitated. Rolled numbers stay off the board. Last one standing wins.`,
        '',
        `**Prize:** ${config.prize.toLocaleString('en-US')} scoreboard points${config.economy ? ' + the same in 🍩 (economy payout ON)' : ' (economy payout off)'}`,
        ...(mine ? [`**Your record:** ${mine.score.toLocaleString('en-US')} points · ${mine.wins} win${mine.wins === 1 ? '' : 's'} · ${mine.games} game${mine.games === 1 ? '' : 's'}`] : []),
        open
          ? `**This channel:** a ${open.state === 'lobby' ? 'lobby is open' : 'game is running'} — one at a time.`
          : '**This channel:** free.',
      ];
    },
    // S117: the source cog is a PLAIN command — `[p]rollout` starts a game.
    // Ours was a group from birth (S72–S83), so the S106 sweep that added
    // `invokeWithoutSubcommand` never looked at it and bare `!rollout` answered
    // with a menu instead of playing. `!rollout help` still lists the family.
    invokeWithoutSubcommand: true,
    fallback: 'play',
    subcommands: [
      {
        name: 'play',
        aliases: ['start'],
        description: 'Open a lobby (anyone may host — the cog has no gate).',
        args: [],
        async run(ctx) {
          const result = createRolloutLobby(ctx.channel.id, ctx.guild.id, ctx.user.id);
          if (result.error === 'busy') {
            await ctx.reply('🚫 There is already a lobby or game in this channel — one at a time.');
            return;
          }
          const game = result.game;
          const message = await ctx.reply({
            embeds: [lobbyEmbed(game)],
            components: lobbyComponents(game),
            allowedMentions: { repliedUser: false },
          });
          if (!message) {
            endRolloutGame(ctx.channel.id);
            return;
          }
          game.lobbyMessage = message;
        },
      },
      {
        name: 'leaderboard',
        aliases: ['lb'],
        description: 'The rollout scoreboard: score, wins, games.',
        args: [],
        async run(ctx) {
          const sorted = topRollout(ctx.guild.id);
          if (sorted.length === 0) {
            await ctx.reply('No one has played this game yet.');
            return;
          }
          const medals = ['🥇', '🥈', '🥉'];
          const lines = sorted
            .slice(0, 15)
            .map(
              (p, i) =>
                `${medals[i] ?? `**${i + 1}.**`} <@${p.id}> — **${p.score.toLocaleString('en-US')}** points · ${p.wins} win${p.wins === 1 ? '' : 's'} · ${p.games} game${p.games === 1 ? '' : 's'}`,
            );
          const place = sorted.findIndex((p) => p.id === ctx.user.id);
          const embed = new EmbedBuilder()
            .setColor(TEAL)
            .setTitle('🎲 Rollout — Leaderboard')
            .setDescription(lines.join('\n'));
          if (place !== -1) embed.setFooter({ text: `You: ${place + 1}/${sorted.length}` });
          await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
        },
      },
      {
        name: 'prize',
        description: `Set the winner's prize (${PRIZE_MIN}–${PRIZE_MAX}).`,
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'amount', type: 'integer', required: true }],
        async run(ctx, { amount }) {
          if (amount < PRIZE_MIN || amount > PRIZE_MAX) {
            await ctx.reply(`🚫 The prize must be ${PRIZE_MIN}–${PRIZE_MAX}.`);
            return;
          }
          setRolloutConfig(ctx.guild.id, { prize: amount });
          await ctx.reply(`✅ The rollout prize is **${amount.toLocaleString('en-US')}**.`);
        },
      },
      {
        name: 'economy',
        description: 'Also pay the prize in donuts through the economy (the cog’s red_economy).',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'state', type: 'boolean', required: true }],
        async run(ctx, { state }) {
          setRolloutConfig(ctx.guild.id, { economy: state });
          await ctx.reply(state ? '✅ Winners are paid in 🍩 on top of scoreboard points.' : '✅ Scoreboard points only.');
        },
      },
      {
        name: 'resetleaderboard',
        description: 'Wipe the rollout scoreboard for this precinct.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [],
        async run(ctx) {
          resetRolloutStats(ctx.guild.id);
          await ctx.reply('🗑️ Rollout leaderboard reset.');
        },
      },
    ],
  },
};
