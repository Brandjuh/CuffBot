// The Classic mafia engine (S105 = M24.1a). Every test plays a real game to a
// real conclusion with an injected `random` and `now` — no gateway, no timers,
// and nothing that waits. A multi-hour game runs here in under a millisecond,
// which is the only reason it can be tested at all.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLASSIC_CORE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MODES,
  ROLES,
  SIDES,
  dealRoles,
  isMafia,
  roleOf,
  shuffle,
  sideOf,
} from '../src/modules/mafia/lib/roles.js';
import { PermissionFlagsBits } from 'discord.js';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  PHASES,
  aliveMafia,
  aliveNeutrals,
  alivePlayers,
  aliveVillagers,
  castJudgement,
  castVote,
  checkWinner,
  closeJudgement,
  closeVoting,
  createGame,
  joinGame,
  leaveGame,
  openVoting,
  pendingActors,
  personalWinners,
  playerOf,
  resolveNight,
  spoiler,
  targetCountFor,
  voteWeightOf,
  startGame,
  submitNightAction,
  voteTally,
} from '../src/modules/mafia/lib/game.js';
import {
  actionPromptFor,
  buttonId,
  componentsFor,
  dayEmbed,
  endEmbed,
  nightEmbed,
  parseButtonId,
  rolesEmbed,
  rolesUsedBy,
  targetsFor,
} from '../src/modules/mafia/lib/render.js';
import { DEFAULT_MAFIA_CONFIG, humanizeMs, phaseLengthOf } from '../src/modules/mafia/lib/config.js';
import { getStats, recordResult, resetStats } from '../src/modules/mafia/service.js';
import mafiaCommand from '../src/modules/mafia/commands/mafia.js';

const STATS_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-mafia-'));
after(() => rmSync(STATS_DIR, { recursive: true, force: true }));

/** A deterministic source: cycles a fixed list, so every deal is pinned. */
const seeded = (values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

const HOST = 'p1';
const ids = (n) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

/** A lobby of `n` players, host first. */
function lobby(n) {
  let game = createGame(HOST);
  for (const id of ids(n).slice(1)) game = joinGame(game, id).game;
  return game;
}

/** A started game whose roles are FORCED, so tests name people by role. */
function started(n, assignment) {
  const begun = startGame(lobby(n), { random: () => 0 });
  assert.equal(begun.ok, true);
  const game = begun.game;
  if (!assignment) return game;
  return {
    ...game,
    players: game.players.map((p) => ({ ...p, roleId: assignment[p.id] ?? 'villager' })),
  };
}

/** The standard five-hand used across the phase tests. */
const FIVE = { p1: 'godfather', p2: 'doctor', p3: 'detective', p4: 'villager', p5: 'villager' };

// ── roles ────────────────────────────────────────────────────────────────────

test('every role card declares a side, and the sides are the cog’s', () => {
  // S108 took the roster from 4 to 13 (Classic + the Crazy/Chaos tier).
  assert.equal(Object.keys(ROLES).length, 13);
  for (const id of ['godfather', 'mafia', 'framer']) assert.equal(ROLES[id].side, SIDES.MAFIA, id);
  for (const id of ['doctor', 'detective', 'villager', 'vigilante', 'mayor', 'spy', 'investigator', 'distractor']) {
    assert.equal(ROLES[id].side, SIDES.VILLAGERS, id);
  }
  for (const id of ['executioner', 'jester']) assert.equal(ROLES[id].side, SIDES.NEUTRAL, id);
  assert.equal(ROLES.villager.night, null, 'an Officer sleeps');
  assert.deepEqual(
    ['godfather', 'doctor', 'detective'].map((id) => ROLES[id].night),
    ['kill', 'protect', 'investigate'],
  );
  assert.equal(isMafia('godfather'), true);
  assert.equal(isMafia('detective'), false);
  assert.equal(roleOf('nonsense'), null);
  assert.deepEqual(CLASSIC_CORE, ['godfather', 'detective', 'doctor']);
});

test('a Classic deal is always the three core roles plus Officers, exactly one mafia', () => {
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n += 1) {
    const roles = dealRoles(n, 'classic', seeded([0.1, 0.9, 0.5, 0.3, 0.7]));
    assert.equal(roles.length, n, `${n} players`);
    for (const core of CLASSIC_CORE) {
      assert.equal(roles.filter((r) => r === core).length, 1, `${n}: one ${core}`);
    }
    assert.equal(roles.filter(isMafia).length, 1, `${n}: Classic is a one-mafia game at every size`);
    assert.equal(roles.filter((r) => r === 'villager').length, n - 3);
  }
});

test('a deal is refused outside the table sizes it works at', () => {
  assert.throws(() => dealRoles(MIN_PLAYERS - 1), /at least 5/);
  assert.throws(() => dealRoles(8, 'nonsense'), /Unknown mode/);
  assert.throws(() => dealRoles(MAX_PLAYERS + 1), /tops out at 20/);
  assert.throws(() => dealRoles(7.5), /at least 5/);
});

test('the shuffle is a real shuffle and never loses or duplicates a card', () => {
  const input = ['a', 'b', 'c', 'd', 'e'];
  const out = shuffle(input, seeded([0.9, 0.1, 0.7, 0.3]));
  assert.deepEqual([...out].sort(), [...input].sort(), 'same multiset');
  assert.deepEqual(input, ['a', 'b', 'c', 'd', 'e'], 'the input is untouched');
  // A fixed source gives a fixed permutation — that is what makes deals testable.
  assert.deepEqual(shuffle(input, seeded([0.9, 0.1, 0.7, 0.3])), out);
});

// ── the lobby ────────────────────────────────────────────────────────────────

