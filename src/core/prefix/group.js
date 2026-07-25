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
import { buildCtx } from './context.js';
import { hasPermission, refusalFor } from './permissions.js';

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
 * S93: `min`/`max` mirror the slash builders' setMinValue/setMaxValue, so a
 * converted command still refuses `!detain @x 0 minutes` instead of quietly
 * accepting it. Stated as a range so the member reads the fix, not the fault.
 */
function boundsCheck(spec, n) {
  if (spec.min != null && n < spec.min) {
    return { error: `\`${spec.name}\` must be ${spec.max != null ? `between ${spec.min} and ${spec.max}` : `at least ${spec.min}`}` };
  }
  if (spec.max != null && n > spec.max) {
    return { error: `\`${spec.name}\` must be ${spec.min != null ? `between ${spec.min} and ${spec.max}` : `at most ${spec.max}`}` };
  }
  return { value: n };
}

/**
 * Resolve one raw token into a typed value. Entity types return an id-bearing
 * object from the guild (mention or raw id both work). Returns {value} or
 * {error}. Pure except for the guild lookups (cache first, fetch fallback).
 */
async function resolveArg(message, spec, raw) {
  const text = String(raw);
  switch (spec.type) {
    case 'string':
      // S93: `maxLength` mirrors the slash builders' setMaxLength — the limit
      // usually exists because the value ends up in an embed field.
      if (spec.maxLength && text.length > spec.maxLength) {
        return { error: `\`${spec.name}\` must be at most ${spec.maxLength} characters` };
      }
      return { value: text };
    case 'integer': {
      const n = Number.parseInt(text, 10);
      if (!Number.isInteger(n)) return { error: `\`${spec.name}\` must be a whole number` };
      return boundsCheck(spec, n);
    }
    case 'number': {
      const n = Number(text);
      if (!Number.isFinite(n)) return { error: `\`${spec.name}\` must be a number` };
      return boundsCheck(spec, n);
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
 * Slot the raw tokens into the arg specs, one raw string per spec.
 *
 * Positional, except for the greedy arg: it swallows every token that the
 * specs around it do not claim. Leading specs take from the front; specs
 * declared AFTER the greedy one take from the BACK (S93) — that is how
 * `!911 @member they spammed the lobby yes` still finds its trailing
 * `anonymous` flag, which the legacy adapter special-cased per command.
 *
 * An OPTIONAL trailing spec only claims its token when the value fits the
 * type; otherwise the token stays part of the greedy span, so a reason ending
 * in an ordinary word is never mistaken for a flag.
 */
function slotTokens(specs, tokens) {
  const greedyIndex = specs.findIndex((s) => s.greedy);
  if (greedyIndex === -1) return specs.map((_, i) => tokens[i] ?? null);

  const raws = new Array(specs.length).fill(null);
  for (let i = 0; i < greedyIndex; i += 1) raws[i] = tokens[i] ?? null;

  // Claim the trailing specs right-to-left, never eating into the leading ones.
  let end = tokens.length;
  for (let i = specs.length - 1; i > greedyIndex; i -= 1) {
    if (end <= greedyIndex) break;
    const candidate = tokens[end - 1];
    if (candidate == null) continue;
    if (!specs[i].required && !looksLike(specs[i], candidate)) continue;
    raws[i] = candidate;
    end -= 1;
  }

  raws[greedyIndex] = tokens.slice(greedyIndex, end).join(' ').trim() || null;
  return raws;
}

/** Cheap type sniff — enough to decide whether a tail token IS this arg. */
function looksLike(spec, token) {
  switch (spec.type) {
    case 'integer':
    case 'number':
      return Number.isFinite(Number(token));
    case 'boolean':
      return TRUE_WORDS.has(token.toLowerCase()) || FALSE_WORDS.has(token.toLowerCase());
    case 'user':
    case 'role':
    case 'channel':
      return /^(<[@#][!&]?\d+>|\d{15,21})$/.test(token);
    default:
      return spec.choices ? spec.choices.includes(token.toLowerCase()) : true;
  }
}

/**
 * Map raw tokens onto a subcommand's (or flat command's) arg specs.
 * @returns {Promise<{values: object, errors: string[]}>}
 */
export async function resolveSubArgs(message, sub, tokens) {
  const specs = sub.args ?? [];
  const values = {};
  const errors = [];
  const raws = slotTokens(specs, tokens);
  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i];
    if (!TYPES.has(spec.type)) {
      errors.push(`bad arg spec ${spec.name}`);
      continue;
    }
    const raw = raws[i];
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

/**
 * Dispatch one parsed `!group …` invocation. Owns the overview, unknown-sub
 * hints, permission refusals, arg errors with usage, and the run() call.
 */
export async function dispatchGroup(group, message, tokens, prefix) {
  const ctx = buildCtx(message, prefix);

  const subName = tokens[0]?.toLowerCase() ?? null;
  let sub =
    subName &&
    group.subcommands.find((s) => s.name === subName || (s.aliases ?? []).includes(subName));

  // S71: a group may name a `fallback` sub that receives the WHOLE token list
  // when the first token matches no subcommand — so game invocations read
  // naturally (`!connect4 @user` = `!connect4 play @user`).
  let subTokens = tokens.slice(1);
  if (!sub && subName && group.fallback) {
    sub = group.subcommands.find((s) => s.name === group.fallback);
    if (sub) subTokens = tokens;
  }

  if (!sub) {
    if (!hasPermission(ctx, group.permission)) {
      await ctx.reply(refusalFor(group.permission));
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

  const gate = sub.permission ?? group.permission;
  if (!hasPermission(ctx, gate)) {
    await ctx.reply(refusalFor(gate));
    return 'refused';
  }

  const { values, errors } = await resolveSubArgs(message, sub, subTokens);
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
