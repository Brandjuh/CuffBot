// Pure jurisdiction logic — no discord.js imports, so tests need no token.

/**
 * CuffBot serves exactly one precinct (guild). Everything outside it is out of
 * jurisdiction and the bot should leave.
 * @param {string} guildId
 * @param {string} homeGuildId
 * @returns {boolean}
 */
export function isHomeGuild(guildId, homeGuildId) {
  return String(guildId) === String(homeGuildId);
}
