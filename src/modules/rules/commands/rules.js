// The !rules group (S97 = M18). Authoring is deliberately plain — one line of
// text per rule — because the owner asked for an EASY way to write rules; the
// polish lives in how the bot renders them, not in what an admin has to type.
//
// Every mutation republishes, so the published post is never stale. Reading
// the rules is public (`!rules` shows them); changing them is Manage Server.
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import {
  addRule,
  clearRules,
  editRule,
  moveRule,
  removeRule,
} from '../lib/rules.js';
import {
  buildRulesPayloads,
  getRules,
  getRulesConfig,
  publishRules,
  publishedAt,
  setRules,
  setRulesConfig,
} from '../service.js';

const MANAGE = PermissionFlagsBits.ManageGuild;

/** Apply a pure mutation, store it, republish, and report — the whole loop. */
async function apply(ctx, result) {
  if (!result.ok) {
    await ctx.reply(`🚫 ${result.message}`);
    return;
  }
  setRules(ctx.guild.id, result.rules);
  const outcome = await publishRules(ctx.guild).catch(() => 'failed');
  await ctx.reply(`${result.message}${publishNote(ctx, outcome)}`);
}

/** One consistent sentence about what happened to the published post. */
function publishNote(ctx, outcome) {
  switch (outcome) {
    case 'edited':
      return ' The published rulebook was updated.';
    case 'posted':
      return ' The rulebook was (re)posted.';
    case 'unconfigured':
      return ` _Not published anywhere yet — set a channel with \`${ctx.prefix}rules channel #channel\`._`;
    case 'missing-channel':
      return ' ⚠️ _The configured rules channel is gone or unreadable._';
    default:
      return ' ⚠️ _Publishing failed — check the bot log._';
  }
}

