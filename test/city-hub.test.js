// The `!city` hub (S133).
//
// The defect this covers is not a wrong answer — it is **no answer**. S122
// removed `city` as an alias of `crime` and reserved the name "for the hub when
// it exists"; nothing built the hub, M26.3 was closed as COMPLETE two sessions
// later, and because the router drops an unknown command silently
// (`router.js`: `if (!command) return`), `!city` did nothing at all for eleven
// sessions. Nothing failed. Nothing logged. The owner found it.
//
// So the first test here is the one that would have caught it: `!city` resolves
// to a registered command. It goes through the LOADER, not an import of
// `city.js`, because importing the file proves the file exists and nothing
// more — the loader is what decides whether the bot has the command.
//
// Everything below that walks the navigation through the real pump, because a
// hub is nothing but navigation, and the payload builders agreeing with each
// other in isolation is exactly the class of bug M26 was about (skill 0.5.44:
// assert the rendered output, not the builders).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-city-hub-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

const { cityHub, HUB_BUTTONS } = await import('../src/modules/city/lib/hub.js');
const { hubPayload } = await import('../src/modules/city/commands/city.js');
const { discoverModules } = await import('../src/core/loader.js');
const { parseCommandLine } = await import('../src/core/prefix/parse.js');
const { dispatchCommand } = await import('../src/core/prefix/command.js');
const { fakeMessage } = await import('./fixtures/fake-message.js');
const pump = (await import('../src/modules/city/events/panel.js')).default;
const { updateCriminal } = await import('../src/modules/city/service.js');

let seq = 0;
const freshGuildId = () => `92000000000000${String((seq += 1)).padStart(4, '0')}`;

const OWNER = '4001';
const user = { id: OWNER, username: 'crook', bot: false };

const titleOf = (payload) => payload?.embeds?.[0]?.data?.title ?? payload?.embeds?.[0]?.title ?? '';
const describe = (payload) =>
  payload?.embeds?.[0]?.data?.description ?? payload?.embeds?.[0]?.description ?? '';

/** Every custom id in a payload, rows flattened. */
const idsOf = (payload) =>
  (payload.components ?? []).flatMap((row) => {
    const json = row.toJSON ? row.toJSON() : row;
    return (json.components ?? []).map((c) => c.custom_id ?? c.customId);
  });

/**
 * Press a component and return what the pump rendered.
 *
 * This is the real `execute` from `events/panel.js`, so a press that no handler
 * matches produces `null` — which is what a dead button looks like.
 */
async function press(guildId, customId, { values, presser = OWNER } = {}) {
  let rendered = null;
  const ephemeral = [];
  await pump.execute({
    customId,
    values,
    guild: { id: guildId, members: { cache: new Map() } },
    user: { id: presser, username: 'crook', bot: false },
    member: { displayName: 'Crook' },
    message: { id: `${guildId}-msg`, edit: async (p) => (rendered = p) },
    update: async (p) => {
      rendered = p;
    },
    reply: async (p) => ephemeral.push(p),
    followUp: async (p) => ephemeral.push(p),
  });
  return { rendered, ephemeral };
}

// ── the regression itself ────────────────────────────────────────────────────

test('`!city` resolves to a registered command — the eleven-session silence', async () => {
  // The loader, not an import: `commands/city.js` existing on disk is not the
  // same fact as the bot having a `!city`, and it was the second that was false.
  const registered = new Map();
  for (const mod of await discoverModules())
    for (const entry of mod.commands ?? []) {
      const def = entry.group ?? entry.command;
      for (const name of [def.name, ...(def.aliases ?? [])]) registered.set(name, mod.name);
    }

  assert.equal(registered.get('city'), 'city', '`!city` is not a command the router can find');
  assert.equal(registered.get('crime'), 'city', 'and `!crime` still is');
});

test('bare `!city` replies with a panel that has buttons', async () => {
  // The owner's report, in one assertion: "dat werkt met een panel en knoppen".
  const guildId = freshGuildId();
  const modules = await discoverModules();
  const entry = modules
    .flatMap((mod) => mod.commands ?? [])
    .find((c) => (c.group ?? c.command).name === 'city');

  const parsed = parseCommandLine('!city', '!');
  const message = fakeMessage({ guildId, authorId: OWNER, users: { [OWNER]: user } });
  const outcome = await dispatchCommand(entry.command, message, parsed.tokens, '!');

  assert.equal(outcome, 'ran');
  assert.equal(message.sent.length, 1);
  const payload = message.sent[0];
  assert.ok(payload.embeds?.length, 'no embed');
  assert.equal(idsOf(payload).length, HUB_BUTTONS.length, 'the hub rendered without its buttons');
});

// ── the pure hub ─────────────────────────────────────────────────────────────

const hub = (over = {}) =>
  cityHub({ criminal: { streak: 0, highest: 0, stats: {} }, balance: 500, jail: { jailed: false }, ...over });

test('a criminal with no record is told so, rather than shown three zeroes', () => {
  assert.match(describe({ embeds: [{ description: hub().lines.join('\n') }] }), /never pulled a job/);
});

