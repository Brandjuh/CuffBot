// The shared game runtime (M26.2b): the parts both games need, in one place
// so the two command files stay thin and the pump has one thing to call.
//
// This is NOT a `commands/` file — the loader enumerates modules by their
// `index.js` manifest, and the manifest lists command modules explicitly, so a
// helper module can live at the module root without being mistaken for one.
// It sits here rather than in `lib/` because it touches discord.js builders
// and the store; `lib/` is the pure half.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { NONE as C4_NONE, TIE as C4_TIE, chooseColumn, playColumn } from './lib/connect4.js';
import { NONE as T_NONE, TIE as T_TIE, chooseSlot, playSlot } from './lib/tictactoe.js';
import { panelFor } from './lib/panel.js';
import { checkStakes, drawWinAmount, refundsFor, settlementFor } from './lib/staking.js';
import { adjustBalance, balanceOf } from '../economy/service.js';
import { getMinigamesConfig, recordResult } from './service.js';

const STYLES = {
  success: ButtonStyle.Success,
  secondary: ButtonStyle.Secondary,
  primary: ButtonStyle.Primary,
  danger: ButtonStyle.Danger,
};

/**
 * The two games behind one interface.
 *
 * Everything that differs between Connect 4 and Tic-Tac-Toe is a value in this
 * table; everything that does not is the code below it. Adding a third game to
 * the frame means adding a row, which is what "a shared frame" has to mean if
 * it is to mean anything.
 */
export const RULES = {
  connect4: {
    label: 'Connect 4',
    none: C4_NONE,
    tie: C4_TIE,
    play: playColumn,
    aiMove: (state, random) => chooseColumn(state.board, state.current, random),
    // `col:3` → 3
    moveFromAction: (action) => (action.startsWith('col:') ? Number(action.slice(4)) : null),
  },
  tictactoe: {
    label: 'Tic-Tac-Toe',
    none: T_NONE,
    tie: T_TIE,
    play: playSlot,
    aiMove: (state, random) => chooseSlot(state.board, state.current, random),
    // `slot:4` → 4
    moveFromAction: (action) => (action.startsWith('slot:') ? Number(action.slice(5)) : null),
  },
};

export const rulesFor = (game) => RULES[game?.game ?? 'connect4'] ?? RULES.connect4;

/** Turn the pure panel description into a discord.js message payload. */
export function payloadFor(game) {
  const panel = panelFor(game);
  const buttons = panel.buttons.map((b) => {
    const button = new ButtonBuilder().setCustomId(`mg:${game.id}:${b.id}`).setStyle(STYLES[b.style]);
    if (b.emoji) button.setEmoji(b.emoji);
    if (b.label) button.setLabel(b.label);
    return button.setDisabled(Boolean(b.disabled));
  });
  // Discord allows five buttons per row; Connect 4's seven columns therefore
  // need two rows, and Tic-Tac-Toe asks for three per row so the nine slots
  // form the 3×3 board they represent.
  const perRow = panel.perRow ?? 5;
  const rows = [];
  for (let i = 0; i < buttons.length; i += perRow) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + perRow)));
  }
  return {
    content: panel.content ?? undefined,
    embeds: [
      new EmbedBuilder().setTitle(panel.embed.title).setDescription(panel.embed.description).setColor(panel.embed.color),
    ],
    components: rows,
    allowedMentions: { parse: ['users'] },
  };
}

/** The bot moves if it is the bot's turn. Exported so the pump can reuse it. */
export async function botMoveIfDue(game, random = Math.random) {
  const rules = rulesFor(game);
  while (!game.finished && game.state.winner === rules.none && game.players[game.state.current]?.bot) {
    game.state = rules.play(game.state, rules.aiMove(game.state, random));
  }
  return settleIfOver(game);
}

