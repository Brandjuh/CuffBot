// The permission gate shared by group commands (S69) and flat commands (S93).
//
// Until S93 every refusal read "You need **Manage Server**" no matter which
// flag was actually required — so `!maintenance` (Administrator),
// `!russianroulette force` (Manage Messages) and `!hammertime role`
// (Manage Roles) all told the member to get a permission that would not have
// helped them. The label map exists to keep the refusal honest.
import { PermissionFlagsBits } from 'discord.js';

const LABELS = new Map([
  [PermissionFlagsBits.Administrator, 'Administrator'],
  [PermissionFlagsBits.ManageGuild, 'Manage Server'],
  [PermissionFlagsBits.ManageChannels, 'Manage Channels'],
  [PermissionFlagsBits.ManageRoles, 'Manage Roles'],
  [PermissionFlagsBits.ManageMessages, 'Manage Messages'],
  [PermissionFlagsBits.ModerateMembers, 'Moderate Members'],
  [PermissionFlagsBits.KickMembers, 'Kick Members'],
  [PermissionFlagsBits.BanMembers, 'Ban Members'],
  [PermissionFlagsBits.ManageNicknames, 'Manage Nicknames'],
  [PermissionFlagsBits.MentionEveryone, 'Mention Everyone'],
]);

/** Human name for a PermissionFlagsBits flag, for refusal messages. */
export function permissionLabel(flag) {
  return LABELS.get(flag) ?? 'elevated permissions';
}

/** The one refusal sentence, so every command surface phrases it identically. */
export function refusalFor(flag) {
  return `🚫 You need **${permissionLabel(flag)}** for that.`;
}

/**
 * Does this member clear the gate? Channel-aware (like a slash interaction's
 * memberPermissions), so a per-channel overwrite counts — not just the
 * guild-level role. No flag means the command is open to everyone.
 */
export function hasPermission(ctx, flag) {
  if (!flag) return true;
  const perms = ctx.channel?.permissionsFor?.(ctx.member) ?? ctx.member?.permissions;
  return Boolean(perms?.has?.(flag));
}

/**
 * Administrator OR the guild owner (S96). A command's `permission` field
 * cannot express the second half — a guild owner implicitly has every power
 * but need not carry the Administrator flag — so the ops commands
 * (`!restart`, `!update`) check this inside run() instead of declaring a gate.
 */
export function isAdminOrOwner(ctx) {
  if (ctx.guild?.ownerId && ctx.guild.ownerId === ctx.user?.id) return true;
  return hasPermission(ctx, PermissionFlagsBits.Administrator);
}
