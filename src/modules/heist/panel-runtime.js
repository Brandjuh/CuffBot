// Turning the pure heist panels into discord.js payloads (S126 = M26.4a).
//
// Not under `commands/` — the loader reads the `index.js` manifest, so a
// helper can live at the module root without being mistaken for a command.
// It sits here rather than in `lib/` because it touches discord.js and the
// store; `lib/` is the pure half.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { craftPanel, equipPanel, jobPanel, shopPanel } from './lib/panels.js';
import { xpProgress } from './lib/leveling.js';
import { ITEMS } from './lib/tables.js';
import { cooldownLeft, getItemCost, getPlayer, heistBalance } from './service.js';

const STYLES = {
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
  secondary: ButtonStyle.Secondary,
  primary: ButtonStyle.Primary,
};

/** The crime red the rest of the module's embeds use. */
const COLOUR = 0x8b1a1a;

/**
 * Panel state rides in the custom id, not in memory.
 *
 * `hp:<view>:<page>:<selected>:<owner>` — so a press still works after a
 * restart, which is the same reason the city panel puts its owner there. The
 * selected recipe is `-` when there is none, because an empty segment would
 * make the id ambiguous to split.
 */
export const encodeId = (action, { view, page = 0, selected = null, owner }) =>
  `hp:${action}:${view}:${page}:${selected ?? '-'}:${owner}`;

export function decodeId(customId) {
  const parts = String(customId).split(':');
  if (parts[0] !== 'hp' || parts.length < 6) return null;
  const [, action, view, page, selected, owner] = parts;
  return { action, view, page: Number(page) || 0, selected: selected === '-' ? null : selected, owner };
}

/** One pure panel description → one discord.js payload. */
function render(panel, { view, owner, page = 0, selected = null }) {
  const rows = [];
  const state = { view, page: panel.page ?? page, selected: panel.selected ?? selected, owner };

  for (const menu of panel.selects ?? (panel.select ? [panel.select] : [])) {
    if (!menu.options?.length && menu.disabled) {
      // A select with no options at all is rejected by Discord, so an empty
      // rack renders as nothing rather than as an invalid component.
      continue;
    }
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(encodeId(menu.id, state))
          .setPlaceholder(menu.placeholder)
          .setDisabled(Boolean(menu.disabled))
          .addOptions(menu.options.slice(0, 25)),
      ),
    );
  }

  const buttons = (panel.buttons ?? []).map((b) => {
    const button = new ButtonBuilder().setCustomId(encodeId(b.id, state)).setStyle(STYLES[b.style]);
    if (b.emoji) button.setEmoji(b.emoji);
    if (b.label) button.setLabel(b.label);
    return button.setDisabled(Boolean(b.disabled));
  });
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }

  return {
    embeds: [new EmbedBuilder().setColor(COLOUR).setDescription(panel.lines.join('\n'))],
    components: rows,
    allowedMentions: { parse: [] },
  };
}

/** `!heist panel` / the job board. */
export function jobPayload(guildId, userId, { page = 0 } = {}) {
  const player = getPlayer(guildId, userId);
  const panel = jobPanel({
    level: xpProgress(player.xp).level,
    cooldownLeft: (type) => cooldownLeft(player, type, Date.now(), null),
    page,
  });
  return render(panel, { view: 'job', owner: userId, page });
}

export async function shopPayload(guildId, userId, { page = 0 } = {}) {
  const balance = await heistBalance(guildId, userId);
  // Prices are owner-tunable (S88's `!heist admin price`), so the shop reads
  // the override rather than the table's constant.
  const costs = Object.fromEntries(Object.keys(ITEMS).map((id) => [id, getItemCost(guildId, id)]));
  return render(shopPanel({ balance, page, costs }), { view: 'shop', owner: userId, page });
}

export function equipPayload(guildId, userId) {
  const player = getPlayer(guildId, userId);
  return render(equipPanel({ inventory: player.inventory, equipped: player.equipped }), {
    view: 'equip',
    owner: userId,
  });
}

export function craftPayload(guildId, userId, { page = 0, selected = null } = {}) {
  const player = getPlayer(guildId, userId);
  return render(craftPanel({ inventory: player.inventory, selected, page }), {
    view: 'craft',
    owner: userId,
    page,
    selected,
  });
}

/** Which payload a view name maps to. */
export const PAYLOADS = {
  job: (guildId, userId, state) => jobPayload(guildId, userId, state),
  shop: (guildId, userId, state) => shopPayload(guildId, userId, state),
  equip: (guildId, userId) => equipPayload(guildId, userId),
  craft: (guildId, userId, state) => craftPayload(guildId, userId, state),
};