test('a lobby fills, refuses duplicates, and will not start short-handed', () => {
  let game = createGame(HOST, { now: 5 });
  assert.equal(game.phase, PHASES.LOBBY);
  assert.equal(game.players.length, 1, 'the host is in');
  assert.equal(game.createdAt, 5);

  assert.equal(joinGame(game, HOST).reason, 'already-in');
  game = joinGame(game, 'p2').game;
  assert.equal(startGame(game).reason, 'too-few', '2 is not 5');

  for (const id of ['p3', 'p4', 'p5']) game = joinGame(game, id).game;
  const begun = startGame(game, { random: () => 0, now: 99 });
  assert.equal(begun.ok, true);
  assert.equal(begun.game.phase, PHASES.NIGHT, 'the game opens on night 1, not a blind day');
  assert.equal(begun.game.day, 1);
  assert.equal(begun.game.startedAt, 99);
  assert.equal(begun.game.players.every((p) => p.roleId !== null), true);
  assert.equal(startGame(begun.game).reason, 'started', 'and cannot be started twice');
  assert.equal(joinGame(begun.game, 'p9').reason, 'started');
});

test('a player may leave the lobby, but the host leaving is refused', () => {
  const game = lobby(5);
  assert.equal(leaveGame(game, 'p3').game.players.length, 4);
  assert.equal(leaveGame(game, 'nobody').reason, 'not-in');
  // Silently promoting a random member is a worse surprise than a refusal.
  assert.equal(leaveGame(game, HOST).reason, 'host');
  assert.equal(leaveGame(started(5, FIVE), 'p3').reason, 'started');
});

// ── night ────────────────────────────────────────────────────────────────────

test('only the three acting roles are waited on, and only until they act', () => {
  const game = started(5, FIVE);
  assert.deepEqual(pendingActors(game).sort(), ['p1', 'p2', 'p3'], 'Officers are not waited for');
  const acted = submitNightAction(game, 'p1', 'p4').game;
  assert.deepEqual(pendingActors(acted).sort(), ['p2', 'p3']);
  assert.deepEqual(pendingActors({ ...game, phase: PHASES.DAY }), []);
});

test('every night-action refusal is a rule, not a guard', () => {
  const game = started(5, FIVE);
  assert.equal(submitNightAction(game, 'p4', 'p1').reason, 'no-action', 'an Officer has none');
  assert.equal(submitNightAction(game, 'p1', 'p1').reason, 'no-self-kill');
  assert.equal(submitNightAction(game, 'p2', 'p2').ok, true, 'but the medic MAY cover themselves');
  assert.equal(submitNightAction(game, 'p1', 'ghost').reason, 'target-dead');
  assert.equal(submitNightAction({ ...game, phase: PHASES.DAY }, 'p1', 'p4').reason, 'not-night');

  const dead = { ...game, players: game.players.map((p) => (p.id === 'p1' ? { ...p, alive: false } : p)) };
  assert.equal(submitNightAction(dead, 'p1', 'p4').reason, 'dead');
});

test('the medic cannot cover the same person two nights running', () => {
  let game = started(6, { ...FIVE, p6: 'villager' });
  game = submitNightAction(game, 'p2', 'p4').game;
  game = submitNightAction(game, 'p1', 'p6').game;
  game = resolveNight(game).game;
  assert.equal(playerOf(game, 'p2').lastProtected, 'p4', 'the medic remembers');

  game = openVoting(game).game;
  game = closeVoting(game).game; // nobody voted → straight to night 2
  assert.equal(game.phase, PHASES.NIGHT);
  // Without this the medic parks on one officer and the night stops being a choice.
  assert.equal(submitNightAction(game, 'p2', 'p4').reason, 'repeat-protect');
  assert.equal(submitNightAction(game, 'p2', 'p5').ok, true);
});

test('a night resolves protection before the attack, so a right guess saves', () => {
  let game = started(5, FIVE);
  game = submitNightAction(game, 'p1', 'p4').game; // Boss shoots p4
  game = submitNightAction(game, 'p2', 'p4').game; // medic covers p4
  const { game: after, events } = resolveNight(game);

  assert.equal(playerOf(after, 'p4').alive, true, 'saved');
  assert.deepEqual(events.filter((e) => e.type === 'saved'), [{ type: 'saved', targetId: 'p4' }]);
  assert.equal(events.some((e) => e.type === 'killed'), false);
  assert.equal(after.phase, PHASES.DAY);
  assert.deepEqual(after.actions, {}, 'the night is cleared');
});

test('a wrong guess does not save, and the death is recorded with its cause', () => {
  let game = started(5, FIVE);
  game = submitNightAction(game, 'p1', 'p4').game;
  game = submitNightAction(game, 'p2', 'p5').game; // covered the wrong officer
  const { game: after, events } = resolveNight(game);

  const dead = playerOf(after, 'p4');
  assert.equal(dead.alive, false);
  assert.equal(dead.diedOn, 1);
  assert.equal(dead.diedTo, 'mafia');
  assert.deepEqual(events.find((e) => e.type === 'killed'), { type: 'killed', targetId: 'p4', cause: 'mafia' });
});

test('a night nobody acted on is quiet, not a crash', () => {
  const { game, events } = resolveNight(started(5, FIVE));
  assert.equal(alivePlayers(game).length, 5);
  assert.deepEqual(events, [{ type: 'quiet-night' }]);
  assert.equal(game.phase, PHASES.DAY);
});

test('an investigation is a PRIVATE event, not a change to the board', () => {
  let game = started(5, FIVE);
  game = submitNightAction(game, 'p3', 'p1').game; // detective looks at the Boss
  const { game: after, events } = resolveNight(game);

  const found = events.find((e) => e.type === 'investigation');
  assert.deepEqual(found, { type: 'investigation', to: 'p3', targetId: 'p1', mafia: true });
  // Information is the whole game: nothing about the shared state may reveal it.
  assert.equal(JSON.stringify(after).includes('investigation'), false);

  let clean = started(5, FIVE);
  clean = submitNightAction(clean, 'p3', 'p4').game;
  assert.equal(resolveNight(clean).events.find((e) => e.type === 'investigation').mafia, false);
});

// ── the vote ─────────────────────────────────────────────────────────────────

