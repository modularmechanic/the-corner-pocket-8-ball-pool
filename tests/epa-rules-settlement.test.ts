import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createArcade } from '../src/simulation/arcade';
import { groupChoice, settleShot } from '../src/simulation/settlement';
import { HEAD_STRING_X, snookered } from '../src/simulation/table-geometry';
import {
  activeSeat,
  BLACK_SPOT,
  initialState,
  legalTargets,
  newRack,
  TABLE,
  type GameState,
  type RuleSet,
  type ShotResult,
} from '../src/simulation/types';

const BOTH: RuleSet[] = ['old', 'new'];
const result = (changes: Partial<ShotResult> = {}): ShotResult => ({
  firstContact: 1,
  potted: [],
  railAfterContact: true,
  breakRails: [1, 2, 3, 4],
  ...changes,
});
/** A mid-rack table: solids for team 0, stripes for team 1, no arcade props near the balls. */
function arranged(rules: RuleSet, seed = `epa-${rules}`): GameState {
  const state = initialState(seed, 'singles', rules);
  state.arcade = createArcade('crossfire', seed);
  Object.assign(state.arcade, { obstacles: [], hazards: [], pickups: [] });
  state.shotCount = 1;
  state.groups = ['solids', 'stripes'];
  return state;
}
const breaking = (rules: RuleSet, seed = `epa-break-${rules}`) => initialState(seed, 'singles', rules);
const settle = (state: GameState, shot: Partial<ShotResult> = {}, shooter = state.turn) =>
  settleShot(state, result(shot), { legalBefore: legalTargets(state, shooter).map((b) => b.id), shooter });
const view = (state: GameState) => ({
  turn: state.turn,
  phase: state.phase,
  shotsLeft: state.shotsLeft,
  foul: state.foul,
  freeShot: state.freeShot,
});
/** Team 0 on solids with only the black left to pot. */
function onTheBlack(rules: RuleSet) {
  const state = arranged(rules);
  for (const id of [1, 2, 3, 4, 5, 6, 7]) state.balls[id].pocketed = true;
  return state;
}
const fouled = (rules: RuleSet) => settle(arranged(rules), { firstContact: 9 }).state;

test('legal break: Old Rules need a pot or two balls to a cushion, New Rules a pot or four', () => {
  for (const [rules, rails] of [
    ['old', [1, 2]],
    ['new', [1, 2, 3, 4]],
  ] as const) {
    assert.deepEqual(view(settle(breaking(rules), { breakRails: [...rails] }).state), {
      turn: 1,
      phase: 'ready',
      shotsLeft: 0,
      foul: false,
      freeShot: false,
    });
    const short = settle(breaking(rules), { breakRails: rails.slice(1) });
    assert.equal(short.state.foul, true, `${rules}: one cushion short is a foul break`);
    assert.equal(short.outcome.rerack, true);
  }
  const blocked = breaking('new');
  blocked.arcade = createArcade('crossfire', blocked.seed);
  assert.equal(settle(blocked, { firstContact: null, breakRails: [], obstacleContact: true }).state.foul, false);
});

test('foul break: both rule sets re-rack and the opponent breaks with two visits; a legal re-break uses the second', () => {
  for (const rules of BOTH) {
    const state = breaking(rules);
    state.balls[3].pocketed = true;
    const foul = settle(state, { firstContact: null, breakRails: [], potted: [0] });
    assert.deepEqual(view(foul.state), { turn: 1, phase: 'ready', shotsLeft: 2, foul: true, freeShot: false });
    assert.equal(foul.state.rebreak, true);
    assert.equal(foul.respots.length, 16, 'every ball is re-racked');
    assert.ok(foul.state.balls.every((ball) => !ball.pocketed));
    const rack = newRack(`${state.seed}:rack:1`);
    assert.deepEqual(
      foul.state.balls.map((ball) => [ball.x, ball.z]),
      rack.map((ball) => [ball.x, ball.z]),
    );
    // The re-break is still a break, held on the first of two visits.
    const quiet = settle(foul.state, { breakRails: [1, 2, 3, 4] });
    assert.deepEqual(view(quiet.state), { turn: 1, phase: 'ready', shotsLeft: 1, foul: false, freeShot: false });
    assert.equal(quiet.state.rebreak, false);
    const again = settle(foul.state, { breakRails: [] });
    assert.deepEqual([again.state.turn, again.state.shotsLeft, again.outcome.rerack], [0, 2, true]);
  }
});

