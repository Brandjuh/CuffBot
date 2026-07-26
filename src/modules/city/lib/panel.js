// The crime panel (M26.3a, owner: "Dit is niet hoe het spel werkt in de link
// die ik je stuurde, dat werkt met panelen niet enkel met commands").
//
// S89–S92 shipped this game as `!crime pickpocket`, `!crime mug`, `!crime
// bank`… The source (CalaMariGold/CalaMari-Cogs `city`) is a **panel**: a
// message that IS the game, with a picker for the crimes and buttons for jail
// and the market. S115's audit measured it at 48 `discord.ui` references
// against our 0 — the largest divergence of any game in the repo.
//
// Pure: plain objects in, a description of what to render out. No discord.js,
// so a test can assert "a crime on cooldown is not selectable" without a
// gateway.
import { CRIMES } from './tables.js';

/**
 * Bailing out of an attempt (the source's `CrimeAttemptView`).
 *
 * This is the piece that made the divergence a GAMEPLAY problem rather than a
 * navigation one: the source puts a `Bail Out!` button on screen **while the
 * crime is resolving**, and pressing it is a real decision — you pay a flat
 * fee to walk away, and the cooldown still burns. A command-only surface has
 * nowhere to put that choice, so it simply did not exist here.
 */
export const BAIL_OUT_COST = 100; // the cog's flat 100, not a percentage
export const ATTEMPT_WINDOW_MS = 30_000; // the cog's `timeout=30` on the view

/**
 * What happens when someone presses Bail Out.
 *
 * @returns {{ok: boolean, reason?: string, cost?: number}}
 */
export function bailOutOutcome(balance, cost = BAIL_OUT_COST) {
  if (balance < cost) return { ok: false, reason: 'too-poor', cost };
  return { ok: true, cost };
}

const MINUTE = 60_000;