test('voting tallies, ignores abstentions, and refuses the dead', () => {
  let game = openVoting(resolveNight(started(5, FIVE)).game).game;
  assert.equal(game.phase, PHASES.VOTING);
  assert.equal(openVoting(game).reason, 'not-day');

  game = castVote(game, 'p1', 'p4').game;
  game = castVote(game, 'p2', 'p4').game;
  game = castVote(game, 'p3', null).game; // an explicit abstention
  assert.deepEqual(voteTally(game), { p4: 2 }, 'abstentions are recorded but not counted');
  assert.equal(game.votes.p3, null, 'and "everyone declined" is not "nobody voted"');

  // A vote replaces the voter's previous one rather than stacking.
  game = castVote(game, 'p1', 'p5').game;
  assert.deepEqual(voteTally(game), { p4: 1, p5: 1 });

  assert.equal(castVote(game, 'p1', 'ghost').reason, 'target-dead');
  const withDead = { ...game, players: game.players.map((p) => (p.id === 'p2' ? { ...p, alive: false } : p)) };
  assert.equal(castVote(withDead, 'p2', 'p4').reason, 'dead');
});

test('a plurality goes to trial; a TIE puts nobody on trial', () => {
  const day = resolveNight(started(5, FIVE)).game;
  let game = openVoting(day).game;
  game = castVote(game, 'p1', 'p4').game;
  game = castVote(game, 'p2', 'p5').game;
  // Breaking a tie by coin flip would execute someone the room did not choose.
  const tied = closeVoting(game);
  assert.equal(tied.accusedId, null);
  assert.equal(tied.game.phase, PHASES.NIGHT, 'straight to the next night');
  assert.equal(tied.game.day, 2);

  let clear = openVoting(day).game;
  clear = castVote(clear, 'p1', 'p4').game;
  clear = castVote(clear, 'p2', 'p4').game;
  clear = castVote(clear, 'p3', 'p5').game;
  const trial = closeVoting(clear);
  assert.equal(trial.accusedId, 'p4');
  assert.equal(trial.game.phase, PHASES.JUDGEMENT);
  assert.deepEqual(trial.tally, { p4: 2, p5: 1 });
});

test('a vote where everyone abstains sends the town to bed', () => {
  let game = openVoting(resolveNight(started(5, FIVE)).game).game;
  for (const id of ids(5)) game = castVote(game, id, null).game;
  const closed = closeVoting(game);
  assert.equal(closed.accusedId, null);
  assert.equal(closed.game.phase, PHASES.NIGHT);
});

// ── judgement ────────────────────────────────────────────────────────────────

/** Drive a five-hand to a trial of `accused`. */
function trialOf(accused, assignment = FIVE) {
  let game = openVoting(resolveNight(started(5, assignment)).game).game;
  for (const id of ids(5).filter((i) => i !== accused)) game = castVote(game, id, accused).game;
  const closed = closeVoting(game);
  assert.equal(closed.accusedId, accused);
  return closed.game;
}

test('the accused gets no say, and a tie acquits', () => {
  let game = trialOf('p4');
  assert.equal(castJudgement(game, 'p4', 'guilty').reason, 'accused');
  assert.equal(castJudgement(game, 'p1', 'maybe').reason, 'bad-verdict');
  assert.equal(castJudgement({ ...game, phase: PHASES.DAY }, 'p1', 'guilty').reason, 'not-judgement');

  game = castJudgement(game, 'p1', 'guilty').game;
  game = castJudgement(game, 'p2', 'innocent').game;
  // A town that cannot agree to execute someone has not agreed to execute them.
  const tied = closeJudgement(game);
  assert.equal(tied.guilty, false);
  assert.deepEqual(tied.counts, { guilty: 1, innocent: 1 });
  assert.equal(playerOf(tied.game, 'p4').alive, true);
  assert.equal(tied.game.phase, PHASES.NIGHT, 'and the night comes anyway');
  assert.equal(tied.game.accusedId, null);
});

test('a guilty verdict lynches, and the cause of death says so', () => {
  let game = trialOf('p4');
  game = castJudgement(game, 'p1', 'guilty').game;
  game = castJudgement(game, 'p2', 'guilty').game;
  game = castJudgement(game, 'p3', 'innocent').game;
  const done = closeJudgement(game);

  assert.equal(done.guilty, true);
  const dead = playerOf(done.game, 'p4');
  assert.equal(dead.alive, false);
  assert.equal(dead.diedTo, 'lynch');
  assert.equal(dead.diedOn, 1);
});

// ── winning ──────────────────────────────────────────────────────────────────

test('villagers win the moment the last mafia is gone', () => {
  const game = started(5, FIVE);
  assert.equal(checkWinner(game), null, '1 mafia vs 4 officers is a live game');
  const lynched = { ...game, players: game.players.map((p) => (p.id === 'p1' ? { ...p, alive: false } : p)) };
  assert.equal(checkWinner(lynched), 'villagers');
});

test('mafia win at PARITY, not at extinction', () => {
  const game = started(5, FIVE);
  const kill = (state, ...who) => ({
    ...state,
    players: state.players.map((p) => (who.includes(p.id) ? { ...p, alive: false } : p)),
  });
  assert.equal(checkWinner(kill(game, 'p4')), null, '1 v 3');
  assert.equal(checkWinner(kill(game, 'p4', 'p5')), null, '1 v 2');
  // At 1 v 1 the Boss can no longer be out-voted, so playing it out changes nothing.
  const parity = kill(game, 'p4', 'p5', 'p3');
  assert.equal(aliveMafia(parity).length, 1);
  assert.equal(aliveVillagers(parity).length, 1);
  assert.equal(checkWinner(parity), 'mafia');
});

