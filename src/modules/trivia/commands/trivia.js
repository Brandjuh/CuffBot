import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { pickQuestionIndex, questionModel, revealModel, ROUND_SECONDS } from '../lib/game.js';
import { endRound, getRound, loadSets, startRound } from '../service.js';
import { logger } from '../../../core/logger.js';

// Set choices are generated from the data files, so a new JSON set shows up in
// the picker on the next deploy-commands run — nothing hand-maintained.
const SETS = loadSets();
const lastIndexByChannelSet = new Map(); // `${channelId}:${setId}` → last question index

function buildData() {
  const builder = new SlashCommandBuilder()
    .setName('trivia')
    .setDescription('Start a police trivia round — first correct answer wins a point.');
  const option = (o) => {
    o.setName('set').setDescription('Which question set to draw from (default: random)');
    for (const set of SETS.values()) o.addChoices({ name: set.title, value: set.set });
    return o;
  };
  return builder.addStringOption(option);
}

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
  data: buildData(),
  async execute(interaction) {
    const channelId = interaction.channel?.id;
    if (!channelId) {
      await interaction.reply({ content: '🚫 Trivia needs a channel.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (getRound(channelId)) {
      await interaction.reply({
        content: '🚫 A trivia round is already running in this channel — answer that one first!',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const sets = loadSets();
    if (sets.size === 0) {
      await interaction.reply({ content: '🚫 No trivia sets installed.', flags: MessageFlags.Ephemeral });
      return;
    }

    const requested = interaction.options.getString('set');
    let set = requested ? sets.get(requested) : null;
    if (requested && !set) {
      await interaction.reply({
        content: `🚫 Unknown set \`${requested}\`. Run \`/trivia-sets\` to see what's on file.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!set) {
      const all = [...sets.values()];
      set = all[Math.floor(Math.random() * all.length)];
    }

    const memoKey = `${channelId}:${set.set}`;
    const questionIndex = pickQuestionIndex(set.questions.length, lastIndexByChannelSet.get(memoKey) ?? -1);
    lastIndexByChannelSet.set(memoKey, questionIndex);

    const roundId = `${channelId}-${interaction.createdTimestamp ?? 0}`;
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
      .setDescription(`${model.question}\n\n${model.choices.map((c) => `**${c.label}.** ${c.text}`).join('\n')}`)
      .setFooter({ text: model.footer });
    const row = new ActionRowBuilder().addComponents(
      model.choices.map((c) =>
        new ButtonBuilder().setCustomId(`trivia:${roundId}:${c.index}`).setLabel(c.label).setStyle(ButtonStyle.Secondary),
      ),
    );

    const response = await interaction.reply({ embeds: [embed], components: [row], withResponse: true });
    round.message = response?.resource?.message ?? null;
    round.timer = setTimeout(() => {
      revealRound(channelId).catch(() => {});
    }, ROUND_SECONDS * 1000);
    round.timer.unref?.();
  },
};
