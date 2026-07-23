// Adapts a text message ("!command …") into an interaction-shaped object so a
// command's single execute() can serve both slash and text invocation. The
// commands are written against the interaction API; this bridge implements the
// subset they use (reply/editReply/followUp/deferReply, options getters,
// user/guild/member/channel) over a Message.
//
// Ephemeral replies have no equivalent in a normal channel, so we honor the
// intent by DMing the author instead — sensitive output (rap sheets, refusals)
// stays private, matching the slash behavior as closely as a text channel allows.
import { MessageFlags } from 'discord.js';
import { assignOptions, usageFor } from './parse.js';

const EPHEMERAL = MessageFlags.Ephemeral;

function isEphemeral(payload) {
  const flags = payload?.flags;
  if (flags === EPHEMERAL) return true;
  if (typeof flags === 'number') return (flags & EPHEMERAL) === EPHEMERAL;
  if (Array.isArray(flags)) return flags.includes(EPHEMERAL) || flags.includes('Ephemeral');
  return false;
}

function forChannel(payload) {
  const p = typeof payload === 'string' ? { content: payload } : { ...payload };
  delete p.flags; // channel messages cannot be ephemeral
  delete p.withResponse;
  return p;
}

/**
 * Resolve the parsed option ids into Discord objects and build the interaction.
 * @returns {Promise<{ errors: string[], interaction: object|null }>}
 */
export async function createMessageInteraction(message, command, parsed) {
  const optionDefs = command.data.toJSON().options ?? [];
  const { values, userIds, errors } = assignOptions(optionDefs, parsed);

  // Resolve user/channel/role ids to objects (async), preferring cached mentions.
  const users = {};
  for (const [name, id] of Object.entries(userIds)) {
    let user = message.mentions?.users?.get(id) ?? null;
    if (!user) user = await message.client.users.fetch(id).catch(() => null);
    if (!user) errors.push(`could not find user for \`${name}\``);
    else users[name] = user;
  }

  if (errors.length > 0) {
    return { errors, interaction: null, usage: usageFor(command.data.name, optionDefs) };
  }

  const author = message.author;
  const state = { sent: null };

  async function deliver(payload, { asNew = false } = {}) {
    if (isEphemeral(payload)) {
      const dm = await author.send(forChannel(payload)).catch(() => null);
      if (dm) return dm;
      // DMs closed — fall back to the channel with a discreet note.
      const p = forChannel(payload);
      p.content = `${author}, ${p.content ?? '(private reply, but your DMs are closed)'}`;
      return message.channel.send(p);
    }
    if (asNew || !state.sent) return message.channel.send(forChannel(payload));
    return message.channel.send(forChannel(payload));
  }

  const interaction = {
    // identity / context
    user: author,
    member: message.member,
    guild: message.guild,
    guildId: message.guildId,
    channel: message.channel,
    client: message.client,
    memberPermissions: message.member?.permissions ?? null,
    createdTimestamp: message.createdTimestamp,
    commandName: command.data.name,
    replied: false,
    deferred: false,
    isChatInputCommand: () => false,
    isTextCommand: true,

    options: {
      getUser: (name, required = false) => {
        const u = users[name] ?? null;
        if (!u && required) throw new Error(`missing user option ${name}`);
        return u;
      },
      getString: (name, required = false) => {
        const v = values[name] ?? null;
        if (v == null && required) throw new Error(`missing string option ${name}`);
        return v;
      },
      getInteger: (name) => (name in values ? values[name] : null),
      getNumber: (name) => (name in values ? values[name] : null),
      getBoolean: (name) => (name in values ? values[name] : null),
    },

    async reply(payload) {
      this.replied = true;
      state.sent = await deliver(payload);
      return typeof payload === 'object' && payload?.withResponse
        ? { resource: { message: state.sent } }
        : state.sent;
    },
    async deferReply() {
      this.deferred = true;
      message.channel.sendTyping?.().catch(() => {});
      state.sent = await message.channel.send('🚔 Working…').catch(() => null);
      return state.sent;
    },
    async editReply(payload) {
      const p = forChannel(payload);
      if (state.sent) return state.sent.edit(p).catch(() => state.sent);
      state.sent = await message.channel.send(p);
      return state.sent;
    },
    async followUp(payload) {
      return deliver(payload, { asNew: true });
    },
  };

  return { errors: [], interaction };
}
