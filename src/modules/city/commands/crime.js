// The !crime group (S90 = M16.13 slice B, CalaMari port): the street-level
// surface over slice A's resolver. The cog drove this with buttons and a
// confirm view; CuffBot is text-only (S68), so each crime is a subcommand and
// the attempt resolves immediately.
import { EmbedBuilder } from 'discord.js';
import { CRIMES } from '../lib/tables.js';
import { streakBonus } from '../lib/resolve.js';
import {
  canAttempt,
  cityBalance,
  commitCrime,
  cooldownFor,
  getCitySettings,
  getCriminal,
  jailState,
} from '../service.js';

const CRIME_COLOUR = 0x8b1a1a;
const WIN = 0xa020f0;
const LOSS = 0xff6600;

const money = (n) => n.toLocaleString('en-US');
const relative = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
const title = (id) => id.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Turn a raw event's display text into something readable in Discord. */
function eventLine(event) {
  return `• ${event.text
    .replaceAll('{credits_bonus}', String(event.credits_bonus ?? 0))
    .replaceAll('{credits_penalty}', String(event.credits_penalty ?? 0))
    .replaceAll('{currency}', '🍩')}`;
}

/** The result card: what happened, what the events did, and the maths. */
export function crimeEmbed(outcome, displayName, { targetName = null } = {}) {
  const crime = CRIMES[outcome.crimeType];
  const lines = [];
  if (outcome.events.length > 0) lines.push(outcome.events.map(eventLine).join('\n'), '');

  if (outcome.success) {
    lines.push(
      targetName
        ? `You lifted **${money(outcome.takenFromTarget)} 🍩** off ${targetName}.`
        : `You got away with **${money(outcome.payout)} 🍩**.`,
    );
    if (outcome.shortfall > 0) lines.push(`-# They only had ${money(outcome.takenFromTarget)} on them.`);
    if (outcome.creditChange !== 0) {
      lines.push(`-# Events ${outcome.creditChange > 0 ? 'added' : 'cost'} ${money(Math.abs(outcome.creditChange))} 🍩 on top.`);
    }
    if (outcome.steps.length > 1) {
      lines.push(
        '',
        '**How it added up**',
        ...outcome.steps.map((step) =>
          step.multiplier ? `-# ${step.label} → ${money(step.amount)}` : `-# ${step.label}: ${money(step.amount)}`,
        ),
      );
    }
    if (outcome.streak.streak > 1) {
      lines.push('', `🔥 **Streak ${outcome.streak.streak}** — ×${outcome.streak.multiplier.toFixed(2)} on your next score.`);
    }
  } else {
    lines.push(
      outcome.brokeAndDoubled
        ? `Busted, and you could not cover the **${money(outcome.fine)} 🍩** fine. They took the **${money(outcome.finePaid)} 🍩** you had and doubled your sentence.`
        : `Busted. A **${money(outcome.fine)} 🍩** fine and a cell.`,
    );
    lines.push(`**Locked up** until ${relative(Date.now() + outcome.jailMs)}.`);
    if (outcome.creditChange !== 0) {
      lines.push(`-# Events ${outcome.creditChange > 0 ? 'added' : 'cost'} ${money(Math.abs(outcome.creditChange))} 🍩.`);
    }
    lines.push('-# Your streak is back to zero.');
  }

  return new EmbedBuilder()
    .setColor(outcome.success ? WIN : LOSS)
    .setTitle(`${crime.emoji} ${title(outcome.crimeType)} — ${outcome.success ? '✅ Clean getaway' : '🚨 Caught'}`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `${displayName} · ${Math.round(outcome.successChance * 100)}% odds after events` });
}

/** Shared runner for all four crimes. */
async function attempt(ctx, crimeType, targetUser = null) {
  const criminal = getCriminal(ctx.guild.id, ctx.user.id);
  const targetBalance = targetUser ? await cityBalance(ctx.guild.id, targetUser.id) : 0;
  const gate = canAttempt(ctx.guild.id, criminal, crimeType, {
    target: targetUser ? { self: targetUser.id === ctx.user.id, bot: targetUser.bot } : null,
    targetBalance,
  });

  if (gate.reason === 'jailed') {
    await ctx.reply(`🚨 You are behind bars until ${relative(gate.releaseAt)}. Sit tight.`);
    return;
  }
  if (gate.reason === 'cooldown') {
    await ctx.reply(`⏱️ Too soon — lie low until ${relative(Date.now() + gate.remainingMs)}.`);
    return;
  }
  if (gate.reason === 'target-required') {
    await ctx.reply(`🚫 That one needs a mark: \`${ctx.prefix}crime ${crimeType === 'pickpocket' ? 'pickpocket' : 'mug'} @member\`.`);
    return;
  }
  if (gate.reason === 'target-self') {
    await ctx.reply('🚫 Robbing yourself is not a crime, just sad.');
    return;
  }
  if (gate.reason === 'target-bot') {
    await ctx.reply('🚫 Bots carry no cash.');
    return;
  }
  if (gate.reason === 'target-too-poor') {
    await ctx.reply(`🚫 They are carrying less than **${money(gate.minimum)} 🍩** — not worth the risk.`);
    return;
  }

  const outcome = await commitCrime(ctx.guild.id, ctx.user.id, crimeType, { targetId: targetUser?.id ?? null });
  await ctx.reply({
    embeds: [
      crimeEmbed(outcome, ctx.member?.displayName ?? ctx.user.username, {
        targetName: targetUser ? `<@${targetUser.id}>` : null,
      }),
    ],
    allowedMentions: { parse: [] },
  });
}

