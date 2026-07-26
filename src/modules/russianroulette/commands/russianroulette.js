// The !russianroulette group (S73 = M16.5, AAA3A port): a mod opens the
// lobby, up to 30 officers join by button, last one standing wins. All game
// texts are the cog's, verbatim.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { MAX_PLAYERS } from '../lib/game.js';
import { SHOT_TIMEOUT_MS, awaitShot, createLobby, endRouletteGame, getRouletteGame } from '../service.js';

const DARK_RED = 0x992d22;

export function lobbyEmbed(game) {
  return new EmbedBuilder()
    .setColor(DARK_RED)
    .setTitle('💥 Russian Roulette Game 🔫')
    .setDescription(
      `Click the button below to **join the party!** Please note that the maximum amount of players is **${MAX_PLAYERS}**.`,
    )
    .addFields({
      name: 'Rules:',
      value:
        '- When its your turn, you will be asked to shoot.\n' +
        '- If you shoot, you may die or survive. One player die each round.\n' +
        '- Each player has 5 seconds to shoot, they die otherwise.\n' +
        '- The game ends when only one player is left.',
    })
    .setFooter({ text: `Hosted by <@${game.hostId}> · players: ${game.players.length}` });
}

export function lobbyComponents(game) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`rr:join:${game.id}`).setEmoji('🎮').setLabel('Join Game').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`rr:leave:${game.id}`).setLabel('Leave').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`rr:players:${game.id}`).setLabel(`View Players (${game.players.length})`).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`rr:start:${game.id}`).setLabel('Start Game!').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rr:cancel:${game.id}`).setEmoji('✖️').setStyle(ButtonStyle.Danger),
    ),
  ];
}

const shootComponents = (game) => [
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rr:shoot:${game.id}`).setEmoji('🔫').setLabel('Shoot!').setStyle(ButtonStyle.Danger),
  ),
];

/**
 * The engine's Discord surface. Turn prompts ping exactly the player on turn
 * (load-bearing: 5 s window) and the winner announce pings the winner; death
 * and click lines render mentions without notifying (house no-ping rule —
 * recorded deviation from the cog, which pinged everywhere).
 */
export function buildIo(game, channel) {
  const noPing = { allowedMentions: { parse: [] } };
  return {
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    async askShot(playerId) {
      const message = await channel
        .send({
          content: `<@${playerId}>, it's your turn to shoot!`,
          components: shootComponents(game),
          allowedMentions: { users: [playerId] },
        })
        .catch(() => null);
      if (!message) return 'timeout';
      const outcome = await awaitShot(game, playerId, SHOT_TIMEOUT_MS);
      await message.edit({ components: [] }).catch(() => {});
      return outcome;
    },
    async say(event) {
      const payloads = {
        round: () => ({
          embeds: [
            new EmbedBuilder()
              .setColor(DARK_RED)
              .setTitle(`Round ${event.round}`)
              .setDescription(`There are ${event.playersLeft} players left.`),
          ],
        }),
        afk: () => ({
          content: `I got tired of waiting, so I decided to shoot <@${event.playerId}> myself.`,
          ...noPing,
        }),
        trigger: () => ({
          content: `<@${event.playerId}> put the gun up to their head and pulled the trigger...`,
          ...noPing,
        }),
        dead: () => ({ content: `**💥 BANG!** <@${event.playerId}> is dead.`, ...noPing }),
        misfire: () => ({
          content: `**💥 BANG!** <@${event.playerId}> made a mistake and put their gun in the wrong direction, shooting <@${event.victimId}>.`,
          ...noPing,
        }),
        click: () => ({ content: 'Click. Nothing happened.' }),
        winner: () => ({
          content: `<@${event.playerId}>`,
          embeds: [
            new EmbedBuilder()
              .setColor(DARK_RED)
              .setTitle('Congratulations! You won the game!')
              .setDescription(`<@${event.playerId}> is the last officer standing. 🏆`),
          ],
          allowedMentions: { users: [event.playerId] },
        }),
        nobody: () => ({
          content: '💀 Everyone hesitated themselves into the grave — nobody survived, nobody wins.',
        }),
      };
      await channel.send(payloads[event.kind]()).catch(() => {});
    },
  };
}

export default {
  group: {
    name: 'russianroulette',
    aliases: ['rr'],
    description: 'Russian roulette: a last-one-standing party game (a mod opens the lobby).',
    emoji: '🔫',
    status(ctx) {
      const open = getRouletteGame(ctx.channel.id);
      return [
        `A mod opens the lobby with \`${ctx.prefix}russianroulette play\`; up to ${MAX_PLAYERS} officers join by button. Each turn you get 5 seconds to shoot — hesitate and the bot shoots you. One chambered round per round; last one standing wins.`,
        '',
        open
          ? `**This channel:** a ${open.state === 'lobby' ? 'lobby is open' : 'game is running'} — one game per channel.`
          : '**This channel:** free.',
      ];
    },
    // S117: the source cog is a PLAIN command — `[p]russianroulette` starts a game.
    // Ours was a group from birth (S72–S83), so the S106 sweep that added
    // `invokeWithoutSubcommand` never looked at it and bare `!russianroulette` answered
    // with a menu instead of playing. `!russianroulette help` still lists the family.
    invokeWithoutSubcommand: true,
    fallback: 'play',
    subcommands: [
      {
        name: 'play',
        aliases: ['start'],
        description: 'Open a lobby (mod-only, like the source cog).',
        permission: PermissionFlagsBits.ManageMessages,
        args: [],
        async run(ctx) {
          const result = createLobby(ctx.channel.id, ctx.guild.id, ctx.user.id);
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
            endRouletteGame(ctx.channel.id);
            return;
          }
          game.lobbyMessage = message;
        },
      },
    ],
  },
};
