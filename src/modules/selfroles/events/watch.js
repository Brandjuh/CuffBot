// Keeps the posted self-roles list current (S59 owner requirement): role
// creates/deletes/edits debounce into one refresh; boot catches up on
// changes that happened while the bot was offline.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { getGuildData } from '../../../core/store.js';
import { SELFROLES_MESSAGE_KEY, refreshSelfRoles, scheduleSelfrolesRefresh } from '../service.js';

const isHome = (guild, client) => guild && guild.id === client.config.homeGuildId;
const guard = (label, fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (error) {
    logger.warn(`Self roles: ${label} failed:`, error);
  }
};

export const onRoleCreate = {
  name: Events.GuildRoleCreate,
  execute: guard('role-create watch', async (role) => {
    if (isHome(role.guild, role.client)) scheduleSelfrolesRefresh(role.guild);
  }),
};

export const onRoleDelete = {
  name: Events.GuildRoleDelete,
  execute: guard('role-delete watch', async (role) => {
    if (isHome(role.guild, role.client)) scheduleSelfrolesRefresh(role.guild);
  }),
};

export const onRoleUpdate = {
  name: Events.GuildRoleUpdate,
  execute: guard('role-update watch', async (_old, role) => {
    if (isHome(role.guild, role.client)) scheduleSelfrolesRefresh(role.guild);
  }),
};

export const onBootCatchUp = {
  name: Events.ClientReady,
  once: true,
  execute: guard('boot catch-up', async (client) => {
    const guild = client.guilds.cache.get(client.config.homeGuildId);
    if (!guild) return;
    // Only once a list was posted: /selfroles post:True is the owner's
    // explicit go-live moment; before that the bot posts nothing on its own.
    if (!getGuildData(guild.id, SELFROLES_MESSAGE_KEY, null)?.messageId) return;
    const timer = setTimeout(() => {
      refreshSelfRoles(guild).catch((error) => logger.warn('Self roles: boot refresh failed:', error));
    }, 20_000);
    timer.unref?.();
  }),
};
