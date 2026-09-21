import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BILLIARDS_MODE,
  BILLIARD_SPOT,
  CANNON_LIMIT,
  CENTRE_SPOT,
  concedeGame,
  cueBallOf,
  FOUL_PENALTY,
  HAZARD_LIMIT,
  initialBilliardsState,
  PYRAMID_SPOT,
  RED,
  settleBilliardsShot,
  valueOf,
  WHITE,
  YELLOW_BALL,
  billiardsTargets,
  type BilliardsShotResult,
  type BilliardsState,
} from '../src/simulation/modes/billiards';
import { SNOOKER_SPOTS, BROWN, YELLOW } from '../src/simulation/modes/snooker';
import { SNOOKER_TABLE } from '../src/simulation/modes/table';

/** A game already under way: both cue balls on the table, the red on its spot. */
function game(target = 100): BilliardsState {
  const state = initialBilliardsState('billiards', target);
  state.phase = 'ready';
  state.shotCount = 1;
  Object.assign(state.balls[WHITE], { x: -2, z: 0, pocketed: false });
  Object.assign(state.balls[YELLOW_BALL], { x: -2, z: 1.2, pocketed: false });
  return state;
}
const settle = (state: BilliardsState, shot: Partial<BilliardsShotResult>, shooter: 0 | 1 = 0) =>
  settleBilliardsShot(
    state,
    { firstContact: RED, potted: [], railAfterContact: true, breakRails: [], ...shot },
    { legalBefore: billiardsTargets(state, shooter).map((b) => b.id), shooter },
  );

test('three balls: a red on the billiard spot and both cue balls in hand at the start', () => {
  const state = initialBilliardsState('billiards');
  assert.equal(state.balls.length, 3);
  assert.deepEqual(
    state.balls.map((b) => b.id),
    [0, 1, 2],
    'ball id is its index, as every other mode assumes',
  );
  assert.deepEqual({ x: state.balls[RED].x, z: state.balls[RED].z }, BILLIARD_SPOT);
  assert.equal(state.balls[RED].pocketed, false);
  assert.ok(state.balls[WHITE].pocketed && state.balls[YELLOW_BALL].pocketed, 'both cue balls start in hand');
  assert.equal(state.phase, 'ball-in-hand');
  assert.equal(BILLIARDS_MODE.id, 'billiards');
  assert.equal(BILLIARDS_MODE.table, SNOOKER_TABLE, 'the 12-foot table is shared with snooker, not redefined');
  assert.deepEqual([cueBallOf(0), cueBallOf(1)], [WHITE, YELLOW_BALL]);
  assert.deepEqual([valueOf(RED), valueOf(WHITE), valueOf(YELLOW_BALL)], [3, 2, 2]);
});

test('either object ball may be struck first, and a pocketed one drops out of the targets', () => {
  const state = game();
  assert.deepEqual(
    billiardsTargets(state, 0).map((b) => b.id),
    [RED, YELLOW_BALL],
  );
  assert.deepEqual(
    billiardsTargets(state, 1).map((b) => b.id),
    [WHITE, RED],
  );
  state.balls[YELLOW_BALL].pocketed = true;
  assert.deepEqual(
    billiardsTargets(state, 0).map((b) => b.id),
    [RED],
  );
});

test('a cannon scores two and keeps the striker at the table', () => {
  const after = settle(game(), { contacts: [RED, YELLOW_BALL] });
  assert.equal(after.state.foul, false);
  assert.deepEqual((after.state as BilliardsState).billiards.scores, [2, 0]);
  assert.equal(after.state.turn, 0);
  assert.equal(after.state.phase, 'ready');
});

test('contacting only one object ball is no cannon and ends the turn without a foul', () => {
  const after = settle(game(), { contacts: [RED] });
  assert.equal(after.state.foul, false);
  assert.deepEqual((after.state as BilliardsState).billiards.scores, [0, 0]);
  assert.equal(after.state.turn, 1);
});

