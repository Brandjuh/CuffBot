// The goal tracker (S103 = M14). Pure — no discord.js, no storage, `now`
// injected — so every rule here is tested against plain objects.
//
// Precinct goals and personal goals are the SAME shape with a different owner.
// That is not a shortcut: the owner's request ("goal tracker") never said
// which one they meant, and one structure answers both readings instead of
// forcing a guess. The only real difference is who may edit and where
// milestones are announced.

export const DEFAULT_GOALS_CONFIG = {
  enabled: true,
  /** Where precinct milestones are announced. null = the channel it was set in. */
  announceChannelId: null,
  /** Percentages that get an announcement. 100 is the finish line. */
  milestones: [25, 50, 75, 100],
  /** How many goals one member may keep open at once. */
  perMemberLimit: 10,
};

/**
 * Where a precinct goal's current value comes from.
 * `members` and `boosts` are read straight off the guild object, so they are
 * exact and cost nothing to keep — no counter to maintain, no drift, and they
 * are already correct the first time anyone looks.
 */
export const SOURCES = ['manual', 'members', 'boosts'];
export const SOURCE_LABELS = {
  manual: 'counted by hand',
  members: 'members in the precinct',
  boosts: 'server boosts',
};

const BAR_WIDTH = 12;
const FILLED = '█';
const EMPTY = '░';