test('black on the break: re-rack and the same player breaks again, ignoring every foul on that shot', () => {
  for (const rules of BOTH)
    for (const shot of [{ potted: [8] }, { potted: [8, 0] }, { potted: [8, 2, 9], offTable: [0, 4] }]) {
      const state = breaking(rules);
      state.shotsLeft = 2;
      const settled = settle(state, shot);
      assert.deepEqual(
        view(settled.state),
        { turn: 0, phase: 'ready', shotsLeft: 2, foul: false, freeShot: false },
        `${rules} ${JSON.stringify(shot)}`,
      );
      assert.equal(settled.outcome.rerack, true);
      assert.equal(settled.state.winner, null);
      assert.equal(settled.state.rebreak, true);
      assert.deepEqual(settled.state.groups, [null, null]);
    }
});

test('New Rules: a cue ball lost on a fair break only passes the turn and is placed behind the head string', () => {
  const lost = settle(breaking('new'), { potted: [0, 3] }).state;
  assert.deepEqual(view(lost), { turn: 1, phase: 'ball-in-hand', shotsLeft: 0, foul: true, freeShot: false });
  assert.equal(lost.balls[0].pocketed, true);
  assert.deepEqual(lost.groups, [null, null], 'groups are never decided on a foul');
  assert.deepEqual(
    view(settle(breaking('old'), { potted: [0, 3] }).state),
    { turn: 1, phase: 'ball-in-hand', shotsLeft: 2, foul: true, freeShot: true },
    'Old Rules treat it as any other foul',
  );
  assert.equal(settle(breaking('new'), { potted: [0], offTable: [5] }).state.shotsLeft, 2, 'a ball off is standard');
});

test('groups: Old Rules decide from a single-group break pot; balls of both groups, or any New Rules break pot, ask for a choice', () => {
  const single = settle(breaking('old'), { potted: [2] }).state;
  assert.deepEqual([single.groups, single.phase, single.turn], [['solids', 'stripes'], 'ready', 0]);
  for (const rules of BOTH) {
    const mixed = settle(breaking(rules), { potted: [2, 9] }).state;
    assert.deepEqual([mixed.groups, mixed.phase, mixed.turn], [[null, null], 'choose-group', 0]);
    const chosen = { ...mixed, ...groupChoice(mixed, 'stripes')! };
    assert.deepEqual([chosen.groups, chosen.phase, chosen.nominated], [['stripes', 'solids'], 'ready', null]);
    const open = arranged(rules);
    open.groups = [null, null];
    open.turn = 1;
    const later = settle(open, { potted: [3, 12] }).state;
    assert.deepEqual([later.phase, later.turn], ['choose-group', 1], `${rules}: mixed pot on an open table`);
    assert.deepEqual({ ...later, ...groupChoice(later, 'solids')! }.groups, ['stripes', 'solids']);
    assert.deepEqual(settle(open, { potted: [3] }).state.groups, ['stripes', 'solids'], `${rules}: one group decides`);
    assert.deepEqual(settle(open, { potted: [3, 12, 0] }).state.groups, [null, null], 'never on a foul');
  }
  assert.equal(groupChoice(single, 'solids'), null, 'no choice is due');
  assert.equal(groupChoice(settle(breaking('old'), { potted: [2, 9] }).state, 'spots'), null);
});

test('New Rules: a group chosen but not potted after the break is decided only by potting one on the next shot', () => {
  const broke = settle(breaking('new'), { potted: [2] }).state;
  assert.equal(broke.phase, 'choose-group');
  const nominated = { ...broke, ...groupChoice(broke, 'stripes')! };
  assert.deepEqual([nominated.groups, nominated.nominated, nominated.phase], [[null, null], 'stripes', 'ready']);
  assert.deepEqual(settle(nominated, { firstContact: 10, potted: [10] }).state.groups, ['stripes', 'solids']);
  const missed = settle(nominated, { firstContact: 10 }).state;
  assert.deepEqual([missed.groups, missed.nominated, missed.turn], [[null, null], null, 1]);
  assert.deepEqual(
    settle(nominated, { firstContact: 3, potted: [3] }).state.groups,
    ['solids', 'stripes'],
    'another pot falls back to the ordinary first legal pot',
  );
});

