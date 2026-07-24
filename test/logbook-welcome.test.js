import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  CATEGORIES,
  memberJoined,
  memberLeft,
  messageDeleted,
  messageEdited,
  rolesChanged,
  voiceChanged,
} from '../src/modules/logbook/lib/logformat.js';
import { getLogbookConfig, postLog, setLogbookConfig } from '../src/modules/logbook/service.js';
import { onMessageDelete, onMessageUpdate } from '../src/modules/logbook/events/messages.js';
import { onMemberAdd, onBanAdd } from '../src/modules/logbook/events/members.js';
import { onVoiceState } from '../src/modules/logbook/events/server.js';
import {
  DEFAULT_WELCOME_CONFIG,
  postWelcome,
  renderWelcome,
  setWelcomeConfig,
} from '../src/modules/welcome/service.js';
import welcomeJoin from '../src/modules/welcome/events/member-join.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-logbook-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

let seq = 0;
const freshGuildId = () => `10000000000000${String((seq += 1)).padStart(4, '0')}`;

function fakeGuild(guildId) {
  const sends = [];
  const channel = { id: 'log-chan', send: async (p) => (sends.push(p), p) };
  const lobby = { id: '411609312037961729', send: async (p) => (sends.push(p), p) };
  return {
    id: guildId,
    name: 'Precinct',
    channels: { cache: new Map([['log-chan', channel], ['411609312037961729', lobby]]) },
    sends,
  };
}

// ── logbook models + gating ──────────────────────────────────────────────────

test('log models render the essentials per category', () => {
  const del = messageDeleted({ authorTag: 'brand#0', authorId: 'u1', channelId: 'c1', content: 'oops', attachmentCount: 2, partial: false });
  assert.equal(del.category, 'messages');
  assert.match(del.lines.join('\n'), /oops/);
  assert.match(del.lines.join('\n'), /Attachments:\*\* 2/);

  const partial = messageDeleted({ channelId: 'c1', partial: true });
  assert.match(partial.lines.join('\n'), /not in my cache/);

  const edit = messageEdited({ authorTag: 'b', authorId: 'u1', channelId: 'c1', before: null, after: 'new', url: 'https://x' });
  assert.match(edit.lines.join('\n'), /unknown — not cached/);

  const joined = memberJoined({ userTag: 'newbie#1', userId: 'u2', accountAgeDays: 1 });
  assert.match(joined.lines.join('\n'), /Account age:\*\* 1 day\b/);

  const left = memberLeft({ userTag: 'gone#2', userId: 'u3', roleNames: ['Rookie', 'DJ'] });
  assert.match(left.lines.join('\n'), /Rookie, DJ/);

  const roles = rolesChanged({ userTag: 't', userId: 'u4', added: ['Veteran'], removed: [] });
  assert.match(roles.lines.join('\n'), /Added:\*\* Veteran/);

  assert.match(voiceChanged({ userTag: 'v', userId: 'u5', fromChannelId: null, toChannelId: 'vc1' }).title, /joined/);
  assert.match(voiceChanged({ userTag: 'v', userId: 'u5', fromChannelId: 'vc1', toChannelId: null }).title, /left/);
  assert.match(voiceChanged({ userTag: 'v', userId: 'u5', fromChannelId: 'vc1', toChannelId: 'vc2' }).title, /moved/);
});

test('postLog honors master switch, channel, category toggles, and never logs the log channel', async () => {
  const guildId = freshGuildId();
  const guild = fakeGuild(guildId);
  const model = messageDeleted({ authorTag: 'x', authorId: 'u', channelId: 'c1', content: 'hi', attachmentCount: 0, partial: false });

  assert.equal(await postLog(guild, model), false, 'no channel configured yet');
  setLogbookConfig(guildId, { channelId: 'log-chan' });
  assert.equal(await postLog(guild, model), true, 'defaults log everything once a channel is set');
  assert.deepEqual(guild.sends[0].allowedMentions, { parse: [] });

  setLogbookConfig(guildId, { messages: false });
  assert.equal(await postLog(guild, model), false, 'category toggle respected');
  setLogbookConfig(guildId, { messages: true, enabled: false });
  assert.equal(await postLog(guild, model), false, 'master switch respected');
  setLogbookConfig(guildId, { enabled: true });
  assert.equal(await postLog(guild, model, { sourceChannelId: 'log-chan' }), false, 'the log channel never logs itself');
});

test('all categories default ON (the owner asked to log everything)', () => {
  const config = getLogbookConfig(freshGuildId());
  for (const category of CATEGORIES) assert.equal(config[category], true, category);
});

// ── logbook events end-to-end with fakes ─────────────────────────────────────

const clientFor = (guildId) => ({ config: { homeGuildId: guildId }, user: { id: 'cuffbot' } });

