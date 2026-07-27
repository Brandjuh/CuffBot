// The heist panels (S126 = M26.4a, ported from `maxcogs/heist` views.py).
//
// S115's audit measured the source at 31 `discord.ui` references against our
// 1: eight panels in the source, of which S88 built only the crew lobby. The
// other seven became subcommands, which is the same mistake M26.3 fixed for
// city — the command surface was scaffolding in slice B and had become the
// product by slice D.
//
// This slice ports the four a PLAYER touches — job selection, the shop, the
// equipment rack and the crafting bench. The two admin config panels and the
// event panel are 26.4b: the panel-first rule (skill 0.5.38) says the panel
// belongs where a player can reach it first, and an admin who types
// `!heist admin` is not that player.
//
// Pure: plain objects in, a description of what to render out. No discord.js,
// so a test can assert "a recipe you cannot afford is not craftable" without a
// gateway.
import { HEISTS, ITEMS, RECIPES, fmt } from './tables.js';
import { levelSuccessBonus } from './leveling.js';
import { relative } from '../../../core/timestamps.js';

/** The source's page sizes, kept so the panels break where the cog's do. */
export const HEISTS_PER_PAGE = 7;
export const RECIPES_PER_PAGE = 10;
/** The source's `timeout=120` on every one of these views. */
export const PANEL_TIMEOUT_MS = 120_000;

const money = (n) => Number(n).toLocaleString('en-US');

/** The source's `_risk_indicator`, by the numbers it actually branches on. */
export function riskLabel(policeChance, risk) {
  const heat = Number(policeChance) || 0;
  if (heat >= 0.35) return '🔴 Extreme';
  if (heat >= 0.2) return '🟠 High';
  if (heat >= 0.1) return '🟡 Medium';
  return '🟢 Low';
}

