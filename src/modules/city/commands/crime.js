// The !crime group (S90 = M16.13 slice B, CalaMari port): the street-level
// surface over slice A's resolver. The cog drove this with buttons and a
// confirm view; CuffBot is text-only (S68), so each crime is a subcommand and
// the attempt resolves immediately.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
} from 'discord.js';
import { attemptPanel, crimePanel, shortWait } from '../lib/panel.js';
import { forgetAttempt, trackAttempt } from '../attempts.js';
import { CRIMES } from '../lib/tables.js';
import { streakBonus } from '../lib/resolve.js';
import {
  LEADERBOARD_CATEGORIES,
  attemptJailbreak,
  buyMarketItem,
  canAttempt,
  cityLeaderboard,
  cityBalance,
  commitCrime,
  commitScenarioCrime,
  cooldownFor,
  getCitySettings,
  getCriminal,
  jailState,
  marketCatalogue,
  payCityBail,
  setCitySettings,
  useJailPass,
} from '../service.js';
import { MARKET_ITEMS } from '../lib/market.js';
import { PermissionFlagsBits } from 'discord.js';
import { bailCost } from '../lib/resolve.js';

const CRIME_COLOUR = 0x8b1a1a;
const WIN = 0xa020f0;
const LOSS = 0xff6600;

