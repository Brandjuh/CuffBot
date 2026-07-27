// Discord timestamp markup (S134, owner: "Times in discord relative time").
//
// Two things are checked here, and the second is the one that earns the file.
//
// 1. The helper converts milliseconds to SECONDS. `<t:1753632000000:R>` is a
//    date in the year 57000; it renders without complaint, so nothing but a
//    test notices.
//
// 2. **A `<t:…>` token never reaches a place Discord cannot render it.**
//    Discord resolves the markup in message content, embed descriptions and
//    embed field values — and prints it as literal text in select-menu option
//    labels and descriptions, button labels, embed titles and footers. Both
//    the city crime picker and the heist job board show a cooldown in an embed
//    line AND in a select option, from what used to be one string; converting
//    that string in place would have put `<t:1753632000:R>` in front of every
//    player, in the picker, forever. This walks the real payloads instead of
//    trusting the comment that says not to.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-timestamps-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

const { TIME_STYLES, clockTime, discordTime, relative, relativeIn } = await import(
  '../src/core/timestamps.js'
);
const { hubPayload } = await import('../src/modules/city/commands/city.js');
const { boardPayload, marketPayload, panelPayload, recordPayload } = await import(
  '../src/modules/city/commands/crime.js'
);
const { updateCriminal } = await import('../src/modules/city/service.js');
const heistRuntime = await import('../src/modules/heist/panel-runtime.js');
const { updatePlayer } = await import('../src/modules/heist/service.js');

let seq = 0;
const freshGuildId = () => `93000000000000${String((seq += 1)).padStart(4, '0')}`;
const USER = '5001';
const user = { id: USER, username: 'crook', bot: false };

// ── the helper ───────────────────────────────────────────────────────────────

test('milliseconds become seconds — the bug that renders as the year 57000', () => {
  const ms = 1_753_632_000_000;
  assert.equal(discordTime(ms), '<t:1753632000:R>');
  assert.equal(relative(ms), '<t:1753632000:R>');
  assert.equal(clockTime(ms), '<t:1753632000:t>');
});

test('every documented style is a single letter Discord accepts', () => {
  // A typo'd style makes Discord print the raw token; the map exists so a
  // caller never types the letter.
  assert.deepEqual(Object.values(TIME_STYLES).sort(), ['D', 'F', 'R', 'T', 'd', 'f', 't']);
  for (const style of Object.values(TIME_STYLES)) {
    assert.match(discordTime(1_753_632_000_000, style), new RegExp(`^<t:\\d+:${style}>$`));
  }
});

test('relativeIn turns "how much is left" into "when", against an injected clock', () => {
  const now = 1_700_000_000_000;
  assert.equal(relativeIn(45 * 60_000, now), `<t:${(now + 45 * 60_000) / 1000}:R>`);
});

test('a sub-second remainder truncates rather than rounding into the future', () => {
  // Math.floor, not round: a timestamp one second ahead of the real release
  // renders "in 1 second" when the sentence is already over.
  assert.equal(discordTime(1_753_632_000_999), '<t:1753632000:R>');
});

// ── where the markup may and may not go ──────────────────────────────────────

/** Every string a viewer sees on a COMPONENT — none of these render markup. */
function componentText(payload) {
  const out = [];
  for (const row of payload.components ?? []) {
    const json = row.toJSON ? row.toJSON() : row;
    for (const component of json.components ?? []) {
      if (component.label) out.push(['label', component.label]);
      if (component.placeholder) out.push(['placeholder', component.placeholder]);
      for (const option of component.options ?? []) {
        if (option.label) out.push(['option.label', option.label]);
        if (option.description) out.push(['option.description', option.description]);
      }
    }
  }
  return out;
}

/** Embed titles and footers do not render markup either. */
function unrenderedEmbedText(payload) {
  const out = [];
  for (const embed of payload.embeds ?? []) {
    const data = embed.data ?? embed;
    if (data.title) out.push(['embed.title', data.title]);
    if (data.footer?.text) out.push(['embed.footer', data.footer.text]);
    for (const field of data.fields ?? []) if (field.name) out.push(['field.name', field.name]);
  }
  return out;
}

const describe = (payload) =>
  (payload.embeds ?? [])
    .map((e) => (e.data ?? e).description ?? '')
    .join('\n');