/** "30m" / "2h" / "1d 6h" — the source's `_cooldown_display`. */
export function cooldownLabel(ms) {
  const minutes = Math.round((Number(ms) || 0) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days}d` : `${days}d ${hours % 24}h`;
}

/** How many pages a list of `total` items needs at `perPage`. */
export const pageCount = (total, perPage) => Math.max(1, Math.ceil(total / perPage));

/** Clamp a page index into range — a stale button must not scroll off the end. */
export const clampPage = (page, total, perPage) => Math.min(Math.max(0, page), pageCount(total, perPage) - 1);

const slice = (list, page, perPage) => list.slice(page * perPage, page * perPage + perPage);

/** Prev / page-counter / next, the source's three-button nav row. */
export function navRow(prefix, page, pages) {
  return [
    { id: `${prefix}:prev`, emoji: '◀', style: 'secondary', disabled: page === 0 },
    { id: `${prefix}:page`, label: `${page + 1}/${pages}`, style: 'secondary', disabled: true },
    { id: `${prefix}:next`, emoji: '▶', style: 'secondary', disabled: page >= pages - 1 },
  ];
}

// ── 1. choosing a job (the source's HeistSelectionView) ──────────────────────

/**
 * The job board.
 *
 * The source shows the success band **already adjusted for your level**, which
 * is the whole reason the panel beats a static list: `!heist jobs` printed the
 * table's raw numbers, so a level-40 player was reading odds that were not
 * theirs.
 *
 * @param {object} opts
 * @param {number} opts.level        the player's heist level
 * @param {(type:string)=>number} opts.cooldownLeft
 */
export function jobPanel({ level = 1, cooldownLeft = () => 0, page = 0, jobs = HEISTS, now = Date.now() } = {}) {
  const all = Object.entries(jobs);
  const pages = pageCount(all.length, HEISTS_PER_PAGE);
  const current = clampPage(page, all.length, HEISTS_PER_PAGE);
  const bonus = levelSuccessBonus(level);
  const shown = slice(all, current, HEISTS_PER_PAGE);

  const rows = shown.map(([name, data]) => {
    const wait = cooldownLeft(name);
    // The level bonus is a fraction; the table's bands are whole percents.
    const min = Math.min(data.minSuccess + Math.trunc(bonus * 100), 100);
    const max = Math.min(data.maxSuccess + Math.trunc(bonus * 100), 100);
    return {
      type: name,
      label: fmt(name),
      emoji: data.emoji,
      risk: riskLabel(data.policeChance, data.risk),
      reward: `${money(data.minReward)}–${money(data.maxReward)}`,
      success: `${min}–${max}%`,
      cooldown: cooldownLabel(data.cooldownMs),
      duration: `${Math.round(data.durationMs / 60_000)}m`,
      // A job on cooldown stays VISIBLE but unselectable — the same rule the
      // city picker follows, and for the same reason: a list that changes
      // shape between glances is unreadable.
      selectable: wait <= 0,
      // S134: two forms of one fact, because they land in two places with
      // different rules. `unavailable` is PLAIN — it goes in a select-menu
      // option description, where Discord prints `<t:…:R>` literally instead
      // of rendering it. `readyAt` is the live timestamp for the embed body.
      unavailable: wait > 0 ? `⏳ ${cooldownLabel(wait)}` : null,
      readyAt: wait > 0 ? `⏳ ready ${relative(now + wait)}` : null,
    };
  });

  // Bold, not `##`: the owner asked for smaller embed text ("Sommige teksten
  // zijn veelste groot"), and S114's guard fails the build on H1/H2. The
  // source uses `##` throughout — copying it verbatim would have shipped the
  // exact thing he complained about.
  const lines = ['**🎯 Choose your job**', ''];
  for (const row of rows) {
    lines.push(`**${row.emoji} ${row.label}** — ${row.risk}${row.selectable ? '' : ` · ${row.readyAt}`}`);
    lines.push(`-# ${row.reward} 🍩 · ${row.success} success · cooldown ${row.cooldown} · takes ${row.duration}`);
  }
  if (bonus > 0) lines.push('', `-# Success shown includes **+${Math.round(bonus * 100)}%** from level ${level}.`);

  return {
    title: '🎯 Choose your job',
    lines,
    rows,
    page: current,
    pages,
    select: {
      id: 'job',
      placeholder: rows.some((r) => r.selectable) ? 'Pick a job…' : 'Everything is cooling down',
      disabled: !rows.some((r) => r.selectable),
      options: rows.map((r) => ({
        label: r.label,
        value: r.type,
        emoji: r.emoji,
        description: r.selectable ? `${r.risk} · ${r.reward} 🍩` : r.unavailable,
      })),
    },
    buttons: navRow('job', current, pages),
  };
}

// ── 2. the shop (the source's ShopView) ──────────────────────────────────────

/** The shop's pages, one per item type — the source's `self.pages`. */
export const SHOP_SECTIONS = [
  { key: 'shield', label: 'Shields' },
  { key: 'tool', label: 'Tools' },
];

/** One line of "what this item does for you", by type. */
export function itemEffect(data) {
  if (data.type === 'shield') return `Cuts your loss by ${(data.reduction * 100).toFixed(1)}%`;
  if (data.type === 'tool') return `+${Math.round(data.boost * 100)}% success on ${fmt(data.forHeist)}`;
  if (data.type === 'loot') return `Sells for ${money(data.minSell)}–${money(data.maxSell)} 🍩`;
  return 'A crafting material.';
}

export function shopPanel({ balance = 0, page = 0, costs = {}, items = ITEMS } = {}) {
  const current = clampPage(page, SHOP_SECTIONS.length, 1);
  const section = SHOP_SECTIONS[current];
  const stock = Object.entries(items)
    .filter(([, data]) => data.type === section.key && data.cost !== undefined)
    .map(([name, data]) => ({
      id: name,
      label: fmt(name),
      emoji: data.emoji,
      cost: costs[name] ?? data.cost,
      effect: itemEffect(data),
    }));

  const lines = [`**🛒 Heist shop — ${section.label}**`, ''];
  for (const item of stock) {
    lines.push(`**${item.emoji} ${item.label}** — ${money(item.cost)} 🍩${item.cost > balance ? ' · _too expensive_' : ''}`);
    lines.push(`-# ${item.effect}`);
  }
  lines.push('', `-# You hold **${money(balance)} 🍩**.`);

  const affordable = stock.filter((i) => i.cost <= balance);
  return {
    title: `🛒 Heist shop — ${section.label}`,
    lines,
    stock,
    page: current,
    pages: SHOP_SECTIONS.length,
    select: {
      id: 'buy',
      placeholder: affordable.length ? 'Buy one…' : 'Nothing here you can afford',
      // Everything unaffordable means nothing to press; say so with a dead
      // menu rather than a refusal after the fact.
      disabled: affordable.length === 0,
      options: stock.map((item) => ({
        label: item.label,
        value: item.id,
        emoji: item.emoji,
        description: `${money(item.cost)} 🍩 · ${item.effect}`.slice(0, 100),
      })),
    },
    buttons: navRow('shop', current, SHOP_SECTIONS.length),
  };
}

