// The S70 config-group conversions: per-group sub rosters, the behaviors that
// are NEW in the groups (range guards, toggle/route, the channel-list merge),
// and the store wiring. Pass-through subs that only relay to already-tested
// service functions get roster coverage, not re-tests.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PermissionFlagsBits } from 'discord.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-groups-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

let seq = 0;
const freshGuildId = () => `70000000000000${String((seq += 1)).padStart(4, '0')}`;

function ctxFor(guildId, guildExtras = {}) {
  const replies = [];
  return {
    replies,
    prefix: '!',
    guild: {
      id: guildId,
      roles: { cache: new Map() },
      channels: { cache: new Map() },
      ...guildExtras,
    },
    channel: { id: 'chan-ctx', sendTyping: async () => {} },
    client: { memberEventsAvailable: true },
    user: { id: 'u1' },
    reply: async (p) => replies.push(typeof p === 'string' ? { content: p } : p),
  };
}

const sub = (group, name) => group.subcommands.find((s) => s.name === name);

// ── rosters: every converted group has the expected shape ────────────────────

test('every S70 config group is ManageGuild-gated with its expected subs', async () => {
  const expectations = [
    ['selfroles/commands/selfroles.js', 'selfroles', [], ['on', 'off', 'channel', 'post', 'info', 'emoji', 'clearinfo']],
    ['memorial/commands/memorial.js', 'memorial', ['memorial-config'], ['on', 'off', 'channel', 'officers-channel', 'firefighters-channel', 'officers-role', 'firefighters-role', 'preview', 'probe']],
    ['hunting/commands/hunting.js', 'hunting', [], ['on', 'off', 'add', 'remove', 'mode', 'showtime', 'undercover', 'rewards', 'interval', 'timeout', 'spawn']],
    ['logbook/commands/logbook.js', 'logbook', [], ['on', 'off', 'toggle', 'route', 'channel']],
    ['economy/commands/claims-config.js', 'claims-config', [], ['hourly', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'streak', 'streakmode']],
    ['economy/commands/economy.js', 'economy', ['economy-config'], ['on', 'off', 'earn']],
    ['leveling/commands/xp.js', 'xp', ['xp-config'], ['on', 'off', 'sync', 'message', 'voice', 'cooldown', 'announce', 'noannounce', 'base', 'exponent']],
    ['detective/commands/ai.js', 'ai', ['ai-config'], ['on', 'off', 'channel', 'everywhere']],
    ['birthdays/commands/birthday.js', 'birthday', ['birthday-config'], ['on', 'off', 'channel', 'role', 'norole']],
    ['chat-starter/commands/chat-starter.js', 'chat-starter', ['chat-starter-config'], ['on', 'off', 'channel', 'idle', 'ai', 'preview', 'test']],
    ['starboard/commands/starboard.js', 'starboard', ['starboard-config'], ['on', 'off', 'channel', 'threshold', 'emoji']],
    ['welcome/commands/welcome.js', 'welcome', ['welcome-config'], ['on', 'off', 'channel', 'message', 'test']],
    ['channellist/commands/channel-list.js', 'channel-list', ['channel-list-config'], ['post', 'update', 'remove', 'role', 'everyone', 'header', 'emoji', 'color', 'voice', 'autoupdate', 'ignore', 'unignore']],
  ];
  for (const [file, name, aliases, subs] of expectations) {
    const { default: cmd } = await import(`../src/modules/${file}`);
    assert.equal(cmd.group.name, name, `${file} group name`);
    assert.deepEqual(cmd.group.aliases ?? [], aliases, `${file} aliases`);
    assert.equal(cmd.group.permission, PermissionFlagsBits.ManageGuild, `${file} permission`);
    assert.deepEqual(cmd.group.subcommands.map((s) => s.name), subs, `${file} sub roster`);
    assert.equal(typeof cmd.group.status, 'function', `${file} has status()`);
  }
});

// ── behaviors that are NEW in the groups ─────────────────────────────────────

