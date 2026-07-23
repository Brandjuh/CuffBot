// Pure rap-sheet text formatting — no discord.js imports.

const TYPE_BADGES = {
  citation: '📋',
  detainment: '🚔',
  arrest: '🚨',
  release: '🔓',
};

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * Render a member's rap sheet as a Discord message body (stays well under the
 * 2000-char message limit by showing counts plus the most recent entries).
 * @param {string} displayName
 * @param {Array<object>} entries oldest first, as stored by lib/api.js
 * @param {{ maxEntries?: number }} [options]
 */
export function formatRapSheet(displayName, entries, { maxEntries = 10 } = {}) {
  const name = displayName.toUpperCase();
  if (entries.length === 0) {
    return `🕊️ Clean sheet — no records on file for **${name}**.`;
  }

  const counts = {};
  for (const entry of entries) counts[entry.type] = (counts[entry.type] ?? 0) + 1;
  const summary = Object.entries(counts)
    .map(([type, count]) => `${TYPE_BADGES[type] ?? '•'} ${plural(count, type)}`)
    .join(' · ');

  const recent = entries.slice(-maxEntries).reverse();
  const lines = recent.map((entry) => {
    const date = (entry.at ?? '').slice(0, 10);
    const reason = entry.reason ? ` — ${entry.reason}` : '';
    return `\`#${String(entry.caseNumber).padStart(4, '0')}\` ${TYPE_BADGES[entry.type] ?? '•'} ${entry.type.toUpperCase()} · ${date}${reason} · officer <@${entry.officerId}>`;
  });

  const truncated = entries.length > maxEntries
    ? `\n… and ${entries.length - maxEntries} older record(s). Full history stays on file.`
    : '';

  const body = `📋 **RAP SHEET — ${name}**\n${summary}\n\n${lines.join('\n')}${truncated}`;
  // Hard safety: a message body over 2000 chars would be rejected by Discord.
  return body.length <= 1990 ? body : `${body.slice(0, 1986)}\n[…]`;
}
