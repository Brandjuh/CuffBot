import selfroles from './commands/selfroles.js';
import buttons from './events/buttons.js';
import { onBootCatchUp, onRoleCreate, onRoleDelete, onRoleUpdate } from './events/watch.js';

export default {
  name: 'selfroles',
  description:
    'Self-assignable roles: a button list in the self-roles channel — press to get a role, press again to take it off; the list follows the role section under the "self-roles" header and keeps itself current.',
  commands: [selfroles],
  events: [buttons, onRoleCreate, onRoleDelete, onRoleUpdate, onBootCatchUp],
};
