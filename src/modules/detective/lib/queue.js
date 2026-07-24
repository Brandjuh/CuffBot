// Pure rules for the rate-limit question queue ("the desk pile"): when the
// shared AI budget refuses a question, it is parked and answered automatically
// once a slot frees up — nobody retypes anything. No discord.js, no timers.

export const QUEUE_CAP = 5; // a bounded pile: one flood can't reserve an hour of budget
export const MAX_QUEUE_WAIT_MS = 3_600_000; // park only waits ≤ 1 h (cooldown/hourly, not daily)

/**
 * Try to park a refused question.
 * One pending case per member: a newer question REPLACES their earlier one
 * (the latest question is the one they still care about).
 * @param {Array<object>} queue current pile (not mutated)
 * @param {{ userId:string|null, channelId:string, askerName:string, question:string, queuedAt:number }} item
 * @returns {{ queue:Array<object>, status:'queued'|'replaced'|'full', position:number }}
 */
export function enqueueQuestion(queue, item, cap = QUEUE_CAP) {
  const existing = item.userId ? queue.findIndex((q) => q.userId === item.userId) : -1;
  if (existing >= 0) {
    const next = [...queue];
    next[existing] = { ...item };
    return { queue: next, status: 'replaced', position: existing + 1 };
  }
  if (queue.length >= cap) return { queue, status: 'full', position: 0 };
  return { queue: [...queue, { ...item }], status: 'queued', position: queue.length + 1 };
}

/** Should this refusal be parked at all? (daily waits are too long to be useful) */
export function shouldQueue(reason, retryAfterMs) {
  return reason !== 'daily' && retryAfterMs <= MAX_QUEUE_WAIT_MS;
}

// The fun part (owner request: "verzin er een leuk verhaaltje bij") — why the
// detective can't take the case RIGHT NOW. Rotates per queue event.
export const WAIT_STORIES = [
  'The detective is mid-interrogation — two suspects, one donut, tensions high.',
  'The detective is on a stakeout and the radio must stay silent. 🍩 binoculars out.',
  'The detective is buried under a mountain of paperwork from the last case.',
  'The detective is walking the K-9 — Rex refuses to fetch clues on an empty stomach.',
  'The detective is in the evidence locker looking for reading glasses… again.',
  'The detective is at the coffee machine. Some cases simply cannot start without it.',
];

/**
 * The parked-reply text: story + case position + when the detective frees up.
 * @param {number} storyIndex any integer; wraps around the story list
 */
export function waitStory(storyIndex, position, waitText) {
  const story = WAIT_STORIES[Math.abs(storyIndex) % WAIT_STORIES.length];
  return (
    `🗂️ ${story}\n` +
    `Your case is **#${position} on the desk pile** — no need to retype it, ` +
    `I'll answer right here in ~${waitText}.`
  );
}
