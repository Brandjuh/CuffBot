// The `!tictactoe` group (M26.2b) — the second game on M26.2a's frame.
import { endGameHere, openGame } from './open.js';

const SPEC = { emoji: '❌', label: 'Tic-Tac-Toe' };

export default {
  group: {
    name: 'tictactoe',
    aliases: ['ttt'],
    description: 'Tic-Tac-Toe on a panel — the board IS the buttons.',
    emoji: '❌',
    invokeWithoutSubcommand: true,
    fallback: 'play',
    subcommands: [
      {
        name: 'play',
        description: 'Open a Tic-Tac-Toe panel. Name an officer, or leave it blank to face the bot.',
        args: [{ name: 'opponent', type: 'user' }],
        async run(ctx, { opponent = null }) {
          await openGame(ctx, 'tictactoe', SPEC, opponent);
        },
      },
      {
        name: 'end',
        description: 'End the game running in this channel.',
        args: [],
        async run(ctx) {
          await endGameHere(ctx, SPEC);
        },
      },
    ],
  },
};
