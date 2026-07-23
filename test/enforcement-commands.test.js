// Command smoke tests with hand-rolled fake interactions — proves option
// parsing, guard order, and reply shapes without a token or network
// (the pattern from discord-reference.md → Testing without a live bot).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import cite from '../src/modules/enforcement/commands/cite.js';
import fine from '../src/modules/enforcement/commands/fine.js';
import detain from '../src/modules/enforcement/commands/detain.js';
import arrest from '../src/modules/enforcement/commands/arrest.js';
import release from '../src/modules/enforcement/commands/release.js';

// Commands file records through the store; point it at a scratch directory
// (read at call time) so tests never touch the repo's data/.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-cmd-test-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

const BOT_ID = '999000000000000999';

function fakeUser(id, name) {
  return {
    id,
    username: name,
    displayName: name,
    toString: () => `<@${id}>`,
    send: async () => {},
  };
}

function fakeInteraction({ perms = [], target, options = {}, member = null, bans = {} }) {
  const replies = [];
  const interaction = {
    replies,
    user: fakeUser('111000000000000111', 'officer'),
    client: { user: { id: BOT_ID } },
    memberPermissions: { has: (flag) => perms.includes(flag) },
    guild: {
      id: '411157175948541954',
      name: 'Test Precinct',
      members: {
        fetch: async () => {
          if (!member) throw new Error('unknown member');
          return member;
        },
        ban: async (id, opts) => {
          interaction.banned = { id, ...opts };
        },
        unban: async (id, reason) => {
          interaction.unbanned = { id, reason };
        },
      },
      bans: {
        fetch: async (id) => {
          if (bans[id]) return bans[id];
          throw new Error('no ban');
        },
      },
    },
    options: {
      getUser: () => target,
      getString: (name) => options[name] ?? null,
      getInteger: (name) => options[name] ?? null,
    },
    reply: async (payload) => {
      replies.push(typeof payload === 'string' ? { content: payload } : payload);
    },
    followUp: async (payload) => {
      replies.push(typeof payload === 'string' ? { content: payload } : payload);
    },
  };
  return interaction;
}

// PermissionFlagsBits values are bigints; the fake stores them opaquely.
import { PermissionFlagsBits } from 'discord.js';
const MOD = PermissionFlagsBits.ModerateMembers;
const BAN = PermissionFlagsBits.BanMembers;

test('cite: blocks invokers without Moderate Members', async () => {
  const ix = fakeInteraction({ perms: [], target: fakeUser('2', 'perp') });
  await cite.execute(ix);
  assert.equal(ix.replies.length, 1);
  assert.match(ix.replies[0].content, /jurisdiction/i);
});