/** A city guild whose member is jailed and cooling down on every job. */
async function jailedCity() {
  const guildId = freshGuildId();
  updateCriminal(guildId, USER, (c) => {
    c.jailMs = 90 * 60_000;
    c.jailStartedAt = Date.now();
    c.cooldowns = { pickpocket: Date.now(), mugging: Date.now(), rob_store: Date.now(), bank_heist: Date.now() };
    return c;
  });
  return guildId;
}

test('the city panels put a live timestamp in the embed and NEVER in a component', async () => {
  const guildId = await jailedCity();
  const guild = { id: guildId, members: { cache: new Map() } };

  const payloads = {
    hub: await hubPayload(guild, user),
    panel: await panelPayload(guild, user),
    market: await marketPayload(guild, user),
    board: boardPayload(guild, user),
    record: recordPayload(guild, user, { back: 'hub' }),
  };

  // The two screens that report the cell must actually say when it ends.
  for (const name of ['hub', 'panel']) {
    assert.match(describe(payloads[name]), /<t:\d+:R>/, `${name} lost its release timestamp`);
    assert.doesNotMatch(describe(payloads[name]), /<t:NaN|<t:undefined/, `${name} rendered a broken epoch`);
  }

  for (const [name, payload] of Object.entries(payloads)) {
    for (const [where, text] of [...componentText(payload), ...unrenderedEmbedText(payload)]) {
      assert.doesNotMatch(
        text,
        /<t:/,
        `${name} → ${where} carries "${text}" — Discord prints that markup literally there`,
      );
    }
  }
});

test('the crime picker still says how long the wait is, in plain text', async () => {
  // The plain form is not an oversight — deleting it in favour of the
  // timestamp would leave the option with no wait at all.
  const guildId = await jailedCity();
  updateCriminal(guildId, USER, (c) => {
    c.jailMs = 0;
    c.jailStartedAt = 0;
    return c;
  });
  const payload = await panelPayload({ id: guildId, members: { cache: new Map() } }, user);
  const options = componentText(payload).filter(([where]) => where === 'option.description');
  assert.ok(options.length > 0, 'the picker rendered no options — this test would prove nothing');
  assert.ok(
    options.some(([, text]) => /wait \d/.test(text)),
    'a cooled-down job no longer tells the player how long to wait',
  );
});

test('the heist panels obey the same split', async () => {
  const guildId = freshGuildId();
  updatePlayer(guildId, USER, (p) => {
    p.cooldowns = { ...p.cooldowns, bank: Date.now(), jewelry_store: Date.now() };
    return p;
  });

  const payloads = {
    job: heistRuntime.jobPayload(guildId, USER),
    shop: await heistRuntime.shopPayload(guildId, USER),
    equip: heistRuntime.equipPayload(guildId, USER),
    craft: heistRuntime.craftPayload(guildId, USER),
    config: heistRuntime.configPayload(guildId, USER),
    prices: heistRuntime.pricePayload(guildId, USER),
    event: heistRuntime.eventPayload(guildId, USER),
  };

  assert.match(describe(payloads.job), /<t:\d+:R>/, 'the job board lost its ready-at timestamp');

  for (const [name, payload] of Object.entries(payloads)) {
    for (const [where, text] of [...componentText(payload), ...unrenderedEmbedText(payload)]) {
      assert.doesNotMatch(text, /<t:/, `heist ${name} → ${where} carries "${text}"`);
    }
  }
});

test('the transcript stamp is not wrapped in a code span', async () => {
  // Backticks make Discord print the token verbatim, and this line HAD them:
  // `` `14:32` `` became `` `<t:…:t>` `` on the first pass of S134, which
  // renders as markup-looking noise instead of a time.
  //
  // Checked on the rendered line rather than by grepping src/ for a backtick
  // near a `<t:` — that pattern cannot tell a JS template literal from a
  // Discord code span, and `!ht` deliberately prints both forms side by side.
  // A guard that fires on correct code is worse than no guard (skill 0.5.52).
  const { formatLine } = await import('../src/modules/transcribe/lib/voice-session.js');
  const at = Date.parse('2026-07-26T14:32:09Z');
  const line = formatLine({ name: 'Alice', text: 'Suspect fled north.', at });

  assert.match(line, new RegExp(`^<t:${Math.floor(at / 1000)}:t> `), 'the stamp is not a bare timestamp');
  assert.doesNotMatch(line, /`/, 'a code span around the stamp stops Discord rendering it');
});
