// Turning a help view into Discord objects (S98 = M19, owner request:
// "Help menu: Buttons per categorie"). Kept out of core/help.js so that file
// stays free of discord.js and its models stay testable as plain data.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import {
  RUNTIME_ADMIN_COMMANDS,
  buildCategorizedHelp,
  summarizeCommand,
} from '../../../core/help.js';
import { hasPermission } from '../../../core/prefix/permissions.js';

/**
 * The categorized model filtered for ONE viewer (S43). Lives here rather than
 * in the command because the button pump has to rebuild it for whoever
 * pressed — two copies of this filter would be two chances to disagree about
 * what a member may see.
 *
 * `source` is anything carrying `channel`/`member` — a command ctx or a
 * component interaction both qualify.
 */
export function buildViewerHelp(source, prefix, moduleList = [], { unfiltered = false } = {}) {
  const commands = moduleList.flatMap((mod) => mod.commands.map(summarizeCommand));
  // S109: a permanent PANEL has no single viewer to filter for, so it lists
  // every category and lets each press answer privately with that presser's
  // own filtered roster. Nothing leaks: the panel advertises categories, the
  // private reply advertises commands.
  if (unfiltered) return buildCategorizedHelp(commands, prefix);
  const isAdmin = hasPermission(source, PermissionFlagsBits.ManageGuild);
  const isVisible = (cmd) => {
    // The runtime-gated admin commands (!update, !restart) declare no
    // permission — their gate lives inside run() — so they are filtered here.
    if (RUNTIME_ADMIN_COMMANDS.has(cmd.name)) return isAdmin;
    if (!cmd.defaultMemberPermissions) return true;
    try {
      return hasPermission(source, BigInt(cmd.defaultMemberPermissions));
    } catch {
      return true; // an unparsable bitfield must never hide the whole menu
    }
  };
  return buildCategorizedHelp(commands, prefix, { isVisible });
}


export const HELP_BUTTON_PREFIX = 'help:';
const BUTTONS_PER_ROW = 5;
const MAX_ROWS = 5;

/**
 * customId = `help:<ownerId>:<categoryKey>`.
 *
 * The owner id travels in the id because a help message is PUBLIC: anyone can
 * press. The pump uses it to decide between editing the message (the person
 * who asked) and answering privately (anyone else) — see events/help-buttons.js
 * for why that distinction matters.
 */
export const helpButtonId = (ownerId, key) => `${HELP_BUTTON_PREFIX}${ownerId}:${key}`;

/**
 * The owner id a PANEL's buttons carry (S109). A panel belongs to the channel,
 * not to a person, so there is no asker whose message may be edited in place —
 * every press gets a private view. Using a sentinel keeps the pump's three-way
 * S98 decision intact instead of adding a fourth code path.
 */
export const PANEL_OWNER = 'panel';

export function parseHelpButtonId(customId) {
  if (!customId?.startsWith(HELP_BUTTON_PREFIX)) return null;
  const rest = customId.slice(HELP_BUTTON_PREFIX.length);
  const split = rest.indexOf(':');
  if (split < 1) return null;
  return { ownerId: rest.slice(0, split), key: rest.slice(split + 1) };
}

/** The embed for a view from core/help.js (`helpOverview` / `helpCategory`). */
export function helpEmbed(view) {
  const embed = new EmbedBuilder().setColor(0x8a5a6a).setTitle(view.title);
  if (view.description) embed.setDescription(view.description);
  if (view.fields?.length) embed.addFields(view.fields);
  return embed;
}

/**
 * One button per category, plus a Back button once a category is open.
 * `active` is the key currently shown — its button is disabled, which is how
 * the menu says where you are without spending a line of text on it.
 */
export function helpRows(view, ownerId, { active = null } = {}) {
  const buttons = view.buttons.map((button) =>
    new ButtonBuilder()
      .setCustomId(helpButtonId(ownerId, button.key))
      // The category titles already carry their emoji; Discord counts a label
      // in characters, so long titles are clipped rather than rejected.
      .setLabel(button.title.slice(0, 80))
      .setStyle(button.key === active ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(button.key === active),
  );
  if (active) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(helpButtonId(ownerId, 'overview'))
        .setLabel('↩ All categories')
        .setStyle(ButtonStyle.Secondary),
    );
  }

  const rows = [];
  for (let i = 0; i < buttons.length && rows.length < MAX_ROWS; i += BUTTONS_PER_ROW) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + BUTTONS_PER_ROW)));
  }
  return rows;
}

/** The complete message payload for a view. */
export function helpPayload(view, ownerId, { active = null } = {}) {
  return {
    embeds: [helpEmbed(view)],
    components: helpRows(view, ownerId, { active }),
    allowedMentions: { parse: [] },
  };
}
