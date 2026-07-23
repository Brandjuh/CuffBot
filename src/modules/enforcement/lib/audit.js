// Pure audit-log reason building — no discord.js imports.

export const DEFAULT_REASON = 'No reason given';

/** Discord truncates audit-log reasons at 512 characters. */
export const AUDIT_REASON_LIMIT = 512;

/**
 * Build the reason string that lands in the guild audit log. The audit log
 * shows CuffBot as the executor, so the acting officer is embedded in the
 * reason — otherwise moderation actions become anonymous.
 * @param {string | null | undefined} reason as typed by the officer
 * @param {string} officerTag e.g. "brand#0" / "brand"
 * @returns {string} at most AUDIT_REASON_LIMIT characters
 */
export function auditReason(reason, officerTag) {
  const base = (reason ?? '').trim() || DEFAULT_REASON;
  const suffix = ` — by ${officerTag} via CuffBot`;
  const room = AUDIT_REASON_LIMIT - suffix.length;
  const clipped = base.length > room ? `${base.slice(0, room - 1)}…` : base;
  return `${clipped}${suffix}`;
}
