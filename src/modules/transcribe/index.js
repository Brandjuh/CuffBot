import transcribe from './commands/transcribe.js';
import messageWatch from './events/message.js';
import voiceWatch from './events/voice-state.js';
import bootSweep from './events/ready.js';
import { shutdownVoice } from './voice/session.js';

export default {
  name: 'transcribe',
  description:
    'The transcription desk: voice memos and audio attachments become written statements, in English.',
  commands: [transcribe],
  events: [messageWatch, voiceWatch, bootSweep],
  // S136: the self-updater exits the process on every merged PR; a live voice
  // session must drain and leave the channel instead of dying into a ghost.
  shutdown: () => shutdownVoice(),
};