test('message delete/edit events post to the log channel', async () => {
  const guildId = freshGuildId();
  const guild = fakeGuild(guildId);
  setLogbookConfig(guildId, { channelId: 'log-chan' });
  const client = clientFor(guildId);

  await onMessageDelete.execute({
    client, guild, channelId: 'c1', partial: false,
    author: { id: 'u1', tag: 'brand#0' }, content: 'deleted text', attachments: { size: 0 },
  });
  assert.equal(guild.sends.length, 1);
  assert.match(guild.sends[0].embeds[0].toJSON().description, /deleted text/);

  await onMessageUpdate.execute(
    { partial: false, content: 'old words' },
    { client, guild, channelId: 'c1', partial: false, author: { id: 'u1', tag: 'brand#0', bot: false }, content: 'new words', url: 'https://x' },
  );
  assert.equal(guild.sends.length, 2);
  const desc = guild.sends[1].embeds[0].toJSON().description;
  assert.match(desc, /old words/);
  assert.match(desc, /new words/);

  // Identical content (embed resolve) → silence.
  await onMessageUpdate.execute(
    { partial: false, content: 'same' },
    { client, guild, channelId: 'c1', partial: false, author: { id: 'u1', tag: 'b', bot: false }, content: 'same' },
  );
  assert.equal(guild.sends.length, 2);
});

test('member join and ban events post; the bot own deletes are skipped', async () => {
  const guildId = freshGuildId();
  const guild = fakeGuild(guildId);
  setLogbookConfig(guildId, { channelId: 'log-chan' });
  const client = clientFor(guildId);

  await onMemberAdd.execute({
    client, guild, id: 'u9',
    user: { id: 'u9', tag: 'new#1', createdTimestamp: Date.now() - 3 * 86_400_000 },
  });
  assert.equal(guild.sends.length, 1);
  assert.match(guild.sends[0].embeds[0].toJSON().description, /new#1/);

  await onBanAdd.execute({ client, guild, partial: false, user: { id: 'u10', tag: 'bad#2' }, reason: 'spam' });
  assert.equal(guild.sends.length, 2);
  assert.match(guild.sends[1].embeds[0].toJSON().description, /spam/);

  await onMessageDelete.execute({
    client, guild, channelId: 'c1', partial: false,
    author: { id: 'cuffbot', tag: 'CuffBot#0' }, content: 'bot own', attachments: { size: 0 },
  });
  assert.equal(guild.sends.length, 2, "the bot's own messages are not logged");
});

test('voice event logs moves but ignores mute toggles', async () => {
  const guildId = freshGuildId();
  const guild = fakeGuild(guildId);
  setLogbookConfig(guildId, { channelId: 'log-chan' });
  const client = clientFor(guildId);
  const member = { id: 'u1', user: { id: 'u1', tag: 'v#1', bot: false } };

  await onVoiceState.execute(
    { guild, client, channelId: 'vc1', member },
    { guild, client, channelId: 'vc1', member },
  );
  assert.equal(guild.sends.length, 0, 'same channel = mute/deaf toggle, ignored');
  await onVoiceState.execute(
    { guild, client, channelId: 'vc1', member },
    { guild, client, channelId: 'vc2', member },
  );
  assert.equal(guild.sends.length, 1);
  assert.match(guild.sends[0].embeds[0].toJSON().title, /moved/);
});

// ── welcome ──────────────────────────────────────────────────────────────────

test('welcome defaults target the owner lobby and render placeholders', () => {
  assert.equal(DEFAULT_WELCOME_CONFIG.channelId, '411609312037961729');
  assert.equal(DEFAULT_WELCOME_CONFIG.enabled, true);
  const text = renderWelcome('Hi {user}, welcome to {server}!', { userMention: '<@u1>', serverName: 'Precinct' });
  assert.equal(text, 'Hi <@u1>, welcome to Precinct!');
});

test('the join event welcomes humans in the lobby, skips bots, respects the switch', async () => {
  const guildId = freshGuildId();
  const guild = fakeGuild(guildId);
  const client = clientFor(guildId);

  await welcomeJoin.execute({ client, guild, id: 'u1', user: { bot: false }, displayName: 'Newbie' });
  assert.equal(guild.sends.length, 1);
  assert.match(guild.sends[0].content, /Welcome to the precinct, <@u1>!/);
  assert.deepEqual(guild.sends[0].allowedMentions, { users: ['u1'] });

  await welcomeJoin.execute({ client, guild, id: 'b1', user: { bot: true }, displayName: 'SomeBot' });
  assert.equal(guild.sends.length, 1, 'bots get no welcome');

  setWelcomeConfig(guildId, { enabled: false });
  await welcomeJoin.execute({ client, guild, id: 'u2', user: { bot: false }, displayName: 'Two' });
  assert.equal(guild.sends.length, 1, 'disabled stays silent');
  setWelcomeConfig(guildId, { enabled: true });
});

test('postWelcome survives an unsendable channel', async () => {
  const guildId = freshGuildId();
  const broken = {
    id: guildId, name: 'P',
    channels: { cache: new Map([['411609312037961729', { id: '411609312037961729', send: async () => { throw new Error('no perms'); } }]]) },
  };
  assert.equal(await postWelcome(broken, 'u1', {}), false);
});