// ── 3. the equipment rack (the source's EquipView) ───────────────────────────

export const EQUIP_SLOTS = ['shield', 'tool'];

/**
 * What is worn, and what could be worn instead.
 *
 * ⚠️ **Recorded divergence:** the source has three slots — shield, tool and
 * **consumable** — but our S85 table has no `consumable` type at all (its four
 * types are shield, tool, loot and material), so a third rack would be an
 * empty select forever. Two slots, and a comment saying why, beats a dead one.
 */
export function equipPanel({ inventory = {}, equipped = {}, items = ITEMS } = {}) {
  const slots = EQUIP_SLOTS.map((slot) => {
    const worn = equipped[slot];
    const owned = Object.entries(inventory)
      .filter(([name, count]) => count > 0 && items[name]?.type === slot)
      .map(([name]) => ({
        id: name,
        label: fmt(name),
        emoji: items[name].emoji,
        effect: itemEffect(items[name]),
        held: inventory[name],
        worn: name === worn,
      }));
    return {
      slot,
      worn: worn && items[worn] ? { id: worn, label: fmt(worn), emoji: items[worn].emoji } : null,
      owned,
    };
  });

  const lines = ['**⚙️ Equipment**', ''];
  for (const s of slots) {
    lines.push(`**${s.slot[0].toUpperCase()}${s.slot.slice(1)}:** ${s.worn ? `${s.worn.emoji} ${s.worn.label}` : '*none*'}`);
  }
  if (slots.every((s) => s.owned.length === 0)) {
    lines.push('', '_Nothing in the locker. `!heist shop` sells gear._');
  }

  return {
    title: '⚙️ Equipment',
    lines,
    slots,
    selects: slots.map((s) => ({
      id: `equip:${s.slot}`,
      placeholder: s.owned.length ? `Equip a ${s.slot}…` : `No ${s.slot} in the locker`,
      disabled: s.owned.length === 0,
      options: s.owned.map((item) => ({
        label: item.label,
        value: item.id,
        emoji: item.emoji,
        description: `${item.held} held · ${item.effect}`.slice(0, 100),
        default: item.worn,
      })),
    })),
    buttons: slots.map((s) => ({
      id: `unequip:${s.slot}`,
      label: `Unequip ${s.slot}`,
      style: 'secondary',
      // Nothing worn means nothing to take off.
      disabled: !s.worn,
    })),
  };
}

// ── 4. the crafting bench (the source's CraftView) ───────────────────────────

/** Can this recipe be made from what is in the bag? */
export const canCraft = (inventory, recipe) =>
  Boolean(recipe?.materials) &&
  Object.entries(recipe.materials).every(([material, qty]) => (inventory[material] ?? 0) >= qty);

