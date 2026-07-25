// Red-style group commands (S69 = M17.1, owner mandate): `!group sub <args>`
// with a bare `!group` showing status + the subcommand overview — the command
// structure of the Red-DiscordBot cogs the owner pointed at. A group command
// file exports { group: {...} } instead of { data, execute }.
//
// Shape:
//   export default { group: {
//     name, description, emoji?, permission?,        // permission = BigInt flag
//     status(ctx)?,                                   // bare !group body lines
//     subcommands: [{ name, aliases?, description, permission?,
//                     args: [{ name, type, required?, greedy?, choices? }],
//                     run(ctx, values) }],
//   } }
//
// ctx = { message, client, guild, channel, member, user, prefix,
//         reply(payload) }  — reply() is the S54 no-ping in-channel reply.
import { EmbedBuilder } from 'discord.js';
import { logger } from '../logger.js';

const TYPES = new Set(['string', 'integer', 'number', 'boolean', 'user', 'role', 'channel']);

/** `!group sub <a> [b…]` usage string for one subcommand. */
export function subUsage(prefix, groupName, sub) {
  const parts = (sub.args ?? []).map((a) => {
    const label = a.greedy ? `${a.name}…` : a.name;
    return a.required ? `<${label}>` : `[${label}]`;
  });
  return `${prefix}${groupName} ${sub.name}${parts.length ? ` ${parts.join(' ')}` : ''}`;
}

const TRUE_WORDS = new Set(['true', 'yes', 'on', 'ja', '1']);
const FALSE_WORDS = new Set(['false', 'no', 'off', 'nee', '0']);

/**
 * Resolve one raw token into a typed value. Entity types return an id-bearing
 * object from the guild (mention or raw id both work). Returns {value} or
 * {error}. Pure except for the guild lookups (cache first, fetch fallback).
 */
async function resolveArg(message, spec, raw) {
  const text = String(raw);
  switch (spec.type) {
    case 'string':
      return { value: text };
    case 'integer': {
      const n = Number.parseInt(text, 10);
      if (!Number.isInteger(n)) return { error: `\`${spec.name}\` must be a whole number` };
      return { value: n };
    }
    case 'number': {
      const n = Number(text);
      if (!Number.isFinite(n)) return { error: `\`${spec.name}\` must be a number` };
      return { value: n };
    }
    case 'boolean': {
      const lower = text.toLowerCase();
      if (TRUE_WORDS.has(lower)) return { value: true };
      if (FALSE_WORDS.has(lower)) return { value: false };
      return { error: `\`${spec.name}\` must be on/off` };
    }
    case 'user': {
      const id = text.match(/^<@!?(\d+)>$/)?.[1] ?? text.match(/^(\d{15,21})$/)?.[1];
      if (!id) return { error: `\`${spec.name}\` must be a member (@mention or id)` };
      const user =
        message.mentions?.users?.get(id) ??
        (await message.client.users.fetch(id).catch(() => null));
      return user ? { value: user } : { error: `could not find member \`${id}\`` };
    }
    case 'role': {
      const id = text.match(/^<@&(\d+)>$/)?.[1] ?? text.match(/^(\d{15,21})$/)?.[1];
      if (!id) return { error: `\`${spec.name}\` must be a role (@mention or id)` };
      const role =
        message.guild.roles.cache.get(id) ??
        (await message.guild.roles.fetch(id).catch(() => null));
      return role ? { value: role } : { error: `could not find role \`${id}\`` };
    }
    case 'channel': {
      const id = text.match(/^<#(\d+)>$/)?.[1] ?? text.match(/^(\d{15,21})$/)?.[1];
      if (!id) return { error: `\`${spec.name}\` must be a channel (#mention or id)` };
      const channel =
        message.guild.channels.cache.get(id) ??
        (await message.guild.channels.fetch(id).catch(() => null));
      if (!channel) return { error: `could not find channel \`${id}\`` };
      // S70: `postable: true` centralizes the S55 rule — post targets must be
      // text or announcement channels (never categories/voice/forums).
      if (spec.postable && channel.type !== 0 && channel.type !== 5) {
        return { error: `\`${spec.name}\` must be a text or announcement channel` };
      }
      return { value: channel };
    }
    default:
      return { error: `unknown arg type ${spec.type}` };
  }
}

/**
 * Map raw tokens onto a subcommand's arg specs (greedy last-string supported).
 * @returns {Promise<{values: object, errors: string[]}>}
 */
export async function resolveSubArgs(message, sub, tokens) {
  const specs = sub.args ?? [];
  const values = {};
  const errors = [];
  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i];
    if (!TYPES.has(spec.type)) {
      errors.push(`bad arg spec ${spec.name}`);
      continue;
    }
    const isLast = i === specs.length - 1;
    let raw;
    if (spec.greedy && isLast) {
      raw = tokens.slice(i).join(' ').trim() || null;
    } else {
      raw = tokens[i] ?? null;
    }
    if (raw == null || raw === '') {
      if (spec.required) errors.push(`missing \`${spec.name}\``);
      continue;
    }
    if (spec.choices && !spec.choices.includes(String(raw).toLowerCase())) {
      errors.push(`\`${spec.name}\` must be one of: ${spec.choices.join(', ')}`);
      continue;
    }
    const resolved = await resolveArg(message, spec, spec.choices ? String(raw).toLowerCase() : raw);
    if (resolved.error) errors.push(resolved.error);
    else values[spec.name] = resolved.value;
  }
  return { values, errors };
}