test('the game ends itself the instant a night or a lynch decides it', () => {
  // Night that reaches parity: 1 v 2 becomes 1 v 1.
  let game = started(5, FIVE);
  game = { ...game, players: game.players.map((p) => (['p4', 'p5'].includes(p.id) ? { ...p, alive: false } : p)) };
  game = submitNightAction(game, 'p1', 'p3').game;
  const night = resolveNight(game);
  assert.equal(night.game.phase, PHASES.OVER);
  assert.equal(night.game.winner, 'mafia');
  assert.equal(night.events.some((e) => e.type === 'killed'), true, 'and the kill is still reported');

  // Lynching the Boss ends it the other way, without opening a night.
  let trial = trialOf('p1');
  for (const id of ['p2', 'p3', 'p4']) trial = castJudgement(trial, id, 'guilty').game;
  const verdict = closeJudgement(trial);
  assert.equal(verdict.game.phase, PHASES.OVER);
  assert.equal(verdict.game.winner, 'villagers');
});

test('a full game plays end to end and reveals every role', () => {
  // Night 1: the Boss shoots an officer, the medic guesses wrong.
  let game = started(5, FIVE);
  game = submitNightAction(game, 'p1', 'p5').game;
  game = submitNightAction(game, 'p2', 'p4').game;
  game = submitNightAction(game, 'p3', 'p1').game; // the detective is right
  const night1 = resolveNight(game);
  assert.equal(night1.events.find((e) => e.type === 'investigation').mafia, true);
  game = night1.game;
  assert.equal(alivePlayers(game).length, 4);

  // Day 1: the detective says so and the town listens.
  game = openVoting(game).game;
  for (const id of ['p2', 'p3', 'p4']) game = castVote(game, id, 'p1').game;
  const closed = closeVoting(game);
  assert.equal(closed.accusedId, 'p1');
  game = closed.game;
  for (const id of ['p2', 'p3', 'p4']) game = castJudgement(game, id, 'guilty').game;
  const end = closeJudgement(game);

  assert.equal(end.game.phase, PHASES.OVER);
  assert.equal(end.game.winner, 'villagers');
  const reveal = spoiler(end.game);
  assert.equal(reveal.length, 5, 'everyone is named at the end, alive or not');
  assert.deepEqual(
    reveal.find((r) => r.id === 'p1'),
    { id: 'p1', roleId: 'godfather', alive: false, diedTo: 'lynch', wonAs: null },
  );
  assert.equal(reveal.find((r) => r.id === 'p5').diedTo, 'mafia');
});

test('a finished game refuses every further move', () => {
  const over = { ...started(5, FIVE), phase: PHASES.OVER, winner: 'villagers' };
  assert.equal(submitNightAction(over, 'p1', 'p4').reason, 'not-night');
  assert.equal(castVote(over, 'p1', 'p4').reason, 'not-voting');
  assert.equal(castJudgement(over, 'p1', 'guilty').reason, 'not-judgement');
  assert.equal(openVoting(over).reason, 'not-day');
  assert.deepEqual(resolveNight(over).events, []);
  assert.equal(closeVoting(over).accusedId, null);
  assert.equal(closeJudgement(over).guilty, false);
});

// ── presentation and the command surface ─────────────────────────────────────

test('a button id round-trips, and a foreign one is ignored', () => {
  assert.equal(buttonId('join', 'g1'), 'mf:join:g1');
  assert.equal(buttonId('target', 'g1', 'p3'), 'mf:target:g1:p3');
  assert.deepEqual(parseButtonId('mf:join:g1'), { action: 'join', gameId: 'g1', extra: null });
  assert.deepEqual(parseButtonId('mf:target:g1:p3'), { action: 'target', gameId: 'g1', extra: 'p3' });
  // Another module's buttons must fall straight through this pump.
  assert.equal(parseButtonId('c4:a:g1'), null);
  assert.equal(parseButtonId('help:games:u1'), null);
  assert.equal(parseButtonId(undefined), null);
});

test('the buttons offered match the phase, and a finished game offers none', () => {
  const at = (phase) => componentsFor({ ...started(5, FIVE), phase }).map((b) => b.action);
  assert.deepEqual(at(PHASES.LOBBY), ['join', 'leave', 'begin']);
  assert.deepEqual(at(PHASES.NIGHT), ['act']);
  assert.deepEqual(at(PHASES.DAY), [], 'the day is for talking, not pressing');
  assert.deepEqual(at(PHASES.VOTING), ['vote']);
  assert.deepEqual(at(PHASES.JUDGEMENT), ['guilty', 'innocent']);
  assert.deepEqual(at(PHASES.OVER), []);
});

test('the night card never says WHO is acting, only how many are left', () => {
  let game = started(5, FIVE);
  game = submitNightAction(game, 'p1', 'p4').game;
  const card = JSON.stringify(nightEmbed(game, { remainingMs: 60_000, waitingCount: 2 }));
  assert.match(card, /Night 1/);
  assert.match(card, /Waiting on \*\*2\*\*/);
  // Leaking the actor or the target would end the game on the spot.
  assert.equal(card.includes('p1'), false);
  assert.equal(card.includes('p4'), false);
});

test('a save is announced without naming who was saved', () => {
  let game = started(5, FIVE);
  game = submitNightAction(game, 'p1', 'p4').game;
  game = submitNightAction(game, 'p2', 'p4').game;
  const { game: day, events } = resolveNight(game);
  const card = JSON.stringify(dayEmbed(day, events, { remainingMs: 1000, nameOf: (id) => id }));
  assert.match(card, /Somebody walked away/);
  // The medic's whole value is that the Boss cannot tell where the cover went.
  assert.equal(/saved.*p4|p4.*was saved/i.test(card), false);
});

test('a death names the victim AND their card — the town has earned that', () => {
  let game = started(5, FIVE);
  game = submitNightAction(game, 'p1', 'p3').game;
  const { game: day, events } = resolveNight(game);
  const card = JSON.stringify(dayEmbed(day, events, { remainingMs: 1000, nameOf: (id) => `name-${id}` }));
  assert.match(card, /name-p3 did not make it/);
  assert.match(card, /The Detective/);
});