const money = (n) => n.toLocaleString('en-US');
const relative = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
const title = (id) => id.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const normalizeItemId = (raw) => String(raw).toLowerCase().trim().replaceAll(' ', '_');
const TEAL_ADMIN = 0x11806a;

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
  if (outcome.scenario) {
    const flavour = outcome.success ? outcome.scenario.success_text : outcome.scenario.fail_text;
    lines.push(`*${flavour.replaceAll('{user}', displayName).replaceAll('{currency}', '🍩')}*`, '');
  }
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
    .setTitle(
      `${crime.emoji} ${outcome.scenario ? outcome.scenario.name : title(outcome.crimeType)} — ${outcome.success ? '✅ Clean getaway' : '🚨 Caught'}`,
    )
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
    // S122: `city` was an alias, which made `!city` and `!crime` literally the
    // same command — the owner noticed ("de spellen Crime/city zijn hetzelfde").
    // In the source they are TWO commands: `[p]city` is the hub and `[p]crime`
    // the crime subsystem. Until the hub exists, one name is honest and two
    // names for one thing is not.
    aliases: [],
    description: 'The city underworld: pick pockets, mug, rob stores, hit banks — and hope the sirens stay quiet.',
    emoji: '🌃',
    invokeWithoutSubcommand: true,
    fallback: 'panel',
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
        `Pick a job: \`${ctx.prefix}crime pickpocket @member\`, \`${ctx.prefix}crime mug @member\`, \`${ctx.prefix}crime store\`, \`${ctx.prefix}crime bank\`, or \`${ctx.prefix}crime random\` for one of 46 one-off scores. Every attempt draws random events that swing the odds, the take and the sentence.`,
        '',
        ...board,
        '',
        criminal.streak > 0
          ? `🔥 **Streak ${criminal.streak}** — ×${streakBonus(criminal.streak).toFixed(2)} on your next score (dies after a day off).`
          : '**Streak:** none — consecutive successes pay up to +25%.',
        jail.jailed
          ? `🚨 **In a cell** until ${relative(jail.releaseAt)} — ${settings.allowBail ? `bail costs **${money(bailCost(jail.remainingMs, settings))} 🍩** (\`${ctx.prefix}crime bail\`)` : 'no bail in this precinct'}, or gamble on \`${ctx.prefix}crime jailbreak\` (one shot).`
          : '**Status:** free to work.',
      ];
    },
    subcommands: [
      {
        name: 'panel',
        aliases: ['open'], // `board` is already the leaderboard
        description: 'Open the city panel — pick a job from the menu.',
        args: [],
        async run(ctx) {
          await ctx.reply(await panelPayload(ctx.guild, ctx.user));
        },
      },
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
        name: 'random',
        aliases: ['lucky', 'scenario'],
        description: 'Take whatever the street offers — one of 46 one-off jobs, odds and all.',
        args: [],
        async run(ctx) {
          const criminal = getCriminal(ctx.guild.id, ctx.user.id);
          const gate = canAttempt(ctx.guild.id, criminal, 'random', {});
          if (gate.reason === 'jailed') {
            await ctx.reply(`🚨 You are behind bars until ${relative(gate.releaseAt)}. \`${ctx.prefix}crime bail\` or \`${ctx.prefix}crime jailbreak\`.`);
            return;
          }
          if (gate.reason === 'cooldown') {
            await ctx.reply(`⏱️ Nothing doing yet — try again ${relative(Date.now() + gate.remainingMs)}.`);
            return;
          }
          const outcome = await commitScenarioCrime(ctx.guild.id, ctx.user.id);
          await ctx.reply({
            embeds: [crimeEmbed(outcome, ctx.member?.displayName ?? ctx.user.username)],
            allowedMentions: { parse: [] },
          });
        },
      },
      {
        name: 'bail',
        description: 'Buy your way out — the price tracks what is left of your sentence.',
        args: [],
        async run(ctx) {
          const result = await payCityBail(ctx.guild.id, ctx.user.id);
          if (result.error === 'bail-disabled') {
            await ctx.reply('🚫 This precinct does not take bail. Sit it out or try your luck.');
            return;
          }
          if (result.error === 'not-jailed') {
            await ctx.reply('You are not in a cell.');
            return;
          }
          if (result.error === 'too-poor') {
            await ctx.reply(`🚫 Bail is **${money(result.cost)} 🍩** and you have **${money(result.balance)}**.`);
            return;
          }
          await ctx.reply(`🔓 Paid **${money(result.cost)} 🍩** — you walk. Try to make it count.`);
        },
      },
      {
        name: 'jailbreak',
        aliases: ['break', 'escape'],
        description: 'One shot per sentence: run for it, or add 30% to your time.',
        args: [],
        async run(ctx) {
          const result = await attemptJailbreak(ctx.guild.id, ctx.user.id);
          if (result.error === 'not-jailed') {
            await ctx.reply('You are already a free officer.');
            return;
          }
          if (result.error === 'already-tried') {
            await ctx.reply('🚫 You already tried that this sentence. The guards are watching you now.');
            return;
          }
          const name = ctx.member?.displayName ?? ctx.user.username;
          const flavour = (result.success ? result.scenario.success_text : result.scenario.fail_text)
            .replaceAll('{user}', name)
            .replaceAll('{currency}', '🍩');
          const lines = [`*${result.scenario.attempt_text.replaceAll('{user}', name)}*`, ''];
          for (const event of result.events) {
            let line = `• ${event.text.replaceAll('{currency}', '🍩')}`;
            if (event.currency_bonus) line += ` (+${money(event.currency_bonus)} 🍩)`;
            if (event.currency_penalty) line += ` (−${money(event.currency_penalty)} 🍩)`;
            lines.push(line);
          }
          if (result.events.length > 0) lines.push('');
          lines.push(flavour);
          if (!result.success) {
            lines.push('', `⛓️ **+30% on your sentence** — out ${relative(Date.now() + result.remainingMs)}.`);
          }
          await ctx.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(result.success ? WIN : LOSS)
                .setTitle(result.success ? '🔓 Successful jailbreak!' : '⛓️ Failed jailbreak!')
                .setDescription(lines.join('\n'))
                .setFooter({ text: `${name} · ${Math.round(result.chance * 100)}% odds after events` }),
            ],
            allowedMentions: { parse: [] },
          });
        },
      },
      {
        name: 'market',
        aliases: ['blackmarket', 'shop'],
        description: 'The black market: a lighter sentence, or a way straight out of one.',
        args: [],
        async run(ctx) {
          const criminal = getCriminal(ctx.guild.id, ctx.user.id);
          const balance = await cityBalance(ctx.guild.id, ctx.user.id);
          const lines = marketCatalogue().map((item) => {
            const owned =
              item.type === 'perk'
                ? criminal.perks.includes(item.id)
                  ? ' · **owned**'
                  : ''
                : (criminal.items[item.id] ?? 0) > 0
                  ? ` · **you hold ${criminal.items[item.id]}**`
                  : '';
            return `${item.emoji} **${item.name}** — ${money(item.cost)} 🍩${owned}\n-# ${item.description}`;
          });
          await ctx.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(CRIME_COLOUR)
                .setTitle('🕯️ The black market')
                .setDescription(lines.join('\n\n'))
                .setFooter({ text: `You hold ${money(balance)} 🍩 · ${ctx.prefix}crime buy <item>` }),
            ],
          });
        },
      },
      {
        name: 'buy',
        description: 'Buy from the black market.',
        args: [{ name: 'item', type: 'string', required: true }],
        async run(ctx, { item }) {
          const id = normalizeItemId(item);
          const result = await buyMarketItem(ctx.guild.id, ctx.user.id, id);
          if (result.error === 'unknown-item') {
            await ctx.reply(`🚫 Nothing by that name — see \`${ctx.prefix}crime market\`.`);
            return;
          }
          if (result.error === 'already-owned') {
            await ctx.reply('🚫 You already have that perk — it is permanent.');
            return;
          }
          if (result.error === 'too-poor') {
            await ctx.reply(`🚫 That costs **${money(result.cost)} 🍩** and you have **${money(result.balance)}**.`);
            return;
          }
          await ctx.reply(
            `✅ Bought ${result.item.emoji} **${result.item.name}** for **${money(result.item.cost)} 🍩**.` +
              (result.item.type === 'consumable' ? ` Use it with \`${ctx.prefix}crime usepass\`.` : ''),
          );
        },
      },
      {
        name: 'usepass',
        aliases: ['pass'],
        description: 'Burn a Get Out of Jail Free card.',
        args: [],
        async run(ctx) {
          const result = useJailPass(ctx.guild.id, ctx.user.id);
          if (result.error === 'no-pass') {
            await ctx.reply(`🚫 You have no card — \`${ctx.prefix}crime market\` sells them.`);
            return;
          }
          if (result.error === 'not-jailed') {
            await ctx.reply('You are not in a cell — keep the card for when you are.');
            return;
          }
          await ctx.reply(`🔑 You flash the card and walk. **${result.left}** left in your pocket.`);
        },
      },
      {
        name: 'leaderboard',
        aliases: ['board', 'top'],
        description: `The precinct's most wanted (${Object.keys(LEADERBOARD_CATEGORIES).join(', ')}).`,
        args: [{ name: 'category', type: 'string', required: false, choices: Object.keys(LEADERBOARD_CATEGORIES) }],
        async run(ctx, { category }) {
          const key = category ?? 'earned';
          const spec = LEADERBOARD_CATEGORIES[key];
          const rows = cityLeaderboard(ctx.guild.id, key);
          if (rows.length === 0) {
            await ctx.reply('Nobody has a record worth showing yet.');
            return;
          }
          const medals = ['🥇', '🥈', '🥉'];
          await ctx.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(CRIME_COLOUR)
                .setTitle(`🌃 Most wanted — ${spec.label}`)
                .setDescription(
                  rows
                    .map((row, i) => `${medals[i] ?? `**${i + 1}.**`} <@${row.id}> — **${money(row.value)}**${spec.suffix}`)
                    .join('\n'),
                )
                .setFooter({ text: `${ctx.prefix}crime leaderboard <${Object.keys(LEADERBOARD_CATEGORIES).join('|')}>` }),
            ],
            allowedMentions: { parse: [] },
          });
        },
      },
      {
        name: 'admin',
        description: 'Tune the underworld: bail, steal limits.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [
          { name: 'setting', type: 'string', required: false },
          { name: 'value', type: 'string', required: false },
        ],
        async run(ctx, { setting, value }) {
          const settings = getCitySettings(ctx.guild.id);
          const knobs = {
            allowbail: { key: 'allowBail', label: 'Bail allowed', boolean: true },
            bailmultiplier: { key: 'bailCostMultiplier', label: 'Bail cost per minute', min: 0, max: 100, float: true },
            minstealbalance: { key: 'minStealBalance', label: 'Minimum balance to be robbable', min: 0, max: 1_000_000 },
            maxstealamount: { key: 'maxStealAmount', label: 'Maximum a single steal can take', min: 1, max: 10_000_000 },
          };

          if (!setting || normalizeItemId(setting) === 'show') {
            await ctx.reply({
              embeds: [
                new EmbedBuilder()
                  .setColor(TEAL_ADMIN)
                  .setTitle('⚙️ Underworld settings')
                  .setDescription(
                    Object.entries(knobs)
                      .map(([name, knob]) => `**${name}** — ${knob.label}: \`${settings[knob.key]}\``)
                      .join('\n'),
                  )
                  .setFooter({ text: `${ctx.prefix}crime admin <setting> <value>` }),
              ],
            });
            return;
          }

          const knob = knobs[normalizeItemId(setting)];
          if (!knob) {
            await ctx.reply(`🚫 Unknown setting. Try: ${Object.keys(knobs).join(', ')}.`);
            return;
          }
          if (value === undefined) {
            await ctx.reply(`🚫 Usage: \`${ctx.prefix}crime admin ${normalizeItemId(setting)} <value>\``);
            return;
          }
          if (knob.boolean) {
            const on = ['on', 'true', 'yes', 'ja', '1'].includes(String(value).toLowerCase());
            setCitySettings(ctx.guild.id, { [knob.key]: on });
            await ctx.reply(`✅ ${knob.label}: **${on ? 'yes' : 'no'}**.`);
            return;
          }
          const parsed = knob.float ? Number(value) : Number.parseInt(value, 10);
          if (!Number.isFinite(parsed) || parsed < knob.min || parsed > knob.max) {
            await ctx.reply(`🚫 ${knob.label} must be ${knob.min}–${knob.max}.`);
            return;
          }
          setCitySettings(ctx.guild.id, { [knob.key]: parsed });
          await ctx.reply(`✅ ${knob.label} is now **${parsed}**.`);
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
                    criminal.perks.length > 0 || Object.keys(criminal.items).length > 0
                      ? `**Kit:** ${[...criminal.perks.map((id) => `${MARKET_ITEMS[id]?.emoji ?? '•'} ${MARKET_ITEMS[id]?.name ?? id}`), ...Object.entries(criminal.items).map(([id, n]) => `${MARKET_ITEMS[id]?.emoji ?? '•'} ${MARKET_ITEMS[id]?.name ?? id} ×${n}`)].join(' · ')}`
                      : null,
                    jail.jailed ? `**🚨 In a cell** until ${relative(jail.releaseAt)}` : '**Status:** at large',
                  ].filter(Boolean).join('\n'),
                ),
            ],
            allowedMentions: { parse: [] },
          });
        },
      },
    ],
  },
};

