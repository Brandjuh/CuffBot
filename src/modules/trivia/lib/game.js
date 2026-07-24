// Pure trivia rules — no discord.js, no fs, no timers. Question sets are
// plain objects (loaded from data/*.json by the service); rounds are plain
// state objects. Everything here is deterministic given its inputs.

export const CHOICE_LABELS = ['A', 'B', 'C', 'D', 'E'];
export const ROUND_SECONDS = 20;

/**
 * Validate a question-set document (one data/*.json file).
 * @returns {{ ok:true } | { ok:false, error:string }}
 */
export function validateSet(doc) {
  if (!doc || typeof doc !== 'object') return { ok: false, error: 'not an object' };
  if (typeof doc.set !== 'string' || !/^[a-z0-9-]+$/.test(doc.set)) {
    return { ok: false, error: 'set must be a kebab-case id' };
  }
  if (typeof doc.title !== 'string' || doc.title.length === 0) {
    return { ok: false, error: 'title missing' };
  }
  if (!Array.isArray(doc.questions) || doc.questions.length === 0) {
    return { ok: false, error: 'questions missing or empty' };
  }
  for (const [i, q] of doc.questions.entries()) {
    if (typeof q.q !== 'string' || q.q.length === 0) return { ok: false, error: `question ${i}: q missing` };
    if (!Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > CHOICE_LABELS.length) {
      return { ok: false, error: `question ${i}: needs 2–${CHOICE_LABELS.length} choices` };
    }
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) {
      return { ok: false, error: `question ${i}: answer index out of range` };
    }
  }
  return { ok: true };
}

/**
 * Pick a question index, avoiding the previous one when possible so back-to-
 * back rounds don't repeat. `random` is injectable for tests.
 */
export function pickQuestionIndex(count, lastIndex = -1, random = Math.random) {
  if (count === 1) return 0;
  let idx = Math.floor(random() * count);
  if (idx === lastIndex) idx = (idx + 1) % count;
  return idx;
}

/** The render model for a question message. */
export function questionModel(set, questionIndex) {
  const q = set.questions[questionIndex];
  return {
    title: `❓ Trivia — ${set.title}`,
    question: q.q,
    choices: q.choices.map((text, i) => ({ label: CHOICE_LABELS[i], text, index: i })),
    footer: `First correct answer wins · one guess per officer · ${ROUND_SECONDS}s`,
  };
}

/** The reveal model shown when a round ends. */
export function revealModel(set, questionIndex, winnerId) {
  const q = set.questions[questionIndex];
  const correct = `${CHOICE_LABELS[q.answer]}. ${q.choices[q.answer]}`;
  return {
    title: winnerId ? '✅ Case closed!' : '⌛ Case gone cold',
    description: winnerId
      ? `<@${winnerId}> cracked it: **${correct}**${q.fact ? `\n_${q.fact}_` : ''}`
      : `Nobody got it. The answer was **${correct}**${q.fact ? `\n_${q.fact}_` : ''}`,
    winnerId: winnerId ?? null,
  };
}

/**
 * Apply one member's button press to a round (mutates round.answered).
 * @param {{ answer:number, answered:Set<string>, winnerId:string|null }} round
 * @returns {'winner'|'wrong'|'already-answered'|'round-won'}
 */
export function applyAnswer(round, userId, choiceIndex) {
  if (round.winnerId) return 'round-won';
  if (round.answered.has(userId)) return 'already-answered';
  round.answered.add(userId);
  if (choiceIndex === round.answer) {
    round.winnerId = userId;
    return 'winner';
  }
  return 'wrong';
}

/** Scores object → sorted leaderboard rows [{userId, points}], ties by id. */
export function scoreboard(scores, limit = 10) {
  return Object.entries(scores ?? {})
    .map(([userId, points]) => ({ userId, points }))
    .sort((a, b) => b.points - a.points || a.userId.localeCompare(b.userId))
    .slice(0, Math.max(1, Math.min(25, limit)));
}
