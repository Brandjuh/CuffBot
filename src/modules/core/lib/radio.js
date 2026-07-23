// Pure reply formatting for /radio-check — no discord.js imports.

/**
 * Describe a round-trip latency in radio jargon. Thresholds are coarse on
 * purpose: the point is a human-readable verdict, not telemetry.
 * @param {number} latencyMs round-trip in milliseconds
 * @returns {string} in-theme reply line
 */
export function describeLatency(latencyMs) {
  const ms = Math.max(0, Math.round(latencyMs));
  if (ms < 150) return `📻 Loud and clear. Round-trip: ${ms} ms.`;
  if (ms < 400) return `📻 Reading you with a bit of static. Round-trip: ${ms} ms.`;
  return `📻 Signal is rough out there. Round-trip: ${ms} ms.`;
}
