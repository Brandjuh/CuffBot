// Pure help-menu construction — no discord.js imports. Turns the loaded
// modules/commands into an embed model that both /help and !help render, so
// the menu can never drift from what is actually loaded (it is generated, not
// hand-maintained).

import { usageFor } from './prefix/parse.js';

export { usageFor };

const MODULE_BADGES = {
  core: '📻',
  enforcement: '🚨',
  records: '📋',
  dispatch: '🗄️',
  academy: '🎖️',
  patrol: '👮',
  'public-affairs': '🍩',
  leveling: '📈',
  detective: '🕵️',
  birthdays: '🎂',
  trivia: '❓',
  memorial: '🕯️',
  starboard: '⭐',
};

/**
 * Build the help model from loaded modules.
 * @param {Array<{name:string, description:string, commands:Array<{name,description,options}>}>} modules
 * @param {string} prefix
 * @returns {{ title:string, description:string, groups:Array<{title:string, entries:Array<{invocations:string, usage:string, description:string}>}> }}
 */
export function buildHelp(modules, prefix) {
  const groups = modules
    .filter((mod) => mod.commands.length > 0)
    .map((mod) => ({
      title: `${MODULE_BADGES[mod.name] ?? '•'} ${titleCase(mod.name)}`,
      entries: mod.commands
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((cmd) => ({
          invocations: `\`/${cmd.name}\` · \`${prefix}${cmd.name}\``,
          usage: `\`${prefix}${usageFor(cmd.name, cmd.options)}\``,
          description: cmd.description,
        })),
    }));

  const total = groups.reduce((n, g) => n + g.entries.length, 0);
  return {
    title: '🚔 CuffBot — Command Roster',
    description:
      `Every command works two ways: as a slash command (**/name**) or as a text command ` +
      `(**${prefix}name**). ${total} commands on duty. Angle brackets \`<>\` are required, ` +
      `square brackets \`[]\` are optional.`,
    groups,
  };
}

/**
 * Render the help model to plain text (used by the text-command path and by
 * tests). Kept under Discord's 2000-char message limit by truncating with a note.
 */
export function renderHelpText(model) {
  const blocks = model.groups.map((group) => {
    const lines = group.entries.map(
      (e) => `  ${e.invocations} — ${e.description}\n     usage: ${e.usage}`,
    );
    return `**${group.title}**\n${lines.join('\n')}`;
  });
  const body = `**${model.title}**\n${model.description}\n\n${blocks.join('\n\n')}`;
  return body.length <= 1990 ? body : `${body.slice(0, 1986)}\n[…]`;
}

function titleCase(name) {
  return name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
