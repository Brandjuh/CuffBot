import ask from './commands/ask.js';
import aiConfig from './commands/ai-config.js';
import mentionReply from './events/mention-reply.js';
import queueFlush from './events/queue-flush.js';

export default {
  name: 'detective',
  description:
    'The precinct detective (AI): /ask questions or mention the bot to talk to it. Free-tier provider (Groq or Gemini) via an API key in .env; one shared server-wide budget — rate-limited questions are parked on the desk pile and answered automatically.',
  commands: [ask, aiConfig],
  events: [mentionReply, queueFlush],
};
