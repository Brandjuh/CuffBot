import logbook from './commands/logbook.js';
import { onMessageDelete, onMessageUpdate, onMessageBulkDelete } from './events/messages.js';
import { onMemberAdd, onMemberRemove, onMemberUpdate, onBanAdd, onBanRemove } from './events/members.js';
import {
  onVoiceState,
  onChannelCreate,
  onChannelDelete,
  onChannelUpdate,
  onRoleCreate,
  onRoleDelete,
  onRoleUpdate,
  onEmojiCreate,
  onEmojiDelete,
  onInviteCreate,
  onInviteDelete,
} from './events/server.js';

export default {
  name: 'logbook',
  description:
    'The station logbook: logs server events (messages, members, moderation, voice, server structure, invites) to a channel — each category toggleable via /logbook.',
  commands: [logbook],
  events: [
    onMessageDelete,
    onMessageUpdate,
    onMessageBulkDelete,
    onMemberAdd,
    onMemberRemove,
    onMemberUpdate,
    onBanAdd,
    onBanRemove,
    onVoiceState,
    onChannelCreate,
    onChannelDelete,
    onChannelUpdate,
    onRoleCreate,
    onRoleDelete,
    onRoleUpdate,
    onEmojiCreate,
    onEmojiDelete,
    onInviteCreate,
    onInviteDelete,
  ],
};
