// The mafia button pump (S105 = M24.1). Module-owned InteractionCreate
// handler filtering the `mf:` prefix — component pumps stay in text-only mode.
//
// This is the S98 non-originator rule at its sharpest: a mafia table is a
// PUBLIC message whose every meaningful interaction is PER-VIEWER and secret.
// So the shared card is only ever edited to show public state (who joined, the
// tally), and everything a single player chooses is answered privately with
// `flags: 64`. Editing the shared card on a private press would leak the game.
import { ActionRowBuilder, Events, MessageFlags, StringSelectMenuBuilder } from 'discord.js';
import { logger } from '../../../core/logger.js';
import {
  PHASES,
  castJudgement,
  castVote,
  joinGame,
  leaveGame,
  playerOf,
  startGame,
  submitNightAction,
} from '../lib/game.js';
import { MIN_PLAYERS } from '../lib/roles.js';
import { ROLES } from '../lib/roles.js';
import { actionPromptFor, buttonId, parseButtonId, targetsFor } from '../lib/render.js';
import { phaseLengthOf } from '../lib/config.js';
import { gameIn, getMafiaConfig, setTable } from '../service.js';
import {
  advance,
  enterPhase,
  judgementComplete,
  namerFor,
  nightComplete,
  render,
  votingComplete,
} from '../flow.js';

const quiet = (interaction, content) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});

/** A private target picker, keyed to the presser so nobody else can use it. */
function pickerFor(interaction, game, kind, ids, guild) {
  const nameOf = namerFor(guild);
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(buttonId(kind, game.id, interaction.user.id))
      .setPlaceholder('Choose someone…')
      .addOptions(
        ids.slice(0, 25).map((id) => ({ label: nameOf(id).slice(0, 100), value: id })),
      ),
  );
}

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    const isButton = interaction.isButton?.();
    const isSelect = interaction.isStringSelectMenu?.();
    if (!isButton && !isSelect) return;
    const parsed = parseButtonId(interaction.customId);
    if (!parsed) return;

    const channel = interaction.channel;
    const game = gameIn(interaction.channelId);
    if (!game || game.id !== parsed.gameId) {
      await quiet(interaction, '⌛ That table is closed. `!mafia start` opens a new one.');
      return;
    }
    const config = getMafiaConfig(interaction.guildId);
    const remainingMs = phaseLengthOf(game.phase, config) ?? 0;

    try {
      switch (parsed.action) {
        // ── lobby ────────────────────────────────────────────────────────────
        case 'join': {
          const joined = joinGame(game, interaction.user.id);
          if (!joined.ok) {
            await quiet(
              interaction,
              joined.reason === 'already-in' ? 'You are already at this table.' : 'This table is not taking players.',
            );
            return;
          }
          setTable(channel.id, { game: joined.game });
          await interaction.deferUpdate().catch(() => {});
          await render(channel, joined.game, { remainingMs });
          return;
        }
        case 'leave': {
          const left = leaveGame(game, interaction.user.id);
          if (!left.ok) {
            await quiet(
              interaction,
              left.reason === 'host'
                ? 'You are the host — use `!mafia end` to close the table.'
                : 'You are not at this table.',
            );
            return;
          }
          setTable(channel.id, { game: left.game });
          await interaction.deferUpdate().catch(() => {});
          await render(channel, left.game, { remainingMs });
          return;
        }
        case 'begin': {
          if (interaction.user.id !== game.hostId) {
            await quiet(interaction, 'Only the host starts the game.');
            return;
          }
          const begun = startGame(game);
          if (!begun.ok) {
            await quiet(
              interaction,
              begun.reason === 'too-few'
                ? `You need ${MIN_PLAYERS} players; there are ${game.players.length}.`
                : 'This game already started.',
            );
            return;
          }
          await interaction.deferUpdate().catch(() => {});
          // Every player is told their own card, privately, before night one.
          await tellRoles(channel, begun.game);
          await enterPhase(channel, begun.game);
          return;
        }

        // ── night ────────────────────────────────────────────────────────────
        case 'act': {
          const prompt = actionPromptFor(game, interaction.user.id);
          if (!prompt.ok) {
            await quiet(interaction, prompt.text);
            return;
          }
          const targets = targetsFor(game, interaction.user.id);
          if (targets.length === 0) {
            await quiet(interaction, 'There is nobody you can choose tonight.');
            return;
          }
          await interaction
            .reply({
              content: prompt.text,
              components: [pickerFor(interaction, game, 'target', targets, channel.guild)],
              flags: MessageFlags.Ephemeral,
            })
            .catch(() => {});
          return;
        }
        case 'target': {
          if (parsed.extra !== interaction.user.id) {
            await quiet(interaction, 'That prompt is not yours.');
            return;
          }
          const submitted = submitNightAction(game, interaction.user.id, interaction.values[0]);
          if (!submitted.ok) {
            await quiet(interaction, refusalFor(submitted.reason));
            return;
          }
          setTable(channel.id, { game: submitted.game });
          const nameOf = namerFor(channel.guild);
          await interaction
            .update({ content: `✅ Noted: **${nameOf(interaction.values[0])}**.`, components: [] })
            .catch(() => {});
          // The shared card only ever learns HOW MANY are still to act.
          await render(channel, submitted.game, { remainingMs });
          if (nightComplete(submitted.game)) await advance(channel);
          return;
        }

        // ── the vote ─────────────────────────────────────────────────────────
        case 'vote': {
          const voter = playerOf(game, interaction.user.id);
          if (!voter?.alive) {
            await quiet(interaction, 'The dead do not vote.');
            return;
          }
          const targets = game.players.filter((p) => p.alive).map((p) => p.id);
          await interaction
            .reply({
              content: 'Who goes on trial?',
              components: [pickerFor(interaction, game, 'ballot', targets, channel.guild)],
              flags: MessageFlags.Ephemeral,
            })
            .catch(() => {});
          return;
        }
        case 'ballot': {
          if (parsed.extra !== interaction.user.id) {
            await quiet(interaction, 'That ballot is not yours.');
            return;
          }
          const cast = castVote(game, interaction.user.id, interaction.values[0]);
          if (!cast.ok) {
            await quiet(interaction, refusalFor(cast.reason));
            return;
          }
          setTable(channel.id, { game: cast.game });
          const nameOf = namerFor(channel.guild);
          await interaction
            .update({ content: `🗳️ Voted for **${nameOf(interaction.values[0])}**.`, components: [] })
            .catch(() => {});
          // The tally IS public — that is the pressure the day phase runs on.
          await render(channel, cast.game, { remainingMs });
          if (votingComplete(cast.game)) await advance(channel);
          return;
        }

        // ── the trial ────────────────────────────────────────────────────────
        case 'guilty':
        case 'innocent': {
          const cast = castJudgement(game, interaction.user.id, parsed.action);
          if (!cast.ok) {
            await quiet(interaction, refusalFor(cast.reason));
            return;
          }
          setTable(channel.id, { game: cast.game });
          await quiet(interaction, `⚖️ Your verdict: **${parsed.action}**.`);
          await render(channel, cast.game, { remainingMs });
          if (judgementComplete(cast.game)) await advance(channel);
          return;
        }
        default:
      }
    } catch (error) {
      logger.error('Mafia: a button press failed:', error);
      await quiet(interaction, '📻 Dispatch, we have a malfunction. That press did not land.');
    }
  },
};

