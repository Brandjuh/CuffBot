// The !heist group (S86 = M16.12 slice B, maxcogs port): the command surface
// over slice A's rules engine. The cog drove everything through select menus
// and buttons; CuffBot is text-only (S68), so each of those views became a
// named subcommand — same gates, same order, same numbers.
//
// Slice B resolves a finished job LAZILY: the next heist command you run
// settles it and shows the result (the cog's own fallback path). Slice C adds
// the timer that announces it unprompted.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { HEISTS, ITEMS, MATERIAL_ITEMS, RECIPES, fmt } from '../lib/tables.js';
import { MAX_LEVEL, XP_TABLE, levelSuccessBonus, xpBar, xpProgress } from '../lib/leveling.js';
import {
  CREW_FLAVOUR_CAUGHT,
  CREW_FLAVOUR_FAIL,
  CREW_FLAVOUR_SUCCESS,
  FLAVOUR_MATERIAL,
  FLAVOUR_SHIELD,
  FLAVOUR_TOOL,
  heatBar,
  narrate,
} from '../lib/flavour.js';
import { craftPlan } from '../lib/crafting.js';
import { armHeistTimer, cancelHeistTimer } from '../scheduler.js';
import {
  CREW_LEVEL_REQUIREMENT,
  CREW_LOBBY_TIMEOUT_MS,
  CREW_SIZE,
  armCrewLobbyTimer,
  buyItem,
  closeCrewLobby,
  cooldownLeft,
  createCrewLobby,
  eventMultiplier,
  getCrewLobby,
  getHeistSettings,
  getItemCost,
  listHeistOverrides,
  resetHeistOverrides,
  setHeistOverride,
  setItemPrice,
  startCrewHeist,
  startHeistEvent,
  stopHeistEvent,
  TUNABLE_FIELDS,
  craftItem,
  equipItem,
  getPlayer,
  heistBalance,
  jailStatus,
  payBail,
  payDebt,
  readyJobs,
  sellItem,
  settleActiveHeist,
  shopItems,
  startHeist,
  unequipSlot,
} from '../service.js';
import {
  configPayload,
  craftPayload,
  equipPayload,
  eventPayload,
  jobPayload,
  pricePayload,
  shopPayload,
} from '../panel-runtime.js';

const CRIME = 0x8b1a1a;
const TEAL = 0x11806a;

const money = (n) => n.toLocaleString('en-US');
const relative = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
const itemLabel = (id) => `${ITEMS[id]?.emoji ?? '❓'} ${fmt(id)}`;
/** Accept "bank drill", "Bank Drill" or "bank_drill" for any table id. */
const normalizeId = (raw) => String(raw).toLowerCase().trim().replaceAll(' ', '_');

/** The result embed for a settled job — the cog's header/status/narrative. */
export function outcomeEmbed(outcome, displayName) {
  const heist = HEISTS[outcome.heistType];
  let status = outcome.success ? '✅ Success' : '❌ Failed';
  if (outcome.caught) status += ' - 🚨 Caught';
  const lines = [`*${narrate(outcome)}*`, ''];

  if (outcome.success) {
    if (outcome.lootItem) lines.push(`You stole a **${fmt(outcome.lootItem)}** from the ${fmt(outcome.heistType)}.`);
    else if (outcome.reward > 0) lines.push(`**+${money(outcome.reward)} 🍩** added to your balance.`);
  } else {
    if (outcome.shieldUsed) lines.push(FLAVOUR_SHIELD[0]);
    if (outcome.shieldAbsorbedAll) lines.push('Your shield absorbed everything. No losses this time.');
    else if (outcome.lossPaid > 0) lines.push(`**−${money(outcome.lossPaid)} 🍩** deducted from your balance.`);
    else if (outcome.debtAdded > 0) {
      lines.push(
        `**${money(outcome.debtAdded)} 🍩** added to your debt` +
          (outcome.debtTax > 0 ? ` (incl. ${money(outcome.debtTax)} tax)` : '') +
          `. Total debt: **${money(outcome.nextState.debt)}**.`,
      );
    }
  }
  if (outcome.toolUsed) {
    lines.push(`${FLAVOUR_TOOL[0]}\n-# ${fmt(outcome.toolUsed)} used (+${Math.round(outcome.toolBoost * 100)}% success boost)`);
  }
  if (outcome.materialDrop) {
    lines.push(`${FLAVOUR_MATERIAL[0]}\n-# Found ${outcome.materialDrop.qty}× ${fmt(outcome.materialDrop.item)}`);
  }
  if (outcome.caught) {
    if (outcome.confiscated) lines.push(`Police confiscated the **${fmt(outcome.confiscated)}**.`);
    if (outcome.seized > 0) lines.push(`Police seized **${money(outcome.seized)} 🍩** from you.`);
    lines.push(
      `**In jail** until ${relative(outcome.jail.endsAt)}.\n` +
        `Bail: ${money(outcome.jail.bail)} + ${money(outcome.jail.bailTax)} tax = **${money(outcome.jail.bailTotal)}** 🍩.`,
    );
    lines.push('-# 🎓 No XP earned (caught)');
  } else {
    const levelUp = outcome.newLevel > outcome.oldLevel ? ` — **Level up! ${outcome.oldLevel} → ${outcome.newLevel}** 🎉` : '';
    const progress = xpProgress(outcome.nextState.xp);
    lines.push(`-# 🎓 +${outcome.xpGained} XP${levelUp} · Lv.${progress.level} ${xpBar(progress.pct)}`);
  }

  return new EmbedBuilder()
    .setColor(outcome.caught ? 0xff0000 : outcome.success ? 0xa020f0 : 0xff6600)
    .setTitle(`${heist?.emoji ?? '🎭'} ${fmt(outcome.heistType)} — ${status}`)
    .setDescription(lines.filter(Boolean).join('\n'))
    .setFooter({ text: displayName });
}