test('two visits: a pot continues the visit and the second visit still follows; the second miss passes the table', () => {
  for (const rules of BOTH) {
    let state = fouled(rules);
    assert.equal(state.turn, 1);
    assert.equal(state.shotsLeft, 2);
    state.freeShot = false;
    state = settle(state, { firstContact: 9, potted: [9] }).state;
    assert.deepEqual([state.turn, state.shotsLeft], [1, 2], `${rules}: a pot on the first visit keeps both`);
    state = settle(state, { firstContact: 10 }).state;
    assert.deepEqual([state.turn, state.shotsLeft, state.foul], [1, 1, false], `${rules}: the second visit`);
    state = settle(state, { firstContact: 10, potted: [10] }).state;
    assert.deepEqual([state.turn, state.shotsLeft], [1, 1], `${rules}: a pot continues the second visit`);
    state = settle(state, { firstContact: 11 }).state;
    assert.deepEqual([state.turn, state.shotsLeft], [0, 0], `${rules}: then an ordinary turn change`);
  }
});

test('a foul during either visit hands two visits back under both rule sets', () => {
  for (const rules of BOTH) {
    const first = fouled(rules);
    first.freeShot = false;
    const second = settle(first, { firstContact: 9 }).state;
    for (const state of [first, second]) {
      assert.deepEqual(
        [settle(state, { firstContact: 1 }).state.turn, settle(state, { firstContact: 1 }).state.shotsLeft],
        [0, 2],
      );
      assert.deepEqual(settle(state, { firstContact: 9, potted: [0] }).state.shotsLeft, 2);
    }
  }
});

test('Old Rules free shot: any ball first, every pot counts and the visit continues, only on the first shot', () => {
  const state = fouled('old');
  assert.deepEqual(view(state), { turn: 1, phase: 'ball-in-hand', shotsLeft: 2, foul: true, freeShot: true });
  assert.equal(legalTargets(state).length, 15, 'every object ball, the black included, may be hit first');
  const opponent = settle(state, { firstContact: 1, potted: [1, 2] });
  assert.deepEqual(view(opponent.state), { turn: 1, phase: 'ready', shotsLeft: 2, foul: false, freeShot: false });
  assert.equal(opponent.outcome.ownPotted, 2);
  assert.deepEqual(
    view(settle(state, { firstContact: 8 }).state),
    { turn: 1, phase: 'ready', shotsLeft: 1, foul: false, freeShot: false },
    'hitting the black first is legal on the free shot',
  );
  const early = settle(state, { firstContact: 8, potted: [8] }).state;
  assert.deepEqual([early.phase, early.winner], ['over', 0], 'the black before the group is cleared still loses');
  const next = settle(state, { firstContact: 9, potted: [9] }).state;
  assert.deepEqual(view(settle(next, { firstContact: 1 }).state).foul, true, 'later shots follow normal rules');
});

test('New Rules have no free shot after an ordinary foul: the cue ball is played from where it lies', () => {
  const state = fouled('new');
  assert.deepEqual(view(state), { turn: 1, phase: 'ready', shotsLeft: 2, foul: true, freeShot: false });
  assert.deepEqual(state.balls[0], arranged('new').balls[0]);
  assert.equal(settle(state, { firstContact: 1 }).state.foul, true);
});

test('potting an opponent’s ball is a foul, except on the Old Rules free shot', () => {
  for (const rules of BOTH) {
    const settled = settle(arranged(rules), { firstContact: 1, potted: [1, 9] });
    assert.equal(settled.state.foul, true);
    assert.equal(settled.state.turn, 1);
    assert.equal(settled.state.shotsLeft, 2);
    assert.equal(settled.state.arcade!.scores[0], 0, 'a foul scores nothing');
    assert.deepEqual(
      settled.events.map((event) => event.reason),
      ['mixed-pot'],
      'the arcade mixed-pot debuff still applies on top of the foul',
    );
  }
});