test('a record replaces the clean line once there is one', () => {
  const lines = hub({ criminal: { streak: 0, highest: 0, stats: { successes: 3, failures: 1 } } }).lines.join('\n');
  assert.match(lines, /3 clean · 1 busted/);
  assert.doesNotMatch(lines, /never pulled a job/);
});

test('the best streak is only mentioned when it beats the current one', () => {
  // "Streak: 4 in a row (best 4)" reads like two different numbers that happen
  // to agree; the parenthetical is only information when it is bigger.
  const equal = hub({ criminal: { streak: 4, highest: 4, stats: {} } }).lines.join('\n');
  assert.match(equal, /\*\*Streak:\*\* 4 in a row$/m);

  const better = hub({ criminal: { streak: 2, highest: 9, stats: {} } }).lines.join('\n');
  assert.match(better, /2 in a row \(best 9\)/);
});

test('jail says WHEN you are out and where the exit is, because the exit is behind Jobs', () => {
  // S134: a Discord timestamp of the release moment, not a rendered duration.
  // The epoch is asserted, not just the shape — `<t:NaN:R>` matches /<t:.*:R>/
  // happily and renders as 1970.
  const NOW = 1_700_000_000_000;
  const view = hub({ jail: { jailed: true, releaseAt: NOW + 45 * 60_000 }, now: NOW });
  assert.equal(view.jailed, true);
  const lines = view.lines.join('\n');
  assert.match(lines, new RegExp(`out <t:${Math.floor((NOW + 45 * 60_000) / 1000)}:R>`));
  assert.match(lines, /jobs board/i, 'a jailed player is told nothing about how to get out');
});

test('the hub falls back to remainingMs when the caller has no releaseAt', () => {
  // `jailState` always supplies `releaseAt`, but a caller that only knows how
  // much time is left must not render `<t:NaN:R>` — which shows as 1970 and
  // still matches any regex looking for a timestamp.
  const NOW = 1_700_000_000_000;
  const lines = hub({ jail: { jailed: true, remainingMs: 10 * 60_000 }, now: NOW }).lines.join('\n');
  assert.match(lines, new RegExp(`<t:${Math.floor((NOW + 10 * 60_000) / 1000)}:R>`));
  assert.doesNotMatch(lines, /NaN/);
});

test('the hub keeps its full button set in jail — the way out is one of them', () => {
  assert.deepEqual(
    hub({ jail: { jailed: true, remainingMs: 1000 } }).buttons.map((b) => b.id),
    HUB_BUTTONS.map((b) => b.id),
  );
});

test('a blank line separates where you stand from what to do next', () => {
  // `filter(Boolean)` drops '' along with the nulls, so the separator this
  // layout is built around silently vanished. Found by mutation testing, not
  // by reading the code.
  assert.ok(hub().lines.includes(''), 'the blank separator is being filtered out with the nulls');
  assert.ok(
    hub({ jail: { jailed: true, remainingMs: 1000 } }).lines.includes(''),
    'and it must survive in the jail view too',
  );
});

test('the hub reads short — the owner has twice said these screens are too long', () => {
  const long = hub({
    criminal: { streak: 7, highest: 12, stats: { successes: 40, failures: 9 } },
    jail: { jailed: true, remainingMs: 3 * 3600_000 },
  });
  assert.ok(long.lines.length <= 6, `hub grew to ${long.lines.length} lines`);
});

// ── the wiring ───────────────────────────────────────────────────────────────

test('every hub button is an action the pump actually handles', async () => {
  // The guard `city-panel.test.js` puts on the crime panel, applied to the hub.
  // A button whose action nobody matches renders, presses, and does nothing.
  const guildId = freshGuildId();
  for (const button of HUB_BUTTONS) {
    const { rendered } = await press(guildId, `cty:${button.id}:${OWNER}`, { values: ['earned'] });
    assert.ok(rendered, `cty:${button.id} is a dead button — the pump has no handler`);
  }
});

test('the crime panel offers a way back to the hub, in a cell and out of it', async () => {
  const guildId = freshGuildId();
  const street = await press(guildId, `cty:crime:${OWNER}`);
  assert.ok(idsOf(street.rendered).includes(`cty:hub:${OWNER}`), 'no way back from the jobs board');

  updateCriminal(guildId, OWNER, (c) => {
    c.jailMs = 3600_000;
    c.jailStartedAt = Date.now();
    return c;
  });
  const cell = await press(guildId, `cty:refresh:${OWNER}`);
  assert.match(titleOf(cell.rendered), /Behind bars/);
  assert.ok(idsOf(cell.rendered).includes(`cty:hub:${OWNER}`), 'no way back from a cell');
});

test('no row exceeds the five components Discord allows', async () => {
  // Jail's set went from four to five in S133. The next button added to it
  // would be silently dropped by the API, so the limit is pinned here.
  const guildId = freshGuildId();
  updateCriminal(guildId, OWNER, (c) => {
    c.jailMs = 3600_000;
    c.jailStartedAt = Date.now();
    return c;
  });
  for (const id of [`cty:hub:${OWNER}`, `cty:refresh:${OWNER}`]) {
    const { rendered } = await press(guildId, id);
    for (const row of rendered.components) {
      const json = row.toJSON ? row.toJSON() : row;
      assert.ok(json.components.length <= 5, `${id} rendered a row of ${json.components.length}`);
    }
  }
});