/** The crew result card: one shared headline, then every officer's outcome. */
export function crewOutcomeEmbed(outcome, names = {}) {
  const pool = outcome.anyCaught ? CREW_FLAVOUR_CAUGHT : outcome.success ? CREW_FLAVOUR_SUCCESS : CREW_FLAVOUR_FAIL;
  let status = outcome.success ? '✅ Success' : '❌ Failed';
  if (outcome.anyCaught) status += ' - 🚨 Some Caught';

  const headline = outcome.success
    ? `**Total haul:** ${money(outcome.totalReward)} 🍩 split ${outcome.members.length} ways\n**Per member:** ~${money(outcome.perMemberReward)} 🍩` +
      (outcome.eventMultiplier > 1 ? `\n-# 🎉 ${outcome.eventMultiplier}× event active!` : '')
    : `**Total loss:** ${money(outcome.totalLoss)} 🍩 split ${outcome.members.length} ways`;

  const blocks = outcome.members.map((result) => {
    const lines = [`**${names[result.userId] ?? `<@${result.userId}>`}**`];
    if (outcome.success) lines.push(`+${money(result.reward)} 🍩`);
    else if (result.lossPaid > 0) lines.push(`−${money(result.lossPaid)} 🍩`);
    else if (result.debtAdded > 0) lines.push(`Debt +${money(result.debtAdded)} 🍩`);
    else lines.push('No losses — the shield held.');
    lines.push(result.caught ? `🚨 Caught — jail until ${relative(result.jail.endsAt)}, bail ${money(result.jail.bailTotal)} 🍩` : '✅ Got away clean');
    if (result.materialDrop) lines.push(`-# Found ${result.materialDrop.qty}× ${fmt(result.materialDrop.item)}`);
    lines.push(result.caught ? '-# 🎓 No XP earned (caught)' : `-# 🎓 +${result.xpGained} XP · Lv.${result.newLevel}${result.newLevel > result.oldLevel ? ' · Level up! 🎉' : ''}`);
    return lines.join('\n');
  });

  return new EmbedBuilder()
    .setColor(outcome.anyCaught ? 0xff0000 : outcome.success ? 0xa020f0 : 0xff6600)
    .setTitle(`👥 Crew Robbery — ${status}`)
    .setDescription(`*${pool[0]}*\n\n${headline}\n\n**Individual results:**\n\n${blocks.join('\n\n')}`);
}

/** The lobby card + its buttons (the cog's slot list). */
export function crewLobbyEmbed(lobby, heist, expiresAt) {
  const slots = Array.from({ length: CREW_SIZE }, (_, i) =>
    i < lobby.members.length ? `**${i + 1}.** <@${lobby.members[i]}> ✅` : `**${i + 1}.** *Waiting…*`,
  );
  return new EmbedBuilder()
    .setColor(CRIME)
    .setTitle('👥 Crew Robbery — Lobby')
    .setDescription(
      `Need ${CREW_SIZE} officers to begin. Lobby closes ${relative(expiresAt)}.\n\n` +
        `**Potential haul:** ${money(heist.minReward)}–${money(heist.maxReward)} 🍩\n` +
        `**Split:** ~${money(Math.trunc(heist.minReward / CREW_SIZE))}–${money(Math.trunc(heist.maxReward / CREW_SIZE))} each\n` +
        `**Police chance:** ${Math.round(heist.policeChance * 100)}% per officer\n\n${slots.join('\n')}`,
    );
}

export function crewLobbyComponents(lobby, { disabled = false } = {}) {
  const full = lobby.members.length >= CREW_SIZE;
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`hst:join:${lobby.id}`).setEmoji('🎭').setLabel('Join Crew').setStyle(ButtonStyle.Success).setDisabled(disabled || full),
      new ButtonBuilder().setCustomId(`hst:leave:${lobby.id}`).setLabel('Leave').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`hst:begin:${lobby.id}`)
        .setLabel(`Begin Heist (${lobby.members.length}/${CREW_SIZE})`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled || !full),
      new ButtonBuilder().setCustomId(`hst:cancel:${lobby.id}`).setEmoji('✖️').setStyle(ButtonStyle.Danger).setDisabled(disabled),
    ),
  ];
}

/**
 * Settle a finished job before doing anything else and post its result — the
 * cog checks the same thing at the top of every command.
 * @returns {Promise<boolean>} true when the caller may continue
 */
