// Enforcement command smokes. S94 (M17.3 slice B) moved them off hand-rolled
// interactions onto `dispatchCommand` — the same path the router takes — so
// the permission gate and the arg parsing are covered rather than simulated.
// No token, no network (the pattern from discord-reference.md → Testing
// without a live bot).
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
import { dispatchCommand } from '../src/core/prefix/command.js';
import { fakeMessage, fakeUser } from './fixtures/fake-message.js';

// Commands file records through the store; point it at a scratch directory
// (read at call time) so tests never touch the repo's data/.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-cmd-test-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

const GUILD = '411157175948541954';
const BOT_ID = '999000000000000999';
const OFFICER = '111000000000000111';
const PERP = '412676658991071243';

const perp = (name = 'perp', id = PERP) =>
  fakeUser(id, name, { displayName: name, send: async () => {} });

/**
 * Dispatch an enforcement command. `member` is what guild.members.fetch
 * returns (null = the target left); `bans` maps id → ban record.
 */
async function run(command, tokens, { perms = true, target = perp(), member = null, bans = {} } = {}) {
  const officer = fakeUser(OFFICER, 'officer', { displayName: 'officer' });
  const message = fakeMessage({
    perms,
    guildId: GUILD,
    authorId: OFFICER,
    users: { [OFFICER]: officer, [target.id]: target },
  });
  const acted = {};
  message.client.user = { id: BOT_ID };
  message.guild.name = 'Test Precinct';
  message.guild.members.fetch = async () => {
    if (!member) throw new Error('unknown member');
    return member;
  };
  message.guild.members.ban = async (id, opts) => {
    acted.banned = { id, ...opts };
  };
  message.guild.members.unban = async (id, reason) => {
    acted.unbanned = { id, reason };
  };
  message.guild.bans = {
    fetch: async (id) => {
      if (bans[id]) return bans[id];
      throw new Error('no ban');
    },
  };
  const outcome = await dispatchCommand(command.command, message, tokens, '!');
  return { outcome, sent: message.sent, acted, target, officer };
}

// ── !cite ────────────────────────────────────────────────────────────────────

test('cite: blocks invokers without Moderate Members, naming that permission', async () => {
  const { outcome, sent } = await run(cite, [PERP, 'x'], { perms: false });
  assert.equal(outcome, 'refused');
  assert.match(sent[0].content, /Moderate Members/);
});