test('winning hazards: potting the red scores three, potting the other cue ball two', () => {
  const red = settle(game(), { contacts: [RED], potted: [RED] });
  assert.deepEqual((red.state as BilliardsState).billiards.scores, [3, 0]);
  const white = settle(game(), { firstContact: YELLOW_BALL, contacts: [YELLOW_BALL], potted: [YELLOW_BALL] });
  assert.deepEqual((white.state as BilliardsState).billiards.scores, [2, 0]);
});

test('losing hazards take the value of the ball struck first and leave the striker in hand', () => {
  const offRed = settle(game(), { firstContact: RED, contacts: [RED], potted: [WHITE] });
  assert.deepEqual((offRed.state as BilliardsState).billiards.scores, [3, 0]);
  assert.equal(offRed.state.turn, 0, 'a scoring stroke keeps the break alive');
  assert.equal(offRed.state.phase, 'ball-in-hand');
  assert.equal(offRed.outcome.scratched, true);

  const offWhite = settle(game(), { firstContact: YELLOW_BALL, contacts: [YELLOW_BALL], potted: [WHITE] });
  assert.deepEqual((offWhite.state as BilliardsState).billiards.scores, [2, 0]);
});

test('combined strokes add up, to the maximum ten', () => {
  const after = settle(game(), {
    firstContact: RED,
    contacts: [RED, YELLOW_BALL],
    potted: [RED, YELLOW_BALL, WHITE],
  });
  // cannon 2 + pot red 3 + pot yellow 2 + in-off red 3.
  assert.deepEqual((after.state as BilliardsState).billiards.scores, [10, 0]);
});

test('a cannon combined with an in-off takes the in-off value from the ball hit first', () => {
  const offYellow = settle(game(), { firstContact: YELLOW_BALL, contacts: [YELLOW_BALL, RED], potted: [WHITE] });
  assert.deepEqual((offYellow.state as BilliardsState).billiards.scores, [4, 0], 'cannon 2 + in-off white 2');
});

test('player one scores with their own cue ball and pots the white as an object ball', () => {
  const state = game();
  state.turn = 1;
  const after = settle(state, { firstContact: WHITE, contacts: [WHITE], potted: [WHITE] }, 1);
  assert.deepEqual((after.state as BilliardsState).billiards.scores, [0, 2]);
  assert.equal(after.state.turn, 1);
  assert.equal(after.state.phase, 'ready', 'the striker yellow is still on the table');
});

test('a potted cue ball stays off the table until its owner plays from in hand', () => {
  const after = settle(game(), { contacts: [YELLOW_BALL], firstContact: YELLOW_BALL, potted: [YELLOW_BALL] });
  assert.equal(after.state.balls[YELLOW_BALL].pocketed, true, 'the white is not spotted');
  assert.ok(!after.respots.some((r) => r.id === YELLOW_BALL));
  // The break ends on the next non-scoring stroke and the incoming player is in hand.
  const next = settle(after.state as BilliardsState, { contacts: [RED] });
  assert.equal(next.state.turn, 1);
  assert.equal(next.state.phase, 'ball-in-hand');
});

test('the red is spotted on the billiard spot, falling back when it is occupied', () => {
  const state = game();
  const after = settle(state, { contacts: [RED], potted: [RED] });
  assert.deepEqual({ x: after.state.balls[RED].x, z: after.state.balls[RED].z }, BILLIARD_SPOT);

  const blocked = game();
  Object.assign(blocked.balls[YELLOW_BALL], BILLIARD_SPOT);
  const onPyramid = settle(blocked, { contacts: [RED], potted: [RED] });
  assert.deepEqual({ x: onPyramid.state.balls[RED].x, z: onPyramid.state.balls[RED].z }, PYRAMID_SPOT);

  const twoBlocked = game();
  Object.assign(twoBlocked.balls[YELLOW_BALL], BILLIARD_SPOT);
  Object.assign(twoBlocked.balls[WHITE], PYRAMID_SPOT);
  const onCentre = settle(twoBlocked, { firstContact: RED, contacts: [RED], potted: [RED] });
  assert.deepEqual({ x: onCentre.state.balls[RED].x, z: onCentre.state.balls[RED].z }, CENTRE_SPOT);
});

