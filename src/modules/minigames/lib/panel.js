// Rendering the game panel (M26.2a).
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

const mention = (player) => (player.bot ? `**${player.name}**` : `<@${player.id}>`);

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

  const lines = [];
  for (const seat of [RED, BLUE]) {
    const player = game.players[seat];
    if (!player) continue;
    // A crown on the winner, an arrow on whoever must move — the cog's own
    // two markers, so the panel reads the same way theirs does.
    const marker = done && state.winner === seat ? '👑 ' : !done && state.current === seat ? '▶' : '';
    lines.push(`${marker}${seat === RED ? '🔴' : '🔵'} - ${mention(player)}`);
  }

  lines.push('');
  lines.push(renderBoard(state));

  if (!game.accepted) {
    lines.push('');
    lines.push(`${mention(game.players[1])} — press **Accept** to play, or **Decline**.`);
  }

  const columns = availableColumns(state.board);
  const buttons = !game.accepted
    ? [
        { id: 'accept', label: 'Accept', style: 'success', disabled: false },
        { id: 'decline', label: 'Decline', style: 'secondary', disabled: false },
      ]
    : done
      ? [{ id: 'rematch', label: 'Rematch', style: 'primary', disabled: false }]
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