export default {
  group: {
    name: 'crime',
    aliases: ['city'],
    description: 'The city underworld: pick pockets, mug, rob stores, hit banks — and hope the sirens stay quiet.',
    emoji: '🌃',
    status(ctx) {
      const criminal = getCriminal(ctx.guild.id, ctx.user.id);
      const jail = jailState(criminal);
      const settings = getCitySettings(ctx.guild.id);
      const now = Date.now();
      const board = Object.keys(CRIMES)
        .filter((type) => type !== 'random')
        .map((type) => {
          const crime = CRIMES[type];
          const left = cooldownFor(criminal, type, now);
          return `${crime.emoji} **${title(type)}** — ${money(crime.minReward)}–${money(crime.maxReward)} 🍩 · ${Math.round(crime.successRate * 100)}% · ${left > 0 ? `⏱️ ${relative(now + left)}` : '✅ ready'}`;
        });
      return [
        `Pick a job: \`${ctx.prefix}crime pickpocket @member\`, \`${ctx.prefix}crime mug @member\`, \`${ctx.prefix}crime store\`, \`${ctx.prefix}crime bank\`. Every attempt draws random events that swing the odds, the take and the sentence.`,
        '',
        ...board,
        '',
        criminal.streak > 0
          ? `🔥 **Streak ${criminal.streak}** — ×${streakBonus(criminal.streak).toFixed(2)} on your next score (dies after a day off).`
          : '**Streak:** none — consecutive successes pay up to +25%.',
        jail.jailed
          ? `🚨 **In a cell** until ${relative(jail.releaseAt)}${settings.allowBail ? ' — bail lands in a later update' : ''}`
          : '**Status:** free to work.',
      ];
    },
    subcommands: [
      {
        name: 'pickpocket',
        aliases: ['pick', 'pocket'],
        description: 'Lift a small share of someone’s donuts. Low risk, low reward.',
        args: [{ name: 'member', type: 'user', required: false }],
        async run(ctx, { member }) {
          await attempt(ctx, 'pickpocket', member ?? null);
        },
      },
      {
        name: 'mug',
        aliases: ['mugging'],
        description: 'Take a bigger cut off a member — more reward, more heat.',
        args: [{ name: 'member', type: 'user', required: false }],
        async run(ctx, { member }) {
          await attempt(ctx, 'mugging', member ?? null);
        },
      },
      {
        name: 'store',
        aliases: ['rob', 'rob_store'],
        description: 'Rob a corner store: 500–2000 🍩 at even odds, six-hour cooldown.',
        args: [],
        async run(ctx) {
          await attempt(ctx, 'rob_store');
        },
      },
      {
        name: 'bank',
        aliases: ['heist', 'bank_heist'],
        description: 'Hit the bank: 1500–5000 🍩 at 40%, once a day, four hours inside if it goes wrong.',
        args: [],
        async run(ctx) {
          await attempt(ctx, 'bank_heist');
        },
      },
      {
        name: 'stats',
        aliases: ['record'],
        description: 'Your criminal record, or someone else’s.',
        args: [{ name: 'member', type: 'user', required: false }],
        async run(ctx, { member }) {
          const target = member ?? ctx.user;
          const criminal = getCriminal(ctx.guild.id, target.id);
          const stats = criminal.stats;
          const attempts = stats.successes + stats.failures;
          const rate = attempts > 0 ? ((stats.successes / attempts) * 100).toFixed(1) : '0.0';
          const jail = jailState(criminal);
          await ctx.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(CRIME_COLOUR)
                .setTitle(`🌃 ${target.username}'s record`)
                .setDescription(
                  [
                    `**Jobs pulled:** ${stats.successes} clean · ${stats.failures} busted (${rate}% success)`,
                    `**Earned:** ${money(stats.earned)} 🍩 · **biggest score:** ${money(stats.largestHeist)} 🍩`,
                    `**Fines paid:** ${money(stats.finesPaid)} 🍩`,
                    `**Lifted off others:** ${money(stats.stolenFrom)} 🍩 · **lost to others:** ${money(stats.stolenBy)} 🍩`,
                    `**Streak:** ${criminal.streak} now · ${criminal.highest} best`,
                    jail.jailed ? `**🚨 In a cell** until ${relative(jail.releaseAt)}` : '**Status:** at large',
                  ].join('\n'),
                ),
            ],
            allowedMentions: { parse: [] },
          });
        },
      },
    ],
  },
};
