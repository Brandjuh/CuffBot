// Mafia table settings (S105 = M24.1). Separate from game.js so the engine
// stays free of anything a guild can change.

export const DEFAULT_MAFIA_CONFIG = {
  /** How long the lobby waits for players before it gives up. */
  lobbyMs: 5 * 60 * 1000,
  /** How long each night lasts if somebody never acts. */
  nightMs: 2 * 60 * 1000,
  /** Discussion before the vote opens. */
  dayMs: 3 * 60 * 1000,
  /** The vote itself. */
  votingMs: 90 * 1000,
  /** The trial. */
  judgementMs: 45 * 1000,
};

export const PHASE_MS = {
  lobby: 'lobbyMs',
  night: 'nightMs',
  day: 'dayMs',
  voting: 'votingMs',
  judgement: 'judgementMs',
};

/** How long the given phase should run, per this guild's settings. */
export const phaseLengthOf = (phase, config = DEFAULT_MAFIA_CONFIG) =>
  ({ ...DEFAULT_MAFIA_CONFIG, ...config })[PHASE_MS[phase]] ?? null;

/** `2m 30s` — used in every phase header so nobody has to guess. */
export function humanizeMs(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return secs === 0 ? `${mins}m` : `${mins}m ${secs}s`;
}
