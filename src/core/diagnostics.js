// Pure helpers for the doctor script — no discord.js, no network, testable.

/**
 * Inspect a raw secret value exactly as it appears in .env and report the
 * copy/paste defects that survive "I am 100% sure it is correct": quotes,
 * whitespace, Windows line endings. Reported, never auto-fixed — the owner
 * must fix the file, or the bot would still read the broken value.
 * @param {string | undefined | null} raw
 * @returns {{ issues: string[] }}
 */
export function analyzeSecret(raw) {
  if (raw == null || raw === '') return { issues: ['is empty or missing'] };
  const issues = [];
  if (/\r/.test(raw)) issues.push('contains a carriage return (Windows line ending)');
  const noCr = raw.replace(/\r/g, '');
  if (/^\s|\s$/.test(noCr)) issues.push('has leading or trailing whitespace');
  const trimmed = noCr.trim();
  if (/^(["']).*\1$/.test(trimmed)) issues.push('is wrapped in quotes');
  if (/\s/.test(trimmed.replace(/^(["'])|(["'])$/g, ''))) issues.push('contains inner whitespace');
  return { issues };
}

/**
 * Safe-to-print shape of a token: length, dot-segment count (bot tokens have
 * exactly 3), and a masked preview. Never the token itself.
 * @param {string | undefined | null} token
 */
export function tokenFingerprint(token) {
  const t = token ?? '';
  return {
    length: t.length,
    dotParts: t.split('.').length,
    preview: t.length >= 8 ? `${t.slice(0, 4)}…${t.slice(-4)}` : '(too short to preview)',
  };
}

/**
 * A Discord bot token's first dot-segment is the base64-encoded id of the bot
 * user. Decoding it offline gives an early mismatch signal before any network
 * call. Returns null when the segment does not decode to a snowflake.
 * @param {string | undefined | null} token
 * @returns {string | null}
 */
export function botIdFromToken(token) {
  const first = (token ?? '').split('.')[0];
  if (!first) return null;
  try {
    const decoded = Buffer.from(first, 'base64').toString('utf8');
    return /^\d{17,20}$/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}