/**
 * Mark a finished game finished, pay out, and write the result exactly once.
 *
 * The `finished` flag is what makes it once-only: every path that can end a
 * game (a human move, a bot move, the final move of a rematch) funnels through
 * here, and a second call is a no-op. Recording twice would double a player's
 * win on a single game — and since M26.2b it would also pay the prize twice,
 * which is the same claim-before-act shape as S22 with real money attached.
 */
export async function settleIfOver(game) {
  const rules = rulesFor(game);
  if (game.finished || game.state.winner === rules.none) return game;
  game.finished = true;

  const [seatA, seatB] = game.players;
  const tie = game.state.winner === rules.tie;
  const winner = tie ? null : game.players[game.state.winner];

  // Money first: a payout that throws must not leave the game unsettled, but a
  // stats write that throws must not leave a prize unpaid either. Paying first
  // and recording second means the worst case is a missing stat line, not a
  // missing payout.
  await payOut(game, { tie, winnerId: winner?.id ?? null });

  // Games against the bot do not touch the scoreboard: a human record is only
  // meaningful against other humans, and the cog's own stats work the same way.
  if (!game.againstBot) {
    const stake = { amount: game.stake?.taken ? game.stake.amount : 0, winAmount: game.stake?.winAmount ?? 0 };
    if (tie) recordResult(game.guildId, { tie: [seatA.id, seatB.id], stake });
    else {
      const loser = game.players[game.state.winner === 0 ? 1 : 0];
      recordResult(game.guildId, { winnerId: winner.id, loserId: loser.id, stake });
    }
  }
  return game;
}

/** Move the money a finished game owes. */
async function payOut(game, { tie, winnerId }) {
  if (!game.stake?.taken) return;
  const moves = settlementFor(
    { tie, winnerId, players: game.players },
    { amount: game.stake.amount, winAmount: game.stake.winAmount },
  );
  for (const move of moves) await adjustBalance(game.guildId, move.id, move.delta);
}

/**
 * Take the stakes. Called when a game is ACCEPTED, never when it is offered —
 * an invitation nobody answers must not cost anything.
 *
 * @returns {{ok:true}|{ok:false, reason:string, shortId?:string, need?:number, have?:number}}
 */
export async function takeStakes(game) {
  if (!game.stake?.amount || game.stake.taken) return { ok: true };
  const config = getMinigamesConfig(game.guildId);
  const withBalances = await Promise.all(
    game.players.map(async (p) => ({ ...p, balance: p.bot ? 0 : await balanceOf(game.guildId, p.id) })),
  );
  const verdict = checkStakes(withBalances, config, { againstBot: game.againstBot });
  if (!verdict.ok) return verdict;
  for (const id of verdict.payers) await adjustBalance(game.guildId, id, -verdict.amount);
  game.stake.taken = verdict.amount > 0;
  return { ok: true };
}

/** Give the stakes back — a game cancelled before anyone moved. */
export async function refundStakes(game) {
  const moves = refundsFor(game.players, { amount: game.stake?.amount ?? 0, staked: Boolean(game.stake?.taken) });
  for (const move of moves) await adjustBalance(game.guildId, move.id, move.delta);
  if (game.stake) game.stake.taken = false;
  return moves;
}

/**
 * The stake a new game carries.
 *
 * The prize is drawn ONCE here rather than at settlement, so the invitation can
 * say what is being played for. A prize decided after the winner is known would
 * also be a prize the loser never agreed to.
 */
export function stakeFor(guildId, { againstBot }, rng) {
  const config = getMinigamesConfig(guildId);
  const verdict = checkStakes([], config, { againstBot });
  return { amount: verdict.amount, winAmount: verdict.amount ? drawWinAmount(config, rng) : 0, taken: false };
}

/** Can everyone afford it? Asked before the panel goes up, as the cog does. */
export async function affordabilityCheck(guildId, players, { againstBot }) {
  const config = getMinigamesConfig(guildId);
  const withBalances = await Promise.all(
    players.map(async (p) => ({ ...p, balance: p.bot ? 0 : await balanceOf(guildId, p.id) })),
  );
  return checkStakes(withBalances, config, { againstBot });
}