test('the action prompt refuses everyone it should, in words', () => {
  const game = started(5, FIVE);
  assert.equal(actionPromptFor(game, 'p4').ok, false, 'an Officer sleeps');
  assert.match(actionPromptFor(game, 'p4').text, /sleep tonight/);
  assert.equal(actionPromptFor(game, 'nobody').ok, false);
  assert.equal(actionPromptFor(game, 'p1').ok, true);
  assert.match(actionPromptFor(game, 'p1').text, /Who dies tonight/);
  assert.match(actionPromptFor(game, 'p2').text, /Who do you cover/);
  assert.match(actionPromptFor(game, 'p3').text, /Who do you look into/);

  const acted = submitNightAction(game, 'p1', 'p4').game;
  assert.match(actionPromptFor(acted, 'p1').text, /already acted/);

  const dead = { ...game, players: game.players.map((p) => (p.id === 'p3' ? { ...p, alive: false } : p)) };
  assert.match(actionPromptFor(dead, 'p3').text, /dead do not act/);
});

test('the target list obeys the same rules the engine does', () => {
  const game = started(5, FIVE);
  assert.equal(targetsFor(game, 'p1').includes('p1'), false, 'the Boss is not on his own list');
  assert.equal(targetsFor(game, 'p2').includes('p2'), true, 'the medic may cover themselves');
  assert.deepEqual(targetsFor(game, 'p4'), [], 'an Officer has no list at all');

  const covered = { ...game, players: game.players.map((p) => (p.id === 'p2' ? { ...p, lastProtected: 'p5' } : p)) };
  assert.equal(targetsFor(covered, 'p2').includes('p5'), false, 'and cannot repeat last night');
});

test('the end card reveals every card and every fate', () => {
  let game = started(5, FIVE);
  game = {
    ...game,
    phase: PHASES.OVER,
    winner: 'villagers',
    players: game.players.map((p) =>
      p.id === 'p1' ? { ...p, alive: false, diedTo: 'lynch' } : p.id === 'p5' ? { ...p, alive: false, diedTo: 'mafia' } : p,
    ),
  };
  const card = JSON.stringify(endEmbed(game, { nameOf: (id) => id }));
  assert.match(card, /precinct wins/);
  for (const id of ids(5)) assert.match(card, new RegExp(id), `${id} is named`);
  assert.match(card, /voted out/);
  assert.match(card, /killed at night/);
  assert.match(card, /survived/);
});

test('the roles card explains every card in the chosen mode', () => {
  const classic = rolesEmbed('classic');
  assert.equal(classic.fields.length, 4, 'Classic deals four cards');
  const chaos = rolesEmbed('chaos');
  assert.ok(chaos.fields.length > classic.fields.length, 'Chaos deals more');
  for (const id of ['vigilante', 'mayor', 'executioner']) {
    assert.ok(chaos.fields.some((f) => f.name.includes(ROLES[id].name)), id);
  }
});

test('phase lengths are configurable and read back as words', () => {
  assert.equal(phaseLengthOf('night'), DEFAULT_MAFIA_CONFIG.nightMs);
  assert.equal(phaseLengthOf('night', { nightMs: 30_000 }), 30_000);
  assert.equal(phaseLengthOf('over'), null, 'a finished game has no deadline');
  assert.equal(humanizeMs(45_000), '45s');
  assert.equal(humanizeMs(120_000), '2m');
  assert.equal(humanizeMs(150_000), '2m 30s');
});

test('the group is shaped the way the loader and the roster expect', () => {
  const subs = mafiaCommand.group.subcommands;
  assert.deepEqual(
    subs.map((s) => s.name),
    ['start', 'end', 'roles', 'stats', 'board', 'modes', 'timings', 'reset'],
  );
  assert.equal(mafiaCommand.group.fallback, 'start');
  assert.ok(subs.some((s) => s.name === mafiaCommand.group.fallback), 'the fallback exists');
  const gated = subs.filter((s) => s.permission).map((s) => s.name);
  assert.deepEqual(gated, ['timings', 'reset'], 'playing is open; the knobs are not');
  for (const sub of subs.filter((s) => s.permission)) {
    assert.equal(sub.permission, PermissionFlagsBits.ManageGuild, sub.name);
  }
});

test('stats count games, wins and the role you played them as', () => {
  const guildId = `50000000000000${String(Date.now() % 10000).padStart(4, '0')}`;
  process.env.CUFFBOT_DATA_DIR = STATS_DIR;
  const game = { ...started(5, FIVE), winner: 'villagers' };
  recordResult(guildId, game);
  recordResult(guildId, { ...game, winner: 'mafia' });

  const stats = getStats(guildId);
  // p1 is the Boss: one loss, then one win.
  assert.deepEqual(stats.p1, { games: 2, wins: 1, roles: { godfather: { games: 2, wins: 1 } } });
  // p3 is the detective: the mirror image.
  assert.deepEqual(stats.p3, { games: 2, wins: 1, roles: { detective: { games: 2, wins: 1 } } });
  resetStats(guildId);
  assert.deepEqual(getStats(guildId), {});
});

// ════════════════════════════════════════════════════════════════════════════
// S108 (M24.2): the second role tier, the modes, and ordered night resolution.
// ════════════════════════════════════════════════════════════════════════════

/** A started game in `mode` whose roles are FORCED, so tests name people by card. */
function table(assignment, { mode = 'chaos' } = {}) {
  const n = Object.keys(assignment).length;
  let game = createGame(HOST, { mode });
  for (const id of ids(n).slice(1)) game = joinGame(game, id).game;
  const begun = startGame(game, { random: () => 0 });
  assert.equal(begun.ok, true);
  return {
    ...begun.game,
    players: begun.game.players.map((p) => ({ ...p, roleId: assignment[p.id], targetId: null })),
  };
}

/** Submit a whole night at once and resolve it. */
function night(game, actions) {
  let next = game;
  for (const [actor, target] of Object.entries(actions)) {
    const step = submitNightAction(next, actor, target);
    assert.equal(step.ok, true, `${actor} → ${JSON.stringify(target)}: ${step.reason}`);
    next = step.game;
  }
  return resolveNight(next);
}