/** Only balls 1 and 9 remain, well away from the black's spot. */
function sparse(rules: RuleSet, shotCount = 1) {
  const state = arranged(rules);
  state.shotCount = shotCount;
  for (const ball of state.balls) if (ball.id > 0) ball.pocketed = ball.id !== 1 && ball.id !== 9;
  Object.assign(state.balls[1], { x: -1, z: -1 });
  Object.assign(state.balls[9], { x: 1, z: 1 });
  return state;
}

test('the black: off the table is a foul and is spotted on its rack position, never a loss', () => {
  for (const rules of BOTH) {
    const settled = settle(sparse(rules), { firstContact: 1, offTable: [8] });
    assert.deepEqual([settled.state.winner, settled.state.foul, settled.state.shotsLeft], [null, true, 2]);
    assert.equal(settled.outcome.respotEight, true);
    assert.deepEqual(
      [settled.state.balls[8].x, settled.state.balls[8].z, settled.state.balls[8].pocketed],
      [BLACK_SPOT.x, 0, false],
    );
    const covered = sparse(rules);
    Object.assign(covered.balls[4], { x: BLACK_SPOT.x, z: 0, pocketed: false });
    const spotted = settle(covered, { firstContact: 1, offTable: [8, 9] }).state;
    assert.deepEqual(
      [spotted.balls[8].x, spotted.balls[8].z],
      [BLACK_SPOT.x + TABLE.radius * 2.2, 0],
      'an occupied spot moves to the nearest clear point along the long axis, foot side first',
    );
    assert.deepEqual(
      [spotted.balls[9].x, spotted.balls[9].z, spotted.balls[9].pocketed],
      [BLACK_SPOT.x - TABLE.radius * 2.2, 0, false],
      'object balls follow the black along the same line',
    );
  }
  const breakOff = settle(sparse('old', 0), { offTable: [8] });
  assert.deepEqual(
    [breakOff.state.foul, breakOff.outcome.rerack, breakOff.state.balls[8].x],
    [true, false, BLACK_SPOT.x],
    'off the table on the break is an ordinary foul, not a re-rack',
  );
});

test('the black: wins only when legally potted after the group; with a foul or an opponent ball it loses', () => {
  for (const rules of BOTH) {
    const cases: [Partial<ShotResult>, 0 | 1][] = [
      [{ firstContact: 8, potted: [8] }, 0],
      [{ firstContact: 8, potted: [8, 0] }, 1],
      [{ firstContact: 8, potted: [8, 9] }, 1],
      [{ firstContact: 9, potted: [8] }, 1],
    ];
    for (const [shot, winner] of cases) {
      const ended = settle(onTheBlack(rules), shot).state;
      assert.deepEqual([ended.phase, ended.winner], ['over', winner], `${rules} ${JSON.stringify(shot)}`);
    }
    const lastBall = onTheBlack(rules);
    lastBall.balls[7].pocketed = false;
    assert.equal(settle(lastBall, { firstContact: 7, potted: [7, 8] }).state.winner, 1, 'with the last own ball');
  }
});

test('Old Rules free shot on the black: play it directly to win, or pot it with only opponent balls', () => {
  for (const potted of [[8], [8, 9, 10]]) {
    const state = onTheBlack('old');
    state.freeShot = true;
    state.shotsLeft = 2;
    const ended = settleShot(state, result({ firstContact: 9, potted }), { legalBefore: [8, 9, 10], shooter: 0 });
    assert.deepEqual([ended.state.phase, ended.state.winner], ['over', 0]);
  }
});

test('New Rules cushion rule: after contact a ball must reach a cushion or be potted; Old Rules need contact only', () => {
  const noCushion = { firstContact: 1, railAfterContact: false };
  assert.deepEqual(view(settle(arranged('new'), noCushion).state).foul, true);
  assert.deepEqual(view(settle(arranged('old'), noCushion).state), {
    turn: 1,
    phase: 'ready',
    shotsLeft: 0,
    foul: false,
    freeShot: false,
  });
  assert.equal(settle(arranged('new'), { ...noCushion, firstContact: null, obstacleContact: true }).state.foul, false);
});

