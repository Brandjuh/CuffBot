import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Collection, PermissionFlagsBits } from 'discord.js';
import { setGuildData } from '../src/core/store.js';
import { thresholdsFor } from '../src/modules/leveling/lib/xp.js';
import { getUserXp, getXpConfig, setXpConfig } from '../src/modules/leveling/service.js';
import level, { progressBar } from '../src/modules/leveling/commands/level.js';
import leaderboardCmd from '../src/modules/leveling/commands/leaderboard.js';
import xpConfigCmd from '../src/modules/leveling/commands/xp-config.js';
import messageXpEvent from '../src/modules/leveling/events/message-xp.js';
import { sweepGuild } from '../src/modules/leveling/events/voice-sweep.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-leveling-cmd-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

let seq = 0;
function freshGuildId() {
  seq += 1;
  return `91000000000000${String(seq).padStart(4, '0')}`;
}

// A guild whose roles encode a [LEVELER] header + 4 ranks (highest first), the
// shape academy's ladder detection expects. Voice channels are added per test.
function fakeGuild(guildId) {
  const roles = new Map();
  roles.set('lvl-header', { id: 'lvl-header', name: '▬ LEVELER ▬', position: 80, editable: true });
  [
    ['r-legend', 'Legend', 79],
    ['r-veteran', 'Veteran', 78],
    ['r-regular', 'Regular', 77],
    ['r-rookie', 'Rookie', 76],
  ].forEach(([id, name, position]) => roles.set(id, { id, name, position, editable: true }));
  setGuildData(guildId, 'academyConfig', { headerRoleId: 'lvl-header', excludedRoleIds: [] });
  return {
    id: guildId,
    afkChannelId: 'afk-channel',
    roles: { cache: roles },
    channels: { cache: new Collection() },
    members: { fetch: async () => null },
  };
}

function fakeMember(guild, id, roleIds = []) {
  const added = [];
  const removed = [];
  return {
    id,
    added,
    removed,
    displayName: `officer-${id}`,
    user: { id, username: `officer-${id}`, bot: false, displayAvatarURL: () => null },
    guild,
    roles: {
      cache: new Map(roleIds.map((rid) => [rid, { id: rid }])),
      add: async (idOrIds) => added.push(...[].concat(idOrIds)),
      remove: async (ids) => removed.push(...[].concat(ids)),
    },
    voice: { selfDeaf: false },
  };
}

function embedDesc(reply) {
  const e = reply.embeds[0];
  return e.data?.description ?? e.description;
}

const T = thresholdsFor(4, getXpConfig('000000000000000000'));

// ---- /level ----

test('/level seeds a ranked member from their role and shows the card', async () => {
  const guild = fakeGuild(freshGuildId());
  const member = fakeMember(guild, 'u1', ['r-veteran']);
  guild.members.fetch = async () => member;
  const replies = [];
  await level.execute({
    guild,
    user: member.user,
    options: { getUser: () => null },
    reply: async (p) => replies.push(p),
  });
  const desc = embedDesc(replies[0]);
  assert.match(desc, new RegExp(`\\*\\*XP:\\*\\* ${T[2].toLocaleString('en-US')}`));
  assert.match(desc, /r-veteran/);
  assert.match(desc, /r-legend/, 'shows the next rank');
  const footer = replies[0].embeds[0].data?.footer ?? replies[0].embeds[0].footer;
  assert.match(footer.text, /seeded from existing rank: Veteran/i);
  assert.equal(getUserXp(guild.id, 'u1'), T[2], 'seed persisted');
});

test('/level for a rankless member starts at 0', async () => {
  const guild = fakeGuild(freshGuildId());
  const member = fakeMember(guild, 'u2', []);
  guild.members.fetch = async () => member;
  const replies = [];
  await level.execute({
    guild,
    user: member.user,
    options: { getUser: () => null },
    reply: async (p) => replies.push(p),
  });
  assert.match(embedDesc(replies[0]), /\*\*XP:\*\* 0/);
  assert.equal(getUserXp(guild.id, 'u2'), 0);
});

test('/level refuses bots and never creates a record for them (audit #4)', async () => {
  const guild = fakeGuild(freshGuildId());
  const bot = { id: 'bot-1', bot: true, username: 'OldLeveler', displayAvatarURL: () => null };
  const replies = [];
  await level.execute({
    guild,
    user: { id: 'human', bot: false },
    options: { getUser: () => bot },
    reply: async (p) => replies.push(p),
  });
  assert.match(replies[0].content, /Bots don’t earn XP/);
  assert.equal(getUserXp(guild.id, 'bot-1'), 0);
  const { getUsers } = await import('../src/modules/leveling/service.js');
  assert.equal('bot-1' in getUsers(guild.id), false, 'no record persisted');
});

