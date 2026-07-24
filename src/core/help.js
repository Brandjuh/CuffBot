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
  'chat-starter': '💬',
  logbook: '📔',
  welcome: '👋',
  channellist: '🗂️',
  economy: '💰',
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

export const EMBED_FIELD_LIMIT = 1_024; // Discord: max chars per field value
export const EMBED_PAGE_BUDGET = 5_000; // stay under Discord's 6000-char TOTAL per embed
export const EMBED_MAX_FIELDS = 25; // Discord: max fields per embed

/**
 * Render one group's entries into field-sized chunks, split at entry
 * boundaries so no command line is ever cut mid-sentence.
 */
export function renderGroupChunks(group, limit = EMBED_FIELD_LIMIT) {
  const chunks = [];
  let current = '';
  for (const entry of group.entries) {
    const line = `${entry.invocations} — ${entry.description}\n usage: ${entry.usage}`;
    const clipped = line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
    const candidate = current ? `${current}\n${clipped}` : clipped;
    if (current && candidate.length > limit) {
      chunks.push(current);
      current = clipped;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Split the help model into embed-sized pages. One embed can hold at most
 * 6000 characters ACROSS title+description+fields (the per-field 1024 cap is
 * not enough on its own — S39: 18 modules broke /help exactly this way) and
 * at most 25 fields. Groups stay whole per field; oversized groups continue
 * in "(continued)" fields.
 * @returns {Array<{title:string, description:string|null, fields:Array<{name,value}>}>}
 */
export function paginateHelp(
  model,
  { pageBudget = EMBED_PAGE_BUDGET, fieldLimit = EMBED_FIELD_LIMIT, maxFields = EMBED_MAX_FIELDS } = {},
) {
  const rawPages = [];
  let fields = [];
  let cost = model.title.length + model.description.length;
  const flush = () => {
    if (fields.length) rawPages.push(fields);
    fields = [];
  };
  for (const group of model.groups) {
    renderGroupChunks(group, fieldLimit).forEach((value, index) => {
      const name = index === 0 ? group.title : `${group.title} (continued)`;
      const size = name.length + value.length;
      if (fields.length > 0 && (cost + size > pageBudget || fields.length >= maxFields)) {
        flush();
        cost = model.title.length + 8; // later pages carry only the title + page marker
      }
      fields.push({ name, value });
      cost += size;
    });
  }
  flush();
  return rawPages.map((pageFields, index) => ({
    title: rawPages.length > 1 ? `${model.title} (${index + 1}/${rawPages.length})` : model.title,
    description: index === 0 ? model.description : null,
    fields: pageFields,
  }));
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