async function settleFirst(ctx) {
  const outcome = await settleActiveHeist(ctx.guild.id, ctx.user.id);
  if (outcome) {
    // We beat the timer to it — drop the armed one so it cannot double-report.
    cancelHeistTimer(ctx.guild.id, ctx.user.id);
    const embed = outcome.members
      ? crewOutcomeEmbed(outcome)
      : outcomeEmbed(outcome, ctx.member?.displayName ?? ctx.user.username);
    await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  }
  return true;
}

/** The jail / active-job / debt gates, in the cog's order. */
async function blocked(ctx, { checkDebt = false, checkActive = true } = {}) {
  const player = getPlayer(ctx.guild.id, ctx.user.id);
  const jail = jailStatus(player);
  if (jail.jailed) {
    await ctx.reply(
      `🚨 You are in jail until ${relative(jail.endsAt)}. Bail is **${money(jail.total)} 🍩** ` +
        `(${money(jail.bail)} + ${money(jail.total - jail.bail)} tax) — \`${ctx.prefix}heist bail\`.`,
    );
    return true;
  }
  if (checkActive && player.activeHeist) {
    await ctx.reply(`🎭 You have a job running — it lands ${relative(player.activeHeist.endsAt)}.`);
    return true;
  }
  if (checkDebt && player.debt > 0) {
    await ctx.reply(
      `💸 You owe **${money(player.debt)} 🍩**. Clear it with \`${ctx.prefix}heist paydebt\` before working again.`,
    );
    return true;
  }
  return false;
}