/** The bare-`!group` overview: status lines (if any) + every visible subcommand. */
export function buildGroupOverview(group, ctx, statusLines = []) {
  const prefix = ctx.prefix;
  const subLines = group.subcommands.map(
    (sub) => `\`${subUsage(prefix, group.name, sub)}\` — ${sub.description}`,
  );
  return new EmbedBuilder()
    .setColor(0x2b6cb0)
    .setTitle(`${group.emoji ?? '🚔'} ${prefix}${group.name}`)
    .setDescription(
      [
        group.description,
        ...(statusLines.length ? ['', ...statusLines] : []),
        '',
        '**Subcommands**',
        ...subLines,
      ].join('\n'),
    );
}

/** Does this member clear the group/sub permission gate? */
function hasPermission(ctx, flag) {
  if (!flag) return true;
  const perms = ctx.channel?.permissionsFor?.(ctx.member) ?? ctx.member?.permissions;
  return Boolean(perms?.has?.(flag));
}

/**
 * Dispatch one parsed `!group …` invocation. Owns the overview, unknown-sub
 * hints, permission refusals, arg errors with usage, and the run() call.
 */
export async function dispatchGroup(group, message, tokens, prefix) {
  const ctx = {
    message,
    client: message.client,
    guild: message.guild,
    channel: message.channel,
    member: message.member,
    user: message.author,
    prefix,
    reply: (payload) => {
      const p = typeof payload === 'string' ? { content: payload } : { ...payload };
      if (!p.allowedMentions) p.allowedMentions = { repliedUser: false };
      return message.reply(p).catch(() => message.channel.send(p).catch(() => null));
    },
  };

  const subName = tokens[0]?.toLowerCase() ?? null;
  const sub =
    subName &&
    group.subcommands.find((s) => s.name === subName || (s.aliases ?? []).includes(subName));

  if (!sub) {
    if (!hasPermission(ctx, group.permission)) {
      await ctx.reply('🚫 You need **Manage Server** for that.');
      return 'refused';
    }
    let statusLines = [];
    if (group.status) {
      try {
        statusLines = (await group.status(ctx)) ?? [];
      } catch (error) {
        logger.warn(`Group ${group.name}: status failed:`, error);
      }
    }
    const embed = buildGroupOverview(group, ctx, statusLines);
    if (subName) embed.setFooter({ text: `Unknown subcommand "${subName}" — pick one from the list.` });
    await ctx.reply({ embeds: [embed] });
    return 'overview';
  }

  if (!hasPermission(ctx, sub.permission ?? group.permission)) {
    await ctx.reply('🚫 You need **Manage Server** for that.');
    return 'refused';
  }

  const { values, errors } = await resolveSubArgs(message, sub, tokens.slice(1));
  if (errors.length > 0) {
    await ctx.reply(`🚫 ${errors.join('; ')}\nUsage: \`${subUsage(prefix, group.name, sub)}\``);
    return 'usage-error';
  }
  try {
    await sub.run(ctx, values);
    return 'ran';
  } catch (error) {
    logger.error(`Group ${group.name} ${sub.name} failed:`, error);
    await ctx.reply('📻 Dispatch, we have a malfunction. The incident has been logged.');
    return 'crashed';
  }
}
