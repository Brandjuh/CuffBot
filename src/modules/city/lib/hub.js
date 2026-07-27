// The city hub (S133): the source's `MainMenuView`, and the command S122 deleted.
//
// S122 removed `city` as an alias of `crime` — rightly, because in the source
// they are two different commands and the owner had noticed they were one here
// ("de spellen Crime/city zijn hetzelfde"). It reserved the name "for the hub
// when it exists". No session built the hub, M26.3 was then closed as
// COMPLETE, and `!city` has answered with **silence** ever since: the router
// drops an unknown command without a word (`router.js`: `if (!command)
// return`). The owner had typed `!city` since S90.
//
// `MainMenuView` is, notably, the one view in M26.3's own inventory of the
// source's `crime/views.py` with no CuffBot counterpart — every other one
// (`CrimeListView`, `BailView`, `JailOptionsView`, `TargetSelectionView`,
// `BlackmarketView`, `CrimeAttemptView`) was built in S122 or S124.
//
// Pure, like `panel.js`: plain objects in, a description of what to render out.
// What the hub says in each state a criminal can be in is assertable without a
// gateway.
import { relative } from '../../../core/timestamps.js';

const money = (n) => Number(n).toLocaleString('en-US');

/**
 * Where the hub can send you. Ordered by how often it is wanted.
 *
 * Each `id` is a `cty:` pump action — `test/city-hub.test.js` matches this set
 * against the pump's handlers, the same guard `city-panel.test.js` puts on the
 * crime panel's buttons, because a button whose action nobody handles is a
 * dead button that looks alive.
 */
export const HUB_BUTTONS = [
  { id: 'crime', label: 'Jobs', style: 'primary', emoji: '🌃' },
  { id: 'market', label: 'Market', style: 'secondary', emoji: '🕯️' },
  { id: 'board', label: 'Board', style: 'secondary', emoji: '🏆' },
  { id: 'record', label: 'Record', style: 'secondary', emoji: '📋' },
];

/**
 * The hub body: where you stand, and where you can go.
 *
 * Deliberately SHORT. The owner has twice said the game screens read too long
 * ("de teksten zijn veelste groot"), and a menu is the one screen with nothing
 * to say — the detail lives one press away behind Record, Market and Board.
 *
 * @param {object}  args
 * @param {object}  args.criminal  the stored record
 * @param {number}  args.balance
 * @param {object}  args.jail      `jailState(criminal)`
 * @returns {{title: string, lines: string[], buttons: typeof HUB_BUTTONS, jailed: boolean}}
 */
export function cityHub({ criminal, balance, jail, now = Date.now() }) {
  const jailed = Boolean(jail?.jailed);
  const stats = criminal?.stats ?? {};
  const clean = stats.successes ?? 0;
  const busted = stats.failures ?? 0;

  const lines = [
    `**Wallet:** ${money(balance)} 🍩`,
    clean + busted === 0
      ? '**Record:** clean — you have never pulled a job.'
      : `**Record:** ${clean} clean · ${busted} busted`,
    criminal?.streak > 0
      ? `**Streak:** ${criminal.streak} in a row${criminal.highest > criminal.streak ? ` (best ${criminal.highest})` : ''}`
      : null,
    '',
    jailed
      ? // Jail is the one state where the hub must say what to do next: the way
        // out is behind the Jobs button, which does not read like an exit.
        // A Discord timestamp, not a rendered duration: the hub is a message
        // that sits in the channel, and "out in 45m 00s" is a lie the moment
        // it is sent (S134).
        `🚔 **You are in a cell** — out ${relative(jail.releaseAt ?? now + jail.remainingMs)}. Bail and jailbreak are on the jobs board.`
      : '_Pick a door._',
    // `filter(Boolean)` would drop the '' separator above with the nulls, which
    // is how the blank line went missing until a mutation test exposed it.
  ].filter((line) => line !== null);

  return { title: '🌆 The streets', lines, buttons: HUB_BUTTONS, jailed };
}
