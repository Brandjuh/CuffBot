import ask from './commands/ask.js';
import aiConfig from './commands/ai-config.js';
import mentionReply from './events/mention-reply.js';

export default {
  name: 'detective',
  description:
    'The precinct detective (AI): /ask questions or mention the bot to talk to it. Free-tier provider (Groq or Gemini) via an API key in .env; one shared server-wide budget of 1 question per 7 s and 62 per hour.',
  commands: [ask, aiConfig],
  events: [mentionReply],
};