test('cite: happy path attaches an animated citation.gif and DMs a copy', async () => {
  let dm = null;
  const target = perp();
  target.send = async (payload) => {
    dm = payload;
  };
  const { sent } = await run(cite, [PERP, 'Donut', 'theft'], { target });
  assert.equal(sent.length, 1, 'no DM-failure note expected');
  assert.match(sent[0].content, /Citation issued/);
  assert.match(sent[0].content, /Reason: Donut theft$/);
  assert.match(sent[0].content, /Case #\d+/, 'citation is filed on the rap sheet');
  assert.equal(sent[0].files[0].name, 'citation.gif');
  assert.ok(dm, 'target got a DM');
  assert.equal(dm.files.length, 1);
});

test('cite: a closed DM adds a note instead of failing the citation', async () => {
  const target = perp();
  target.send = async () => {
    throw new Error('Cannot send messages to this user');
  };
  const { sent } = await run(cite, [PERP, 'x'], { target });
  assert.match(sent[0].content, /Citation issued/);
  assert.match(sent[1].content, /No DM copy delivered/);
});

test('cite: penalty: takes the rest of the line and leaves the reason clean (S94)', async () => {
  const { sent } = await run(cite, [PERP, 'loud', 'music', 'penalty:FINAL', 'WARNING']);
  assert.match(sent[0].content, /Reason: loud music$/, 'the keyword is not part of the reason');
});

test('cite: an optional free-text arg never steals the last word of the reason', async () => {
  // The regression S94 fixed: `penalty` is declared after the greedy `reason`,
  // and every word "fits" a string, so the tail-claiming rule used to file
  // this as reason "Donut" + penalty "theft".
  const { sent } = await run(cite, [PERP, 'Donut', 'theft']);
  assert.match(sent[0].content, /Reason: Donut theft$/);
});

test('cite: refuses to cite the bot itself', async () => {
  const bot = perp('CuffBot', BOT_ID);
  const { sent } = await run(cite, [BOT_ID, 'x'], { target: bot });
  assert.match(sent[0].content, /can't cuff the police/i);
});

test('cite: refuses to cite yourself (Internal Affairs)', async () => {
  const officer = fakeUser(OFFICER, 'officer', { displayName: 'officer', send: async () => {} });
  const { sent } = await run(cite, [OFFICER, 'x'], { target: officer });
  assert.match(sent[0].content, /against yourself/i);
});

// ── !fine ────────────────────────────────────────────────────────────────────

test('fine: public, no permission needed, no record filed, animated gif', async () => {
  const friend = perp('friend', '777000000000000777');
  const { outcome, sent } = await run(fine, ['777000000000000777', 'excessive', 'donut', 'consumption'], {
    perms: false,
    target: friend,
  });
  assert.equal(outcome, 'ran', 'no permission gate at all');
  assert.match(sent[0].content, /good fun/i);
  assert.equal(sent[0].files[0].name, 'citation.gif');
  assert.doesNotMatch(sent[0].content, /Case #/, 'fine files no record');
});

test('fine: cannot fine the bot', async () => {
  const bot = perp('CuffBot', BOT_ID);
  const { sent } = await run(fine, [BOT_ID, 'x'], { perms: false, target: bot });
  assert.match(sent[0].content, /cannot fine the police/i);
});

// ── !detain ──────────────────────────────────────────────────────────────────

test('detain: replies specifically when the target is not in the precinct', async () => {
  const { sent } = await run(detain, [PERP, '10m'], { member: null });
  assert.match(sent[0].content, /not in the precinct/i);
});

test('detain: rejects nonsense durations with guidance', async () => {
  const { sent } = await run(detain, [PERP, 'awhile']);
  assert.match(sent[0].content, /not a duration/i);
});

test('detain: rejects durations over the 28-day cap', async () => {
  const { sent } = await run(detain, [PERP, '29d']);
  assert.match(sent[0].content, /28 days/);
});

test('detain: times out a moderatable member with an audit reason', async () => {
  let timeout = null;
  const member = {
    moderatable: true,
    timeout: async (ms, reason) => {
      timeout = { ms, reason };
    },
  };
  const { sent } = await run(detain, [PERP, '1h30m', 'contempt', 'of', 'donut'], { member });
  assert.equal(timeout.ms, 90 * 60_000);
  assert.match(timeout.reason, /contempt of donut — by officer via CuffBot/);
  assert.match(sent[0].content, /1 hour 30 minutes/);
  assert.match(sent[0].content, /Case #\d+/, 'detainment is filed on the rap sheet');
});

test('detain: hierarchy block replies with role guidance', async () => {
  const member = { moderatable: false, timeout: async () => {} };
  const { sent } = await run(detain, [PERP, '10m'], { member });
  assert.match(sent[0].content, /highest role/i);
});

test('detain: a missing duration is a usage error carrying the usage line', async () => {
  const { outcome, sent } = await run(detain, [PERP]);
  assert.equal(outcome, 'usage-error');
  assert.match(sent[0].content, /missing `duration`/);
  assert.match(sent[0].content, /!detain <target> <duration> \[reason…\]/);
});

// ── !arrest ──────────────────────────────────────────────────────────────────

test('arrest: bans by id when the target already left the guild', async () => {
  const { sent, acted } = await run(arrest, [PERP, 'fled', 'the', 'scene', 'wipe:24h']);
  assert.equal(acted.banned.id, PERP);
  assert.equal(acted.banned.deleteMessageSeconds, 86_400);
  assert.match(acted.banned.reason, /fled the scene — by officer via CuffBot/);
  assert.match(sent[0].content, /arrested/i);
  assert.match(sent[0].content, /last 24 hours/);
});

test('arrest: no wipe keyword keeps every message', async () => {
  const { acted, sent } = await run(arrest, [PERP, 'general', 'nuisance']);
  assert.equal(acted.banned.deleteMessageSeconds, 0);
  assert.doesNotMatch(sent[0].content, /wiped/);
});

test('arrest: an unknown wipe value lists the valid ones instead of guessing', async () => {
  const { sent, acted } = await run(arrest, [PERP, 'x', 'wipe:forever']);
  assert.match(sent[0].content, /`wipe` must be one of/);
  assert.equal(acted.banned, undefined, 'nobody is banned on a bad option');
});

test('arrest: says so when the target is already banned', async () => {
  const { sent, acted } = await run(arrest, [PERP, 'x'], { bans: { [PERP]: { user: { id: PERP } } } });
  assert.match(sent[0].content, /already under arrest/i);
  assert.equal(acted.banned, undefined);
});

// ── !release ─────────────────────────────────────────────────────────────────

test('release: lifts an active timeout', async () => {
  let lifted = null;
  const member = {
    moderatable: true,
    communicationDisabledUntilTimestamp: Date.now() + 60_000,
    timeout: async (ms, reason) => {
      lifted = { ms, reason };
    },
  };
  const { sent } = await run(release, [PERP], { member });
  assert.equal(lifted.ms, null);
  assert.match(sent[0].content, /released from the holding cell/i);
});

test('release: unban path demands Ban Members even though the command gate is lower', async () => {
  // perms:false would refuse at the gate, so the fake answers "has Moderate
  // Members but not Ban Members" by flag.
  const officer = fakeUser(OFFICER, 'officer');
  const exiled = perp('exiled');
  const message = fakeMessage({ guildId: GUILD, authorId: OFFICER, users: { [OFFICER]: officer, [PERP]: exiled } });
  const { PermissionFlagsBits } = await import('discord.js');
  message.channel.permissionsFor = () => ({
    has: (flag) => flag === PermissionFlagsBits.ModerateMembers,
  });
  message.guild.members.fetch = async () => {
    throw new Error('gone');
  };
  message.guild.members.unban = async () => {
    throw new Error('should not be called');
  };
  message.guild.bans = { fetch: async () => ({ user: { id: PERP } }) };
  await dispatchCommand(release.command, message, [PERP], '!');
  assert.match(message.sent[0].content, /Ban Members/);
});

test('release: lifts a ban when the invoker may', async () => {
  const { sent, acted } = await run(release, [PERP], { bans: { [PERP]: { user: { id: PERP } } } });
  assert.equal(acted.unbanned.id, PERP);
  assert.match(sent[0].content, /ban lifted/i);
});

test('release: says so when there is nothing to release', async () => {
  const { sent } = await run(release, [PERP]);
  assert.match(sent[0].content, /nothing to release/i);
});