export function craftPanel({ inventory = {}, selected = null, page = 0, recipes = RECIPES, items = ITEMS } = {}) {
  const all = Object.entries(recipes);
  const pages = pageCount(all.length, RECIPES_PER_PAGE);
  const current = clampPage(page, all.length, RECIPES_PER_PAGE);
  const shown = slice(all, current, RECIPES_PER_PAGE);

  const rows = shown.map(([name, recipe]) => ({
    id: name,
    label: fmt(name),
    emoji: items[name]?.emoji ?? '🔨',
    ready: canCraft(inventory, recipe),
    materials: Object.entries(recipe.materials).map(([material, qty]) => ({
      id: material,
      label: fmt(material),
      need: qty,
      have: inventory[material] ?? 0,
    })),
  }));

  const lines = [`**🔨 Crafting** — page ${current + 1}/${pages}`, ''];
  for (const row of rows) {
    lines.push(`**${row.emoji} ${row.label}** ${row.ready ? '✅' : '❌'}`);
    lines.push(`-# ${row.materials.map((m) => `${m.have}/${m.need} ${m.label}`).join(' · ')}`);
  }

  // The source keeps a detail block for the selected recipe, so the missing
  // material is named rather than left as a red cross.
  const chosen = selected && recipes[selected] ? { id: selected, recipe: recipes[selected] } : null;
  const ready = chosen ? canCraft(inventory, chosen.recipe) : false;
  if (chosen) {
    lines.push('', `**Selected:** ${items[chosen.id]?.emoji ?? '🔨'} ${fmt(chosen.id)} — ${ready ? '✅ ready' : '❌ missing materials'}`);
    for (const [material, qty] of Object.entries(chosen.recipe.materials)) {
      const have = inventory[material] ?? 0;
      lines.push(`-# ${fmt(material)}: need ${qty}, have ${have}${have >= qty ? '' : ` (**${qty - have} short**)`}`);
    }
  }

  return {
    title: '🔨 Crafting',
    lines,
    rows,
    page: current,
    pages,
    selected: chosen?.id ?? null,
    ready,
    select: {
      id: 'recipe',
      placeholder: 'Choose a recipe…',
      disabled: rows.length === 0,
      options: rows.map((row) => ({
        label: row.label,
        value: row.id,
        emoji: row.emoji,
        description: `${row.ready ? 'Ready' : 'Missing'}: ${row.materials.map((m) => `${m.need}× ${m.label}`).join(', ')}`.slice(0, 100),
        default: row.id === chosen?.id,
      })),
    },
    buttons: [
      ...navRow('craft', current, pages),
      // Craft is only live once a recipe is selected AND affordable, so the
      // button never has to refuse a press it could have prevented.
      { id: 'craft:make', label: 'Craft', emoji: '🔨', style: 'success', disabled: !ready },
    ],
  };
}

// ── the admin panels (S130 = M26.4b) ─────────────────────────────────────────
//
// The last three of the source's eight. They are separated from the four above
// by more than a heading: these are the only ones that CHANGE the game for
// everybody, so the pump gates them on Manage Server and they carry the
// owner's id like the rest. 26.4a took the player-facing four first on the
// panel-first rule (0.5.38) — the panel belongs where a player reaches it, and
// an admin typing `!heist admin` is not that player.

/** The config panel's two selections travel as one custom-id segment. */
export const packSelection = (job, field) => `${job ?? '-'}~${field ?? '-'}`;
export function unpackSelection(packed) {
  const [job, field] = String(packed ?? '').split('~');
  return { job: job && job !== '-' ? job : null, field: field && field !== '-' ? field : null };
}

/** A stored value rendered the way it is TYPED, not the way it is stored. */
export function fieldValue(spec, raw) {
  if (raw === undefined || raw === null) return '—';
  if (spec.seconds) return cooldownLabel(raw);
  if (spec.float) return `${Math.round(raw * 100)}%`;
  return money(raw);
}

/**
 * `!heist admin` — pick a job, pick a field, type a value.
 *
 * The source drives this with two selects and a modal, and so does this. The
 * one thing it adds: **the whole job is shown while you edit it**, with a ◄ on
 * the field you have selected, so a number is never changed without its
 * neighbours in view — `minReward` above `maxReward` is the pair most easily
 * put the wrong way round.
 */
