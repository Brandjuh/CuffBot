// Pure parsing for text ("!command …") invocation — no discord.js imports, so
// splitting a raw message into a command name and its tokens stays testable
// without a gateway. Turning those tokens into typed values (and into real
// Discord objects) is `prefix/group.js`; this file only cuts the line up.
//
// S96: `assignOptions` and its slash-option machinery lived here to serve the
// interaction adapter. Both are gone with M17.3 — the arg specs on a group or
// flat command carry their own types, bounds and choices.

/** Derive a usage hint from a command's options: `<required>` / `[optional]`. */
export function usageFor(name, options = []) {
  const parts = options
    .filter((o) => o.type !== 1 && o.type !== 2) // skip subcommands/groups
    .map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`));
  return [name, ...parts].join(' ');
}

/**
 * Split a line into whitespace-separated tokens, keeping "double quoted"
 * spans together (quotes removed). Unclosed quotes swallow the rest of the line.
 * @param {string} input
 * @returns {string[]}
 */
export function tokenize(input) {
  const tokens = [];
  const re = /"([^"]*)"|(\S+)/g;
  let match;
  while ((match = re.exec(input)) !== null) {
    tokens.push(match[1] !== undefined ? match[1] : match[2]);
  }
  return tokens;
}

/**
 * If `content` starts with `prefix`, return the command name (lowercased) and
 * the argument remainder; otherwise null. A lone prefix, or "! command" with a
 * space after the prefix, is treated as not-a-command.
 * @returns {{ name: string, argString: string, tokens: string[] } | null}
 */
export function parseCommandLine(content, prefix) {
  if (typeof content !== 'string' || !content.startsWith(prefix)) return null;
  const body = content.slice(prefix.length);
  if (body.length === 0 || /^\s/.test(body)) return null;
  const firstSpace = body.search(/\s/);
  const name = (firstSpace === -1 ? body : body.slice(0, firstSpace)).toLowerCase();
  const argString = firstSpace === -1 ? '' : body.slice(firstSpace + 1).trim();
  return { name, argString, tokens: tokenize(argString) };
}

/**
 * How one argument is written in a usage line (S117, owner: *"er staat in de
 * help `<kind>` en `<state>` maar nergens staat uitgelegd welke states of
 * kinds er zijn"*).
 *
 * The name alone is useless for a closed set: `<kind>` tells you a word goes
 * there, not which words are legal — and the only way to find out was to guess
 * wrong and read the error. When the spec already knows the answer, print it.
 *
 *   choices  → `voice|files`
 *   boolean  → `true|false`   (the parser also takes yes/no/on/off/ja/nee/1/0,
 *                              but two canonical words are the useful hint)
 *   greedy   → `name…`
 */
export function argLabel(spec) {
  if (spec.choices?.length) return spec.choices.join('|');
  if (spec.type === 'boolean') return 'true|false';
  return spec.greedy ? `${spec.name}…` : spec.name;
}

/** `<label>` when required, `[label]` when not. */
export const argToken = (spec) => (spec.required ? `<${argLabel(spec)}>` : `[${argLabel(spec)}]`);