export default {
  group: {
    name: 'heist',
    aliases: ['heists'],
    description: 'Heist: run timed jobs, dodge the police, grind gear — the other side of the badge.',
    emoji: '💰',
    fallback: 'play', // `!heist bank` reads like the cog's job picker
    async status(ctx) {
      const player = getPlayer(ctx.guild.id, ctx.user.id);
      const progress = xpProgress(player.xp);
      const jail = jailStatus(player);
      const ready = readyJobs(player, Date.now(), ctx.guild.id).length;
      const multiplier = eventMultiplier(ctx.guild.id);
      const total = Object.keys(HEISTS).filter((type) => !HEISTS[type].crewSize).length;
      const bonus = levelSuccessBonus(progress.level);
      return [
        `Pick a job with \`${ctx.prefix}heist play <job>\` (see \`${ctx.prefix}heist jobs\`), then wait it out — the result lands when the clock runs down. Gear up in \`${ctx.prefix}heist shop\`, grind materials into better kit with \`${ctx.prefix}heist craft\`.`,
        '',
        `**Level ${progress.level}**/${MAX_LEVEL} ${xpBar(progress.pct)}${bonus > 0 ? ` · +${Math.round(bonus * 100)}% success` : ''}`,
        `**Heat:** ${heatBar(player.heat)}`,
        `**Record:** ✅ ${player.stats.success} · ❌ ${player.stats.fail} · 🚨 ${player.stats.caught}`,
        multiplier > 1 ? `**🎉 Event:** payouts are **${multiplier}×** right now` : null,
        player.debt > 0 ? `**💸 Debt:** ${money(player.debt)} 🍩 — \`${ctx.prefix}heist paydebt\`` : null,
        jail.jailed
          ? `**🚨 In jail** until ${relative(jail.endsAt)} — bail ${money(jail.total)} 🍩`
          : player.activeHeist
            ? `**🎭 Running:** ${fmt(player.activeHeist.type)}, lands ${relative(player.activeHeist.endsAt)}`
            : `**Ready:** ${ready}/${total} jobs off cooldown`,
      ].filter(Boolean);
    },
    subcommands: [
      {
        name: 'play',
        aliases: ['start', 'do'],
        description: 'Start a job (add `confirm` to accept debt risk when you cannot cover the loss).',
        args: [
          { name: 'job', type: 'string', required: true },
          { name: 'confirm', type: 'string', required: false },
        ],
        async run(ctx, { job, confirm }) {
          await settleFirst(ctx);
          const type = normalizeId(job);
          const heist = getHeistSettings(ctx.guild.id, type);
          if (!heist) {
            await ctx.reply(`🚫 No such job. \`${ctx.prefix}heist jobs\` lists them all.`);
            return;
          }
          if (heist.crewSize) {
            await ctx.reply('🚫 Crew robbery needs a four-officer lobby — that lands in a later slice.');
            return;
          }
          if (await blocked(ctx, { checkDebt: true })) return;

          const player = getPlayer(ctx.guild.id, ctx.user.id);
          const left = cooldownLeft(player, type, Date.now(), heist.cooldownMs);
          if (left > 0) {
            await ctx.reply(`⏱️ ${fmt(type)} is still cooling down — ready ${relative(Date.now() + left)}.`);
            return;
          }
          // The cog asks for consent when the worst case exceeds your balance:
          // going in anyway means debt plus a 20% tax. Text-only version: a
          // literal `confirm` token (recorded deviation from its button).
          const balance = await heistBalance(ctx.guild.id, ctx.user.id);
          const taxAgreed = balance < heist.maxLoss;
          if (taxAgreed && normalizeId(confirm ?? '') !== 'confirm') {
            await ctx.reply(
              `⚠️ ${fmt(type)} can cost up to **${money(heist.maxLoss)} 🍩** and you hold **${money(balance)}**. ` +
                'Going in anyway means the shortfall becomes **debt +20% tax**.\n' +
                `Run \`${ctx.prefix}heist play ${type} confirm\` to accept that risk.`,
            );
            return;
          }

          const { endsAt } = startHeist(ctx.guild.id, ctx.user.id, type, ctx.channel.id, { taxAgreed });
          // S87: the job now announces itself when the clock runs out; the
          // lazy path stays as the fallback if that timer never fires.
          armHeistTimer(ctx.client, ctx.guild.id, ctx.user.id, endsAt);
          const equipped = player.equipped;
          const toolLine =
            equipped.tool && ITEMS[equipped.tool]?.forHeist === type
              ? `\n🔧 ${fmt(equipped.tool)} equipped — +${Math.round((ITEMS[equipped.tool].boost ?? 0) * 100)}% success`
              : '';
          const shieldLine = equipped.shield ? `\n🛡️ ${fmt(equipped.shield)} ready to absorb a loss` : '';
          await ctx.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(CRIME)
                .setTitle(`${heist.emoji} ${fmt(type)} — in progress`)
                .setDescription(
                  `You slip away into the night. The job lands ${relative(endsAt)}.` +
                    toolLine +
                    shieldLine +
                    `\n\n-# Success ${heist.minSuccess}–${heist.maxSuccess}% · police ${Math.round(heist.policeChance * 100)}% · run any \`${ctx.prefix}heist\` command afterwards to see how it went.`,
                ),
            ],
          });
        },
      },
      {
        name: 'panel',
        aliases: ['board', 'open'],
        description: 'Open the job board — pick a job from the menu instead of typing its name.',
        args: [],
        async run(ctx) {
          await settleFirst(ctx);
          await ctx.reply(jobPayload(ctx.guild.id, ctx.user.id));
        },
      },
      {
        name: 'jobs',
        aliases: ['list', 'cooldowns'],
        description: 'Every job: payout, odds and whether it is off cooldown.',
        args: [],
        async run(ctx) {
          const player = getPlayer(ctx.guild.id, ctx.user.id);
          const now = Date.now();
          const rows = Object.keys(HEISTS)
            .map((type) => [type, getHeistSettings(ctx.guild.id, type)])
            .filter(([, heist]) => !heist.crewSize)
            .sort((a, b) => a[1].maxReward - b[1].maxReward)
            .map(([type, heist]) => {
              const left = cooldownLeft(player, type, now, heist.cooldownMs);
              const pays = ITEMS[type]?.type === 'loot' ? `a ${fmt(type)}` : `${money(heist.minReward)}–${money(heist.maxReward)} 🍩`;
              const state = left > 0 ? `⏱️ ${relative(now + left)}` : '✅ ready';
              return `${heist.emoji} **${fmt(type)}** — ${pays} · ${heist.minSuccess}–${heist.maxSuccess}% · ${state}`;
            });
          await ctx.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(CRIME)
                .setTitle('💰 Jobs on the board')
                .setDescription(rows.join('\n'))
                .setFooter({ text: `${ctx.prefix}heist play <job> — risk rises with the payout` }),
            ],
          });
        },
      },
      {
        name: 'shop',
        description: 'Gear for sale: shields absorb losses, tools boost one specific job.',
        args: [],
        async run(ctx) {
          // S126: the shop IS a panel now — a paged shelf with a buy select,
          // the way the source has it. `!heist buy <item> [amount]` still
          // works for anyone who prefers to type, and is the only way to buy
          // more than one at a time.
          await ctx.reply(await shopPayload(ctx.guild.id, ctx.user.id));
        },
      },
      {
        name: 'catalogue',
        aliases: ['prices'],
        description: 'The shop as a plain list, if you would rather read than click.',
        args: [],
        async run(ctx) {
          const shields = shopItems().filter((item) => item.type === 'shield');
          const tools = shopItems().filter((item) => item.type === 'tool');
          const balance = await heistBalance(ctx.guild.id, ctx.user.id);
          const shieldLines = shields.map(
            (item) => `${item.emoji} **${fmt(item.id)}** — ${money(item.cost)} 🍩 · −${(item.reduction * 100).toFixed(0)}% loss (single use)`,
          );
          const toolLines = tools.map(
            (item) => `${item.emoji} **${fmt(item.id)}** — ${money(item.cost)} 🍩 · +${Math.round(item.boost * 100)}% on ${fmt(item.forHeist)}`,
          );
          await ctx.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(TEAL)
                .setTitle('🛒 Heist supplies')
                .setDescription(`**Shields**\n${shieldLines.join('\n')}\n\n**Tools**\n${toolLines.join('\n')}`)
                .setFooter({ text: `You hold ${money(balance)} 🍩 · ${ctx.prefix}heist buy <item> [amount]` }),
            ],
          });
        },
      },
      {
        name: 'buy',
        description: 'Buy gear from the shop.',
        args: [
          { name: 'item', type: 'string', required: true },
          { name: 'amount', type: 'integer', required: false },
        ],
        async run(ctx, { item, amount }) {
          await settleFirst(ctx);
          if (await blocked(ctx, { checkDebt: true })) return;
          const id = normalizeId(item);
          const count = amount ?? 1;
          const result = await buyItem(ctx.guild.id, ctx.user.id, id, count);
          if (result.error === 'not-for-sale') {
            await ctx.reply(`🚫 That is not on sale — see \`${ctx.prefix}heist shop\`.`);
            return;
          }
          if (result.error === 'bad-amount') {
            await ctx.reply('🚫 Buy between 1 and 100 at a time.');
            return;
          }
          if (result.error === 'poor') {
            await ctx.reply(`🚫 Not enough funds. Need **${money(result.need)} 🍩**, you have **${money(result.have)}**.`);
            return;
          }
          await ctx.reply(`✅ Bought ${count}× ${itemLabel(id)} for **${money(result.cost)} 🍩**. Equip it with \`${ctx.prefix}heist equip ${id}\`.`);
        },
      },
      {
        name: 'equip',
        aliases: ['gear', 'loadout'],
        description: 'Open the equipment rack, or name an item to equip it directly.',
        args: [{ name: 'item', type: 'string', required: false }],
        async run(ctx, { item }) {
          if (await blocked(ctx)) return;
          if (!item) {
            // S126: the rack is a panel — one select per slot showing only
            // what you actually own, and an Unequip button per slot that is
            // dead when the slot is empty.
            await ctx.reply(equipPayload(ctx.guild.id, ctx.user.id));
            return;
          }
          const id = normalizeId(item);
          const result = equipItem(ctx.guild.id, ctx.user.id, id);
          if (result.error === 'unknown-item') {
            await ctx.reply('🚫 No such item.');
            return;
          }
          if (result.error === 'not-equippable') {
            await ctx.reply('🚫 Only shields and tools can be equipped.');
            return;
          }
          if (result.error === 'not-owned') {
            await ctx.reply(`🚫 You do not own a ${fmt(id)} — \`${ctx.prefix}heist shop\`.`);
            return;
          }
          await ctx.reply(`✅ ${itemLabel(id)} equipped in your **${result.slot}** slot.`);
        },
      },
      {
        name: 'unequip',
        description: 'Clear a slot: shield or tool.',
        args: [{ name: 'slot', type: 'string', required: true, choices: ['shield', 'tool'] }],
        async run(ctx, { slot }) {
          if (await blocked(ctx)) return;
          unequipSlot(ctx.guild.id, ctx.user.id, slot);
          await ctx.reply(`✅ Your **${slot}** slot is empty.`);
        },
      },
      {
        name: 'inventory',
        aliases: ['inv'],
        description: 'Your gear, loot and materials.',
        args: [],
        async run(ctx) {
          await settleFirst(ctx);
          const player = getPlayer(ctx.guild.id, ctx.user.id);
          const entries = Object.entries(player.inventory).filter(([, count]) => count > 0);
          if (entries.length === 0 && player.debt <= 0) {
            await ctx.reply('Your inventory is empty and you have no debt.');
            return;
          }
          const sections = { shield: [], tool: [], loot: [], material: [] };
          for (const [id, count] of entries) {
            const item = ITEMS[id];
            if (!item) continue;
            const equipped = player.equipped.shield === id || player.equipped.tool === id ? ' *(equipped)*' : '';
            const detail =
              item.type === 'shield'
                ? `−${(item.reduction * 100).toFixed(0)}% loss, single use`
                : item.type === 'tool'
                  ? `+${Math.round(item.boost * 100)}% on ${fmt(item.forHeist)}, single use`
                  : `sells for ${money(item.minSell)}–${money(item.maxSell)} 🍩`;
            sections[item.type].push(`**${itemLabel(id)} ×${count}**${equipped}\n-# ${detail}`);
          }
          const blocks = [
            ['🛡️ Shields', sections.shield],
            ['🔧 Tools', sections.tool],
            ['💰 Loot', sections.loot],
            ['🧱 Materials', sections.material],
          ]
            .filter(([, list]) => list.length > 0)
            .map(([title, list]) => `**${title}**\n${list.join('\n')}`);
          if (player.debt > 0) blocks.unshift(`**💸 Debt:** ${money(player.debt)} 🍩`);
          await ctx.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(TEAL)
                .setTitle(`🎒 ${ctx.member?.displayName ?? ctx.user.username}'s stash`)
                .setDescription(blocks.join('\n\n'))
                .setFooter({ text: `${ctx.prefix}heist sell <item> [amount] · ${ctx.prefix}heist craft` }),
            ],
          });
        },
      },
      {
        name: 'sell',
        description: 'Sell loot or materials (the price is rolled per unit).',
        args: [
          { name: 'item', type: 'string', required: true },
          { name: 'amount', type: 'integer', required: false },
        ],
        async run(ctx, { item, amount }) {
          await settleFirst(ctx);
          if (await blocked(ctx)) return;
          const id = normalizeId(item);
          const count = amount ?? 1;
          const result = await sellItem(ctx.guild.id, ctx.user.id, id, count);
          if (result.error === 'not-sellable') {
            await ctx.reply('🚫 Only loot and materials can be sold.');
            return;
          }
          if (result.error === 'bad-amount') {
            await ctx.reply('🚫 Sell at least one.');
            return;
          }
          if (result.error === 'not-enough') {
            await ctx.reply(`🚫 You do not have ${count}× ${fmt(id)}.`);
            return;
          }
          await ctx.reply(`✅ Sold ${count}× ${itemLabel(id)} for **${money(result.price)} 🍩**.`);
        },
      },
      {
        name: 'craft',
        description: 'Turn materials into enhanced gear (bare = what you can make).',
        args: [{ name: 'recipe', type: 'string', required: false }],
        async run(ctx, { recipe }) {
          await settleFirst(ctx);
          if (await blocked(ctx)) return;
          if (!recipe) {
            // S126: the bare form is the bench panel — pick a recipe, see
            // exactly what you are short of, press Craft. Naming a recipe
            // still crafts it directly.
            await ctx.reply(craftPayload(ctx.guild.id, ctx.user.id));
            return;
          }
          const result = craftItem(ctx.guild.id, ctx.user.id, normalizeId(recipe));
          if (result.error === 'unknown-recipe') {
            await ctx.reply(`🚫 No such recipe — \`${ctx.prefix}heist craft\` lists them.`);
            return;
          }
          if (result.error === 'missing') {
            const missing = Object.entries(result.missing)
              .map(([material, qty]) => `${qty}× ${fmt(material)}`)
              .join(', ');
            await ctx.reply(`🚫 Not enough materials — you still need ${missing}.`);
            return;
          }
          await ctx.reply(`✅ Crafted ${itemLabel(result.result)}. Equip it with \`${ctx.prefix}heist equip ${result.result}\`.`);
        },
      },
      {
        name: 'bail',
        aliases: ['bailout'],
        description: 'Pay bail — for yourself or for another officer.',
        args: [{ name: 'member', type: 'user', required: false }],
        async run(ctx, { member }) {
          const targetId = member?.id ?? ctx.user.id;
          const result = await payBail(ctx.guild.id, ctx.user.id, targetId);
          if (result.error === 'not-jailed') {
            await ctx.reply(targetId === ctx.user.id ? 'You are not in jail.' : `<@${targetId}> is not in jail.`);
            return;
          }
          if (result.error === 'poor') {
            await ctx.reply(`🚫 Bail is **${money(result.need)} 🍩** and you hold **${money(result.have)}**.`);
            return;
          }
          await ctx.reply(
            targetId === ctx.user.id
              ? `🔓 You paid **${money(result.total)} 🍩** and walked out. Your heat is clear.`
              : `🔓 You paid **${money(result.total)} 🍩** — <@${targetId}> is free, with a clean heat record.`,
          );
        },
      },
      {
        name: 'paydebt',
        description: 'Pay down what you owe (as much as your balance covers).',
        args: [],
        async run(ctx) {
          await settleFirst(ctx);
          const result = await payDebt(ctx.guild.id, ctx.user.id);
          if (result.paid === 0 && result.remaining === 0) {
            await ctx.reply('✅ You are debt-free.');
            return;
          }
          if (result.paid === 0) {
            await ctx.reply(`🚫 You still owe **${money(result.remaining)} 🍩** and have nothing to pay it with.`);
            return;
          }
          await ctx.reply(
            result.remaining > 0
              ? `💸 Paid **${money(result.paid)} 🍩** — **${money(result.remaining)}** still outstanding.`
              : `✅ Paid **${money(result.paid)} 🍩**. Debt cleared — back to work.`,
          );
        },
      },
      {
        name: 'crew',
        description: `Organise a ${CREW_SIZE}-officer crew robbery (needs level ${CREW_LEVEL_REQUIREMENT}).`,
        args: [],
        async run(ctx) {
          await settleFirst(ctx);
          if (await blocked(ctx, { checkDebt: true })) return;
          const player = getPlayer(ctx.guild.id, ctx.user.id);
          const level = xpProgress(player.xp).level;
          if (level < CREW_LEVEL_REQUIREMENT) {
            await ctx.reply(`🚫 You must be **level ${CREW_LEVEL_REQUIREMENT}** or higher to organise a crew robbery (you are ${level}).`);
            return;
          }
          const left = cooldownLeft(player, 'crew_robbery', Date.now(), getHeistSettings(ctx.guild.id, 'crew_robbery').cooldownMs);
          if (left > 0) {
            await ctx.reply(`⏱️ Crew robbery is still cooling down for you — ready ${relative(Date.now() + left)}.`);
            return;
          }
          const result = createCrewLobby(ctx.channel.id, ctx.guild.id, ctx.user.id);
          if (result.error === 'busy') {
            await ctx.reply('🚫 A crew is already forming in this channel — one at a time.');
            return;
          }
          const lobby = result.lobby;
          const heist = getHeistSettings(ctx.guild.id, 'crew_robbery');
          const expiresAt = Date.now() + CREW_LOBBY_TIMEOUT_MS;
          const message = await ctx.reply({
            embeds: [crewLobbyEmbed(lobby, heist, expiresAt)],
            components: crewLobbyComponents(lobby),
          });
          if (!message) {
            closeCrewLobby(ctx.channel.id);
            return;
          }
          lobby.message = message;
          armCrewLobbyTimer(lobby, async () => {
            closeCrewLobby(lobby.channelId);
            await message
              .edit({
                embeds: [crewLobbyEmbed(lobby, heist, expiresAt).setTitle('👥 Crew Robbery — lobby expired')],
                components: crewLobbyComponents(lobby, { disabled: true }),
              })
              .catch(() => {});
          });
        },
      },
      {
        name: 'admin',
        description: 'Tune the job table, item prices and payout events.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [
          { name: 'action', type: 'string', required: false },
          { name: 'target', type: 'string', required: false },
          { name: 'field', type: 'string', required: false },
          { name: 'value', type: 'string', required: false },
        ],
        async run(ctx, { action, target, field, value }) {
          const verb = normalizeId(action ?? 'show');
          const overrides = listHeistOverrides(ctx.guild.id);

          if (verb === 'show') {
            const lines = Object.entries(overrides).flatMap(([job, fields]) =>
              Object.entries(fields).map(([key, stored]) => {
                const spec = TUNABLE_FIELDS[key];
                const shown = spec?.seconds ? `${stored / 1000}s` : stored;
                return `**${fmt(job)}** · ${key} = ${shown}`;
              }),
            );
            const multiplier = eventMultiplier(ctx.guild.id);
            await ctx.reply({
              embeds: [
                new EmbedBuilder()
                  .setColor(TEAL)
                  .setTitle('⚙️ Heist tuning')
                  .setDescription(
                    (lines.length ? lines.join('\n') : 'No overrides — every job runs on the ported defaults.') +
                      (multiplier > 1 ? `\n\n🎉 **Event active:** ${multiplier}× payouts` : ''),
                  )
                  .setFooter({
                    text: `${ctx.prefix}heist admin set <job> <field> <value> · fields: ${Object.keys(TUNABLE_FIELDS).join(', ')}`,
                  }),
              ],
            });
            return;
          }

          if (verb === 'set') {
            if (!target || !field || value === undefined) {
              await ctx.reply(`🚫 Usage: \`${ctx.prefix}heist admin set <job> <field> <value>\``);
              return;
            }
            const result = setHeistOverride(ctx.guild.id, normalizeId(target), field, value);
            if (result.error === 'unknown-job') {
              await ctx.reply(`🚫 No such job — see \`${ctx.prefix}heist jobs\`.`);
              return;
            }
            if (result.error === 'unknown-field') {
              await ctx.reply(`🚫 Tunable fields: ${Object.keys(TUNABLE_FIELDS).join(', ')}.`);
              return;
            }
            if (result.error === 'not-a-number') {
              await ctx.reply('🚫 That value is not a number.');
              return;
            }
            if (result.error === 'out-of-range') {
              await ctx.reply(`🚫 ${TUNABLE_FIELDS[field].label} must be ${result.min}–${result.max}.`);
              return;
            }
            await ctx.reply(`✅ **${fmt(normalizeId(target))}** · ${field} is now **${value}**${TUNABLE_FIELDS[field].seconds ? ' seconds' : ''}.`);
            return;
          }

          if (verb === 'reset') {
            const job = target ? normalizeId(target) : null;
            if (job && !HEISTS[job]) {
              await ctx.reply('🚫 No such job.');
              return;
            }
            const cleared = resetHeistOverrides(ctx.guild.id, job);
            await ctx.reply(
              cleared === 0
                ? 'Nothing to reset — no overrides were set.'
                : `♻️ Cleared **${cleared}** override${cleared === 1 ? '' : 's'}${job ? ` on ${fmt(job)}` : ' across every job'}.`,
            );
            return;
          }

          if (verb === 'price') {
            if (!target || field === undefined) {
              await ctx.reply(`🚫 Usage: \`${ctx.prefix}heist admin price <item> <cost>\``);
              return;
            }
            const itemId = normalizeId(target);
            const result = setItemPrice(ctx.guild.id, itemId, Number.parseInt(field, 10));
            if (result.error === 'not-for-sale') {
              await ctx.reply('🚫 That item is not sold in the shop.');
              return;
            }
            if (result.error === 'out-of-range') {
              await ctx.reply('🚫 A price must be a whole number between 0 and 10,000,000.');
              return;
            }
            await ctx.reply(`✅ ${itemLabel(itemId)} now costs **${money(result.cost)} 🍩** (was ${money(ITEMS[itemId].cost)}).`);
            return;
          }

          if (verb === 'event') {
            if (normalizeId(target ?? '') === 'stop') {
              stopHeistEvent(ctx.guild.id);
              await ctx.reply('✅ Payout event stopped.');
              return;
            }
            const multiplier = Number.parseInt(target ?? '', 10);
            const hours = Number(field ?? 1);
            const result = startHeistEvent(ctx.guild.id, multiplier, hours);
            if (result.error === 'bad-multiplier') {
              await ctx.reply('🚫 The multiplier must be a whole number 2–5.');
              return;
            }
            if (result.error === 'bad-duration') {
              await ctx.reply('🚫 The duration must be 0–168 hours.');
              return;
            }
            await ctx.reply(`🎉 **${multiplier}× payouts** until ${relative(result.endsAt)}. Stop early with \`${ctx.prefix}heist admin event stop\`.`);
            return;
          }

          await ctx.reply(`🚫 Unknown action. Try: show, set, reset, price, event — e.g. \`${ctx.prefix}heist admin show\`.`);
        },
      },
      {
        name: 'tune',
        aliases: ['settings'],
        description: 'Open the job-settings panel: pick a job, pick a field, type a value.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [],
        async run(ctx) {
          await ctx.reply(configPayload(ctx.guild.id, ctx.user.id));
        },
      },
      {
        // `prices` belongs to the player-facing `catalogue` list (S126); this
        // is the admin editor, so it takes the other name rather than stealing
        // one the precinct already types. The loader's duplicate-alias guard
        // caught the collision at test time (skill 0.5.39, third time).
        name: 'pricing',
        aliases: ['repricing'],
        description: 'Open the item-price panel and change what the shop charges.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [],
        async run(ctx) {
          await ctx.reply(pricePayload(ctx.guild.id, ctx.user.id));
        },
      },
      {
        name: 'event',
        aliases: ['events'],
        description: 'Open the payout-event panel: start or stop a rewards multiplier.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [],
        async run(ctx) {
          await ctx.reply(eventPayload(ctx.guild.id, ctx.user.id));
        },
      },
      {
        name: 'level',
        aliases: ['xp'],
        description: 'Level and XP progress, yours or another officer’s.',
        args: [{ name: 'member', type: 'user', required: false }],
        async run(ctx, { member }) {
          const target = member ?? ctx.user;
          const player = getPlayer(ctx.guild.id, target.id);
          const progress = xpProgress(player.xp);
          const bonus = levelSuccessBonus(progress.level);
          const next =
            progress.level >= MAX_LEVEL
              ? '-# Max level reached!'
              : `-# ${money(XP_TABLE[progress.level] - player.xp)} XP until level ${progress.level + 1}`;
          await ctx.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(TEAL)
                .setTitle(`🎓 ${target.username}'s heist level`)
                .setDescription(
                  `**Level ${progress.level}** / ${MAX_LEVEL}\n${xpBar(progress.pct)} ${money(progress.into)}/${money(progress.span)} XP\n${next}\n\n` +
                    (bonus > 0
                      ? `**Bonus:** +${Math.round(bonus * 100)}% success chance on every job`
                      : '-# Earn XP on jobs for success bonuses (+0.5% per level, max +20% at Lv.40)'),
                ),
            ],
            allowedMentions: { parse: [] },
          });
        },
      },
    ],
  },
};