// ── the modes ────────────────────────────────────────────────────────────────

test('every mode deals a legal hand at every table size', () => {
  for (const mode of Object.keys(MODES)) {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n += 1) {
      const roles = dealRoles(n, mode, seeded([0.1, 0.9, 0.42, 0.7, 0.3, 0.55]));
      assert.equal(roles.length, n, `${mode} @ ${n}`);
      // The three Classic cards are in every band of every mode.
      for (const core of CLASSIC_CORE) {
        assert.equal(roles.filter((r) => r === core).length, 1, `${mode} @ ${n}: one ${core}`);
      }
      // A Jester is never DEALT — it is only ever arrived at (the cog's flag).
      assert.equal(roles.includes('jester'), false, `${mode} @ ${n}: no dealt Jester`);
      // And nobody is dealt a card that does not exist.
      for (const r of roles) assert.ok(ROLES[r], `${mode} @ ${n}: unknown role ${r}`);
    }
  }
});

test('a mode only ever deals cards it advertises', () => {
  for (const mode of Object.values(MODES)) {
    const allowed = new Set(rolesUsedBy(mode));
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n += 1) {
      for (const seed of [() => 0, () => 0.99, seeded([0.2, 0.8, 0.5])]) {
        for (const r of dealRoles(n, mode.id, seed)) {
          assert.ok(allowed.has(r), `${mode.id} @ ${n} dealt ${r}, which its card does not list`);
        }
      }
    }
  }
});

test('the mafia never outnumbers the precinct at the deal', () => {
  // A hand that starts at parity is a game that is already over.
  for (const mode of Object.keys(MODES)) {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n += 1) {
      for (const seed of [() => 0, () => 0.99, seeded([0.3, 0.7, 0.1])]) {
        const roles = dealRoles(n, mode, seed);
        const bad = roles.filter(isMafia).length;
        assert.ok(bad < n - bad, `${mode} @ ${n}: ${bad} mafia vs ${n - bad} others`);
      }
    }
  }
});

// ── the new cards ────────────────────────────────────────────────────────────

test('the Enforcer becomes the Boss when the Boss dies', () => {
  const game = table({ p1: 'godfather', p2: 'mafia', p3: 'doctor', p4: 'detective', p5: 'villager', p6: 'villager', p7: 'villager' });
  // The Vigilante is absent, so the Boss dies to a lynch instead.
  let voting = openVoting(resolveNight(game).game).game;
  for (const id of ['p2', 'p3', 'p4', 'p5', 'p6', 'p7']) voting = castVote(voting, id, 'p1').game;
  let trial = closeVoting(voting).game;
  for (const id of ['p2', 'p3', 'p4', 'p5', 'p6']) trial = castJudgement(trial, id, 'guilty').game;
  const after = closeJudgement(trial).game;

  // Without succession the mafia would still be alive but unable to shoot.
  assert.equal(playerOf(after, 'p2').roleId, 'godfather', 'the Enforcer took over');
  assert.equal(aliveMafia(after).length, 1);
});

test('the Vigilante dies of guilt for shooting an innocent, and does not for a crook', () => {
  const cast = { p1: 'godfather', p2: 'vigilante', p3: 'doctor', p4: 'detective', p5: 'villager', p6: 'villager', p7: 'villager' };

  const wrong = night(table(cast), { p2: 'p5' });
  assert.equal(playerOf(wrong.game, 'p5').alive, false, 'the innocent dies');
  assert.equal(playerOf(wrong.game, 'p2').alive, false, 'and so does the Vigilante');
  assert.equal(playerOf(wrong.game, 'p2').diedTo, 'guilt');
  assert.ok(wrong.events.some((e) => e.type === 'vigilante-guilt'));

  const right = night(table(cast), { p2: 'p1' });
  assert.equal(playerOf(right.game, 'p1').alive, false, 'the Boss dies');
  assert.equal(playerOf(right.game, 'p2').alive, true, 'shooting a crook costs nothing');
});

test('a Vigilante shot that the medic blocks costs no guilt either', () => {
  // The shot never landed, so there is nothing to feel guilty about.
  const { game } = night(
    table({ p1: 'godfather', p2: 'vigilante', p3: 'doctor', p4: 'detective', p5: 'villager', p6: 'villager', p7: 'villager' }),
    { p2: 'p5', p3: 'p5' },
  );
  assert.equal(playerOf(game, 'p5').alive, true);
  assert.equal(playerOf(game, 'p2').alive, true);
});

test('a revealed Commissioner votes twice, in the vote AND at the trial', () => {
  const cast = { p1: 'godfather', p2: 'mayor', p3: 'doctor', p4: 'detective', p5: 'villager', p6: 'villager', p7: 'villager' };
  const { game: day } = night(table(cast), { p2: null });
  assert.equal(playerOf(day, 'p2').revealed, true);

  let voting = openVoting(day).game;
  voting = castVote(voting, 'p2', 'p1').game; // the Commissioner, worth 2
  voting = castVote(voting, 'p5', 'p6').game; // one ordinary officer
  assert.deepEqual(voteTally(voting), { p1: 2, p6: 1 });
  const closed = closeVoting(voting);
  assert.equal(closed.accusedId, 'p1', 'two beats one');

  let trial = closed.game;
  trial = castJudgement(trial, 'p2', 'guilty').game;
  trial = castJudgement(trial, 'p5', 'innocent').game;
  const verdict = closeJudgement(trial);
  assert.deepEqual(verdict.counts, { guilty: 2, innocent: 1 });
  assert.equal(verdict.guilty, true, 'the extra vote counts at the trial too');
});