/** Tell every player their card, privately, before the first night. */
async function tellRoles(channel, game) {
  const nameOf = namerFor(channel.guild);
  for (const player of game.players) {
    const role = ROLES[player.roleId];
    const member = await channel.guild.members.fetch(player.id).catch(() => null);
    if (!member || !role) continue;
    const lines = [
      `${role.emoji} **You are ${role.name}.**`,
      role.description,
      '',
      `**At night:** ${role.ability}`,
      `**You win by:** ${role.objective}`,
    ];
    // eslint-disable-next-line no-await-in-loop -- ordered, and at most 20
    await member.send(lines.join('\n')).catch(() =>
      channel
        .send({
          content: `🕵️ <@${player.id}>, I could not DM you your card — open your DMs and ask the host to restart.`,
          allowedMentions: { users: [player.id] },
        })
        .catch(() => null),
    );
  }
  void nameOf;
}

const REFUSALS = {
  'not-night': 'The night is over.',
  'not-voting': 'Voting is not open.',
  'not-judgement': 'There is no trial right now.',
  dead: 'The dead do not act.',
  'no-action': 'You have nothing to do tonight.',
  'target-dead': 'They are already gone.',
  'no-self-kill': 'You cannot pick yourself for that.',
  'repeat-protect': 'You covered them last night. Pick someone else.',
  accused: 'You are the one on trial. You do not get a vote.',
  'bad-verdict': 'That is not a verdict.',
};
const refusalFor = (reason) => REFUSALS[reason] ?? 'That move is not allowed right now.';
