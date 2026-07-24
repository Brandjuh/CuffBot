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
import { logger } from '../logger.js';
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
  delete p.textInChannel; // adapter-only routing marker, never sent to Discord
  return p;
}

/**
 * Resolve the parsed option ids into Discord objects and build the interaction.
 * @returns {Promise<{ errors: string[], interaction: object|null }>}
 */
const OPTION_TYPE = { USER: 6, CHANNEL: 7, ROLE: 8 };

export async function createMessageInteraction(message, command, parsed) {
  const optionDefs = command.data.toJSON().options ?? [];
  const { values, userIds: refIds, errors } = assignOptions(optionDefs, parsed, command.textGreedyArg ?? null);
  const typeByName = Object.fromEntries(optionDefs.map((o) => [o.name, o.type]));
  const defByName = Object.fromEntries(optionDefs.map((o) => [o.name, o]));

  // Resolve user/role/channel ids to objects (async), by option type, preferring
  // cached mentions/entities.
  const users = {};
  const roles = {};
  const channels = {};
  for (const [name, id] of Object.entries(refIds)) {
    const type = typeByName[name];
    if (type === OPTION_TYPE.ROLE) {
      let role = message.guild?.roles?.cache?.get(id) ?? null;
      if (!role) role = await message.guild?.roles?.fetch(id).catch(() => null);
      if (!role) errors.push(`could not find role for \`${name}\``);
      else roles[name] = role;
    } else if (type === OPTION_TYPE.CHANNEL) {
      let channel = message.guild?.channels?.cache?.get(id) ?? null;
      if (!channel) channel = await message.guild?.channels?.fetch(id).catch(() => null);
      if (!channel) errors.push(`could not find channel for \`${name}\``);
      else {
        // Honor the builder's addChannelTypes restriction, like the slash UI
        // does — otherwise a category/forum id would be stored where the
        // command expects a text channel and features fail silently later.
        const allowed = defByName[name]?.channel_types;
        if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(channel.type)) {
          errors.push(`\`${name}\` must be a text channel`);
        } else {
          channels[name] = channel;
        }
      }
    } else {
      let user = message.mentions?.users?.get(id) ?? null;
      if (!user) user = await message.client.users.fetch(id).catch(() => null);
      if (!user) errors.push(`could not find user for \`${name}\``);
      else users[name] = user;
    }
  }

  if (errors.length > 0) {
    return { errors, interaction: null, usage: usageFor(command.data.name, optionDefs) };
  }

  const author = message.author;
  const state = { sent: null };

  async function deliver(payload, { asNew = false } = {}) {
    if (isEphemeral(payload)) {
      // S50: ephemeral-for-NOISE (game claims, cooldown notices) is not
      // ephemeral-for-PRIVACY. Commands mark the former with textInChannel —
      // on the text path it answers right in the channel (reply, no ping);
      // only genuinely private output (rap sheets) still goes to DM.
      if (payload?.textInChannel) {
        const p = forChannel(payload);
        if (!p.allowedMentions) p.allowedMentions = { repliedUser: false };
        if (typeof message.reply === 'function') return message.reply(p);
        return message.channel.send(p);
      }
      try {
        return await author.send(forChannel(payload));
      } catch (error) {
        // Only Discord error 50007 means the DM was genuinely refused.
        // Anything else (bad payload, network) is OUR failure — blaming the
        // member's "closed DMs" for it sends them hunting through settings
        // that are already fine (S46 owner report). Log the real error.
        logger.warn(
          `Text-command DM to ${author.tag ?? author.id} failed (code ${error?.code ?? 'unknown'}): ${error?.message ?? error}`,
        );
        const p = forChannel(payload);
        const note =
          error?.code === 50007
            ? '(private reply — Discord refused the DM. Check this server’s **Privacy Settings → Direct Messages**, and that CuffBot isn’t blocked.)'
            : '(private reply — the DM failed on my end, so it lands here instead.)';
        p.content = p.content ? `${author}, ${p.content}` : `${author}, ${note}`;
        return message.channel.send(p);
      }
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
    // Channel-aware, like a slash interaction's memberPermissions — so a
    // per-channel permission overwrite is honored, not just the guild-level role.
    memberPermissions:
      message.channel?.permissionsFor?.(message.member) ?? message.member?.permissions ?? null,
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
      getRole: (name, required = false) => {
        const r = roles[name] ?? null;
        if (!r && required) throw new Error(`missing role option ${name}`);
        return r;
      },
      getChannel: (name, required = false) => {
        const c = channels[name] ?? null;
        if (!c && required) throw new Error(`missing channel option ${name}`);
        return c;
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
