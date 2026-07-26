// The !goal group (S103 = M14). Personal goals are open to everyone; the
// precinct's goals are Manage Server.
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import {
  SOURCES,
  SOURCE_LABELS,
  applyProgress,
  completedCount,
  createGoal,
  findGoal,
  formatGoal,
  goalBoard,
  isComplete,
  percentOf,
  sortGoals,
} from '../lib/goals.js';
import {
  getAllMemberGoals,
  getGoalsConfig,
  getGuildGoals,
  getMemberGoals,
  moveGoal,
  refreshTrackedGoals,
  resetGoals,
  setGoalsConfig,
  updateGuildGoals,
  updateMemberGoals,
} from '../service.js';

const MEDALS = ['🥇', '🥈', '🥉'];

/** Render a list of goals into an embed body, or say the list is empty. */
function listBody(goals, empty) {
  const rows = sortGoals(goals);
  if (rows.length === 0) return empty;
  return rows.map((goal) => formatGoal(goal)).join('\n\n');
}

export default {
  group: {
    name: 'goal',
    aliases: ['goals', 'target'],
    description: 'Track what the precinct — and you — are working towards.',
    emoji: '🎯',
    async status(ctx) {
      // Auto-tracked goals are refreshed before anyone reads them, so the
      // status card is never stale between sweeps.
      await refreshTrackedGoals(ctx.guild, { channel: ctx.channel }).catch(() => 0);
      const config = getGoalsConfig(ctx.guild.id);
      const guildGoals = getGuildGoals(ctx.guild.id);
      const mine = getMemberGoals(ctx.guild.id, ctx.user.id);
      const open = Object.values(guildGoals).filter((g) => !isComplete(g));
      return [
        `**Precinct goals:** ${open.length} open, ${Object.values(guildGoals).length - open.length} reached`,
        `**Your goals:** ${Object.values(mine).filter((g) => !isComplete(g)).length} open, ${completedCount(mine)} reached`,
        `**Milestones announced at:** ${config.milestones.join('%, ')}%${
          config.announceChannelId ? ` in <#${config.announceChannelId}>` : ''
        }`,
        '',
        `\`${ctx.prefix}goal list\` for the precinct's goals · \`${ctx.prefix}goal new 30 Read 30 books\` to start one of your own.`,
      ];
    },
    subcommands: [
      // ── everyone ───────────────────────────────────────────────────────────
      {
        name: 'list',
        aliases: ['precinct', 'server'],
        description: 'The precinct’s goals and how far along they are.',
        args: [],
        async run(ctx) {
          await refreshTrackedGoals(ctx.guild, { channel: ctx.channel }).catch(() => 0);
          const goals = getGuildGoals(ctx.guild.id);
          const embed = new EmbedBuilder()
            .setColor(0x2f6f9f)
            .setTitle('🎯 Precinct Goals')
            .setDescription(
              listBody(goals, `Nothing set yet. An admin can start one with \`${ctx.prefix}goal create 1000 Members\`.`),
            );
          await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
        },
      },
      {
        name: 'mine',
        aliases: ['me'],
        description: 'Your own goals.',
        args: [{ name: 'member', type: 'user' }],
        async run(ctx, { member }) {
          const target = member ?? ctx.user;
          const goals = getMemberGoals(ctx.guild.id, target.id);
          const embed = new EmbedBuilder()
            .setColor(0x4a7f4a)
            .setTitle(`🎯 ${target.id === ctx.user.id ? 'Your' : `${target.username}’s`} goals`)
            .setDescription(
              listBody(
                goals,
                target.id === ctx.user.id
                  ? `None yet. \`${ctx.prefix}goal new 30 Read 30 books\` starts one.`
                  : 'They have not set any goals.',
              ),
            );
          await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
        },
      },
      {
        name: 'new',
        description: 'Start a goal of your own.',
        args: [
          { name: 'target', type: 'integer', required: true, min: 1, max: 1_000_000_000 },
          { name: 'name', type: 'string', required: true, greedy: true, maxLength: 80 },
          { name: 'unit', type: 'string' }, // keyword: unit:books
        ],
        async run(ctx, { target, name, unit }) {
          const config = getGoalsConfig(ctx.guild.id);
          const existing = getMemberGoals(ctx.guild.id, ctx.user.id);
          const open = Object.values(existing).filter((g) => !isComplete(g)).length;
          if (open >= config.perMemberLimit) {
            await ctx.reply(
              `🎯 You already have **${open}** goals open (the limit is ${config.perMemberLimit}). Finish or \`${ctx.prefix}goal drop\` one first.`,
            );
            return;
          }
          const made = createGoal(existing, { name, target, unit, by: ctx.user.id });
          if (!made.ok) {
            await ctx.reply(`🚫 ${made.message}`);
            return;
          }
          updateMemberGoals(ctx.guild.id, ctx.user.id, (goals) => ({ ...goals, [made.goal.id]: made.goal }));
          await ctx.reply(`🎯 Goal set: **${made.goal.name}** — 0 / ${target}${made.goal.unit ? ` ${made.goal.unit}` : ''}.`);
        },
      },
      {
        name: 'log',
        aliases: ['add', 'progress'],
        description: 'Add progress to one of your goals.',
        args: [
          { name: 'amount', type: 'integer', required: true, min: -1_000_000, max: 1_000_000 },
          { name: 'name', type: 'string', required: true, greedy: true },
        ],
        async run(ctx, { amount, name }) {
          const goals = getMemberGoals(ctx.guild.id, ctx.user.id);
          const found = findGoal(goals, name);
          if (!found.ok) {
            await ctx.reply(`🚫 ${found.message}`);
            return;
          }
          const step = applyProgress(found.goal, found.goal.current + amount, { milestones: [] });
          updateMemberGoals(ctx.guild.id, ctx.user.id, (all) => ({ ...all, [step.goal.id]: step.goal }));
          await ctx.reply(
            step.justCompleted
              ? `🎉 **${step.goal.name}** — done! ${step.goal.target}${step.goal.unit ? ` ${step.goal.unit}` : ''}.\n\`${formatGoal(step.goal).split('\n')[1].replaceAll('`', '')}\``
              : `${formatGoal(step.goal)}`,
          );
        },
      },
      {
        name: 'done',
        aliases: ['complete'],
        description: 'Mark one of your goals as reached.',
        args: [{ name: 'name', type: 'string', required: true, greedy: true }],
        async run(ctx, { name }) {
          const goals = getMemberGoals(ctx.guild.id, ctx.user.id);
          const found = findGoal(goals, name);
          if (!found.ok) {
            await ctx.reply(`🚫 ${found.message}`);
            return;
          }
          const step = applyProgress(found.goal, found.goal.target, { milestones: [] });
          updateMemberGoals(ctx.guild.id, ctx.user.id, (all) => ({ ...all, [step.goal.id]: step.goal }));
          await ctx.reply(`🎉 **${step.goal.name}** — reached. Nice work.`);
        },
      },
      {
        name: 'drop',
        aliases: ['delete'],
        description: 'Delete one of your goals.',
        args: [{ name: 'name', type: 'string', required: true, greedy: true }],
        async run(ctx, { name }) {
          const goals = getMemberGoals(ctx.guild.id, ctx.user.id);
          const found = findGoal(goals, name);
          if (!found.ok) {
            await ctx.reply(`🚫 ${found.message}`);
            return;
          }
          updateMemberGoals(ctx.guild.id, ctx.user.id, (all) => {
            const next = { ...all };
            delete next[found.goal.id];
            return next;
          });
          await ctx.reply(`🎯 **${found.goal.name}** dropped.`);
        },
      },
      {
        name: 'board',
        aliases: ['leaderboard', 'top'],
        description: 'Who has finished the most goals.',
        args: [{ name: 'size', type: 'integer', min: 1, max: 25 }],
        async run(ctx, { size = 10 }) {
          const rows = goalBoard(getAllMemberGoals(ctx.guild.id), size);
          const embed = new EmbedBuilder().setColor(0x4a7f4a).setTitle('🎯 Goals Reached');
          embed.setDescription(
            rows.length === 0
              ? 'Nobody has finished a goal yet. Be the first.'
              : rows
                  .map(
                    ({ userId, completed, open }, i) =>
                      `${MEDALS[i] ?? `**${i + 1}.**`} <@${userId}> — **${completed}** reached${open > 0 ? ` · ${open} open` : ''}`,
                  )
                  .join('\n'),
          );
          await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
        },
      },

      // ── the precinct's goals ───────────────────────────────────────────────
      {
        name: 'create',
        description: 'Start a goal for the whole precinct.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [
          { name: 'target', type: 'integer', required: true, min: 1, max: 1_000_000_000 },
          { name: 'name', type: 'string', required: true, greedy: true, maxLength: 80 },
          { name: 'unit', type: 'string' },
          { name: 'track', type: 'string', choices: SOURCES },
        ],
        async run(ctx, { target, name, unit, track = 'manual' }) {
          const made = createGoal(getGuildGoals(ctx.guild.id), {
            name,
            target,
            unit,
            source: track,
            by: ctx.user.id,
          });
          if (!made.ok) {
            await ctx.reply(`🚫 ${made.message}`);
            return;
          }
          updateGuildGoals(ctx.guild.id, (goals) => ({ ...goals, [made.goal.id]: made.goal }));
          // An auto-tracked goal should show its real number immediately, not
          // sit at zero until the first sweep.
          if (track !== 'manual') await refreshTrackedGoals(ctx.guild, { channel: ctx.channel }).catch(() => 0);
          const goal = getGuildGoals(ctx.guild.id)[made.goal.id] ?? made.goal;
          await ctx.reply(
            `🎯 Precinct goal set — ${SOURCE_LABELS[track]}.\n${formatGoal(goal)}`,
          );
        },
      },
      {
        name: 'set',
        description: 'Set a precinct goal’s current value.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [
          { name: 'value', type: 'integer', required: true, min: 0, max: 1_000_000_000 },
          { name: 'name', type: 'string', required: true, greedy: true },
        ],
        async run(ctx, { value, name }) {
          const found = findGoal(getGuildGoals(ctx.guild.id), name);
          if (!found.ok) {
            await ctx.reply(`🚫 ${found.message}`);
            return;
          }
          if (found.goal.source !== 'manual') {
            await ctx.reply(
              `🚫 **${found.goal.name}** is ${SOURCE_LABELS[found.goal.source]} — it would be overwritten on the next sweep. \`${ctx.prefix}goal track manual ${found.goal.name}\` first.`,
            );
            return;
          }
          const result = await moveGoal(ctx.guild, found.goal.id, value, { channel: ctx.channel });
          await ctx.reply(result.ok ? formatGoal(result.goal) : `🚫 ${result.message}`);
        },
      },
      {
        name: 'bump',
        description: 'Add to a precinct goal’s current value.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [
          { name: 'amount', type: 'integer', required: true, min: -1_000_000, max: 1_000_000 },
          { name: 'name', type: 'string', required: true, greedy: true },
        ],
        async run(ctx, { amount, name }) {
          const found = findGoal(getGuildGoals(ctx.guild.id), name);
          if (!found.ok) {
            await ctx.reply(`🚫 ${found.message}`);
            return;
          }
          if (found.goal.source !== 'manual') {
            await ctx.reply(`🚫 **${found.goal.name}** is ${SOURCE_LABELS[found.goal.source]} and counts itself.`);
            return;
          }
          const result = await moveGoal(ctx.guild, found.goal.id, found.goal.current + amount, {
            channel: ctx.channel,
          });
          await ctx.reply(result.ok ? formatGoal(result.goal) : `🚫 ${result.message}`);
        },
      },
      {
        name: 'track',
        description: 'What a precinct goal counts: by hand, members, or boosts.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [
          { name: 'source', type: 'string', required: true, choices: SOURCES },
          { name: 'name', type: 'string', required: true, greedy: true },
        ],
        async run(ctx, { source, name }) {
          const found = findGoal(getGuildGoals(ctx.guild.id), name);
          if (!found.ok) {
            await ctx.reply(`🚫 ${found.message}`);
            return;
          }
          updateGuildGoals(ctx.guild.id, (goals) => ({
            ...goals,
            [found.goal.id]: { ...goals[found.goal.id], source },
          }));
          await refreshTrackedGoals(ctx.guild, { channel: ctx.channel }).catch(() => 0);
          await ctx.reply(
            `🎯 **${found.goal.name}** is now ${SOURCE_LABELS[source]}.\n${formatGoal(getGuildGoals(ctx.guild.id)[found.goal.id])}`,
          );
        },
      },
      {
        name: 'remove',
        description: 'Delete a precinct goal.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'name', type: 'string', required: true, greedy: true }],
        async run(ctx, { name }) {
          const found = findGoal(getGuildGoals(ctx.guild.id), name);
          if (!found.ok) {
            await ctx.reply(`🚫 ${found.message}`);
            return;
          }
          updateGuildGoals(ctx.guild.id, (goals) => {
            const next = { ...goals };
            delete next[found.goal.id];
            return next;
          });
          await ctx.reply(`🎯 **${found.goal.name}** removed.`);
        },
      },
      {
        name: 'channel',
        description: 'Where milestone announcements go.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'channel', type: 'channel', postable: true }],
        async run(ctx, { channel }) {
          if (!channel) {
            setGoalsConfig(ctx.guild.id, { announceChannelId: null });
            await ctx.reply('🎯 Milestones are announced wherever the progress was made.');
            return;
          }
          setGoalsConfig(ctx.guild.id, { announceChannelId: channel.id });
          await ctx.reply({
            content: `🎯 Milestones will be announced in ${channel}.`,
            allowedMentions: { parse: [] },
          });
        },
      },
      {
        name: 'announce',
        description: 'Turn milestone announcements on or off.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'state', type: 'boolean', required: true }],
        async run(ctx, { state }) {
          setGoalsConfig(ctx.guild.id, { enabled: state });
          await ctx.reply(
            state ? '🎯 Milestones will be announced.' : '🎯 Milestones are tracked silently.',
          );
        },
      },
      {
        name: 'reset',
        description: 'Wipe every goal, precinct and personal (irreversible).',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'confirm', type: 'string', choices: ['confirm'] }],
        async run(ctx, { confirm }) {
          if (confirm !== 'confirm') {
            await ctx.reply(
              `🚫 That deletes every goal in the precinct, including everyone's personal ones. Run \`${ctx.prefix}goal reset confirm\` if you mean it.`,
            );
            return;
          }
          resetGoals(ctx.guild.id);
          await ctx.reply('🎯 Every goal is gone. A clean slate.');
        },
      },
    ],
  },
};
