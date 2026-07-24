// Tracks when the configured channel last saw a message (RAM only). Human
// messages also clear the "bot spoke last" guard so the next starter is
// allowed. Needs no Message Content — arrival is activity, content irrelevant.
import { Events } from 'discord.js';
import { getStarterConfig, noteActivity } from '../service.js';

export default {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild || message.guild.id !== message.client.config.homeGuildId) return;
    const config = getStarterConfig(message.guild.id);
    if (!config.channelId || message.channelId !== config.channelId) return;
    // The bot's own starter must NOT count as fresh conversation; other bots
    // do reset the idle clock (their messages are visible activity) but only
    // humans re-arm the next starter.
    if (message.author?.id === message.client.user?.id) return;
    noteActivity(message.channelId, { human: !message.author?.bot });
  },
};
