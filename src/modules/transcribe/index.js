import transcribe from './commands/transcribe.js';
import messageWatch from './events/message.js';
import voiceWatch from './events/voice-state.js';

export default {
  name: 'transcribe',
  description:
    'The transcription desk: voice memos and audio attachments become written statements, in English.',
  commands: [transcribe],
  events: [messageWatch, voiceWatch],
};
