// Picking a mark (S124 = M26.3b, the source's `TargetSelectionView`).
//
// Two of the five crimes need a victim. Before this, picking one from the panel
// was impossible — the panel answered "that one needs a mark, run `!crime
// pickpocket @member`", which throws the player back out to the text surface
// the panel was built to replace.
//
// The source offers **Random Target** / **Select Target** / **Cancel**, where
// Select Target opens a modal you type a name into. We keep the choice but not
// the modal: discord.js v14 has a user select menu, so the player picks from a
// real list instead of spelling a display name correctly.
//
// Pure: plain candidate records in, verdicts out. `{id, bot, balance, jailed}`
// is all a candidate needs to be, so the caller decides how expensive the
// lookup is.

/**
 * Why this member cannot be robbed, or `null` if they can.
 *
 * The order matters for the message the player gets: "that's you" beats "they
 * are broke" even when both are true.
 *
 * @param {{id:string, bot?:boolean, balance?:number, jailed?:boolean}} candidate
 * @param {{selfId:string, minBalance:number, lastTargetId?:string|null}} opts
 * @returns {null|'self'|'bot'|'jailed'|'too-poor'|'repeat'}
 */
export function targetProblem(candidate, { selfId, minBalance, lastTargetId = null }) {
  if (!candidate || !candidate.id) return 'bot';
  if (candidate.id === selfId) return 'self';
  if (candidate.bot) return 'bot';
  if (candidate.jailed) return 'jailed';
  if ((candidate.balance ?? 0) < minBalance) return 'too-poor';
  // The cog remembers your last mark and refuses to hand you the same one
  // twice in a row from the random button. Deliberately NOT enforced on a
  // deliberate pick: refusing a name the player typed themselves is different
  // from refusing to roll it, and only the roll is the cog's concern.
  if (lastTargetId && candidate.id === lastTargetId) return 'repeat';
  return null;
}

/** Everyone who can be robbed right now. */
export function eligibleTargets(candidates, opts) {
  return candidates.filter((candidate) => targetProblem(candidate, opts) === null);
}

/**
 * Roll a mark.
 *
 * When the ONLY thing standing between the player and a target is that it was
 * their last one, the cog's own message admits the situation ("the only member
 * found was already your last target"). We do the same thing more usefully:
 * fall back to allowing the repeat rather than refusing to play, because a
 * two-person guild would otherwise never get a random target at all.
 *
 * @returns {{ok:true, target:object, repeat:boolean}|{ok:false, reason:'nobody'}}
 */
export function pickRandomTarget(candidates, opts, rng = { pick: (l) => l[Math.floor(Math.random() * l.length)] }) {
  const fresh = eligibleTargets(candidates, opts);
  if (fresh.length > 0) return { ok: true, target: rng.pick(fresh), repeat: false };

  const repeats = eligibleTargets(candidates, { ...opts, lastTargetId: null });
  if (repeats.length > 0) return { ok: true, target: rng.pick(repeats), repeat: true };

  return { ok: false, reason: 'nobody' };
}

/** The sentence a player sees when their chosen mark is refused. */
export const TARGET_REFUSAL = {
  self: '🚫 Robbing yourself is not a crime, just sad.',
  bot: '🚫 Bots carry no cash.',
  jailed: '🚫 They are already in a cell — nothing left to take.',
  'too-poor': '🚫 They are not carrying enough to be worth the risk.',
  repeat: '🚫 You just hit them. Give it a minute.',
  nobody: '🚫 Nobody on this street is worth robbing right now.',
};
