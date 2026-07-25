// Pure Connect 4 rules (S71 = M16.3, ported from phen-cogs/connect4) — no
// discord.js. Board = ROWS×COLS grid of 0 (empty) / 1 (challenger 🔴) /
// 2 (opponent 🔵); row 0 is the TOP row, pieces fall to the highest index.
export const COLS = 7;
export const ROWS = 6;
export const PIECES = ['⚪', '🔴', '🔵'];
const COLUMN_HEADER = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'].join('');

export function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

/**
 * Drop a piece into a column. Returns the landed row index, or -1 when the
 * column is full — the cog CRASHED on that press (recorded port bug); callers
 * must turn -1 into a polite refusal.
 */
export function dropPiece(board, col, player) {
  if (col < 0 || col >= COLS) return -1;
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    if (board[row][col] === 0) {
      board[row][col] = player;
      return row;
    }
  }
  return -1;
}

/** Does the piece just placed at (row, col) complete a run of ≥4? */
export function isWinningMove(board, row, col) {
  const player = board[row][col];
  if (!player) return false;
  const runs = [
    [0, 1], // horizontal
    [1, 0], // vertical
    [1, 1], // diagonal ↘
    [1, -1], // diagonal ↙
  ];
  for (const [dr, dc] of runs) {
    let count = 1;
    for (const sign of [1, -1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === player) {
        count += 1;
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (count >= 4) return true;
  }
  return false;
}

export function isFull(board) {
  return board[0].every((cell) => cell !== 0);
}

/** The emoji board with the column header row, as the cog rendered it. */
export function renderBoard(board) {
  const rows = board.map((row) => row.map((cell) => PIECES[cell]).join(''));
  return [COLUMN_HEADER, ...rows].join('\n');
}
