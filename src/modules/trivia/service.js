// Trivia service: loads the data-driven question sets, owns the in-RAM active
// rounds (one per channel), and keeps scores in the guild store. Adding a new
// trivia set = dropping a JSON file into data/ — nothing else to touch.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../../core/logger.js';
import { getGuildData, updateGuildData } from '../../core/store.js';
import { validateSet } from './lib/game.js';

export const TRIVIA_SCORES_KEY = 'triviaScores';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');

let setsCache = null;

/**
 * All valid question sets, keyed by set id. Invalid files are skipped loudly —
 * a typo in one set must never take down the module.
 */
export function loadSets({ dir = dataDir, force = false } = {}) {
  if (setsCache && !force) return setsCache;
  const sets = new Map();
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch (error) {
    logger.warn('Trivia: cannot read data dir:', error);
  }
  for (const file of files) {
    try {
      const doc = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
      const check = validateSet(doc);
      if (!check.ok) {
        logger.warn(`Trivia: skipping ${file} — ${check.error}`);
        continue;
      }
      sets.set(doc.set, doc);
    } catch (error) {
      logger.warn(`Trivia: skipping ${file} — unreadable JSON (${error.message})`);
    }
  }
  setsCache = sets;
  return sets;
}

// ── active rounds (in-RAM; a restart simply forfeits the open round) ─────────

const rounds = new Map(); // channelId → round

export function getRound(channelId) {
  return rounds.get(channelId) ?? null;
}

export function startRound(channelId, { setId, questionIndex, answer, roundId }) {
  const round = {
    roundId,
    setId,
    questionIndex,
    answer,
    answered: new Set(),
    winnerId: null,
    message: null, // filled in by the command once the question is posted
    timer: null,
  };
  rounds.set(channelId, round);
  return round;
}

export function endRound(channelId) {
  const round = rounds.get(channelId);
  if (round?.timer) clearTimeout(round.timer);
  rounds.delete(channelId);
  return round ?? null;
}

/** Test seam: forget all live rounds. */
export function clearAllRounds() {
  for (const channelId of [...rounds.keys()]) endRound(channelId);
}

// ── scores ───────────────────────────────────────────────────────────────────

export function addPoint(guildId, userId) {
  let total = 0;
  updateGuildData(
    guildId,
    TRIVIA_SCORES_KEY,
    (scores) => {
      total = (scores[userId] ?? 0) + 1;
      return { ...scores, [userId]: total };
    },
    {},
  );
  return total;
}

export function getScores(guildId) {
  return getGuildData(guildId, TRIVIA_SCORES_KEY, {});
}