export default {
  group: {
    name: 'rules',
    aliases: ['rule'],
    description: 'The precinct rulebook: write the rules, the bot keeps one tidy post current.',
    emoji: '📜',
    async status(ctx) {
      const rules = getRules(ctx.guild.id);
      const config = getRulesConfig(ctx.guild.id);
      const published = publishedAt(ctx.guild.id);
      return [
        `**Rules on the books:** ${rules.length}`,
        `**Channel:** ${config.channelId ? `<#${config.channelId}>` : '_not set_'}`,
        `**Published:** ${
          published
            ? `yes — ${published.messageIds.length} message(s) in <#${published.channelId}>`
            : '_not yet_'
        }`,
      ];
    },
    subcommands: [
      {
        name: 'show',
        aliases: ['list', 'read'],
        description: 'Read the rules right here (everyone).',
        args: [],
        async run(ctx) {
          const payloads = buildRulesPayloads(ctx.guild.id);
          for (const payload of payloads) await ctx.reply(payload);
        },
      },
      {
        name: 'add',
        description: 'Add a rule to the end of the book.',
        permission: MANAGE,
        args: [{ name: 'text', type: 'string', required: true, greedy: true }],
        async run(ctx, { text }) {
          await apply(ctx, addRule(getRules(ctx.guild.id), text));
        },
      },
      {
        name: 'edit',
        aliases: ['rewrite'],
        description: 'Rewrite one rule, keeping its number.',
        permission: MANAGE,
        args: [
          { name: 'number', type: 'integer', required: true, min: 1 },
          { name: 'text', type: 'string', required: true, greedy: true },
        ],
        async run(ctx, { number, text }) {
          await apply(ctx, editRule(getRules(ctx.guild.id), number, text));
        },
      },
      {
        name: 'remove',
        aliases: ['delete'],
        description: 'Remove a rule — the ones below it move up.',
        permission: MANAGE,
        args: [{ name: 'number', type: 'integer', required: true, min: 1 }],
        async run(ctx, { number }) {
          await apply(ctx, removeRule(getRules(ctx.guild.id), number));
        },
      },
      {
        name: 'move',
        description: 'Move a rule to another position.',
        permission: MANAGE,
        args: [
          { name: 'from', type: 'integer', required: true, min: 1 },
          { name: 'to', type: 'integer', required: true, min: 1 },
        ],
        async run(ctx, { from, to }) {
          await apply(ctx, moveRule(getRules(ctx.guild.id), from, to));
        },
      },
      {
        name: 'clear',
        description: 'Erase every rule (irreversible).',
        permission: MANAGE,
        args: [{ name: 'confirm', type: 'string', choices: ['confirm'] }],
        async run(ctx, { confirm }) {
          if (confirm !== 'confirm') {
            const rules = getRules(ctx.guild.id);
            await ctx.reply(
              `🚫 That erases all ${rules.length} rules. Run \`${ctx.prefix}rules clear confirm\` if you mean it.`,
            );
            return;
          }
          await apply(ctx, clearRules(getRules(ctx.guild.id)));
        },
      },
      {
        name: 'channel',
        description: 'Set the channel the rulebook is published to.',
        permission: MANAGE,
        args: [{ name: 'channel', type: 'channel', required: true, postable: true }],
        async run(ctx, { channel }) {
          setRulesConfig(ctx.guild.id, { channelId: channel.id });
          const outcome = await publishRules(ctx.guild).catch(() => 'failed');
          await ctx.reply({
            content: `📜 The rulebook lives in ${channel} now.${publishNote(ctx, outcome)}`,
            allowedMentions: { parse: [] },
          });
        },
      },
      {
        name: 'title',
        description: 'Set the heading of the published post.',
        permission: MANAGE,
        args: [{ name: 'text', type: 'string', required: true, greedy: true, maxLength: 256 }],
        async run(ctx, { text }) {
          setRulesConfig(ctx.guild.id, { title: text });
          const outcome = await publishRules(ctx.guild).catch(() => 'failed');
          await ctx.reply(`📜 Title set.${publishNote(ctx, outcome)}`);
        },
      },
      {
        name: 'intro',
        aliases: ['header'],
        description: 'Text above the first rule (empty to clear).',
        permission: MANAGE,
        args: [{ name: 'text', type: 'string', greedy: true, maxLength: 1000 }],
        async run(ctx, { text = '' }) {
          setRulesConfig(ctx.guild.id, { header: text });
          const outcome = await publishRules(ctx.guild).catch(() => 'failed');
          await ctx.reply(`📜 Intro ${text ? 'set' : 'cleared'}.${publishNote(ctx, outcome)}`);
        },
      },
      {
        name: 'outro',
        aliases: ['footer'],
        description: 'Text below the last rule (empty to clear).',
        permission: MANAGE,
        args: [{ name: 'text', type: 'string', greedy: true, maxLength: 1000 }],
        async run(ctx, { text = '' }) {
          setRulesConfig(ctx.guild.id, { footer: text });
          const outcome = await publishRules(ctx.guild).catch(() => 'failed');
          await ctx.reply(`📜 Outro ${text ? 'set' : 'cleared'}.${publishNote(ctx, outcome)}`);
        },
      },
      {
        name: 'publish',
        aliases: ['refresh', 'repost'],
        description: 'Force the published post back in line with the stored rules.',
        permission: MANAGE,
        args: [],
        async run(ctx) {
          const outcome = await publishRules(ctx.guild).catch(() => 'failed');
          const said = {
            edited: '📜 Rulebook refreshed in place.',
            posted: '📜 Rulebook posted.',
            unconfigured: `🚫 No rules channel set — \`${ctx.prefix}rules channel #channel\` first.`,
            'missing-channel': '🚫 The configured rules channel is gone or I cannot post there.',
            failed: '🚫 Publishing failed — check the bot log.',
          };
          await ctx.reply(said[outcome] ?? said.failed);
        },
      },
      {
        name: 'preview',
        description: 'See exactly what would be published, without publishing it.',
        permission: MANAGE,
        args: [],
        async run(ctx) {
          const payloads = buildRulesPayloads(ctx.guild.id);
          await ctx.reply(
            `📜 Preview — ${payloads.length} message(s) would be published:`,
          );
          for (const payload of payloads) await ctx.reply(payload);
        },
      },
      {
        name: 'export',
        description: 'The rules as plain numbered text, ready to copy elsewhere.',
        permission: MANAGE,
        args: [],
        async run(ctx) {
          const rules = getRules(ctx.guild.id);
          if (rules.length === 0) {
            await ctx.reply('📜 There are no rules yet.');
            return;
          }
          const body = rules.map((text, i) => `${i + 1}. ${text}`).join('\n');
          // Deliberately fenced: an export is for copying, so mentions and
          // markdown inside a rule must show as typed.
          const embed = new EmbedBuilder()
            .setColor(getRulesConfig(ctx.guild.id).color)
            .setTitle('📜 Rules — plain text')
            .setDescription(`\`\`\`\n${body.slice(0, 3900)}\n\`\`\``);
          await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
        },
      },
    ],
  },
};
