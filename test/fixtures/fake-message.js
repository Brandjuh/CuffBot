// A Message stand-in for testing the text-command surface without a gateway.
//
// Extracted from test/group.test.js in S93 (M17.3 slice A): the group tests
// grew it, and every batch of the flat-command conversion needs the same
// thing, so it lives here instead of being copy-pasted per test file.
//
// `sent` records every reply/send in order: `{ via, content?, embeds?, files? }`.

/**
 * @param {object} [options]
 * @param {boolean} [options.perms]   what permissionsFor().has() answers
 * @param {object} [options.roles]    id → role, for `role` args
 * @param {object} [options.channels] id → channel, for `channel` args
 * @param {object} [options.users]    id → user, for `user` args
 * @param {object} [options.members]  id → guild member, for guild.members.fetch
 * @param {string} [options.authorId]
 * @param {string} [options.guildId]
 */
export function fakeMessage({
  perms = true,
  roles = {},
  channels = {},
  users = {},
  members = {},
  authorId = 'u1',
  guildId = '900000000000000001',
} = {}) {
  const sent = [];
  const typing = { count: 0 };
  const push = (via, p) => {
    sent.push({ via, ...(typeof p === 'string' ? { content: p } : p) });
    return { id: 'sent', edit: async (next) => push('edit', next) };
  };
  const author = users[authorId] ?? { id: authorId, bot: false, username: 'tester' };
  return {
    sent,
    typing,
    author,
    member: members[authorId] ?? { id: authorId },
    client: {
      users: {
        fetch: async (id) => {
          if (users[id]) return users[id];
          throw new Error('unknown user');
        },
      },
    },
    guild: {
      id: guildId,
      roles: { cache: new Map(Object.entries(roles)), fetch: async (id) => roles[id] ?? null },
      channels: {
        cache: new Map(Object.entries(channels)),
        fetch: async (id) => channels[id] ?? null,
      },
      members: {
        cache: new Map(Object.entries(members)),
        fetch: async (id) => {
          if (members[id]) return members[id];
          throw new Error('unknown member');
        },
      },
    },
    channel: {
      id: 'chan-1',
      permissionsFor: () => ({ has: () => perms }),
      send: async (p) => push('send', p),
      sendTyping: async () => {
        typing.count += 1;
      },
    },
    mentions: { users: { get: (id) => users[id] } },
    reply: async (p) => push('reply', p),
  };
}

/** A user object shaped like the bits commands actually touch. */
export function fakeUser(id, username = `user-${id}`, extra = {}) {
  return {
    id,
    username,
    bot: false,
    displayAvatarURL: () => `https://cdn.example/${id}.png`,
    toString: () => `<@${id}>`,
    ...extra,
  };
}

/** A guild member wrapping a fake user. */
export function fakeMember(user, { displayName, roleIds = [], joinedTimestamp = 0 } = {}) {
  return {
    id: user.id,
    user,
    displayName: displayName ?? user.username,
    joinedTimestamp,
    roles: { cache: new Map(roleIds.map((id) => [id, { id }])) },
  };
}
