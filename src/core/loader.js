// Module discovery and wiring. Modules never self-register: this is the only
// place that scans src/modules/, so adding a module means adding a folder —
// nothing else to touch. deploy-commands.js reuses the same discovery so the
// registered command set can never drift from the loaded one.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Collection } from 'discord.js';
import { logger } from './logger.js';

const modulesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'modules');

/**
 * Validate a Red-style group command's shape (S69) and return its name.
 * Failing the boot beats a group that silently swallows its subcommands.
 */
export function validateGroup(mod, group) {
  if (!group?.name || !group.description || !Array.isArray(group.subcommands)) {
    throw new Error(
      `Module "${mod.name}" has a malformed group: needs { name, description, subcommands[] }.`,
    );
  }
  // S70: group-level aliases keep retired command names working (the owner's
  // muscle memory: !memorial-config still reaches !memorial).
  if (group.aliases && !group.aliases.every((a) => typeof a === 'string' && a.length > 0)) {
    throw new Error(`Group "${group.name}" (module "${mod.name}") has a non-string alias.`);
  }
  // S71: `fallback` routes unmatched first tokens into a designated sub.
  if (group.fallback && !group.subcommands.some((s) => s?.name === group.fallback)) {
    throw new Error(`Group "${group.name}" names fallback "${group.fallback}" but has no such subcommand.`);
  }
  // S106: `invokeWithoutSubcommand` is meaningless without something to invoke.
  // Failing the boot beats a group that silently answers with a menu.
  if (group.invokeWithoutSubcommand && !group.fallback) {
    throw new Error(`Group "${group.name}" sets invokeWithoutSubcommand but names no fallback.`);
  }
  const seen = new Set();
  for (const sub of group.subcommands) {
    if (!sub?.name || !sub.description || typeof sub.run !== 'function') {
      throw new Error(
        `Group "${group.name}" (module "${mod.name}") has a subcommand without name/description/run.`,
      );
    }
    for (const alias of [sub.name, ...(sub.aliases ?? [])]) {
      if (seen.has(alias)) {
        throw new Error(`Group "${group.name}" reuses subcommand name/alias "${alias}".`);
      }
      seen.add(alias);
    }
  }
  return group.name;
}

/**
 * Validate a flat command's shape (S93 = M17.3) and return its name. A flat
 * command is a group without subcommands: same arg specs, same run(ctx, values).
 */
export function validateFlatCommand(mod, command) {
  if (!command?.name || !command.description || typeof command.run !== 'function') {
    throw new Error(
      `Module "${mod.name}" has a malformed command: needs { name, description, run() }.`,
    );
  }
  if (command.aliases && !command.aliases.every((a) => typeof a === 'string' && a.length > 0)) {
    throw new Error(`Command "${command.name}" (module "${mod.name}") has a non-string alias.`);
  }
  for (const arg of command.args ?? []) {
    if (!arg?.name || !arg.type) {
      throw new Error(`Command "${command.name}" (module "${mod.name}") has an arg without name/type.`);
    }
  }
  return command.name;
}

/**
 * Import every src/modules/<name>/index.js manifest and validate its shape.
 * @returns {Promise<Array<{ name: string, description: string, commands: any[], events: any[] }>>}
 */
export async function discoverModules(dir = modulesDir) {
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const modules = [];
  for (const name of entries) {
    const manifestUrl = pathToFileURL(path.join(dir, name, 'index.js')).href;
    const mod = (await import(manifestUrl)).default;
    if (!mod?.name || !Array.isArray(mod.commands) || !Array.isArray(mod.events)) {
      throw new Error(
        `Module "${name}" has a malformed manifest: index.js must default-export ` +
          '{ name, description, commands[], events[] }.',
      );
    }
    modules.push(mod);
  }
  return modules;
}

/**
 * Wire all modules onto the client: commands into client.commands, events onto
 * the client emitter. Throws on malformed commands and duplicate names —
 * failing the boot is better than silently shadowing a command.
 */
export async function loadModules(client) {
  const modules = await discoverModules();
  client.commands = new Collection();
  // Exposed so /help and !help can generate the roster from what is actually
  // loaded (never a hand-maintained list that drifts).
  client.moduleList = modules;
  // S136: a module may export an optional async `shutdown()` — run before the
  // process exits (self-update restart, SIGTERM), so live state with a VISIBLE
  // footprint (a voice session, an open lobby) ends honestly instead of dying
  // into a ghost. Collected here so core never imports module internals.
  client.moduleShutdowns = [];

  for (const mod of modules) {
    if (mod.shutdown !== undefined) {
      if (typeof mod.shutdown !== 'function') {
        throw new Error(`Module "${mod.name}" has a shutdown that is not a function.`);
      }
      client.moduleShutdowns.push({ name: mod.name, run: mod.shutdown });
    }
    for (const command of mod.commands) {
      // Two shapes, since S96 finished M17.3: a Red-style group ({ group },
      // S69) or a flat command ({ command }, S93). Both register under their
      // name AND their aliases (S70) — every key resolves to the same command
      // object; help shows only the primary name.
      let names;
      if (command?.group) {
        names = [validateGroup(mod, command.group), ...(command.group.aliases ?? [])];
      } else if (command?.command) {
        names = [validateFlatCommand(mod, command.command), ...(command.command.aliases ?? [])];
      } else {
        throw new Error(`Module "${mod.name}" has a command that is neither a group nor a command.`);
      }
      for (const name of names) {
        if (client.commands.has(name)) {
          throw new Error(`Duplicate command name "${name}" (module "${mod.name}").`);
        }
        client.commands.set(name, command);
      }
      command.module = mod.name; // for help grouping
    }

    for (const event of mod.events) {
      if (!event?.name || typeof event.execute !== 'function') {
        throw new Error(`Module "${mod.name}" has an event without a name or execute function.`);
      }
      const handler = (...args) => {
        Promise.resolve(event.execute(...args)).catch((error) =>
          logger.error(`Event ${event.name} handler failed:`, error),
        );
      };
      if (event.once) client.once(event.name, handler);
      else client.on(event.name, handler);
    }

    logger.info(
      `Module "${mod.name}" loaded: ${mod.commands.length} command(s), ${mod.events.length} event(s).`,
    );
  }

  return modules;
}