/** "3m 20s" / "1h 05m" — short enough for a select-menu description. */
export function shortWait(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  if (total < 60) return `${total}s`;
  const mins = Math.floor(total / 60);
  if (mins < 60) return `${mins}m ${String(total % 60).padStart(2, '0')}s`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

/**
 * One row per crime, with whether it can be picked right now and why not.
 *
 * A crime on cooldown stays **visible but unselectable** rather than vanishing:
 * a picker whose contents change between glances is unreadable, and "wait 4m"
 * is more useful than an option that silently is not there.
 *
 * @param {object} criminal   the stored record
 * @param {(type: string) => number} cooldownLeft
 * @param {boolean} jailed
 */
export function crimeOptions(criminal, cooldownLeft, jailed, now = Date.now()) {
  return Object.entries(CRIMES).map(([type, crime]) => {
    const wait = cooldownLeft(type, now);
    const label = type.replace(/_/g, ' ');
    let unavailable = null;
    if (jailed) unavailable = 'in jail';
    else if (wait > 0) unavailable = `wait ${shortWait(wait)}`;
    return {
      type,
      label: label.charAt(0).toUpperCase() + label.slice(1),
      emoji: crime.emoji,
      risk: crime.risk,
      reward: `${crime.minReward}–${crime.maxReward}`,
      requiresTarget: Boolean(crime.requiresTarget),
      selectable: unavailable === null,
      unavailable,
    };
  });
}

/**
 * The panel body.
 *
 * @returns {{title, lines: string[], options, buttons, jailed: boolean}}
 */
export function crimePanel({ criminal, balance, jail, cooldownLeft, now = Date.now() }) {
  const jailed = Boolean(jail?.jailed);
  const options = crimeOptions(criminal, cooldownLeft, jailed, now);

  const lines = [
    `**Wallet:** ${Number(balance).toLocaleString('en-US')} 🍩`,
    criminal.streak > 0 ? `**Streak:** ${criminal.streak} clean job${criminal.streak === 1 ? '' : 's'} in a row` : null,
  ].filter(Boolean);

  if (jailed) {
    lines.push('', `🚔 **You are in jail** — out in **${shortWait(jail.remainingMs)}**.`);
  } else {
    const ready = options.filter((o) => o.selectable).length;
    lines.push(
      '',
      ready === 0
        ? '_Everything is on cooldown. Come back in a bit._'
        : `Pick a job below. ${ready} of ${options.length} available.`,
    );
  }

  // Jail replaces the crime picker entirely — the source does the same, and
  // offering jobs you cannot do would be noise on the one screen where the
  // player has exactly two meaningful choices.
  //
  // S124 adds Market and Board to both views. S122 deliberately left them off
  // because they had nowhere to go — that was the scaffolding-as-product trap
  // (skill 0.5.38) avoided, not a permanent decision. Now that the pump can
  // render both in place, the buttons lead somewhere and belong here. They sit
  // on BOTH views on purpose: buying a Get Out of Jail Free card is exactly
  // what a jailed player wants the market for.
  // S133 adds Streets to both views, so the hub `!city` opens is one press from
  // the board rather than a command you have to remember. Jail's set is now at
  // Discord's five-per-row limit, which `city-panel.test.js` pins.
  const buttons = jailed
    ? [
        { id: 'bail', label: 'Pay Bail', style: 'success', emoji: '💸' },
        { id: 'jailbreak', label: 'Jail Break', style: 'danger', emoji: '🔓' },
        { id: 'market', label: 'Market', style: 'secondary', emoji: '🕯️' },
        { id: 'board', label: 'Board', style: 'secondary', emoji: '🏆' },
        { id: 'hub', label: 'Streets', style: 'secondary', emoji: '🌆' },
      ]
    : [
        { id: 'refresh', label: 'Refresh', style: 'secondary', emoji: '🔄' },
        { id: 'market', label: 'Market', style: 'secondary', emoji: '🕯️' },
        { id: 'board', label: 'Board', style: 'secondary', emoji: '🏆' },
        { id: 'hub', label: 'Streets', style: 'secondary', emoji: '🌆' },
      ];

  return {
    title: jailed ? '🚔 Behind bars' : '🌃 The city',
    lines,
    options: jailed ? [] : options,
    buttons,
    jailed,
  };
}

/** The attempt message, shown while the crime is "in progress". */
export function attemptPanel(crimeType, userId) {
  const crime = CRIMES[crimeType];
  return {
    title: `${crime?.emoji ?? '🌃'} ${crimeType.replace(/_/g, ' ')}`,
    lines: [
      `<@${userId}> is casing the job…`,
      '',
      `-# Second thoughts? **Bail Out** costs ${BAIL_OUT_COST} 🍩 and burns the cooldown, but you walk away clean.`,
    ],
    buttons: [{ id: `bail-out:${crimeType}`, label: 'Bail Out!', style: 'danger', emoji: '🏃' }],
  };
}

/**
 * The mark-picking step for a crime that needs a victim (S124).
 *
 * Before this, the panel's answer to "pickpocket" was a pointer back to
 * `!crime pickpocket @member` — which sends the player out of the panel the
 * panel exists to replace. The source has a whole view for this; ours is a
 * user select plus the source's Random and Cancel.
 */
export function targetPanel(crimeType, userId, minBalance) {
  const crime = CRIMES[crimeType];
  return {
    title: `${crime?.emoji ?? '🌃'} ${crimeType.replace(/_/g, ' ')} — pick a mark`,
    lines: [
      'Choose someone below, or let the street decide.',
      '',
      `-# They need at least **${Number(minBalance).toLocaleString('en-US')} 🍩** on them to be worth it. Bots, cellmates and you are off the table.`,
    ],
    buttons: [
      { id: `roll:${crimeType}`, label: 'Random Target', style: 'primary', emoji: '🎯' },
      { id: 'refresh', label: 'Cancel', style: 'secondary', emoji: '✖️' },
    ],
  };
}
