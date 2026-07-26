// Rendering the game panel (M26.2a, extended for Tic-Tac-Toe in M26.2b).
//
// This is THE thing M26 exists for. The source cog is panel-driven — one
// message that IS the game, edited in place — and S71/S100 shipped a command
// surface instead. Skill rule 0.5.38 now says the panel belongs in the first
// slice a player can touch, and this is that slice.
//
// Pure: takes plain objects, returns `{ content, embed, rows }` descriptions
// that the command layer turns into discord.js builders. Keeping it pure is
// what lets a test assert "the buttons for full columns are disabled" without
// a gateway.
import { BLUE, COLORS, NONE, NUMBERS, RED, TIE, availableColumns, renderBoard } from './connect4.js';
import {
  CIRCLE,
  COLORS as TTT_COLORS,
  CROSS,
  EMOJIS as TTT_EMOJIS,
  SLOTS,
  slotToXY,
  winningLine as tttWinningLine,
} from './tictactoe.js';

const mention = (player) => (player.bot ? `**${player.name}**` : `<@${player.id}>`);

const money = (n) => Number(n).toLocaleString('en-US');

/**
 * The stake lines shared by both games.
 *
 * Shown **before** the game is accepted (so nobody commits without knowing the
 * price) and again on the result (so the payout is visible where it happened).
 * Silent in between — a running board should not repeat the terms every turn.
 */
export function stakeLines(game, { done, winnerSeat }) {
  const amount = game.stake?.amount ?? 0;
  if (!amount) return [];
  if (!game.accepted) {
    return ['', `💰 **Entry fee:** ${money(amount)} 🍩 each`, `🏆 **Winner takes:** ${money(game.stake.winAmount)} 🍩`];
  }
  if (!done) return [];
  if (winnerSeat === TIE || winnerSeat < 0) return ['', `💰 A tie — both stakes returned (${money(amount)} 🍩 each).`];
  const winner = game.players[winnerSeat];
  if (winner?.bot) return ['', `💰 The house keeps the ${money(amount)} 🍩.`];
  return ['', `💰 **${winner?.name ?? 'The winner'} takes ${money(game.stake.winAmount)} 🍩.**`];
}

/** The two seat lines, with the cog's crown-and-arrow markers. */
function seatLines(game, seats, emojiFor, { done, current, winner }) {
  return seats
    .filter((seat) => game.players[seat])
    .map((seat) => {
      const marker = done && winner === seat ? '👑 ' : !done && current === seat && game.accepted ? '▶' : '';
      return `${marker}${emojiFor(seat)} - ${mention(game.players[seat])}`;
    });
}

/** The invitation footer, identical for both games. */
const inviteLine = (game) => `${mention(game.players[1])} — press **Accept** to play, or **Decline**.`;

const inviteButtons = () => [
  { id: 'accept', label: 'Accept', style: 'success', disabled: false },
  { id: 'decline', label: 'Decline', style: 'secondary', disabled: false },
];

const rematchButtons = () => [{ id: 'rematch', label: 'Rematch', style: 'primary', disabled: false }];

/**
 * The panel for a Connect 4 session.
 *
 * @returns {{content: string|null, embed: {title,description,color},
 *   buttons: Array<{id: string, emoji: string, disabled: boolean}>, done: boolean}}
 */
export function connect4Panel(game) {
  const { state } = game;
  const done = state.winner !== NONE || game.cancelled;

  const title = !game.accepted
    ? 'Pending invitation…'
    : done
      ? state.winner === TIE
        ? 'Connect 4 — a tie'
        : `Connect 4 — ${game.players[state.winner]?.name ?? 'nobody'} wins`
      : 'Connect 4';

  const lines = seatLines(game, [RED, BLUE], (seat) => (seat === RED ? '🔴' : '🔵'), {
    done,
    current: state.current,
    winner: state.winner,
  });

  lines.push('');
  lines.push(renderBoard(state));

  if (!game.accepted) {
    lines.push('');
    lines.push(inviteLine(game));
  }
  lines.push(...stakeLines(game, { done, winnerSeat: state.winner }));

  const columns = availableColumns(state.board);
  const buttons = !game.accepted
    ? inviteButtons()
    : done
      ? rematchButtons()
      : NUMBERS.slice(0, state.board.width).map((emoji, column) => ({
          id: `col:${column}`,
          emoji,
          style: 'secondary',
          // A full column is disabled rather than left pressable. The cog
          // CRASHED on a full-column press; S71 already recorded that as a
          // port fix and answered it with a refusal — disabling is better
          // still, because the refusal never has to happen.
          disabled: !columns.includes(column),
        }));

  return {
    content: done || !game.accepted ? null : `${mention(game.players[state.current])}, your turn.`,
    embed: {
      title,
      description: lines.join('\n'),
      color: COLORS[done ? state.winner : NONE] ?? COLORS[NONE],
    },
    buttons,
    done,
  };
}

/**
 * The panel for a Tic-Tac-Toe session (M26.2b).
 *
 * The board IS the buttons here — nine of them, three per row — which is why
 * the description has no grid in it. A taken slot shows its mark and is
 * disabled, so the board and the controls are the same object and there is
 * nothing to keep in sync.
 */
export function ticTacToePanel(game) {
  const { state } = game;
  const done = state.winner !== NONE || game.cancelled;

  const title = !game.accepted
    ? 'Pending invitation…'
    : done
      ? state.winner === TIE
        ? 'Tic-Tac-Toe — a tie'
        : `Tic-Tac-Toe — ${game.players[state.winner]?.name ?? 'nobody'} wins`
      : 'Tic-Tac-Toe';

  const lines = seatLines(game, [CROSS, CIRCLE], (seat) => TTT_EMOJIS[seat], {
    done,
    current: state.current,
    winner: state.winner,
  });

  if (!game.accepted) {
    lines.push('');
    lines.push(inviteLine(game));
  }
  lines.push(...stakeLines(game, { done, winnerSeat: state.winner }));

  const winning = new Set(tttWinningLine(state).map(([x, y]) => `${x},${y}`));
  const slotButtons = [...Array(SLOTS).keys()].map((slot) => {
    const [x, y] = slotToXY(slot);
    const mark = state.board.get(x, y);
    return {
      id: `slot:${slot}`,
      emoji: TTT_EMOJIS[mark],
      // The winning three are highlighted the way Connect 4 highlights its
      // four: the loud style, not a different emoji, because the marks have to
      // stay readable as marks.
      style: winning.has(`${x},${y}`) ? 'success' : 'secondary',
      disabled: mark !== NONE || done,
    };
  });

  // ⚠️ The finished board STAYS on screen, with the rematch button under it —
  // the source does the same (`get_view` builds a RematchView and then adds all
  // nine buttons to it anyway). Connect 4 can drop its buttons on finish
  // because its board is drawn in the embed text; Tic-Tac-Toe's board IS the
  // buttons, so dropping them would delete the game the moment it ended, and
  // the winning-line highlight would never be seen by anyone.
  const buttons = !game.accepted ? inviteButtons() : done ? [...slotButtons, ...rematchButtons()] : slotButtons;

  return {
    content: done || !game.accepted ? null : `${mention(game.players[state.current])}, your turn.`,
    embed: {
      title,
      description: lines.join('\n'),
      color: TTT_COLORS[done ? state.winner : NONE] ?? TTT_COLORS[NONE],
    },
    buttons,
    done,
    // Nine slot buttons must land three per row, not Discord's default five.
    perRow: 3,
  };
}

/** Which renderer a session uses. */
export const panelFor = (game) => (game.game === 'tictactoe' ? ticTacToePanel(game) : connect4Panel(game));
