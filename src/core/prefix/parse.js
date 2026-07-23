// Pure parsing for text ("!command …") invocation — no discord.js imports, so
// the whole mapping from a raw message to typed command options is testable
// without a gateway. The adapter (adapter.js) turns the ids this produces into
// real Discord objects; here everything stays strings/numbers/booleans.

// discord.js ApplicationCommandOptionType numeric values we support.
const OPTION_TYPE = { STRING: 3, INTEGER: 4, BOOLEAN: 5, USER: 6, CHANNEL: 7, ROLE: 8, NUMBER: 10 };

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

/** Extract an id from a user/role/channel mention or a raw snowflake. */
export function extractId(token) {
  if (typeof token !== 'string') return null;
  const mention = token.match(/^<(?:@[!&]?|#)(\d{17,20})>$/); // <@id> <@!id> <@&id> <#id>
  if (mention) return mention[1];
  return /^\d{17,20}$/.test(token) ? token : null;
}

function parseBoolean(token) {
  if (/^(true|yes|y|on|1)$/i.test(token)) return true;
  if (/^(false|no|n|off|0)$/i.test(token)) return false;
  return null;
}

// Does a single token satisfy an option's type? Used to decide whether an
// OPTIONAL trailing option should claim a tail token or leave it to the greedy
// free-text field. (An optional STRING never claims a tail token — any word
// "fits" it, so it would ambiguously steal the last word of the reason.)
function tokenFits(def, token) {
  switch (def.type) {
    case OPTION_TYPE.USER:
    case OPTION_TYPE.CHANNEL:
    case OPTION_TYPE.ROLE:
      return extractId(token) !== null;
    case OPTION_TYPE.INTEGER:
    case OPTION_TYPE.NUMBER: {
      const n = Number(token);
      if (!Number.isFinite(n) || (def.type === OPTION_TYPE.INTEGER && !Number.isInteger(n))) return false;
      return !def.choices?.length || def.choices.some((c) => c.value === n);
    }
    case OPTION_TYPE.BOOLEAN:
      return parseBoolean(token) !== null;
    default:
      return false;
  }
}

/**
 * Map tokens onto a command's option definitions.
 *
 * One option is the greedy "rest" field (free text): explicitly the option named
 * `greedyName` (a command's `textGreedyArg`), else the last option if it is a
 * string. Options BEFORE it bind one token each from the front; options AFTER it
 * bind one token each from the TAIL (right-to-left), so a free-text `reason`
 * declared before an optional `penalty`/`wipe`/`anonymous` still absorbs the
 * middle of the line instead of being truncated. Optional trailing options only
 * claim a tail token when it fits their type (and optional strings never do).
 *
 * @param {Array<{name,type,required?,choices?}>} optionDefs from data.toJSON().options
 * @param {{tokens:string[]}} parsed from parseCommandLine
 * @param {string|null} [greedyName] the option that should absorb free text
 * @returns {{ values: Record<string, any>, userIds: Record<string,string>, errors: string[] }}
 */
export function assignOptions(optionDefs, parsed, greedyName = null) {
  const defs = optionDefs ?? [];
  const tokens = parsed?.tokens ?? [];
  const values = {};
  const userIds = {};
  const errors = [];

  const missing = (def) => {
    if (def.required) errors.push(`missing required argument \`${def.name}\``);
  };

  // Bind exactly one token to an option (used from front and tail).
  const bindToken = (def, token) => {
    switch (def.type) {
      case OPTION_TYPE.USER:
      case OPTION_TYPE.CHANNEL:
      case OPTION_TYPE.ROLE: {
        const id = extractId(token);
        if (!id) errors.push(`\`${def.name}\` should be a mention or id, got "${token}"`);
        else userIds[def.name] = id;
        break;
      }
      case OPTION_TYPE.INTEGER:
      case OPTION_TYPE.NUMBER: {
        const num = Number(token);
        if (!Number.isFinite(num) || (def.type === OPTION_TYPE.INTEGER && !Number.isInteger(num))) {
          errors.push(`\`${def.name}\` should be a number, got "${token}"`);
        } else if (def.choices?.length && !def.choices.some((c) => c.value === num)) {
          errors.push(`\`${def.name}\` must be one of: ${def.choices.map((c) => c.value).join(', ')}`);
        } else {
          values[def.name] = num;
        }
        break;
      }
      case OPTION_TYPE.BOOLEAN: {
        const bool = parseBoolean(token);
        if (bool === null) errors.push(`\`${def.name}\` should be true/false, got "${token}"`);
        else values[def.name] = bool;
        break;
      }
      case OPTION_TYPE.STRING:
        values[def.name] = token;
        break;
      default:
        if (def.required) errors.push(`\`${def.name}\` can only be provided via the slash command`);
    }
  };

  // Pick the greedy free-text option.
  let greedyIndex = -1;
  if (greedyName) {
    const gi = defs.findIndex((d) => d.name === greedyName && d.type === OPTION_TYPE.STRING);
    if (gi >= 0) greedyIndex = gi;
  }
  if (greedyIndex < 0) {
    const lastIdx = defs.length - 1;
    if (lastIdx >= 0 && defs[lastIdx].type === OPTION_TYPE.STRING) greedyIndex = lastIdx;
  }

  if (greedyIndex < 0) {
    // No greedy option: bind everything from the front, one token each.
    let cursor = 0;
    for (const def of defs) {
      if (tokens[cursor] === undefined) missing(def);
      else bindToken(def, tokens[cursor++]);
    }
    return { values, userIds, errors };
  }

  // Front: options before the greedy take one token each.
  let front = 0;
  for (let i = 0; i < greedyIndex; i += 1) {
    if (tokens[front] === undefined) missing(defs[i]);
    else bindToken(defs[i], tokens[front++]);
  }

  // Tail: options after the greedy take one token each from the end, in reverse
  // declaration order. Optional ones only claim a token that fits their type.
  let tail = tokens.length;
  for (let i = defs.length - 1; i > greedyIndex; i -= 1) {
    const def = defs[i];
    if (def.type === OPTION_TYPE.STRING && !def.required) continue; // ambiguous — leave to slash/quotes
    if (front >= tail) {
      missing(def);
      continue;
    }
    const token = tokens[tail - 1];
    if (def.required) {
      bindToken(def, token);
      tail -= 1;
    } else if (tokenFits(def, token)) {
      bindToken(def, token);
      tail -= 1;
    }
    // optional + doesn't fit → leave unset, token stays for the greedy field
  }

  // Greedy absorbs the middle.
  const mid = tokens.slice(front, tail);
  if (mid.length === 0) missing(defs[greedyIndex]);
  else values[defs[greedyIndex].name] = mid.join(' ');

  return { values, userIds, errors };
}