test('cue-ball placement: mandatory in the kitchen after a lost cue ball, optional after an Old Rules foul', () => {
  for (const rules of BOTH)
    for (const shot of [{ potted: [0] }, { offTable: [0] }]) {
      const state = settle(arranged(rules), shot).state;
      assert.deepEqual([state.phase, state.balls[0].pocketed, state.shotsLeft], ['ball-in-hand', true, 2]);
      assert.equal(state.freeShot, rules === 'old');
    }
  const optional = fouled('old');
  assert.deepEqual([optional.phase, optional.balls[0].pocketed], ['ball-in-hand', false]);
  assert.equal(fouled('new').phase, 'ready');
  const shielded = arranged('old');
  shielded.arcade!.activeShot.ward = true;
  const rescued = settle(shielded, { potted: [0] });
  assert.equal(rescued.outcome.wardRescued, true);
  assert.deepEqual(view(rescued.state), { turn: 1, phase: 'ready', shotsLeft: 0, foul: false, freeShot: false });
});

/** Team 1 (stripes) will face a cue ball boxed in by solids so no stripe can be reached in a straight line. */
function snookerTable(rules: RuleSet) {
  const state = arranged(rules);
  for (const ball of state.balls) if (ball.id !== 0) ball.pocketed = true;
  const ring = [1, 2, 3, 4, 5, 6, 7, 8];
  Object.assign(state.balls[0], { x: HEAD_STRING_X - 1, z: 0 });
  ring.forEach((id, i) => {
    const angle = (i / ring.length) * Math.PI * 2;
    Object.assign(state.balls[id], {
      pocketed: false,
      x: HEAD_STRING_X - 1 + Math.cos(angle) * TABLE.radius * 2.05,
      z: Math.sin(angle) * TABLE.radius * 2.05,
    });
  });
  Object.assign(state.balls[12], { pocketed: false, x: 3, z: 0 });
  return state;
}

test('New Rules foul snooker: a foul that leaves no straight line to any own ball grants a free ball', () => {
  const state = snookerTable('new');
  assert.equal(snookered(state, 1), true);
  assert.equal(snookered(state, 0), false, 'the fouler can still reach their own balls');
  const settled = settle(state, { firstContact: 12 }).state;
  assert.deepEqual(view(settled), { turn: 1, phase: 'ball-in-hand', shotsLeft: 2, foul: true, freeShot: true });
  assert.equal(legalTargets(settled).length, 9, 'any ball may be hit first');
  const nominated = settle(settled, { firstContact: 3, potted: [3] });
  assert.deepEqual(view(nominated.state), { turn: 1, phase: 'ready', shotsLeft: 2, foul: false, freeShot: false });
  assert.equal(nominated.outcome.ownPotted, 1, 'the first ball hit counts as the player’s own for that shot');
  assert.equal(settle(settled, { firstContact: 3, potted: [3, 4] }).state.foul, true, 'only the ball hit first');
  const open = snookerTable('new');
  for (const id of [1, 2, 8]) open.balls[id].pocketed = true;
  assert.equal(snookered(open, 1), false, 'a gap in the ring is a straight line to the stripe');
  assert.equal(settle(open, { firstContact: 12 }).state.phase, 'ready');
});

test('doubles: the two visits belong to the team while partners alternate every shot', () => {
  for (const rules of BOTH) {
    const state = arranged(rules);
    state.format = 'doubles';
    const foul = settle(state, { firstContact: 9 }).state;
    foul.freeShot = false;
    assert.deepEqual([activeSeat(foul), foul.shotsLeft], [1, 2]);
    const second = settle(foul, { firstContact: 9 }).state;
    assert.deepEqual([second.turn, activeSeat(second), second.shotsLeft], [1, 3, 1]);
    const over = settle(second, { firstContact: 9 }).state;
    assert.deepEqual([over.turn, activeSeat(over), over.shotsLeft, over.teamOrder], [0, 2, 0, [1, 0]]);
  }
});