test('cite: happy path attaches a citation.png and DMs a copy', async () => {
  const target = fakeUser('412676658991071243', 'perp');
  let dm = null;
  target.send = async (payload) => {
    dm = payload;
  };
  const ix = fakeInteraction({
    perms: [MOD],
    target,
    options: { reason: 'Donut theft' },
  });
  await cite.execute(ix);
  assert.equal(ix.replies.length, 1, 'no ephemeral DM-failure note expected');
  assert.match(ix.replies[0].content, /Citation issued/);
  assert.match(ix.replies[0].content, /Case #\d+/, 'citation is filed on the rap sheet');
  assert.equal(ix.replies[0].files.length, 1);
  assert.ok(dm, 'target got a DM');
  assert.equal(dm.files.length, 1);
});

test('cite: attaches an animated citation.gif', async () => {
  const ix = fakeInteraction({ perms: [MOD], target: fakeUser('412676658991071243', 'perp'), options: { reason: 'x' } });
  await cite.execute(ix);
  assert.equal(ix.replies[0].files[0].name, 'citation.gif');
});

test('cite: refuses to cite the bot itself', async () => {
  const ix = fakeInteraction({ perms: [MOD], target: fakeUser(BOT_ID, 'CuffBot') });
  await cite.execute(ix);
  assert.match(ix.replies[0].content, /can't cuff the police/i);
});

test('fine: public, no permission needed, no record filed, animated gif', async () => {
  const ix = fakeInteraction({ perms: [], target: fakeUser('777', 'friend'), options: { reason: 'excessive donut consumption' } });
  await fine.execute(ix);
  assert.match(ix.replies[0].content, /good fun/i);
  assert.equal(ix.replies[0].files[0].name, 'citation.gif');
  assert.ok(!/Case #/.test(ix.replies[0].content), 'fine files no record');
});

test('fine: cannot fine the bot', async () => {
  const ix = fakeInteraction({ perms: [], target: fakeUser(BOT_ID, 'CuffBot'), options: { reason: 'x' } });
  await fine.execute(ix);
  assert.match(ix.replies[0].content, /cannot fine the police/i);
});

test('cite: refuses to cite yourself (Internal Affairs)', async () => {
  const officer = fakeUser('111000000000000111', 'officer');
  const ix = fakeInteraction({ perms: [MOD], target: officer, options: { reason: 'x' } });
  // make the invoking user the same as the target
  ix.user = officer;
  await cite.execute(ix);
  assert.match(ix.replies[0].content, /against yourself/i);
});

test('detain: replies specifically when the target is not in the precinct', async () => {
  const ix = fakeInteraction({
    perms: [MOD],
    target: fakeUser('2', 'ghost'),
    options: { duration: '10m' },
    member: null, // fetchMember returns null → not a member
  });
  await detain.execute(ix);
  assert.match(ix.replies[0].content, /not in the precinct/i);
});

test('detain: rejects nonsense durations with guidance', async () => {
  const ix = fakeInteraction({
    perms: [MOD],
    target: fakeUser('2', 'perp'),
    options: { duration: 'a while' },
  });
  await detain.execute(ix);
  assert.match(ix.replies[0].content, /not a duration/i);
});

test('detain: rejects durations over the 28-day cap', async () => {
  const ix = fakeInteraction({
    perms: [MOD],
    target: fakeUser('2', 'perp'),
    options: { duration: '29d' },
  });
  await detain.execute(ix);
  assert.match(ix.replies[0].content, /28 days/);
});

test('detain: times out a moderatable member with an audit reason', async () => {
  let timeout = null;
  const member = {
    moderatable: true,
    timeout: async (ms, reason) => {
      timeout = { ms, reason };
    },
  };
  const ix = fakeInteraction({
    perms: [MOD],
    target: fakeUser('2', 'perp'),
    options: { duration: '1h30m', reason: 'contempt of donut' },
    member,
  });
  await detain.execute(ix);
  assert.equal(timeout.ms, 90 * 60_000);
  assert.match(timeout.reason, /contempt of donut — by officer via CuffBot/);
  assert.match(ix.replies[0].content, /1 hour 30 minutes/);
  assert.match(ix.replies[0].content, /Case #\d+/, 'detainment is filed on the rap sheet');
});

test('detain: hierarchy block replies with role guidance', async () => {
  const member = { moderatable: false, timeout: async () => {} };
  const ix = fakeInteraction({
    perms: [MOD],
    target: fakeUser('2', 'admin'),
    options: { duration: '10m' },
    member,
  });
  await detain.execute(ix);
  assert.match(ix.replies[0].content, /highest role/i);
});

test('arrest: bans by id when the target already left the guild', async () => {
  const ix = fakeInteraction({
    perms: [BAN],
    target: fakeUser('2', 'runner'),
    options: { reason: 'fled the scene', wipe: 86_400 },
  });
  await arrest.execute(ix);
  assert.equal(ix.banned.id, '2');
  assert.equal(ix.banned.deleteMessageSeconds, 86_400);
  assert.match(ix.banned.reason, /fled the scene — by officer via CuffBot/);
  assert.match(ix.replies[0].content, /arrested/i);
});

test('release: lifts an active timeout', async () => {
  let lifted = null;
  const member = {
    moderatable: true,
    communicationDisabledUntilTimestamp: Date.now() + 60_000,
    timeout: async (ms, reason) => {
      lifted = { ms, reason };
    },
  };
  const ix = fakeInteraction({ perms: [MOD], target: fakeUser('2', 'perp'), member });
  await release.execute(ix);
  assert.equal(lifted.ms, null);
  assert.match(ix.replies[0].content, /released from the holding cell/i);
});

test('release: unban path demands Ban Members', async () => {
  const ix = fakeInteraction({
    perms: [MOD], // has moderate, lacks ban
    target: fakeUser('2', 'exiled'),
    bans: { 2: { user: { id: '2' } } },
  });
  await release.execute(ix);
  assert.match(ix.replies[0].content, /Ban Members/);
  assert.equal(ix.unbanned, undefined);
});

test('release: lifts a ban when the invoker may', async () => {
  const ix = fakeInteraction({
    perms: [MOD, BAN],
    target: fakeUser('2', 'exiled'),
    bans: { 2: { user: { id: '2' } } },
  });
  await release.execute(ix);
  assert.equal(ix.unbanned.id, '2');
  assert.match(ix.replies[0].content, /ban lifted/i);
});

test('release: says so when there is nothing to release', async () => {
  const ix = fakeInteraction({ perms: [MOD], target: fakeUser('2', 'free') });
  await release.execute(ix);
  assert.match(ix.replies[0].content, /nothing to release/i);
});