export function configPanel({ jobs = HEISTS, settingsFor = () => ({}), selected = null, fields = null } = {}) {
  const spec = fields ?? {};
  const { job, field } = unpackSelection(selected);
  const chosen = job && jobs[job] ? job : null;
  const lines = ['**⚙️ Heist settings**', ''];

  if (!chosen) {
    lines.push('_Pick a job, then a field, then press **Set value**._');
  } else {
    const current = settingsFor(chosen);
    lines.push(`**${jobs[chosen].emoji} ${fmt(chosen)}**`);
    for (const [key, meta] of Object.entries(spec)) {
      lines.push(`-# ${meta.label}: ${fieldValue(meta, current[key])}${key === field ? ' ◄' : ''}`);
    }
    if (!field) lines.push('', '_Now pick the field to change._');
  }

  const jobOptions = Object.entries(jobs)
    .slice(0, 25)
    .map(([name, data]) => ({ label: fmt(name), value: name, emoji: data.emoji, default: name === chosen }));

  return {
    title: '⚙️ Heist settings',
    lines,
    selected: packSelection(chosen, chosen ? field : null),
    job: chosen,
    field: chosen ? field : null,
    selects: [
      { id: 'cfg-job', placeholder: 'Which job…', disabled: false, options: jobOptions },
      {
        id: 'cfg-field',
        placeholder: chosen ? 'Which setting…' : 'Pick a job first',
        disabled: !chosen,
        options: Object.entries(spec).map(([key, meta]) => ({
          label: meta.label,
          value: key,
          description: `${meta.min}–${meta.max}${meta.seconds ? ' seconds' : ''}`.slice(0, 100),
          default: key === field,
        })),
      },
    ],
    buttons: [
      // Dead until both halves are chosen — a modal that opens with nothing to
      // write to is a refusal disguised as a form.
      { id: 'cfg-set', label: 'Set value', emoji: '✏️', style: 'primary', disabled: !(chosen && field) },
      { id: 'cfg-reset', label: 'Reset this job', emoji: '↩️', style: 'danger', disabled: !chosen },
    ],
  };
}

/** `!heist admin prices` — the shop's price list, one page of 25 at a time. */
export function pricePanel({ items = ITEMS, costs = {}, selected = null, page = 0 } = {}) {
  const priced = Object.entries(items).filter(([, data]) => data.cost !== undefined);
  const pages = pageCount(priced.length, 25);
  const current = clampPage(page, priced.length, 25);
  const shown = slice(priced, current, 25);
  const chosen = selected && items[selected]?.cost !== undefined ? selected : null;

  const lines = [`**💰 Item prices** — page ${current + 1}/${pages}`, ''];
  for (const [name, data] of shown) {
    const cost = costs[name] ?? data.cost;
    // An overridden price is marked, so "why is this 99?" is answerable from
    // the panel instead of from the config file.
    const overridden = costs[name] !== undefined && costs[name] !== data.cost;
    lines.push(`-# ${data.emoji} ${fmt(name)}: ${money(cost)}${overridden ? ` _(was ${money(data.cost)})_` : ''}${name === chosen ? ' ◄' : ''}`);
  }

  return {
    title: '💰 Item prices',
    lines,
    page: current,
    pages,
    selected: chosen,
    select: {
      id: 'price-pick',
      placeholder: 'Which item…',
      disabled: shown.length === 0,
      options: shown.map(([name, data]) => ({
        label: fmt(name),
        value: name,
        emoji: data.emoji,
        description: `${money(costs[name] ?? data.cost)} 🍩`,
        default: name === chosen,
      })),
    },
    buttons: [
      ...navRow('price', current, pages),
      { id: 'price-set', label: 'Set price', emoji: '✏️', style: 'primary', disabled: !chosen },
    ],
  };
}

/** `!heist admin event` — the payout multiplier, started and stopped. */
export function eventPanel({ multiplier = 1, endsAt = 0, now = Date.now() } = {}) {
  const active = multiplier > 1 && endsAt > now;
  const lines = active
    ? [
        `**🎉 Event running — ${multiplier}× payouts**`,
        '',
        `Ends <t:${Math.floor(endsAt / 1000)}:R>.`,
        '-# Every cash reward a job pays out is multiplied while this runs.',
      ]
    : [
        '**🎉 Heist events**',
        '',
        'Nothing running.',
        '-# Start one to multiply every cash payout for a set number of hours.',
      ];

  return {
    title: '🎉 Heist events',
    lines,
    active,
    buttons: [
      { id: 'event-start', label: 'Start event', emoji: '🎉', style: 'success', disabled: active },
      { id: 'event-stop', label: 'Stop event', emoji: '🛑', style: 'danger', disabled: !active },
    ],
  };
}
