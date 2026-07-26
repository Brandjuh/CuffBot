// Donut staking (M26.2b, ported from `minigames/base.py` + the cog's config).
//
// The owner asked for "everything the cog has", staking included. The cog's
// shape, kept:
//
//   * every human player pays `betAmount` **when the game is accepted**, not
//     when it is offered — an invitation nobody answers must not cost anything;
//   * the winner receives `winAmount`, a single random draw in
//     `[winMin, winMax]` made when the game is created, so both players can be
//     told what they are playing for before either commits;
//   * a game cancelled **before it starts** refunds every stake;
//   * a bot never pays and is never paid.
//
// Pure: balances in, decisions out. No store, no economy calls, no Discord.

/** The cog's `default_guild`. */
export const DEFAULT_STAKE_CONFIG = {
  betAmount: 100,
  winMin: 400,
  winMax: 600,
  // NOT in the cog — see `stakeAgainstBot` below.
  betVsBot: true,
};

/**
 * The prize for this game, drawn once at creation.
 *
 * A range that is the wrong way round would make `rng.int(min, max)` return
 * nonsense, so it is clamped here rather than trusted; the admin command
 * refuses to store an inverted range, but a config file edited by hand can
 * still produce one.
 */
export function drawWinAmount(config = DEFAULT_STAKE_CONFIG, rng = { int: (a, b) => a + Math.floor(Math.random() * (b - a + 1)) }) {
  const min = Math.max(0, Math.min(config.winMin, config.winMax));
  const max = Math.max(0, Math.max(config.winMin, config.winMax));
  return rng.int(min, max);
}

/**
 * Does this game cost anything, and who pays?
 *
 * ⚠️ **`betVsBot` is ours, not the cog's.** The cog charges the human and pays
 * out in full when the opponent is the bot, which turns a beatable heuristic
 * into a repeatable **+300 to +500 donuts per game** — a faucet nothing else in
 * CuffBot's economy comes close to. The cog's behaviour is the default, because
 * the owner asked for the cog; the knob exists so switching it off is one
 * command rather than a code change if the precinct's economy starts to drift.
 */
export function stakeAgainstBot(config = DEFAULT_STAKE_CONFIG) {
  return config.betVsBot !== false;
}

/**
 * Who has to pay, and can they?
 *
 * @param {Array<{id:string, bot?:boolean, balance:number}>} players
 * @returns {{ok:true, amount:number, payers:string[]}|{ok:false, reason:'too-poor', shortId:string, need:number, have:number}}
 */
export function checkStakes(players, config = DEFAULT_STAKE_CONFIG, { againstBot = false } = {}) {
  const amount = Math.max(0, Number(config.betAmount) || 0);
  if (amount === 0 || (againstBot && !stakeAgainstBot(config))) {
    return { ok: true, amount: 0, payers: [] };
  }
  const humans = players.filter((p) => !p.bot);
  for (const player of humans) {
    if ((player.balance ?? 0) < amount) {
      return { ok: false, reason: 'too-poor', shortId: player.id, need: amount, have: player.balance ?? 0 };
    }
  }
  return { ok: true, amount, payers: humans.map((p) => p.id) };
}

/**
 * What the ledger must do when a staked game ends.
 *
 * A tie returns both stakes rather than paying a prize — the cog's
 * `handle_game_end` pays only `winner != TIE && winner != NONE`, and its
 * `record_game_result` then charges a tied player nothing, so the money has to
 * come back. Leaving it withdrawn would quietly delete two stakes per tie.
 *
 * @param {{winnerId:string|null, players:Array<{id:string,bot?:boolean}>, tie:boolean}} outcome
 * @returns {Array<{id:string, delta:number, why:string}>}
 */
export function settlementFor(outcome, { amount, winAmount }) {
  if (!amount) {
    // No stakes were taken, so nothing is owed — including to the winner. A
    // prize paid out of an unstaked game would be money from nowhere.
    return [];
  }
  const humans = outcome.players.filter((p) => !p.bot);
  if (outcome.tie || !outcome.winnerId) {
    return humans.map((p) => ({ id: p.id, delta: amount, why: 'refund' }));
  }
  const winner = humans.find((p) => p.id === outcome.winnerId);
  return winner ? [{ id: winner.id, delta: winAmount, why: 'prize' }] : [];
}

/** Stakes come back untouched when a game is cancelled before it starts. */
export function refundsFor(players, { amount, staked }) {
  if (!staked || !amount) return [];
  return players.filter((p) => !p.bot).map((p) => ({ id: p.id, delta: amount, why: 'refund' }));
}

/**
 * What a player's earnings changed by — the cog's
 * `total_earnings += win_amount - bet_amount` for the winner and
 * `-= bet_amount` for the loser.
 *
 * A tie is 0 in the cog too (it adds nothing), which is only correct because
 * the stake comes back; `settlementFor` above is what makes that true here.
 */
export function earningsDelta({ won, tied }, { amount, winAmount }) {
  if (!amount) return 0;
  if (tied) return 0;
  return won ? winAmount - amount : -amount;
}
