import channelList from './commands/channel-list.js';
import {
  onChannelCreate,
  onChannelDelete,
  onChannelUpdate,
  onRoleUpdate,
  onRoleDelete,
  onListMessageDelete,
  onListBulkDelete,
  onBootCatchUp,
} from './events/watch.js';

export default {
  name: 'channellist',
  description:
    'The precinct directory: posts a self-updating list of all categories and channels (with their topics) and keeps it current as the server changes — ported from the owner\'s FRA bot.',
  commands: [channelList],
  events: [
    onChannelCreate,
    onChannelDelete,
    onChannelUpdate,
    onRoleUpdate,
    onRoleDelete,
    onListMessageDelete,
    onListBulkDelete,
    onBootCatchUp,
  ],
};
