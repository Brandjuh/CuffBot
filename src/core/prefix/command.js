// Flat commands (S93 = M17.3 slice A): `!command <args>` with no subcommands.
//
// M17.1 gave groups (`!youtube channel #x`) a first-class shape but left every
// single-purpose command — `!badge`, `!daily`, `!rapsheet` — on the legacy
// `{ data: SlashCommandBuilder, execute(interaction) }` path, kept alive only
// by the interaction adapter. Those commands are not families and forcing them
// into groups would rename what the precinct types every day. So they get
// their own shape instead, sharing the group framework's ctx, arg resolution,
// permission gate and crash handling — which is what finally makes the adapter
// deletable (M17.3 slice D).
//
// Shape:
//   export default { command: {
//     name, aliases?, description, emoji?, permission?,   // permission = BigInt flag
//     args: [{ name, type, required?, greedy?, choices?, postable? }],
//     run(ctx, values),                                   // happy path only
//   } }
import { argToken } from './parse.js';
import { logger } from '../logger.js';
import { buildCtx } from './context.js';
import { hasPermission, refusalFor } from './permissions.js';
import { resolveSubArgs } from './group.js';

/** `!command <a> [b…]` — the usage line shown on an arg error and in help. */
export function commandUsage(prefix, command) {
  // S117: see `argToken` — a closed set is spelled out rather than named.
  const parts = (command.args ?? []).map(argToken);
  return `${prefix}${command.name}${parts.length ? ` ${parts.join(' ')}` : ''}`;
}

/**
 * Dispatch one parsed `!command …` invocation. Owns the permission refusal,
 * the arg errors with usage, and the in-theme crash apology — so run() only
 * ever has to describe the happy path.
 *
 * @returns {Promise<'refused'|'usage-error'|'ran'|'crashed'>}
 */
export async function dispatchCommand(command, message, tokens, prefix) {
  const ctx = buildCtx(message, prefix);

  if (!hasPermission(ctx, command.permission)) {
    await ctx.reply(refusalFor(command.permission));
    return 'refused';
  }

  const { values, errors } = await resolveSubArgs(message, command, tokens);
  if (errors.length > 0) {
    await ctx.reply(`🚫 ${errors.join('; ')}\nUsage: \`${commandUsage(prefix, command)}\``);
    return 'usage-error';
  }

  try {
    await command.run(ctx, values);
    return 'ran';
  } catch (error) {
    logger.error(`Command ${command.name} failed:`, error);
    await ctx.reply('📻 Dispatch, we have a malfunction. The incident has been logged.');
    return 'crashed';
  }
}