test('a third consecutive lone pot of the red puts it on the centre spot', () => {
  let state = game();
  for (const expected of [BILLIARD_SPOT, BILLIARD_SPOT, CENTRE_SPOT, BILLIARD_SPOT]) {
    const after = settle(state, { contacts: [RED], potted: [RED] });
    assert.deepEqual({ x: after.state.balls[RED].x, z: after.state.balls[RED].z }, expected);
    state = after.state as BilliardsState;
  }
  // A stroke that scores something else breaks the sequence, so the next lone pot starts at the Spot again.
  const cannon = settle(state, { contacts: [RED, YELLOW_BALL] });
  assert.equal((cannon.state as BilliardsState).billiards.redPotRun, 0);
  const restart = settle(cannon.state as BilliardsState, { contacts: [RED], potted: [RED] });
  assert.deepEqual({ x: restart.state.balls[RED].x, z: restart.state.balls[RED].z }, BILLIARD_SPOT);
});

test('a red forced off the table is a foul, and it is still spotted for the next player', () => {
  const after = settle(game(), { contacts: [RED], offTable: [RED] });
  assert.equal(after.state.foul, true);
  assert.deepEqual((after.state as BilliardsState).billiards.scores, [0, FOUL_PENALTY]);
  assert.deepEqual({ x: after.state.balls[RED].x, z: after.state.balls[RED].z }, BILLIARD_SPOT);
  assert.equal(after.state.turn, 1);
});

test('missing every object ball costs two and ends the turn', () => {
  const after = settle(game(), { firstContact: null, contacts: [] });
  assert.equal(after.state.foul, true);
  assert.deepEqual((after.state as BilliardsState).billiards.scores, [0, FOUL_PENALTY]);
  assert.equal(after.state.turn, 1);
  assert.equal(after.outcome.foul, true);
});

test('a foul stroke scores nothing for the striker even when it would have potted', () => {
  const after = settle(game(), { contacts: [RED, YELLOW_BALL], potted: [RED], offTable: [YELLOW_BALL] });
  assert.deepEqual((after.state as BilliardsState).billiards.scores, [0, FOUL_PENALTY]);
});

test('the seventy-sixth consecutive cannon is a foul; seventy-five are not', () => {
  let state = game();
  for (let i = 0; i < CANNON_LIMIT; i++) {
    const after = settle(state, { contacts: [RED, YELLOW_BALL] });
    assert.equal(after.state.foul, false, `cannon ${i + 1} should be legal`);
    state = after.state as BilliardsState;
  }
  assert.equal(state.billiards.cannonRun, CANNON_LIMIT);
  assert.deepEqual(state.billiards.scores, [CANNON_LIMIT * 2, 0]);
  const over = settle(state, { contacts: [RED, YELLOW_BALL] });
  assert.equal(over.state.foul, true);
  assert.deepEqual((over.state as BilliardsState).billiards.scores, [CANNON_LIMIT * 2, FOUL_PENALTY]);
  assert.equal((over.state as BilliardsState).billiards.cannonRun, 0);
});

test('a hazard in the stroke resets the cannon count', () => {
  let state = game();
  for (let i = 0; i < 10; i++) state = settle(state, { contacts: [RED, YELLOW_BALL] }).state as BilliardsState;
  assert.equal(state.billiards.cannonRun, 10);
  state = settle(state, { contacts: [RED, YELLOW_BALL], potted: [RED] }).state as BilliardsState;
  assert.equal(state.billiards.cannonRun, 0, 'a cannon in conjunction with a hazard does not count towards the limit');
  assert.equal(state.billiards.hazardRun, 0, 'nor does the hazard count towards its own limit');
});

