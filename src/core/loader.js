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

  for (const mod of modules) {
    for (const command of mod.commands) {
      // S69 (M17.1): a command is either a Red-style group ({ group }) or a
      // legacy flat command ({ data, execute }). Groups are dispatched by
      // core/prefix/group.js; the router picks the path per command.
      const commandName = command?.group ? validateGroup(mod, command.group) : null;
      const legacyName = command?.data?.name;
      if (!commandName && (!legacyName || typeof command.execute !== 'function')) {
        throw new Error(`Module "${mod.name}" has a command without group or data/execute.`);
      }
      const name = commandName ?? legacyName;
      if (client.commands.has(name)) {
        throw new Error(`Duplicate command name "${name}" (module "${mod.name}").`);
      }
      command.module = mod.name; // for help grouping
      client.commands.set(name, command);
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
