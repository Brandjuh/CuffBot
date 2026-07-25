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
import xpLadderCmd from '../src/modules/leveling/commands/xp-ladder.js';
import leaderboardCmd from '../src/modules/leveling/commands/leaderboard.js';
import xpConfigCmd from '../src/modules/leveling/commands/xp.js';
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

// S93: !level / !leaderboard / !xp-ladder are flat { command } commands now.
// Their run() takes the same ctx the group framework builds — here with the
// rich guild fixture above, which fakeMessage's plain guild cannot stand in for.
function flatCtx(guild, user = { id: 'viewer', bot: false }) {
  const replies = [];
  return {
    replies,
    ctx: { guild, user, prefix: '!', reply: async (p) => { replies.push(typeof p === 'string' ? { content: p } : p); } },
  };
}

function embedDesc(reply) {
  const e = reply.embeds[0];
  return e.data?.description ?? e.description;
}

const T = thresholdsFor(4, getXpConfig('000000000000000000'));

// ---- !level ----

test('!level seeds a ranked member from their role and shows the card', async () => {
  const guild = fakeGuild(freshGuildId());
  const member = fakeMember(guild, 'u1', ['r-veteran']);
  guild.members.fetch = async () => member;
  const { ctx, replies } = flatCtx(guild, member.user);
  await level.command.run(ctx, {});
  const desc = embedDesc(replies[0]);
  assert.match(desc, new RegExp(`\\*\\*XP:\\*\\* ${T[2].toLocaleString('en-US')}`));
  assert.match(desc, /r-veteran/);
  assert.match(desc, /r-legend/, 'shows the next rank');
  const footer = replies[0].embeds[0].data?.footer ?? replies[0].embeds[0].footer;
  assert.match(footer.text, /seeded from existing rank: Veteran/i);
  assert.equal(getUserXp(guild.id, 'u1'), T[2], 'seed persisted');
});

test('!level for a rankless member starts at 0', async () => {
  const guild = fakeGuild(freshGuildId());
  const member = fakeMember(guild, 'u2', []);
  guild.members.fetch = async () => member;
  const { ctx, replies } = flatCtx(guild, member.user);
  await level.command.run(ctx, {});
  assert.match(embedDesc(replies[0]), /\*\*XP:\*\* 0/);
  assert.equal(getUserXp(guild.id, 'u2'), 0);
});