test('an unrevealed Commissioner is still worth one, and reveals only once', () => {
  const cast = { p1: 'godfather', p2: 'mayor', p3: 'doctor', p4: 'detective', p5: 'villager', p6: 'villager', p7: 'villager' };
  const before = table(cast);
  assert.equal(voteWeightOf(playerOf(before, 'p2')), 1);

  const { game: day } = night(before, { p2: null });
  const next = openVoting(day).game;
  const night2 = closeVoting(next).game; // nobody voted → straight to night 2
  assert.equal(night2.phase, PHASES.NIGHT);
  // Nothing left to do, so the table must not wait for them.
  assert.equal(pendingActors(night2).includes('p2'), false);
  assert.equal(submitNightAction(night2, 'p2', null).reason, 'already-revealed');
});

test('the Framer makes an innocent read as mafia, for one night only', () => {
  const cast = { p1: 'godfather', p2: 'framer', p3: 'detective', p4: 'doctor', p5: 'villager', p6: 'villager', p7: 'villager' };
  const framed = night(table(cast), { p2: 'p5', p3: 'p5' });
  const read = framed.events.find((e) => e.type === 'investigation');
  assert.equal(read.mafia, true, 'the detective is lied to');

  // Next night, with nobody framing, the same read is honest again.
  const clean = night(table(cast), { p3: 'p5' });
  assert.equal(clean.events.find((e) => e.type === 'investigation').mafia, false);
});

test('the Tail sees WHO their target visited, never what they did', () => {
  const cast = { p1: 'godfather', p2: 'spy', p3: 'doctor', p4: 'detective', p5: 'villager', p6: 'villager', p7: 'villager' };
  const { events } = night(table(cast), { p1: 'p6', p2: 'p1', p3: 'p5' });
  const tail = events.find((e) => e.type === 'tail');
  assert.deepEqual(tail.visited, ['p6'], 'the Boss went to p6');
  // The card is a movement log, not a confession: nothing says "kill".
  assert.equal(JSON.stringify(tail).includes('kill'), false);
});

test('the Tail sees nothing when the target stayed in', () => {
  const cast = { p1: 'godfather', p2: 'spy', p3: 'doctor', p4: 'detective', p5: 'villager', p6: 'villager', p7: 'villager' };
  const { events } = night(table(cast), { p2: 'p5' }); // p5 is an Officer, who never goes out
  assert.deepEqual(events.find((e) => e.type === 'tail').visited, []);
});

test('the Private Eye compares two people and needs two DIFFERENT ones', () => {
  const cast = { p1: 'godfather', p2: 'investigator', p3: 'doctor', p4: 'detective', p5: 'villager', p6: 'villager', p7: 'villager' };
  const game = table(cast);
  assert.equal(submitNightAction(game, 'p2', 'p5').reason, 'wrong-target-count', 'one is not two');
  assert.equal(submitNightAction(game, 'p2', ['p5', 'p5']).reason, 'same-target-twice');

  const same = night(game, { p2: ['p5', 'p6'] });
  assert.equal(same.events.find((e) => e.type === 'comparison').same, true, 'two officers match');
  const differ = night(game, { p2: ['p1', 'p5'] });
  assert.equal(differ.events.find((e) => e.type === 'comparison').same, false, 'the Boss does not');
});

test('a Framer fools the Private Eye too — the frame is read by everyone', () => {
  const cast = { p1: 'godfather', p2: 'investigator', p3: 'framer', p4: 'doctor', p5: 'villager', p6: 'villager', p7: 'villager' };
  const { events } = night(table(cast), { p2: ['p1', 'p5'], p3: 'p5' });
  assert.equal(events.find((e) => e.type === 'comparison').same, true, 'a framed officer matches the Boss');
});

test('the Distraction cancels the action she interrupts — including a kill', () => {
  const cast = { p1: 'godfather', p2: 'distractor', p3: 'doctor', p4: 'detective', p5: 'villager', p6: 'villager', p7: 'villager' };
  const blocked = night(table(cast), { p1: 'p5', p2: 'p1' });
  assert.equal(playerOf(blocked.game, 'p5').alive, true, 'the Boss never got out the door');
  assert.ok(blocked.events.some((e) => e.type === 'was-blocked' && e.to === 'p1'));

  // She blocks information just as well as violence.
  const quiet = night(table(cast), { p4: 'p1', p2: 'p4' });
  assert.equal(quiet.events.some((e) => e.type === 'investigation'), false, 'the detective learned nothing');
});

test('a blocked visitor never went anywhere, so the Tail sees an empty night', () => {
  const cast = { p1: 'godfather', p2: 'spy', p3: 'distractor', p4: 'doctor', p5: 'detective', p6: 'villager', p7: 'villager' };
  // The Boss is blocked; the Tail is following the Boss.
  const { events } = night(table(cast), { p1: 'p6', p2: 'p1', p3: 'p1' });
  assert.deepEqual(events.find((e) => e.type === 'tail').visited, []);
});

// ── the neutrals ─────────────────────────────────────────────────────────────

/** Drive a table to a lynch of `accused`. */
function lynch(game, accused) {
  let voting = openVoting(resolveNight(game).game).game;
  for (const p of alivePlayers(voting).filter((x) => x.id !== accused)) {
    voting = castVote(voting, p.id, accused).game;
  }
  const closed = closeVoting(voting);
  assert.equal(closed.accusedId, accused);
  let trial = closed.game;
  for (const p of alivePlayers(trial).filter((x) => x.id !== accused)) {
    trial = castJudgement(trial, p.id, 'guilty').game;
  }
  return closeJudgement(trial);
}

test('the Executioner is marked at the deal, always on a VILLAGER, never themselves', () => {
  for (const seed of [() => 0, () => 0.4, () => 0.99, seeded([0.1, 0.6, 0.3])]) {
    let game = createGame(HOST, { mode: 'crazy' });
    for (const id of ids(8).slice(1)) game = joinGame(game, id).game;
    const started = startGame(game, { random: seed }).game;
    const exec = started.players.find((p) => p.roleId === 'executioner');
    if (!exec) continue;
    assert.ok(exec.targetId, 'a mark was assigned');
    assert.notEqual(exec.targetId, exec.id, 'never themselves');
    // Marking a crook would make the card a second detective.
    assert.equal(sideOf(playerOf(started, exec.targetId).roleId), SIDES.VILLAGERS);
  }
});