// ── Back goes where you came from ────────────────────────────────────────────

test('Back from a hub-opened market returns to the hub, not to the jobs board', async () => {
  // Before S133 the market's Back was hard-coded to `cty:refresh`, so opening
  // it from the hub dropped the player on a screen they had never been on.
  const guildId = freshGuildId();
  const market = await press(guildId, `cty:market:hub:${OWNER}`);
  assert.match(titleOf(market.rendered), /black market/i);
  assert.ok(idsOf(market.rendered).includes(`cty:hub:${OWNER}`), 'Back does not lead to the hub');

  const back = await press(guildId, `cty:hub:${OWNER}`);
  assert.match(titleOf(back.rendered), /The streets/);
});

test('Back from a jobs-board-opened market still returns to the jobs board', async () => {
  const guildId = freshGuildId();
  const market = await press(guildId, `cty:market:${OWNER}`);
  assert.ok(idsOf(market.rendered).includes(`cty:refresh:${OWNER}`), 'the default origin regressed');
});

test('the origin survives switching leaderboard category and buying an item', async () => {
  // Both re-render their own view, and a Back button that changes meaning
  // halfway through a visit is worse than one that is always wrong.
  //
  // Pressing the id the PREVIOUS render produced is the whole point: the Back
  // button on one render is computed from the incoming id, so a select that
  // drops the origin looks correct for exactly one press and then forgets. A
  // mutation dropping `${back}` from these two ids survived a version of this
  // test that only read the Back button.
  const guildId = freshGuildId();

  let board = await press(guildId, `cty:board:hub:${OWNER}`, { values: ['earned'] });
  for (const category of ['successes', 'finesPaid', 'streak']) {
    const selector = idsOf(board.rendered).find((id) => id.startsWith('cty:board-cat:'));
    assert.ok(selector, 'the board rendered without its category switcher');
    board = await press(guildId, selector, { values: [category] });
    assert.match(titleOf(board.rendered), /Most wanted/);
    assert.ok(
      idsOf(board.rendered).includes(`cty:hub:${OWNER}`),
      `switching to ${category} lost the origin`,
    );
  }

  let market = await press(guildId, `cty:market:hub:${OWNER}`);
  for (let i = 0; i < 2; i += 1) {
    const buy = idsOf(market.rendered).find((id) => id.startsWith('cty:buy:'));
    assert.ok(buy, 'the market rendered without its buy menu');
    market = await press(guildId, buy, { values: ['jail_pass'] });
    assert.ok(idsOf(market.rendered).includes(`cty:hub:${OWNER}`), `buy #${i + 1} lost the origin`);
  }
});

test('the record card is the same card `!crime stats` prints, plus a Back', async () => {
  // One card, two entry points. A panel view that drifts from the command it
  // replaced is precisely the M26 complaint, so they share a builder and this
  // pins that they still do.
  const guildId = freshGuildId();
  const { recordPayload } = await import('../src/modules/city/commands/crime.js');
  const standalone = recordPayload({ id: guildId }, user);
  const inPanel = (await press(guildId, `cty:record:${OWNER}`)).rendered;

  // The WHOLE embed, not just the description: a footer, colour or title that
  // differs between the two entry points is the same class of drift, and
  // comparing descriptions alone let a `.setFooter()` mutation survive.
  const embed = (p) => JSON.parse(JSON.stringify(p.embeds[0]));
  assert.deepEqual(embed(inPanel), embed(standalone));
  assert.match(describe(standalone), /Jobs pulled:/, 'the card rendered empty — this proves nothing');
  assert.deepEqual(standalone.components, [], 'the standalone card has nowhere to go back to');
  assert.ok(idsOf(inPanel).includes(`cty:hub:${OWNER}`), 'the panel card has no way back');
});

// ── the non-originator rule (S98) ────────────────────────────────────────────

test('a stranger pressing the hub is pointed at their own, and changes nothing', async () => {
  const guildId = freshGuildId();
  const { rendered, ephemeral } = await press(guildId, `cty:hub:${OWNER}`, { presser: '9999' });
  assert.equal(rendered, null, "a stranger's press redrew the owner's board");
  assert.match(ephemeral[0].content, /!city/, 'the pointer must name the command that gets them their own');
});

// ── the manual ───────────────────────────────────────────────────────────────

test('the city manual documents `!city`', () => {
  // The manual's command table is a hand-maintained list of command names, and
  // it already rotted once here: it kept claiming `!city` for two sessions
  // after S122 deleted it. Now it must claim it because the command is back.
  const manual = readFileSync(
    path.join(path.resolve(fileURLToPath(new URL('..', import.meta.url))), 'docs', 'modules', 'city.md'),
    'utf8',
  );
  assert.match(manual, /^\| `!city`/m, 'the command table has no `!city` row');
});