test('progressBar clamps and fills proportionally', () => {
  assert.equal(progressBar(0, 100), '▱'.repeat(12));
  assert.equal(progressBar(100, 100), '▰'.repeat(12));
  assert.equal(progressBar(50, 100), '▰'.repeat(6) + '▱'.repeat(6));
  assert.equal(progressBar(500, 100), '▰'.repeat(12), 'overshoot clamps');
});

// ---- /leaderboard ----

test('/leaderboard lists seeded + earned XP, highest first', async () => {
  const guild = fakeGuild(freshGuildId());
  // Seed two members by viewing their /level once.
  for (const [id, roles] of [['top', ['r-legend']], ['low', ['r-rookie']]]) {
    const m = fakeMember(guild, id, roles);
    guild.members.fetch = async () => m;
    await level.execute({ guild, user: m.user, options: { getUser: () => null }, reply: async () => {} });
  }
  const replies = [];
  await leaderboardCmd.execute({
    guild,
    options: { getInteger: () => null },
    reply: async (p) => replies.push(p),
  });
  const desc = embedDesc(replies[0]);
  assert.ok(desc.indexOf('top') < desc.indexOf('low'), 'legend outranks rookie');
  assert.match(desc, /🥇/);
});

test('/leaderboard with no data explains how XP starts', async () => {
  const guild = fakeGuild(freshGuildId());
  const replies = [];
  await leaderboardCmd.execute({
    guild,
    options: { getInteger: () => null },
    reply: async (p) => replies.push(p),
  });
  assert.match(embedDesc(replies[0]), /No XP on the books yet/);
});

// ---- /xp-config ----

function configInteraction(guild, opts = {}, perms = [PermissionFlagsBits.ManageGuild]) {
  const replies = [];
  return {
    replies,
    guild,
    memberPermissions: { has: (f) => perms.includes(f) },
    options: {
      getBoolean: (n) => opts[n] ?? null,
      getInteger: (n) => opts[n] ?? null,
      getChannel: (n) => opts[n] ?? null,
    },
    reply: async (p) => replies.push(p),
  };
}

test('/xp-config requires Manage Server', async () => {
  const guild = fakeGuild(freshGuildId());
  const ix = configInteraction(guild, {}, []);
  await xpConfigCmd.execute(ix);
  assert.match(ix.replies[0].content, /Manage Server/);
});

test('/xp-config patches settings and shows thresholds per rank', async () => {
  const guild = fakeGuild(freshGuildId());
  const ix = configInteraction(guild, { 'message-xp': 25, cooldown: 30, announce: { id: 'chan-1' } });
  await xpConfigCmd.execute(ix);
  const saved = getXpConfig(guild.id);
  assert.equal(saved.messageXp, 25);
  assert.equal(saved.messageCooldownMs, 30_000);
  assert.equal(saved.announceChannelId, 'chan-1');
  const desc = embedDesc(ix.replies[0]);
  assert.match(desc, /r-legend/);
  assert.match(desc, new RegExp(T[3].toLocaleString('en-US')), 'top rank threshold shown');
  assert.match(desc, /seeded with the XP of the rank they already hold/i);
  assert.match(desc, /\*\*Ladder pinned:\*\* yes/, 'pinned status shown');
});

test('/xp-config clear-announce resets the announce channel (audit #6)', async () => {
  const guild = fakeGuild(freshGuildId());
  await xpConfigCmd.execute(configInteraction(guild, { announce: { id: 'chan-1' } }));
  assert.equal(getXpConfig(guild.id).announceChannelId, 'chan-1');
  await xpConfigCmd.execute(configInteraction(guild, { 'clear-announce': true }));
  assert.equal(getXpConfig(guild.id).announceChannelId, null);
});

test('/xp-config warns when the ladder is not pinned', async () => {
  const guild = fakeGuild(freshGuildId());
  setGuildData(guild.id, 'academyConfig', { headerRoleId: null, excludedRoleIds: [] });
  const ix = configInteraction(guild);
  await xpConfigCmd.execute(ix);
  assert.match(embedDesc(ix.replies[0]), /\*\*Ladder pinned:\*\* ⚠️ no/);
});

// ---- message XP event ----

function fakeMessage(guild, member, homeGuildId = guild.id) {
  const sent = [];
  return {
    sent,
    guild,
    member,
    author: member.user,
    channel: { send: async (p) => sent.push(p) },
    client: { config: { homeGuildId } },
  };
}

