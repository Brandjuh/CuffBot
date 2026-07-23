// The rap-sheet API — the seam other modules call (see architecture.md →
// Cross-module calls: always through a module's lib/, never its commands).
// No discord.js imports: callable and testable anywhere.
import { getGuildData, updateGuildData } from '../../../core/store.js';

export const RECORD_TYPES = ['citation', 'detainment', 'arrest', 'release'];

const EMPTY = { nextCaseNumber: 1, entries: [] };

/**
 * File a record and get it back with its case number stamped.
 * @param {string} guildId
 * @param {{ type: string, userId: string, officerId: string,
 *           reason?: string | null, meta?: object }} record
 * @returns {object} the stored entry incl. caseNumber and ISO timestamp
 */
export function addRecord(guildId, { type, userId, officerId, reason = null, meta = {} }, options = {}) {
  if (!RECORD_TYPES.includes(type)) {
    throw new Error(`Unknown record type "${type}" — expected one of ${RECORD_TYPES.join(', ')}`);
  }
  let stored;
  updateGuildData(
    guildId,
    'rapSheet',
    (sheet) => {
      stored = {
        caseNumber: sheet.nextCaseNumber,
        type,
        userId,
        officerId,
        reason,
        meta,
        at: new Date().toISOString(),
      };
      return {
        nextCaseNumber: sheet.nextCaseNumber + 1,
        entries: [...sheet.entries, stored],
      };
    },
    EMPTY,
    options,
  );
  return stored;
}

/** All records for one member, oldest first. */
export function recordsFor(guildId, userId, options = {}) {
  const sheet = getGuildData(guildId, 'rapSheet', EMPTY, options);
  return sheet.entries.filter((entry) => entry.userId === userId);
}

/**
 * Expunge a member's records — all of them, or one case number.
 * @returns {{ removed: number }}
 */
export function expungeRecords(guildId, userId, caseNumber = null, options = {}) {
  let removed = 0;
  updateGuildData(
    guildId,
    'rapSheet',
    (sheet) => {
      const keep = sheet.entries.filter((entry) => {
        const hit = entry.userId === userId && (caseNumber === null || entry.caseNumber === caseNumber);
        if (hit) removed += 1;
        return !hit;
      });
      return { ...sheet, entries: keep };
    },
    EMPTY,
    options,
  );
  return { removed };
}