test('the sixteenth consecutive hazard is a foul, and the fifteenth brings a potted cue ball back', () => {
  let state = game();
  // Pot the other cue ball once so it is off the table for the rest of the run.
  state = settle(state, { firstContact: YELLOW_BALL, contacts: [YELLOW_BALL], potted: [YELLOW_BALL] })
    .state as BilliardsState;
  assert.equal(state.balls[YELLOW_BALL].pocketed, true);
  for (let i = 1; i < HAZARD_LIMIT; i++) {
    const after = settle(state, { contacts: [RED], potted: [RED] });
    assert.equal(after.state.foul, false, `hazard ${i + 1} should be legal`);
    state = after.state as BilliardsState;
  }
  assert.equal(state.billiards.hazardRun, HAZARD_LIMIT);
  assert.equal(state.balls[YELLOW_BALL].pocketed, false, 'Rule 11(c) returns it after the fifteenth hazard');
  assert.deepEqual(
    { x: state.balls[YELLOW_BALL].x, z: state.balls[YELLOW_BALL].z },
    SNOOKER_SPOTS[BROWN],
    'the middle of the baulk-line',
  );
  // With the striker's own ball sitting on the middle of the baulk-line, it goes to the right-hand corner of the D.
  const blocked = game();
  Object.assign(blocked.balls[WHITE], SNOOKER_SPOTS[BROWN]);
  blocked.balls[YELLOW_BALL].pocketed = true;
  blocked.billiards.hazardRun = HAZARD_LIMIT - 1;
  const corner = settle(blocked, { contacts: [RED], potted: [RED] });
  assert.deepEqual(
    { x: corner.state.balls[YELLOW_BALL].x, z: corner.state.balls[YELLOW_BALL].z },
    SNOOKER_SPOTS[YELLOW],
  );
  const over = settle(state, { contacts: [RED], potted: [RED] });
  assert.equal(over.state.foul, true);
  assert.equal((over.state as BilliardsState).billiards.hazardRun, 0);
});

test('a non-scoring stroke ends the break and clears both running counts', () => {
  let state = game();
  state = settle(state, { contacts: [RED, YELLOW_BALL] }).state as BilliardsState;
  assert.equal(state.billiards.cannonRun, 1);
  state = settle(state, { contacts: [RED] }).state as BilliardsState;
  assert.equal(state.billiards.cannonRun, 0);
  assert.equal(state.billiards.hazardRun, 0);
  assert.equal(state.turn, 1);
});

test('reaching the points target ends the game', () => {
  let state = game(10);
  state = settle(state, { contacts: [RED], potted: [RED] }).state as BilliardsState;
  assert.equal(state.winner, null);
  state = settle(state, { contacts: [RED], potted: [RED] }).state as BilliardsState;
  assert.equal(state.winner, null, '6 of 10');
  const final = settle(state, { contacts: [RED, YELLOW_BALL], potted: [RED] });
  assert.equal((final.state as BilliardsState).billiards.scores[0], 11);
  assert.equal(final.state.winner, 0);
  assert.equal(final.state.phase, 'over');
  assert.equal(final.outcome.winner, 0);
});

test('foul points can carry the opponent past the target', () => {
  const state = game(2);
  const after = settle(state, { firstContact: null, contacts: [] });
  assert.equal(after.state.winner, 1);
  assert.equal(after.state.phase, 'over');
});

test('a game may be conceded', () => {
  const conceded = concedeGame(game(), 0);
  assert.equal(conceded.winner, 1);
  assert.equal(conceded.phase, 'over');
});

test('settlement is pure: the input state is untouched', () => {
  const state = game();
  const snapshot = structuredClone(state);
  settle(state, { contacts: [RED, YELLOW_BALL], potted: [RED, WHITE] });
  assert.deepEqual(state, snapshot);
});

test('settlement is deterministic: the same stroke twice gives the same state', () => {
  const state = game();
  const shot: Partial<BilliardsShotResult> = { contacts: [RED, YELLOW_BALL], potted: [RED] };
  assert.deepEqual(settle(state, shot).state, settle(state, shot).state);
});