/** A stable, readable id from a name: "1000 Members" → "1000-members". */
export function slugify(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * Create a goal.
 * @returns {{ ok: boolean, goal?: object, message?: string }}
 */
export function createGoal(goals, { name, target, unit = '', source = 'manual', by = null, now = Date.now() }) {
  const clean = String(name ?? '').trim();
  if (clean.length === 0) return { ok: false, message: 'A goal needs a name.' };
  if (clean.length > 80) return { ok: false, message: 'That name is longer than 80 characters.' };
  if (!Number.isFinite(target) || target <= 0) return { ok: false, message: 'The target must be a positive number.' };
  if (!SOURCES.includes(source)) return { ok: false, message: `Unknown source "${source}".` };

  const id = slugify(clean);
  if (id.length === 0) return { ok: false, message: 'That name has no letters or digits in it.' };
  if (goals[id]) return { ok: false, message: `There is already a goal called **${goals[id].name}**.` };

  return {
    ok: true,
    goal: {
      id,
      name: clean,
      target,
      current: 0,
      unit: String(unit ?? '').trim().slice(0, 20),
      source,
      by,
      createdAt: now,
      completedAt: null,
      // Which milestones have been announced. Recording them is what makes
      // announcing idempotent — a re-sweep cannot re-announce 50%.
      announced: [],
    },
  };
}

/** Clamp a value into the goal's range. Progress never goes below zero. */
const clamp = (value, target) => Math.max(0, Math.min(Number(value) || 0, target));

/**
 * Move a goal's progress. Returns a NEW goal — the caller decides whether to
 * persist it — plus which milestones this move crossed.
 *
 * @returns {{ goal: object, crossed: number[], justCompleted: boolean }}
 */
export function applyProgress(goal, value, { milestones = DEFAULT_GOALS_CONFIG.milestones, now = Date.now() } = {}) {
  const before = goal.current;
  const current = clamp(value, goal.target);
  const wasComplete = goal.completedAt !== null;
  const complete = current >= goal.target;

  const crossed = milestones
    .filter((mark) => !goal.announced.includes(mark))
    .filter((mark) => percentOf({ ...goal, current }) >= mark && percentOf({ ...goal, current: before }) < mark);

  return {
    goal: {
      ...goal,
      current,
      completedAt: complete ? (goal.completedAt ?? now) : null,
      announced: [...goal.announced, ...crossed],
    },
    crossed,
    justCompleted: complete && !wasComplete,
  };
}

export const percentOf = (goal) =>
  goal.target > 0 ? Math.min(100, (goal.current / goal.target) * 100) : 0;

export const isComplete = (goal) => goal.completedAt !== null;

/** `████████░░░░ 67%` — the whole point of a goal tracker is seeing it. */
export function progressBar(goal, width = BAR_WIDTH) {
  const percent = percentOf(goal);
  // Floor rather than round: an unfinished goal must never show a full bar.
  const filled = percent >= 100 ? width : Math.floor((percent / 100) * width);
  return `${FILLED.repeat(filled)}${EMPTY.repeat(width - filled)} ${Math.floor(percent)}%`;
}

/** `**1000 Members** — 640 / 1000 members` */
export function formatGoal(goal, { bar = true } = {}) {
  const unit = goal.unit ? ` ${goal.unit}` : '';
  const head = `${isComplete(goal) ? '✅' : '🎯'} **${goal.name}** — ${goal.current} / ${goal.target}${unit}`;
  return bar ? `${head}\n\`${progressBar(goal)}\`` : head;
}

/**
 * Find a goal by name or id, tolerantly. Exact id wins; then an exact
 * case-insensitive name; then a unique prefix. An ambiguous prefix is an
 * ERROR rather than a guess — silently editing the wrong goal is worse than
 * asking again.
 *
 * @returns {{ ok: boolean, goal?: object, message?: string }}
 */
export function findGoal(goals, query) {
  const list = Object.values(goals ?? {});
  const q = String(query ?? '').trim().toLowerCase();
  if (q.length === 0) return { ok: false, message: 'Name a goal.' };

  const byId = goals[q] ?? goals[slugify(q)];
  if (byId) return { ok: true, goal: byId };

  const exact = list.filter((g) => g.name.toLowerCase() === q);
  if (exact.length === 1) return { ok: true, goal: exact[0] };

  const partial = list.filter((g) => g.name.toLowerCase().includes(q) || g.id.includes(slugify(q)));
  if (partial.length === 1) return { ok: true, goal: partial[0] };
  if (partial.length > 1) {
    return {
      ok: false,
      message: `That matches ${partial.length} goals: ${partial.map((g) => `**${g.name}**`).join(', ')}. Be more specific.`,
    };
  }
  return { ok: false, message: `No goal matches "${query}".` };
}

/** Open goals first, then by how close they are to done, then by name. */
export function sortGoals(goals) {
  return Object.values(goals ?? {}).sort((a, b) => {
    if (isComplete(a) !== isComplete(b)) return isComplete(a) ? 1 : -1;
    const delta = percentOf(b) - percentOf(a);
    if (Math.abs(delta) > 0.0001) return delta;
    return a.name.localeCompare(b.name);
  });
}

/**
 * The value an auto-tracked goal should hold right now. Returns null for a
 * manual goal — the caller must not overwrite a hand-kept number.
 */
export function currentFromSource(source, { memberCount = 0, boostCount = 0 } = {}) {
  if (source === 'members') return memberCount;
  if (source === 'boosts') return boostCount;
  return null;
}

/** The announcement for a crossed milestone. 100% gets its own sentence. */
export function milestoneMessage(goal, mark) {
  const unit = goal.unit ? ` ${goal.unit}` : '';
  if (mark >= 100) {
    return `🎉 **Goal reached: ${goal.name}!** ${goal.target}${unit} — the precinct did it.\n\`${progressBar(goal)}\``;
  }
  return `🎯 **${goal.name}** is **${mark}%** of the way there — ${goal.current} / ${goal.target}${unit}.\n\`${progressBar(goal)}\``;
}

/** How many goals a member has finished — the board's ranking value. */
export function completedCount(memberGoals) {
  return Object.values(memberGoals ?? {}).filter(isComplete).length;
}

/**
 * The personal-goal leaderboard: who has finished the most. Members with none
 * finished are left out — a board of zeroes tells nobody anything.
 */
export function goalBoard(allMemberGoals, size = 10) {
  return Object.entries(allMemberGoals ?? {})
    .map(([userId, goals]) => ({
      userId,
      completed: completedCount(goals),
      open: Object.values(goals).filter((g) => !isComplete(g)).length,
    }))
    .filter((row) => row.completed > 0)
    .sort((a, b) => b.completed - a.completed || a.userId.localeCompare(b.userId))
    .slice(0, Math.max(1, size));
}
