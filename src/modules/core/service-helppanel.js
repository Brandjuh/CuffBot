// The permanent help panel (S109, owner request: "Ik mis nog steeds een help
// waarbij ik een paneel heb met categorieen").
//
// `!help` has had category buttons since S98, but you have to type it. A panel
// is the same menu pinned in a channel: post it once and the precinct presses
// it forever.
//
// This is the published-post pattern (selfroles S59/S64, rules S97) at its
// smallest — one message rather than an array — with the same four hard parts:
// track the id, edit in place, re-post when the fetch fails (somebody deleted
// it), and clean up the old channel when the panel moves.
import { getGuildData, setGuildData } from '../../core/store.js';
import { logger } from '../../core/logger.js';
import { helpOverview } from '../../core/help.js';
import { PANEL_OWNER, buildViewerHelp, helpPayload } from './lib/help-menu.js';

export const HELP_PANEL_KEY = 'helpPanel';

export const getHelpPanel = (guildId) =>
  getGuildData(guildId, HELP_PANEL_KEY, { channelId: null, messageId: null });

export const setHelpPanel = (guildId, panel) => setGuildData(guildId, HELP_PANEL_KEY, panel);

/**
 * The panel's payload.
 *
 * A panel is read by everyone, so it cannot be permission-filtered the way
 * `!help` is — there is no single viewer to filter for. It therefore shows the
 * FULL category list, and pressing a button gives that presser their own
 * filtered view privately. Nothing is leaked: the panel advertises categories,
 * the private reply advertises commands.
 */
export function panelPayload(client, prefix) {
  const model = buildViewerHelp({ client, member: null, channel: null }, prefix, client.moduleList ?? [], {
    unfiltered: true,
  });
  const view = helpOverview(model);
  return {
    ...helpPayload(
      {
        ...view,
        title: '📻 CuffBot — command roster',
        description:
          `${view.description}\n\nPress a category. **Your answer is private** and shows only the commands you can actually use.`,
      },
      PANEL_OWNER,
    ),
  };
}

/**
 * Put the panel in `channel` (or refresh it where it already is).
 *
 * @returns {Promise<'posted'|'edited'|'moved'|'failed'>}
 */
export async function publishHelpPanel(guild, channel, prefix) {
  const stored = getHelpPanel(guild.id);
  const payload = panelPayload(guild.client, prefix);
  const movedChannel = Boolean(stored.channelId) && stored.channelId !== channel.id;

  // Edit in place when the panel is already where it should be.
  if (!movedChannel && stored.messageId) {
    const existing = await channel.messages.fetch(stored.messageId).catch(() => null);
    if (existing) {
      const edited = await existing.edit(payload).catch(() => null);
      if (edited) return 'edited';
    }
  }

  const sent = await channel.send(payload).catch((error) => {
    logger.warn('Help panel: could not post:', error);
    return null;
  });
  if (!sent) return 'failed';

  // Moving the panel must not leave a second one behind in the old channel.
  if (movedChannel) await removePanelMessage(guild, stored);
  setHelpPanel(guild.id, { channelId: channel.id, messageId: sent.id });
  return movedChannel ? 'moved' : 'posted';
}

/** Delete the tracked message, wherever it is. Never throws. */
async function removePanelMessage(guild, panel) {
  if (!panel?.channelId || !panel.messageId) return false;
  const channel =
    guild.channels.cache.get(panel.channelId) ??
    (await guild.channels.fetch(panel.channelId).catch(() => null));
  if (!channel?.messages) return false;
  const message = await channel.messages.fetch(panel.messageId).catch(() => null);
  if (!message) return false;
  return Boolean(await message.delete().catch(() => null));
}

/**
 * Take the panel down and forget it.
 * @returns {Promise<'removed'|'forgotten'|'none'>} — `forgotten` means the
 *   message was already gone, which is a success from the admin's point of view
 */
export async function removeHelpPanel(guild) {
  const stored = getHelpPanel(guild.id);
  if (!stored.messageId) return 'none';
  const deleted = await removePanelMessage(guild, stored);
  setHelpPanel(guild.id, { channelId: null, messageId: null });
  return deleted ? 'removed' : 'forgotten';
}
