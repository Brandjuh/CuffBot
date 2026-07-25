// S93 (M17.3 slice A): rewritten onto dispatchCommand — the path the router
// actually takes — instead of hand-built interactions. That makes the arg
// parsing part of what these tests prove, which matters most for !911, whose
// trailing anonymity flag used to need a per-command adapter hint.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import badge from '../src/modules/public-affairs/commands/badge.js';
import donut from '../src/modules/public-affairs/commands/donut.js';
import wanted from '../src/modules/public-affairs/commands/wanted.js';
import report911 from '../src/modules/public-affairs/commands/911.js';
import { addRecord } from '../src/modules/records/lib/api.js';
import { setEvidenceLocker, clearEvidenceLocker } from '../src/modules/dispatch/lib/api.js';
import { encodePng } from '../src/modules/enforcement/lib/png.js';
import { dispatchCommand } from '../src/core/prefix/command.js';
import { fakeMessage, fakeUser, fakeMember } from './fixtures/fake-message.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-pa-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

const GUILD = '411157175948541954';
const SELF = '700000000000000001';
const BUDDY = '700000000000000002';
const PERP = '700000000000000009';

/**
 * Dispatch a flat command as SELF. `people` are addressable by id; `member`
 * overrides what guild.members.fetch returns (public-affairs reads
 * displayName/joinedTimestamp off it).
 */
async function run(command, tokens, { people = [], member, lockerChannel } = {}) {
  const self = fakeUser(SELF, 'officer');
  const users = Object.fromEntries([self, ...people].map((u) => [u.id, u]));
  const message = fakeMessage({ guildId: GUILD, authorId: SELF, users });
  if (member !== undefined) message.guild.members.fetch = async () => member;
  if (lockerChannel) {
    message.guild.channels.cache.set(lockerChannel.id, lockerChannel);
    message.guild.channels.fetch = async () => lockerChannel;
  }
  const outcome = await dispatchCommand(command.command, message, tokens, '!');
  return { outcome, sent: message.sent, typing: message.typing, self };
}

const embedOf = (reply) => reply.embeds[0].data ?? reply.embeds[0];

test('badge shows a card even with no rank and no records', async () => {
  const self = fakeUser(SELF, 'officer');
  const { sent } = await run(badge, [], { member: fakeMember(self, { displayName: 'officer' }) });
  assert.match(embedOf(sent[0]).title, /officer/);
});

test('badge reflects filed records', async () => {
  addRecord(GUILD, { type: 'citation', userId: PERP, officerId: SELF, reason: 'x' });
  const perp = fakeUser(PERP, 'perp');
  const { sent } = await run(badge, [PERP], {
    people: [perp],
    member: fakeMember(perp, { displayName: 'perp' }),
  });
  const fields = embedOf(sent[0]).fields;
  assert.equal(fields.find((f) => f.name === 'Record').value, '1 entry');
});

test('donut hands out a treat', async () => {
  const buddy = fakeUser(BUDDY, 'buddy');
  const { sent } = await run(donut, [`<@${BUDDY}>`], { people: [buddy] });
  assert.match(sent[0].content, new RegExp(`hands <@${BUDDY}>`));
  assert.match(sent[0].content, /🍩/);
});

test('donut with no target treats the caller', async () => {
  const { sent } = await run(donut, []);
  assert.match(sent[0].content, /treats themselves/);
});

test('wanted renders a poster attachment with the fetched avatar', async () => {
  const png = encodePng(new Uint8Array(16 * 16 * 3).fill(120), 16, 16);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
  });
  try {
    const perp = fakeUser(PERP, 'perp');
    const { sent, typing } = await run(wanted, [PERP], {
      people: [perp],
      member: fakeMember(perp, { displayName: 'perp' }),
    });
    // S93: the old deferReply() placeholder is replaced by a typing indicator —
    // a message command has no 3-second deadline to beat.
    assert.equal(typing.count, 1, 'shows it is working before the slow render');
    assert.equal(sent.length, 1, 'one message, not a placeholder plus an edit');
    assert.equal(sent[0].files[0].name, 'wanted.png');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('wanted still posts a poster when the avatar fetch fails', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('network down');
  };
  try {
    const perp = fakeUser(PERP, 'perp2');
    const { sent } = await run(wanted, [PERP], { people: [perp], member: null });
    assert.equal(sent[0].files[0].name, 'wanted.png');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('wanted takes a multi-word crime as the rest of the line', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  try {
    const perp = fakeUser(PERP, 'perp3');
    const { outcome } = await run(wanted, [PERP, 'stealing', 'the', 'last', 'donut'], {
      people: [perp],
      member: null,
    });
    assert.equal(outcome, 'ran');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('911 files to the evidence locker and reads the trailing anonymity flag', async () => {
  const delivered = [];
  const channel = { id: 'locker', send: async (p) => delivered.push(p) };
  setEvidenceLocker(GUILD, 'locker');
  const suspect = fakeUser(BUDDY, 'suspect');
  const { sent } = await run(report911, [BUDDY, 'being', 'loud', 'yes'], {
    people: [suspect],
    lockerChannel: channel,
  });
  assert.equal(delivered.length, 1, 'report delivered to locker');
  assert.match(delivered[0].embeds[0].title, /911/);
  const fields = delivered[0].embeds[0].fields;
  assert.match(fields.find((f) => f.name === 'Reporter').value, /Anonymous/);
  assert.match(fields.find((f) => f.name === 'Reason').value, /^being loud$/);
  assert.match(sent[0].content, /filed with the force/);
  clearEvidenceLocker(GUILD);
});

test('911: a reason ending in an ordinary word stays whole', async () => {
  const delivered = [];
  setEvidenceLocker(GUILD, 'locker');
  const suspect = fakeUser(BUDDY, 'suspect');
  await run(report911, [BUDDY, 'they', 'keep', 'shouting'], {
    people: [suspect],
    lockerChannel: { id: 'locker', send: async (p) => delivered.push(p) },
  });
  const fields = delivered[0].embeds[0].fields;
  assert.match(fields.find((f) => f.name === 'Reason').value, /^they keep shouting$/);
  assert.doesNotMatch(fields.find((f) => f.name === 'Reporter').value, /Anonymous/);
  clearEvidenceLocker(GUILD);
});

test('911 tells the reporter when no locker is configured', async () => {
  clearEvidenceLocker(GUILD);
  const suspect = fakeUser(BUDDY, 'suspect');
  const { sent } = await run(report911, [BUDDY, 'x'], { people: [suspect] });
  assert.match(sent[0].content, /no evidence-locker channel configured/);
});