// ── the panel (M26.3a) ───────────────────────────────────────────────────────

/** Render the caller's personal city panel as a discord.js payload. */
export async function panelPayload(guild, user) {
  const criminal = getCriminal(guild.id, user.id);
  const balance = await cityBalance(guild.id, user.id);
  const view = crimePanel({
    criminal,
    balance,
    jail: jailState(criminal),
    cooldownLeft: (type, at) => cooldownFor(criminal, type, at),
  });

  const rows = [];
  if (view.options.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`cty:pick:${user.id}`)
      .setPlaceholder('Pick a job…')
      .addOptions(
        view.options.map((o) => ({
          label: o.label,
          value: o.type,
          emoji: o.emoji,
          // The reason a job is unavailable belongs in the row, not in a
          // refusal after the fact.
          description: o.selectable
            ? `${o.reward} 🍩 · ${o.risk} risk${o.requiresTarget ? ' · needs a mark' : ''}`
            : `⏳ ${o.unavailable}`,
        })),
      );
    // Discord has no per-option disabling, so an all-cooldown board disables
    // the whole menu rather than offering picks that would only be refused.
    menu.setDisabled(view.options.every((o) => !o.selectable));
    rows.push(new ActionRowBuilder().addComponents(menu));
  }
  if (view.buttons.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        view.buttons.map((b) =>
          new ButtonBuilder()
            .setCustomId(`cty:${b.id}:${user.id}`)
            .setLabel(b.label)
            .setEmoji(b.emoji)
            .setStyle(PANEL_STYLES[b.style]),
        ),
      ),
    );
  }

  return {
    embeds: [new EmbedBuilder().setTitle(view.title).setDescription(view.lines.join('\n')).setColor(0x8e44ad)],
    components: rows,
    allowedMentions: { parse: [] },
  };
}

