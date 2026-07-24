import youtube from './commands/youtube.js';
import youtubeSweep from './events/youtube-sweep.js';

export default {
  name: 'youtube',
  description:
    'YouTube upload announcements: follows one or more creators via their public feeds (no API key) and posts every new video link in the configured channel.',
  commands: [youtube],
  events: [youtubeSweep],
};
