import trivia from './commands/trivia.js';
import triviaScores from './commands/trivia-scores.js';
import triviaSets from './commands/trivia-sets.js';
import triviaButtons from './events/trivia-buttons.js';

export default {
  name: 'trivia',
  description:
    'Police trivia: /trivia starts a buttoned question round (first correct answer wins a point), /trivia-scores shows the leaderboard. Question sets are plain JSON files — add more anytime.',
  commands: [trivia, triviaScores, triviaSets],
  events: [triviaButtons],
};
