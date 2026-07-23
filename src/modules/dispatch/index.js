import evidenceLocker from './commands/evidence-locker.js';
import dispatch from './commands/dispatch.js';

export default {
  name: 'dispatch',
  description:
    'Dispatch & the evidence locker: log enforcement actions to a configured channel and broadcast announcements to the precinct.',
  commands: [evidenceLocker, dispatch],
  events: [],
};
