// The updater's small persisted state (S127): whether the automatic check is
// on, and what the last unattended run did.
//
// Separate from `update-status.js` to keep that file's boot-report concerns
// apart from the loop's, and separate from `updater.js` so the mechanism
// itself stays free of the store and remains testable without a data dir.
import { getGuildData, setGuildData } from '../../core/store.js';

export const AUTO_UPDATE_KEY = 'autoUpdate';
export const LAST_AUTO_RUN_KEY = 'lastAutoUpdateRun';

/**
 * Default ON.
 *
 * The owner asked for automatic updates every 15 minutes and has re-asked
 * across five sessions; shipping it off-by-default would mean the fix does
 * nothing until he finds a command nobody told him about (skill 0.5.37 — an
 * owner action nobody performs is not a feature).
 */
export const autoUpdateEnabled = (guildId) => getGuildData(guildId, AUTO_UPDATE_KEY, true) !== false;

export const setAutoUpdate = (guildId, on) => setGuildData(guildId, AUTO_UPDATE_KEY, Boolean(on));

/** `{ at, result, from, to }` for the last unattended run, or null. */
export const lastAutoRun = (guildId) => getGuildData(guildId, LAST_AUTO_RUN_KEY, null);

export const rememberAutoRun = (guildId, run) =>
  setGuildData(guildId, LAST_AUTO_RUN_KEY, { at: Date.now(), result: run.result, from: run.from, to: run.to });
