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
  ROLES,
  SIDES,
  dealRoles,
  isMafia,
  roleOf,
  shuffle,
} from '../src/modules/mafia/lib/roles.js';
import { PermissionFlagsBits } from 'discord.js';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  PHASES,
  aliveMafia,
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
  playerOf,
  resolveNight,
  spoiler,
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

test('the four Classic roles are the cog’s, with the right sides', () => {
  assert.deepEqual(Object.keys(ROLES), ['godfather', 'doctor', 'detective', 'villager']);
  assert.equal(ROLES.godfather.side, SIDES.MAFIA);
  for (const id of ['doctor', 'detective', 'villager']) {
    assert.equal(ROLES[id].side, SIDES.VILLAGERS, id);
  }
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

test('a deal is always the three core roles plus Officers, exactly one mafia', () => {
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n += 1) {
    const roles = dealRoles(n, seeded([0.1, 0.9, 0.5, 0.3, 0.7]));
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
  assert.deepEqual(events.find((e) => e.type === 'killed'), { type: 'killed', targetId: 'p4', byId: 'p1' });
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
    { id: 'p1', roleId: 'godfather', alive: false, diedTo: 'lynch' },
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

test('the roles card explains all four', () => {
  const card = rolesEmbed();
  assert.equal(card.fields.length, 4);
  for (const role of Object.values(ROLES)) {
    assert.ok(card.fields.some((f) => f.name.includes(role.name)), role.name);
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
    ['start', 'end', 'roles', 'stats', 'board', 'timings', 'reset'],
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
