// The `ctx` every command run() receives, whether it came from a group
// subcommand (S69) or a flat command (S93). Building it in one place is what
// lets both surfaces share the same reply contract.
//
// ctx.reply is the S54 rule in code: a `!command` NEVER answers by DM and
// never pings the person it is replying to. It falls back to a plain channel
// send when the original message is gone (deleted mid-command).
import { MessageFlags } from 'discord.js';

/**
 * Is this a framework ctx or a legacy adapter-built interaction? Both carry
 * `guild`, `user`, `client` and `reply()`, so shared helpers work on either —
 * only the ephemeral flag differs, and only the legacy path knows it. `prefix`
 * is the discriminator: a ctx always has one, an interaction never does.
 *
 * This exists only for the M17.3 window, while both shapes are in play. When
 * slice D deletes the adapter, `replyEither` collapses to `source.reply`.
 */
export const isCtx = (source) => 'prefix' in source;

/** Reply from a helper that may be called from either shape. */
export function replyEither(source, content) {
  return isCtx(source)
    ? source.reply(content)
    : source.reply({ content, flags: MessageFlags.Ephemeral });
}

export function buildCtx(message, prefix) {
  return {
    message,
    client: message.client,
    guild: message.guild,
    channel: message.channel,
    member: message.member,
    user: message.author,
    prefix,
    // S93: the replacement for the legacy deferReply(). A text command has no
    // 3-second interaction deadline — that was purely a slash constraint — so
    // a slow command (avatar fetch, AI call) shows the typing indicator and
    // then answers once, instead of posting "🚔 Working…" and editing it.
    typing: () => Promise.resolve(message.channel?.sendTyping?.()).catch(() => null),
    reply: (payload) => {
      const p = typeof payload === 'string' ? { content: payload } : { ...payload };
      if (!p.allowedMentions) p.allowedMentions = { repliedUser: false };
      return message.reply(p).catch(() => message.channel.send(p).catch(() => null));
    },
  };
}