test('!level refuses bots and never creates a record for them (audit #4)', async () => {
  const guild = fakeGuild(freshGuildId());
  const bot = { id: 'bot-1', bot: true, username: 'OldLeveler', displayAvatarURL: () => null };
  const { ctx, replies } = flatCtx(guild);
  await level.command.run(ctx, { target: bot });
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

// ---- !leaderboard ----

test('!leaderboard lists seeded + earned XP, highest first', async () => {
  const guild = fakeGuild(freshGuildId());
  // Seed two members by viewing their /level once.
  for (const [id, roles] of [['top', ['r-legend']], ['low', ['r-rookie']]]) {
    const m = fakeMember(guild, id, roles);
    guild.members.fetch = async () => m;
    await level.command.run(flatCtx(guild, m.user).ctx, {});
  }
  const { ctx, replies } = flatCtx(guild);
  await leaderboardCmd.command.run(ctx, {});
  const desc = embedDesc(replies[0]);
  assert.ok(desc.indexOf('top') < desc.indexOf('low'), 'legend outranks rookie');
  assert.match(desc, /🥇/);
});

test('!leaderboard with no data explains how XP starts', async () => {
  const guild = fakeGuild(freshGuildId());
  const { ctx, replies } = flatCtx(guild);
  await leaderboardCmd.command.run(ctx, {});
  assert.match(embedDesc(replies[0]), /No XP on the books yet/);
});

// ---- !xp-ladder ----
// Converted in S93 and, until then, the only command in the module with no
// test at all — the conversion is what surfaced that.

test('!xp-ladder lists each tier and marks where the viewer stands', async () => {
  const guild = fakeGuild(freshGuildId());
  const member = fakeMember(guild, 'climber', ['r-regular']);
  guild.members.fetch = async () => member;
  await level.command.run(flatCtx(guild, member.user).ctx, {}); // seeds their XP

  const { ctx, replies } = flatCtx(guild, member.user);
  await xpLadderCmd.command.run(ctx, {});
  const desc = embedDesc(replies[0]);
  for (const roleId of ['r-rookie', 'r-regular', 'r-veteran', 'r-legend']) {
    assert.match(desc, new RegExp(roleId), `${roleId} is on the ladder`);
  }
  assert.match(desc, /⬅️ you/, 'the viewer is marked');
  // fakeGuild writes academyConfig.headerRoleId, i.e. the ladder IS pinned —
  // so the "auto-promotions stay idle" warning must stay out of the way.
  assert.doesNotMatch(desc, /Ladder not pinned/);
});

test('!xp-ladder says so plainly when no ladder exists', async () => {
  const guild = fakeGuild(freshGuildId());
  guild.roles.cache.clear();
  const { ctx, replies } = flatCtx(guild);
  await xpLadderCmd.command.run(ctx, {});
  assert.match(replies[0].content, /No rank ladder detected/);
});

// ---- the !xp group (S70) ----

const xpGroup = xpConfigCmd.group;
const xpSub = (name) => xpGroup.subcommands.find((s) => s.name === name);

function groupCtx(guild) {
  const replies = [];
  return {
    replies,
    guild,
    prefix: '!',
    reply: async (p) => replies.push(typeof p === 'string' ? { content: p } : p),
  };
}

test('!xp is a Manage-Server group with the settings roster (S70)', () => {
  assert.equal(xpGroup.name, 'xp');
  assert.ok(xpGroup.aliases.includes('xp-config'), 'the retired name stays as an alias');
  assert.equal(xpGroup.permission, PermissionFlagsBits.ManageGuild);
  assert.deepEqual(
    xpGroup.subcommands.map((s) => s.name),
    ['on', 'off', 'sync', 'message', 'voice', 'cooldown', 'announce', 'noannounce', 'base', 'exponent'],
  );
});

test('!xp subs patch settings; status shows thresholds per rank', async () => {
  const guild = fakeGuild(freshGuildId());
  const ctx = groupCtx(guild);
  await xpSub('message').run(ctx, { amount: 25 });
  await xpSub('cooldown').run(ctx, { seconds: 30 });
  await xpSub('announce').run(ctx, { channel: { id: 'chan-1' } });
  const saved = getXpConfig(guild.id);
  assert.equal(saved.messageXp, 25);
  assert.equal(saved.messageCooldownMs, 30_000);
  assert.equal(saved.announceChannelId, 'chan-1');
  const desc = xpGroup.status(groupCtx(guild)).join('\n');
  assert.match(desc, /r-legend/);
  assert.match(desc, new RegExp(T[3].toLocaleString('en-US')), 'top rank threshold shown');
  assert.match(desc, /seeded with the XP of the rank they already hold/i);
  assert.match(desc, /\*\*Ladder pinned:\*\* yes/, 'pinned status shown');
});

test('!xp rejects out-of-range values without saving (S70 range guards)', async () => {
  const guild = fakeGuild(freshGuildId());
  const ctx = groupCtx(guild);
  await xpSub('message').run(ctx, { amount: 500 });
  assert.match(ctx.replies[0].content, /must be 1–100/);
  assert.equal(getXpConfig(guild.id).messageXp, 15, 'default untouched');
});

test('!xp noannounce resets the announce channel (audit #6)', async () => {
  const guild = fakeGuild(freshGuildId());
  await xpSub('announce').run(groupCtx(guild), { channel: { id: 'chan-1' } });
  assert.equal(getXpConfig(guild.id).announceChannelId, 'chan-1');
  await xpSub('noannounce').run(groupCtx(guild), {});
  assert.equal(getXpConfig(guild.id).announceChannelId, null);
});

test('!xp status warns when the ladder is not pinned', async () => {
  const guild = fakeGuild(freshGuildId());
  setGuildData(guild.id, 'academyConfig', { headerRoleId: null, excludedRoleIds: [] });
  assert.match(xpGroup.status(groupCtx(guild)).join('\n'), /\*\*Ladder pinned:\*\* ⚠️ no/);
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
  setXpConfig(guild.id, { messageXp: 1_000 }); // one message reaches Rookie (T[0]=1000, S45)
  const message = fakeMessage(guild, member);
  await messageXpEvent.execute(message);
  assert.equal(getUserXp(guild.id, 'u3'), 1_000);
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