const PANEL_STYLES = {
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
  secondary: ButtonStyle.Secondary,
  primary: ButtonStyle.Primary,
};

/**
 * Run a crime picked from the panel, with the source's Bail Out window.
 *
 * The cog posts the attempt, sleeps 2 s, then checks whether the player bailed
 * before resolving — so the button is a live decision, not decoration. That
 * sleep is the mechanic and is reproduced; `wait` is injectable so a test does
 * not spend two real seconds per case.
 *
 * ⚠️ **Recorded deviation:** the cog re-checks `bailed` between each narrated
 * event, giving a longer window. Our resolver settles a crime in one call, so
 * the window is the 2 s beat. Same decision, same price, fewer chances to take
 * it — splitting the resolver is 26.3b.
 */
export async function attemptFromPanel(interaction, crimeType, { wait = defaultWait } = {}) {
  const criminal = getCriminal(interaction.guild.id, interaction.user.id);
  const gate = canAttempt(interaction.guild.id, criminal, crimeType, {
    target: CRIMES[crimeType]?.requiresTarget ? null : undefined,
  });
  if (gate.reason === 'target-required') {
    await interaction.reply({
      content: `🌃 That one needs a mark — \`${'!'}crime ${crimeType} @member\` picks one.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!gate.ok) {
    await interaction.reply({
      content:
        gate.reason === 'jailed'
          ? '🚨 You are behind bars.'
          : gate.reason === 'cooldown'
            ? `⏱️ Not yet — ${shortWait(gate.remainingMs)} to go.`
            : '🚫 You cannot run that one right now.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const view = attemptPanel(crimeType, interaction.user.id);
  const sent = await interaction
    .reply({
      embeds: [new EmbedBuilder().setTitle(view.title).setDescription(view.lines.join('\n')).setColor(0xe67e22)],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`cty:bail-out:${crimeType}:${interaction.user.id}`)
            .setLabel(view.buttons[0].label)
            .setEmoji(view.buttons[0].emoji)
            .setStyle(ButtonStyle.Danger),
        ),
      ],
      withResponse: true,
      fetchReply: true,
    })
    .catch(() => null);

  const messageId = sent?.id ?? sent?.resource?.message?.id ?? null;
  const live = messageId ? trackAttempt(messageId) : { bailed: false, settled: false };

  await wait(BEAT_MS);
  if (live.bailed) return; // the button already replaced the message

  live.settled = true;
  if (messageId) forgetAttempt(messageId);

  const outcome = await commitCrime(interaction.guild.id, interaction.user.id, crimeType);
  await interaction
    .editReply({
      embeds: [crimeEmbed(outcome, interaction.member?.displayName ?? interaction.user.username, {})],
      components: [],
    })
    .catch(() => {});
}

/** The cog's `asyncio.sleep(2)` after posting the attempt. */
export const BEAT_MS = 2_000;
const defaultWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.());
