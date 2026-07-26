// The `!connect4` group (M26.2a, thinned in M26.2b when Tic-Tac-Toe joined
// and `stats`/`board` moved to the shared `!minigames` surface).
import { endGameHere, openGame } from './open.js';

const SPEC = { emoji: '🔴', label: 'Connect 4' };

export default {
  group: {
    name: 'connect4',
    aliases: ['c4'],
    description: 'Connect 4 on a panel — challenge an officer, or take on the bot.',
    emoji: '🔴',
    invokeWithoutSubcommand: true,
    fallback: 'play',
    subcommands: [
      {
        name: 'play',
        description: 'Open a Connect 4 panel. Name an officer, or leave it blank to face the bot.',
        args: [{ name: 'opponent', type: 'user' }],
        async run(ctx, { opponent = null }) {
          await openGame(ctx, 'connect4', SPEC, opponent);
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