test('the Executioner wins when their mark is lynched, and the game keeps going', () => {
  const game = {
    ...table({ p1: 'godfather', p2: 'executioner', p3: 'doctor', p4: 'detective', p5: 'villager', p6: 'villager', p7: 'villager' }),
  };
  const marked = { ...game, players: game.players.map((p) => (p.id === 'p2' ? { ...p, targetId: 'p5' } : p)) };
  const end = lynch(marked, 'p5');

  assert.deepEqual(end.personalWins, [{ playerId: 'p2', as: 'executioner' }]);
  assert.equal(playerOf(end.game, 'p2').wonAs, 'executioner');
  // A neutral win is personal — it does not end anything.
  assert.notEqual(end.game.phase, PHASES.OVER);
  assert.deepEqual(personalWinners(end.game), [{ playerId: 'p2', as: 'executioner' }]);
});

test('an Executioner whose mark dies at NIGHT becomes a Jester', () => {
  const game = table({ p1: 'godfather', p2: 'executioner', p3: 'doctor', p4: 'detective', p5: 'villager', p6: 'villager', p7: 'villager' });
  const marked = { ...game, players: game.players.map((p) => (p.id === 'p2' ? { ...p, targetId: 'p5' } : p)) };
  const { game: after, events } = night(marked, { p1: 'p5' });

  assert.equal(playerOf(after, 'p2').roleId, 'jester', 'the card changed, the win did not vanish');
  assert.ok(events.some((e) => e.type === 'executioner-failed' && e.to === 'p2'));
});

test('a Jester wins by being lynched — and nobody else notices', () => {
  const game = table({ p1: 'godfather', p2: 'jester', p3: 'doctor', p4: 'detective', p5: 'villager', p6: 'villager', p7: 'villager' });
  const end = lynch(game, 'p2');
  assert.deepEqual(end.personalWins, [{ playerId: 'p2', as: 'jester' }]);
  assert.notEqual(end.game.phase, PHASES.OVER, 'the game carries on without them');
});

test('a Jester who dies at night wins nothing', () => {
  const game = table({ p1: 'godfather', p2: 'jester', p3: 'doctor', p4: 'detective', p5: 'villager', p6: 'villager', p7: 'villager' });
  const { game: after } = night(game, { p1: 'p2' });
  assert.equal(playerOf(after, 'p2').alive, false);
  assert.deepEqual(personalWinners(after), [], 'only a lynch pays');
});

test('neutrals count against the mafia for parity but never win the game', () => {
  const game = table({ p1: 'godfather', p2: 'jester', p3: 'doctor', p4: 'detective', p5: 'villager', p6: 'villager', p7: 'villager' });
  const kill = (state, ...who) => ({
    ...state,
    players: state.players.map((p) => (who.includes(p.id) ? { ...p, alive: false } : p)),
  });
  // p1 mafia · p2 jester · p3 doctor left = 1 v 2, not parity, because the
  // Jester counts as "everyone else" even though it can never win the game.
  assert.equal(checkWinner(kill(game, 'p4', 'p5', 'p6', 'p7')), null);
  assert.equal(aliveNeutrals(kill(game, 'p4', 'p5', 'p6', 'p7')).length, 1);
  // Take the Jester out and the same board IS parity — 1 v 1.
  assert.equal(checkWinner(kill(game, 'p4', 'p5', 'p6', 'p7', 'p2')), 'mafia');
  // And a board with no mafia is a precinct win even with a neutral standing.
  assert.equal(checkWinner(kill(game, 'p1')), 'villagers');
});

// ── the prompts keep up with the cards ───────────────────────────────────────

test('every acting card has a prompt, and every sleeping card says so', () => {
  const cast = {
    p1: 'godfather', p2: 'mafia', p3: 'framer', p4: 'doctor', p5: 'detective',
    p6: 'vigilante', p7: 'mayor', p8: 'spy', p9: 'investigator', p10: 'distractor',
    p11: 'villager', p12: 'executioner',
  };
  const game = { ...table(cast), players: Object.entries(cast).map(([id, roleId]) => ({
    id, roleId, alive: true, diedOn: null, diedTo: null, lastProtected: null, revealed: false,
    targetId: roleId === 'executioner' ? 'p11' : null, wonAs: null,
  })) };

  for (const [id, roleId] of Object.entries(cast)) {
    const prompt = actionPromptFor(game, id);
    if (ROLES[roleId].night) {
      assert.equal(prompt.ok, true, `${roleId} should be prompted`);
      assert.ok(prompt.text.length > 20, `${roleId} prompt is a sentence`);
    } else {
      assert.equal(prompt.ok, false, `${roleId} sleeps`);
      assert.match(prompt.text, /sleep tonight/, roleId);
    }
  }
  // The Executioner is told their mark when they press, since they have no
  // other way to be reminded.
  assert.match(actionPromptFor(game, 'p12').text, /Your mark is <@p11>/);
});

test('the offered targets never include one the engine would refuse', () => {
  const cast = { p1: 'godfather', p2: 'vigilante', p3: 'doctor', p4: 'detective', p5: 'villager', p6: 'villager', p7: 'villager' };
  const game = table(cast);
  for (const [id, roleId] of Object.entries(cast)) {
    for (const target of targetsFor(game, id)) {
      const step = submitNightAction(game, id, targetCountFor(roleId) === 2 ? [target] : target);
      assert.notEqual(step.reason, 'no-self-kill', `${roleId} was offered itself`);
      assert.notEqual(step.reason, 'target-dead', `${roleId} was offered a corpse`);
      assert.notEqual(step.reason, 'repeat-protect', `${roleId} was offered a repeat`);
    }
  }
  assert.deepEqual(targetsFor(game, 'p7'), [], 'an Officer is offered nothing');
  assert.deepEqual(targetsFor(game, 'p1').includes('p1'), false, 'the Boss is not on his own list');
});