test('hunting rewards/interval/timeout guard their ranges before saving', async () => {
  const { default: hunting } = await import('../src/modules/hunting/commands/hunting.js');
  const { getHuntingConfig } = await import('../src/modules/hunting/service.js');
  const guildId = freshGuildId();
  const ctx = ctxFor(guildId);

  await sub(hunting.group, 'rewards').run(ctx, { min: 300, max: 100 });
  assert.match(ctx.replies[0].content, /min ≤ max/);
  assert.equal(getHuntingConfig(guildId).rewardMin, 100, 'default untouched on refusal');

  await sub(hunting.group, 'rewards').run(ctx, { min: 150, max: 400 });
  const saved = getHuntingConfig(guildId);
  assert.equal(saved.rewardMin, 150);
  assert.equal(saved.rewardMax, 400);

  await sub(hunting.group, 'interval').run(ctx, { min: 30, max: 3600 });
  assert.match(ctx.replies.at(-1).content, /min ≥ 60/);
  await sub(hunting.group, 'timeout').run(ctx, { seconds: 5 });
  assert.match(ctx.replies.at(-1).content, /10–600/);
});

test('hunting add/remove maintain the channel list without duplicates', async () => {
  const { default: hunting } = await import('../src/modules/hunting/commands/hunting.js');
  const { getHuntingConfig } = await import('../src/modules/hunting/service.js');
  const guildId = freshGuildId();
  const ctx = ctxFor(guildId);
  const chan = { id: 'hunt-2', type: 0 };

  await sub(hunting.group, 'add').run(ctx, { channel: chan });
  assert.ok(getHuntingConfig(guildId).channels.includes('hunt-2'));
  await sub(hunting.group, 'add').run(ctx, { channel: chan });
  assert.match(ctx.replies.at(-1).content, /Already hunting/);
  assert.equal(getHuntingConfig(guildId).channels.filter((id) => id === 'hunt-2').length, 1);
  await sub(hunting.group, 'remove').run(ctx, { channel: chan });
  assert.ok(!getHuntingConfig(guildId).channels.includes('hunt-2'));
});

test('logbook toggle/route hit the right per-category keys', async () => {
  const { default: logbook } = await import('../src/modules/logbook/commands/logbook.js');
  const { getLogbookConfig, resolveLogChannelId } = await import('../src/modules/logbook/service.js');
  const guildId = freshGuildId();
  const ctx = ctxFor(guildId);

  await sub(logbook.group, 'toggle').run(ctx, { category: 'voice', state: false });
  assert.equal(getLogbookConfig(guildId).voice, false);
  await sub(logbook.group, 'route').run(ctx, { category: 'messages', channel: { id: 'log-msgs', type: 0 } });
  assert.equal(resolveLogChannelId(guildId, 'messages'), 'log-msgs');
  await sub(logbook.group, 'channel').run(ctx, { channel: { id: 'log-all', type: 0 } });
  assert.equal(resolveLogChannelId(guildId, 'moderation'), 'log-all', 'single override wins for unrouted categories');
  assert.equal(resolveLogChannelId(guildId, 'messages'), 'log-msgs', 'explicit route still wins');
});

test('claims-config amount subs write the interval keys and refuse out-of-range', async () => {
  const { default: claims } = await import('../src/modules/economy/commands/claims-config.js');
  const { getEconomyConfig } = await import('../src/modules/economy/service.js');
  const guildId = freshGuildId();
  const ctx = ctxFor(guildId);

  await sub(claims.group, 'weekly').run(ctx, { amount: 750 });
  assert.equal(getEconomyConfig(guildId).claimWeek, 750);
  await sub(claims.group, 'weekly').run(ctx, { amount: -1 });
  assert.match(ctx.replies.at(-1).content, /0–1000000/);
  assert.equal(getEconomyConfig(guildId).claimWeek, 750, 'refusal saves nothing');
  await sub(claims.group, 'streakmode').run(ctx, { mode: 'percent' });
  assert.equal(getEconomyConfig(guildId).streakPercent, true);
});

