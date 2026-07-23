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

/**
 * Map tokens onto a command's option definitions, in declaration order. The
 * LAST string option is greedy (it takes the whole remainder) so
 * "!cite @user being a repeat offender" puts the sentence into `reason`.
 *
 * @param {Array<{name,type,required?,choices?}>} optionDefs from data.toJSON().options
 * @param {{tokens:string[]}} parsed from parseCommandLine
 * @returns {{ values: Record<string, any>, userIds: Record<string,string>, errors: string[] }}
 *   values: STRING/INTEGER/NUMBER/BOOLEAN resolved; USER/CHANNEL/ROLE ids go in userIds.
 */
export function assignOptions(optionDefs, parsed) {
  const defs = optionDefs ?? [];
  const tokens = parsed?.tokens ?? [];
  const values = {};
  const userIds = {};
  const errors = [];

  // Only a TRAILING string option is greedy (takes the rest of the line). If a
  // non-string option follows it, the string must stay single-token so the
  // later option still gets its token — otherwise e.g. "!rank-link Chief @role"
  // would let `rank` swallow the role mention.
  const lastIdx = defs.length - 1;
  const greedyStringIndex = lastIdx >= 0 && defs[lastIdx].type === OPTION_TYPE.STRING ? lastIdx : -1;

  let cursor = 0;
  const missing = (def) => {
    if (def.required) errors.push(`missing required argument \`${def.name}\``);
  };

  defs.forEach((def, i) => {
    const token = tokens[cursor];
    switch (def.type) {
      case OPTION_TYPE.USER:
      case OPTION_TYPE.CHANNEL:
      case OPTION_TYPE.ROLE: {
        if (token === undefined) return missing(def);
        const id = extractId(token);
        if (!id) {
          errors.push(`\`${def.name}\` should be a mention or id, got "${token}"`);
        } else {
          userIds[def.name] = id;
        }
        cursor += 1;
        break;
      }
      case OPTION_TYPE.INTEGER:
      case OPTION_TYPE.NUMBER: {
        if (token === undefined) return missing(def);
        const num = Number(token);
        if (!Number.isFinite(num) || (def.type === OPTION_TYPE.INTEGER && !Number.isInteger(num))) {
          errors.push(`\`${def.name}\` should be a number, got "${token}"`);
        } else if (def.choices?.length && !def.choices.some((c) => c.value === num)) {
          errors.push(`\`${def.name}\` must be one of: ${def.choices.map((c) => c.value).join(', ')}`);
        } else {
          values[def.name] = num;
        }
        cursor += 1;
        break;
      }
      case OPTION_TYPE.BOOLEAN: {
        if (token === undefined) return missing(def);
        const bool = parseBoolean(token);
        if (bool === null) errors.push(`\`${def.name}\` should be true/false, got "${token}"`);
        else values[def.name] = bool;
        cursor += 1;
        break;
      }
      case OPTION_TYPE.STRING: {
        if (i === greedyStringIndex) {
          const rest = tokens.slice(cursor);
          if (rest.length === 0) return missing(def);
          values[def.name] = rest.join(' ');
          cursor = tokens.length;
        } else {
          if (token === undefined) return missing(def);
          values[def.name] = token;
          cursor += 1;
        }
        break;
      }
      default:
        // Unsupported option types (attachment, subcommand) are not reachable
        // via text — the command's slash form must be used.
        if (def.required) errors.push(`\`${def.name}\` can only be provided via the /${''}slash command`);
    }
  });

  return { values, userIds, errors };
}
