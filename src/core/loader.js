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

  for (const mod of modules) {
    for (const command of mod.commands) {
      const commandName = command?.data?.name;
      if (!commandName || typeof command.execute !== 'function') {
        throw new Error(`Module "${mod.name}" has a command without data or execute.`);
      }
      if (client.commands.has(commandName)) {
        throw new Error(`Duplicate command name "/${commandName}" (module "${mod.name}").`);
      }
      client.commands.set(commandName, command);
    }

    for (const event of mod.events) {
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