test('channel-list unignore accepts a raw id for deleted channels (the merge kept it)', async () => {
  const { default: channelList } = await import('../src/modules/channellist/commands/channel-list.js');
  const { getChannellistConfig, setChannellistConfig } = await import('../src/modules/channellist/service.js');
  const guildId = freshGuildId();
  const ctx = ctxFor(guildId);

  await sub(channelList.group, 'ignore').run(ctx, { channel: { id: '451095508560379934', type: 0 } });
  assert.deepEqual(getChannellistConfig(guildId).ignoredIds, ['451095508560379934']);
  await sub(channelList.group, 'unignore').run(ctx, { channel: '451095508560379934' });
  assert.deepEqual(getChannellistConfig(guildId).ignoredIds, []);

  await sub(channelList.group, 'unignore').run(ctx, { channel: 'not-an-id' });
  assert.match(ctx.replies.at(-1).content, /#channel mention or a raw channel id/);

  setChannellistConfig(guildId, { ignoredIds: [] });
  await sub(channelList.group, 'unignore').run(ctx, { channel: '<#123456789012345678>' });
  assert.match(ctx.replies.at(-1).content, /was not ignored/);
});

test('starboard emoji sub validates via parseEmojiInput before saving', async () => {
  const { default: starboard } = await import('../src/modules/starboard/commands/starboard.js');
  const { getStarboardConfig } = await import('../src/modules/starboard/service.js');
  const guildId = freshGuildId();
  const ctx = ctxFor(guildId);

  await sub(starboard.group, 'emoji').run(ctx, { emoji: 'word' });
  assert.match(ctx.replies[0].content, /not an emoji I can watch for/);
  await sub(starboard.group, 'emoji').run(ctx, { emoji: '🍩' });
  assert.equal(getStarboardConfig(guildId).emoji, '🍩');
});

test('welcome message sub saves, clamps, and previews the template', async () => {
  const { default: welcome } = await import('../src/modules/welcome/commands/welcome.js');
  const { getWelcomeConfig } = await import('../src/modules/welcome/service.js');
  const guildId = freshGuildId();
  const ctx = ctxFor(guildId, { name: 'Precinct' });

  await sub(welcome.group, 'message').run(ctx, { text: 'Welcome {user} to {server}!' });
  assert.equal(getWelcomeConfig(guildId).message, 'Welcome {user} to {server}!');
  assert.match(ctx.replies[0].content, /Preview:.*<@u1>.*Precinct/s, 'placeholders render in the preview');
});

test('memorial subs write the per-feed keys (S60/S62 knobs preserved)', async () => {
  const { default: memorial } = await import('../src/modules/memorial/commands/memorial.js');
  const { getMemorialConfig } = await import('../src/modules/memorial/service.js');
  const guildId = freshGuildId();
  const ctx = ctxFor(guildId);

  await sub(memorial.group, 'officers-channel').run(ctx, { channel: { id: 'off-chan', type: 0 } });
  await sub(memorial.group, 'firefighters-role').run(ctx, { role: { id: 'fire-role' } });
  const config = getMemorialConfig(guildId);
  assert.equal(config.odmpChannelId, 'off-chan');
  assert.equal(config.fireheroRoleId, 'fire-role');
});

test('selfroles status reports config + detection; on/off flip the switch', async () => {
  const { default: selfroles } = await import('../src/modules/selfroles/commands/selfroles.js');
  const { getSelfrolesConfig } = await import('../src/modules/selfroles/service.js');
  const guildId = freshGuildId();
  const ctx = ctxFor(guildId, { roles: { cache: new Map() }, members: { me: null } });

  await sub(selfroles.group, 'off').run(ctx);
  assert.equal(getSelfrolesConfig(guildId).enabled, false);
  const lines = selfroles.group.status(ctx);
  assert.match(lines[0], /\*\*Enabled:\*\* no/);
  assert.match(lines.join('\n'), /not found/, 'missing header named out loud');
  await sub(selfroles.group, 'on').run(ctx);
  assert.equal(getSelfrolesConfig(guildId).enabled, true);
});
