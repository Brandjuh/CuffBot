// S95 (M17.3 slice C): converted to the flat { command } shape. The set
// choices come from the framework's `choices`, so an unknown set is refused
// with the valid list inline instead of a hand-written pointer. The
// withResponse dance is gone too — ctx.reply returns the sent Message, which
// is exactly what the reveal timer needs to edit.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { pickQuestionIndex, questionModel, revealModel, ROUND_SECONDS } from '../lib/game.js';
import { endRound, getRound, loadSets, startRound } from '../service.js';
import { logger } from '../../../core/logger.js';

// Set choices are generated from the data files, so a new JSON set is
// selectable after a restart — nothing hand-maintained.
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
  command: {
    name: 'trivia',
    description: 'Start a police trivia round — first correct answer wins a point.',
    emoji: '❓',
    // Default: random. An unknown id is refused by the framework with the
    // valid list, so there is no hand-written "run !trivia-sets" pointer.
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
};
