// Keeps ranks + XP coherent when the LADDER ITSELF changes (S37 owner
// request: rename/reorder/delete/add rank roles "without problems"). Renames
// are free — role ids anchor everything. Structural changes debounce (15 s,
// a UI drag-reorder fires one event per shifted role) into one quiet
// reconciliation sweep; boot compares against the stored snapshot so changes
// made while the bot was offline are caught too.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { noteLadderMaybeChanged, scheduleLadderReconcile } from '../service.js';

const isHome = (guild, client) => guild && guild.id === client.config.homeGuildId;
const guard = (label, fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (error) {
    logger.warn(`Leveling: ${label} failed:`, error);
  }
};

export const onRoleReorder = {
  name: Events.GuildRoleUpdate,
  execute: guard('ladder watch (role update)', async (before, after) => {
    if (!isHome(after.guild, after.client)) return;
    // Only position moves matter here — renames are cosmetic to the ladder.
    if ((before.rawPosition ?? before.position) !== (after.rawPosition ?? after.position)) {
      scheduleLadderReconcile(after.guild);
    }
  }),
};

export const onRoleRemoved = {
  name: Events.GuildRoleDelete,
  execute: guard('ladder watch (role delete)', async (role) => {
    if (isHome(role.guild, role.client)) scheduleLadderReconcile(role.guild);
  }),
};

export const onRoleAdded = {
  name: Events.GuildRoleCreate,
  execute: guard('ladder watch (role create)', async (role) => {
    if (isHome(role.guild, role.client)) scheduleLadderReconcile(role.guild);
  }),
};

export const onBootLadderCheck = {
  name: Events.ClientReady,
  execute: guard('ladder boot check', async (client) => {
    const guild = client.guilds.cache.get(client.config.homeGuildId);
    if (guild) await noteLadderMaybeChanged(guild);
  }),
};