test('message event awards XP and announces a promotion in-channel', async () => {
  const guild = fakeGuild(freshGuildId());
  const member = fakeMember(guild, 'u3', []);
  setXpConfig(guild.id, { messageXp: 100 }); // one message reaches Rookie (T[0]=100)
  const message = fakeMessage(guild, member);
  await messageXpEvent.execute(message);
  assert.equal(getUserXp(guild.id, 'u3'), 100);
  assert.deepEqual(member.added, ['r-rookie']);
  assert.equal(message.sent.length, 1);
  assert.match(message.sent[0].content, /first stripes.*Rookie/);
});

test('message event ignores bots, DMs, foreign guilds, and disabled config', async () => {
  const guild = fakeGuild(freshGuildId());
  const member = fakeMember(guild, 'u4', []);

  const bot = fakeMessage(guild, member);
  bot.author = { ...member.user, bot: true };
  await messageXpEvent.execute(bot);

  const foreign = fakeMessage(guild, member, 'some-other-guild');
  await messageXpEvent.execute(foreign);

  setXpConfig(guild.id, { enabled: false });
  await messageXpEvent.execute(fakeMessage(guild, member));

  assert.equal(getUserXp(guild.id, 'u4'), 0, 'no XP was ever awarded');
});

test('message event ignores system messages (joins/boosts pay nothing — audit #9)', async () => {
  const guild = fakeGuild(freshGuildId());
  const member = fakeMember(guild, 'u4s', []);
  const message = fakeMessage(guild, member);
  message.system = true;
  await messageXpEvent.execute(message);
  assert.equal(getUserXp(guild.id, 'u4s'), 0);
});

test('message event survives a broken ladder without throwing', async () => {
  const guild = fakeGuild(freshGuildId());
  guild.roles = null; // ladder resolution will throw inside the handler
  const member = fakeMember(guild, 'u5', []);
  member.roles.cache = new Map();
  await messageXpEvent.execute(fakeMessage(guild, member)); // must not throw
});

// ---- voice sweep ----

function voiceChannel(guild, id, members, { type = 2 } = {}) {
  return { id, type, members: new Map(members.map((m) => [m.id, m])) };
}

test('voice sweep pays eligible members and skips lone/deaf/AFK/bots', async () => {
  const guild = fakeGuild(freshGuildId());
  const a = fakeMember(guild, 'va', []);
  const b = fakeMember(guild, 'vb', []);
  const deaf = fakeMember(guild, 'vdeaf', []);
  deaf.voice.selfDeaf = true;
  const lone = fakeMember(guild, 'vlone', []);
  const afk1 = fakeMember(guild, 'vafk1', []);
  const afk2 = fakeMember(guild, 'vafk2', []);
  const botM = fakeMember(guild, 'vbot', []);
  botM.user.bot = true;

  guild.channels.cache.set('vc-1', voiceChannel(guild, 'vc-1', [a, b, deaf, botM]));
  guild.channels.cache.set('vc-2', voiceChannel(guild, 'vc-2', [lone]));
  guild.channels.cache.set('afk-channel', voiceChannel(guild, 'afk-channel', [afk1, afk2]));
  guild.channels.cache.set('text-1', { id: 'text-1', type: 0, members: new Map() });

  await sweepGuild(guild);
  const perMin = getXpConfig(guild.id).voiceXpPerMin;
  assert.equal(getUserXp(guild.id, 'va'), perMin);
  assert.equal(getUserXp(guild.id, 'vb'), perMin);
  assert.equal(getUserXp(guild.id, 'vdeaf'), 0, 'self-deafened earns nothing');
  assert.equal(getUserXp(guild.id, 'vlone'), 0, 'alone earns nothing');
  assert.equal(getUserXp(guild.id, 'vafk1'), 0, 'AFK channel earns nothing');
  assert.equal(getUserXp(guild.id, 'vbot'), 0, 'bots earn nothing');
});

test('voice sweep seeds a ranked member on first sight, then adds the minute', async () => {
  const guild = fakeGuild(freshGuildId());
  const ranked = fakeMember(guild, 'vr', ['r-regular']);
  const buddy = fakeMember(guild, 'vbuddy', []);
  guild.channels.cache.set('vc-1', voiceChannel(guild, 'vc-1', [ranked, buddy]));
  await sweepGuild(guild);
  const config = getXpConfig(guild.id);
  assert.equal(getUserXp(guild.id, 'vr'), T[1] + config.voiceXpPerMin, 'Regular floor + 1 minute');
});

test('voice sweep does nothing when the system is disabled', async () => {
  const guild = fakeGuild(freshGuildId());
  setXpConfig(guild.id, { enabled: false });
  const a = fakeMember(guild, 'vx', []);
  const b = fakeMember(guild, 'vy', []);
  guild.channels.cache.set('vc-1', voiceChannel(guild, 'vc-1', [a, b]));
  await sweepGuild(guild);
  assert.equal(getUserXp(guild.id, 'vx'), 0);
});