// ── starting a job from the panel (S126 = M26.4a) ────────────────────────────

/**
 * The job board's select, resolved.
 *
 * Deliberately NOT a copy of `play`'s body: it re-uses the same gates through
 * the service, and answers the one case a panel cannot express — the cog's
 * debt consent, which `play` asks for with a literal `confirm` token. A button
 * cannot carry that token, so the panel refuses the job and names the command
 * that accepts the risk, rather than quietly signing the player up for debt.
 */
export async function startHeistFromPanel(interaction, jobType) {
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const heist = jobType ? getHeistSettings(guildId, jobType) : null;
  const say = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});

  if (!heist) {
    await say('🚫 That job is no longer on the board.');
    return;
  }
  if (heist.crewSize) {
    await say('🚫 Crew robbery needs a four-officer lobby — `!heist crew` opens one.');
    return;
  }

  const player = getPlayer(guildId, userId);
  const jail = jailStatus(player);
  if (jail.jailed) {
    await say(`🚨 You are in a cell until ${relative(jail.endsAt)}.`);
    return;
  }
  if (player.activeHeist) {
    await say(`🎭 You are already running ${fmt(player.activeHeist.type)} — it lands ${relative(player.activeHeist.endsAt)}.`);
    return;
  }
  const left = cooldownLeft(player, jobType, Date.now(), heist.cooldownMs);
  if (left > 0) {
    await say(`⏱️ ${fmt(jobType)} is still cooling down — ready ${relative(Date.now() + left)}.`);
    return;
  }

  const balance = await heistBalance(guildId, userId);
  if (balance < heist.maxLoss) {
    await say(
      `⚠️ ${fmt(jobType)} can cost up to **${money(heist.maxLoss)} 🍩** and you hold **${money(balance)}**. ` +
        `Going in anyway means the shortfall becomes **debt +20% tax** — run \`!heist play ${jobType} confirm\` to accept that.`,
    );
    return;
  }

  const { endsAt } = startHeist(guildId, userId, jobType, interaction.channelId, { taxAgreed: false });
  armHeistTimer(interaction.client, guildId, userId, endsAt);
  await interaction
    .update({
      embeds: [
        new EmbedBuilder()
          .setColor(CRIME)
          .setTitle(`${heist.emoji} ${fmt(jobType)} — in progress`)
          .setDescription(
            `You slip away into the night. The job lands ${relative(endsAt)}.` +
              `\n\n-# Success ${heist.minSuccess}–${heist.maxSuccess}% · police ${Math.round(heist.policeChance * 100)}% · run any \`!heist\` command afterwards to see how it went.`,
          ),
      ],
      components: [],
    })
    .catch(() => {});
}
