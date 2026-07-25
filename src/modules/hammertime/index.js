import hammertime from './commands/hammertime.js';
import messages from './events/messages.js';
import selects from './events/selects.js';

export default {
  name: 'hammertime',
  description:
    'Hammertime (ported from Dumb-Cogs): natural time phrases → Discord timestamps that render correctly for every reader, backed by a per-member timezone registry with role defaults and an optional auto-convert mode.',
  commands: [hammertime],
  events: [messages, selects],
};
