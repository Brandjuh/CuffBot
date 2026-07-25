// Shared enforcement checks that talk to Discord objects (so they live at the
// module root, not lib/). Every guard replies itself when it blocks, with a
// specific in-theme but factual message — a silent refusal reads as a broken
// bot.
//
// S96: every caller is a flat or group command now, so these take a `ctx` and
// reply through it — the shape-agnostic shim the M17.3 window needed is gone
// along with the last legacy command.

/**
 * Refuse self-targeting and bot-targeting with fitting replies.
 * @returns {Promise<boolean>} true when the target is actionable
 */
export async function ensureSensibleTarget(ctx, targetUser) {
  if (targetUser.id === ctx.user.id) {
    await ctx.reply(
      '🚫 You cannot take enforcement action against yourself. Internal Affairs has been notified. (Not really.)',
    );
    return false;
  }
  if (targetUser.id === ctx.client.user.id) {
    await ctx.reply("🚫 You can't cuff the police. CuffBot is un-arrestable.");
    return false;
  }
  return true;
}

/**
 * Fetch the target as a guild member, or null when they are not in the guild
 * (which is a valid situation for bans/unbans by id).
 */
export async function fetchMember(ctx, userId) {
  return ctx.guild.members.fetch(userId).catch(() => null);
}

/** Standard reply when role hierarchy blocks the bot. */
export async function replyHierarchyBlocked(ctx, targetUser) {
  await ctx.reply(
    `🚫 Cannot act on ${targetUser}: their highest role is at or above mine (or they are the server owner). Move the CuffBot role higher in Server Settings → Roles.`,
  );
}
