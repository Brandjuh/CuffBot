// The trivia group (`!trivia`). S106 folded the hyphenated pair in:
// `!trivia scores` and `!trivia sets` are now `scores` and `sets`.
//
// `invokeWithoutSubcommand` (Red's `invoke_without_command`) keeps bare
// `!trivia` STARTING A ROUND rather than answering with a menu — that is the
// invocation the precinct types, and folding a family must not change it.
// `!trivia police-codes` still works too, via the fallback.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { ROUND_SECONDS, pickQuestionIndex, questionModel, revealModel, scoreboard } from '../lib/game.js';
import { endRound, getRound, getScores, loadSets, startRound } from '../service.js';

const SETS = loadSets();
const lastIndexByChannelSet = new Map(); // `${channelId}:${setId}` → last question index

export function buildReveal(set, questionIndex, winnerId) {
  const model = revealModel(set, questionIndex, winnerId);
  return new EmbedBuilder().setColor(winnerId ? 0x2ecc71 : 0x95a5a6).setTitle(model.title).setDescription(model.description);
}

/** Ends a round and edits the question message into the reveal. Never throws. */
export async function revealRound(channelId) {
  const round = endRound(channelId);
  if (!round) return;
  const set = loadSets().get(round.setId);
  if (!set) return;
  try {
    await round.message?.edit?.({
      embeds: [buildReveal(set, round.questionIndex, round.winnerId)],
      components: [],
    });
  } catch (error) {
    logger.warn('Trivia: reveal edit failed:', error);
  }
}

export default {
  group: {
    name: 'trivia',
    aliases: ['trivia-scores', 'trivia-sets'],
    description: 'Police trivia: buttoned rounds, a leaderboard, and the installed question sets.',
    emoji: '❓',
    fallback: 'play',
    invokeWithoutSubcommand: true,
    subcommands: [
      {
        // S106: this is what bare `!trivia` runs.
        name: 'play',
        aliases: ['start', 'round'],
        description: 'Start a police trivia round — first correct answer wins a point.',
        args: [{ name: 'set', type: 'string', choices: [...SETS.keys()] }],
        async run(ctx, { set: requested }) {

          const channelId = ctx.channel?.id;
          if (!channelId) {
            await ctx.reply('🚫 Trivia needs a channel.');
            return;
          }
          if (getRound(channelId)) {
            await ctx.reply('🚫 A trivia round is already running in this channel — answer that one first!');
            return;
          }
          const sets = loadSets();
          if (sets.size === 0) {
            await ctx.reply('🚫 No trivia sets installed.');
            return;
          }

          let set = requested ? sets.get(requested) : null;
          if (!set) {
            const all = [...sets.values()];
            set = all[Math.floor(Math.random() * all.length)];
          }

          const memoKey = `${channelId}:${set.set}`;
          const questionIndex = pickQuestionIndex(
            set.questions.length,
            lastIndexByChannelSet.get(memoKey) ?? -1,
          );
          lastIndexByChannelSet.set(memoKey, questionIndex);

          const roundId = `${channelId}-${ctx.message?.createdTimestamp ?? 0}`;
          const round = startRound(channelId, {
            setId: set.set,
            questionIndex,
            answer: set.questions[questionIndex].answer,
            roundId,
          });

          const model = questionModel(set, questionIndex);
          const embed = new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle(model.title)
            .setDescription(
              `${model.question}\n\n${model.choices.map((c) => `**${c.label}.** ${c.text}`).join('\n')}`,
            )
            .setFooter({ text: model.footer });
          const row = new ActionRowBuilder().addComponents(
            model.choices.map((c) =>
              new ButtonBuilder()
                .setCustomId(`trivia:${roundId}:${c.index}`)
                .setLabel(c.label)
                .setStyle(ButtonStyle.Secondary),
            ),
          );

          round.message = await ctx.reply({ embeds: [embed], components: [row] });
          round.timer = setTimeout(() => {
            revealRound(channelId).catch(() => {});
          }, ROUND_SECONDS * 1000);
          round.timer.unref?.();
        },
      },
      {
        // S106: was `!trivia scores`.
        name: 'scores',
        aliases: ['leaderboard', 'board', 'top'],
        description: 'Show the precinct trivia leaderboard.',
        args: [],
        async run(ctx) {

          const rows = scoreboard(getScores(ctx.guild.id), 10);
          const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle('🏆 Trivia Leaderboard');
          embed.setDescription(
            rows.length === 0
              ? `No points scored yet — start a round with \`${ctx.prefix}trivia\`.`
              : rows
                  .map(({ userId, points }, i) => {
                    const medal = ['🥇', '🥈', '🥉'][i] ?? `**${i + 1}.**`;
                    return `${medal} <@${userId}> — ${points} point${points === 1 ? '' : 's'}`;
                  })
                  .join('\n'),
          );
          await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
        },
      },
      {
        // S106: was `!trivia sets`.
        name: 'sets',
        aliases: ['list', 'packs'],
        description: 'List the installed trivia question sets.',
        args: [],
        async run(ctx) {

          const sets = [...loadSets().values()];
          const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle('📚 Trivia Question Sets');
          embed.setDescription(
            sets.length === 0
              ? 'No sets installed. Drop a JSON file in `src/modules/trivia/data/` (see the manual) and redeploy.'
              : sets.map((s) => `**${s.title}** — \`${s.set}\`, ${s.questions.length} questions`).join('\n'),
          );
          embed.setFooter({
            text: `Play one with ${ctx.prefix}trivia <set> · new sets are plain JSON files`,
          });
          await ctx.reply({ embeds: [embed] });
        },
      },
    ],
  },
};
