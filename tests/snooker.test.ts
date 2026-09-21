import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLACK,
  BLUE,
  BROWN,
  COLOURS,
  concedeFrame,
  GREEN,
  initialSnookerState,
  isRed,
  PINK,
  RED_COUNT,
  settleSnookerShot,
  SNOOKER_SPOTS,
  snookerRack,
  snookerTargets,
  valueOf,
  YELLOW,
} from '../src/simulation/modes/snooker';
import { SNOOKER_TABLE } from '../src/simulation/modes/table';
import { firstPlacementSpot, inPlacementZone } from '../src/simulation/table-geometry';
import type { GameState, ShotResult } from '../src/simulation/types';

function frame(): GameState {
  const state = initialSnookerState('snooker');
  state.phase = 'ready';
  state.shotCount = 1;
  return state;
}
const settle = (state: GameState, shot: Partial<ShotResult>, shooter: 0 | 1 = 0) =>
  settleSnookerShot(
    state,
    { firstContact: 1, potted: [], railAfterContact: true, breakRails: [], ...shot },
    { legalBefore: snookerTargets(state, shooter).map((b) => b.id), shooter },
  );
/** Clear the table down to the named balls, leaving everything else pocketed. */
function only(state: GameState, ids: number[]): GameState {
  for (const ball of state.balls) ball.pocketed = ball.id !== 0 && !ids.includes(ball.id);
  return state;
}

test('the frame racks fifteen reds behind the pink and the six colours on their own spots', () => {
  const state = frame();
  assert.equal(state.balls.length, 1 + RED_COUNT + COLOURS.length);
  assert.deepEqual(
    state.balls.map((b) => b.id),
    state.balls.map((_, index) => index),
    'ball id is its index, as every other mode assumes',
  );
  assert.equal(state.balls.filter((b) => isRed(b.id)).length, RED_COUNT);
  for (const colour of COLOURS)
    assert.deepEqual({ x: state.balls[colour].x, z: state.balls[colour].z }, SNOOKER_SPOTS[colour]);
  assert.deepEqual([YELLOW, GREEN, BROWN, BLUE, PINK, BLACK].map(valueOf), [2, 3, 4, 5, 6, 7]);
  assert.equal(valueOf(1), 1);
  const apex = state.balls[1];
  assert.ok(
    apex.x > SNOOKER_SPOTS[PINK].x && apex.x < SNOOKER_SPOTS[BLACK].x,
    'the triangle sits between pink and black',
  );
  assert.ok(inPlacementZone(state, state.balls[0]), 'the cue ball starts in the D');
  assert.equal(snookerRack('other-seed').length, state.balls.length);
  assert.equal(snookerTargets(state).length, RED_COUNT, 'every red is on to start with');
});

test('a red puts the striker on a colour, and that colour scores its value and goes back on its spot', () => {
  const potRed = settle(frame(), { firstContact: 1, potted: [1] });
  assert.equal(potRed.outcome.foul, false);
  assert.deepEqual(potRed.state.snooker!.scores, [1, 0]);
  assert.equal(potRed.state.snooker!.onColour, true);
  assert.equal(potRed.state.turn, 0, 'a legal pot keeps the striker at the table');
  assert.deepEqual(
    snookerTargets(potRed.state).map((b) => b.id),
    [...COLOURS],
  );

  const potBlack = settle(potRed.state, { firstContact: BLACK, potted: [BLACK] });
  assert.equal(potBlack.outcome.foul, false);
  assert.deepEqual(potBlack.state.snooker!.scores, [8, 0]);
  assert.equal(potBlack.state.balls[BLACK].pocketed, false);
  assert.deepEqual({ x: potBlack.state.balls[BLACK].x, z: potBlack.state.balls[BLACK].z }, SNOOKER_SPOTS[BLACK]);
  assert.deepEqual(potBlack.respots, [{ id: BLACK, ...SNOOKER_SPOTS[BLACK] }]);
  assert.equal(potBlack.state.snooker!.onColour, false, 'back on a red');
  assert.equal(potBlack.state.balls[1].pocketed, true, 'reds never come back');

  const missed = settle(potBlack.state, { firstContact: 2, potted: [] });
  assert.equal(missed.state.turn, 1);
  assert.equal(missed.state.snooker!.onColour, false);
});

test('the colour taken after the final red still respots; only the clearance leaves colours down', () => {
  const state = only(frame(), [15, ...COLOURS]);
  const lastRed = settle(state, { firstContact: 15, potted: [15] });
  assert.equal(lastRed.state.snooker!.onColour, true);
  const afterLastRed = settle(lastRed.state, { firstContact: BLUE, potted: [BLUE] });
  assert.equal(afterLastRed.state.balls[BLUE].pocketed, false, 'the colour after the last red goes back up');
  assert.deepEqual(afterLastRed.state.snooker!.scores, [6, 0]);
  assert.deepEqual(
    snookerTargets(afterLastRed.state).map((b) => b.id),
    [YELLOW],
    'now the clearance, lowest value first',
  );

  const yellow = settle(afterLastRed.state, { firstContact: YELLOW, potted: [YELLOW] });
  assert.equal(yellow.state.balls[YELLOW].pocketed, true, 'clearance colours stay down');
  assert.deepEqual(yellow.state.snooker!.scores, [8, 0]);
  assert.deepEqual(
    snookerTargets(yellow.state).map((b) => b.id),
    [GREEN],
  );
});

test('fouls award the other side four points, or the value of the ball concerned when that is higher', () => {
  const nothingHit = settle(frame(), { firstContact: null });
  assert.equal(nothingHit.outcome.foul, true);
  assert.deepEqual(nothingHit.state.snooker!.scores, [0, 4], 'the minimum penalty');
  assert.equal(nothingHit.state.turn, 1);

  const wrongBall = settle(frame(), { firstContact: BLACK });
  assert.deepEqual(wrongBall.state.snooker!.scores, [0, 7], 'striking the black while on a red');

  const extraColour = settle(frame(), { firstContact: 1, potted: [1, BLUE] });
  assert.equal(extraColour.outcome.foul, true);
  assert.deepEqual(extraColour.state.snooker!.scores, [0, 5]);
  assert.equal(extraColour.state.balls[BLUE].pocketed, false, 'a fouled colour is respotted');
  assert.equal(extraColour.state.balls[1].pocketed, true, 'a fouled red is not');

  const offTable = settle(frame(), { firstContact: 1, offTable: [BLACK] });
  assert.deepEqual(offTable.state.snooker!.scores, [0, 7]);
  assert.equal(offTable.state.balls[BLACK].pocketed, false);

  const onPink = only(frame(), [PINK, BLACK]);
  onPink.snooker!.scores = [20, 0];
  const inOff = settle(onPink, { firstContact: PINK, potted: [0] });
  assert.equal(inOff.outcome.scratched, true);
  assert.deepEqual(inOff.state.snooker!.scores, [20, 6], 'the pink was the ball on');
  assert.equal(inOff.state.phase, 'ball-in-hand', 'an in-off is the only way to get the cue ball in hand');
});

test('a foul that leaves the striker snookered gives a free ball worth the value of the ball on', () => {
  const state = only(frame(), [1, ...COLOURS]);
  Object.assign(state.balls[0], { x: -1, z: 0 });
  Object.assign(state.balls[1], { x: 4, z: 0 });
  Object.assign(state.balls[BLUE], { x: 1.5, z: 0 });
  for (const [index, colour] of [YELLOW, GREEN, BROWN, PINK, BLACK].entries())
    Object.assign(state.balls[colour], { x: -8, z: -3 + index * 1.5 });

  const foul = settle(state, { firstContact: null });
  assert.equal(foul.outcome.foul, true);
  assert.equal(foul.state.turn, 1);
  assert.equal(foul.state.snooker!.freeBall, true, 'the blue snookers every red');
  assert.equal(snookerTargets(foul.state, 1).length, foul.state.balls.filter((b) => !b.pocketed && b.id !== 0).length);

  const potFree = settle(foul.state, { firstContact: BLUE, potted: [BLUE] }, 1);
  assert.equal(potFree.outcome.foul, false);
  assert.deepEqual(
    potFree.state.snooker!.scores,
    [0, 5],
    'the four for the foul plus one: a free ball scores the ball on',
  );
  assert.equal(potFree.state.balls[BLUE].pocketed, false, 'and the free ball is respotted');
  assert.equal(potFree.state.snooker!.onColour, true, 'the striker is now on a colour');
  assert.equal(potFree.state.snooker!.freeBall, false);
});

test('one stroke may pot several reds; a colour with no red is a foul worth that colour', () => {
  const two = settle(frame(), { firstContact: 1, potted: [1, 2] });
  assert.equal(two.outcome.foul, false);
  assert.deepEqual(two.state.snooker!.scores, [2, 0], 'a point per red');
  assert.equal(two.state.snooker!.onColour, true, 'however many reds go down, only one colour is owed');
  assert.equal(two.state.turn, 0);

  const colourOnly = settle(frame(), { firstContact: 1, potted: [BLUE] });
  assert.equal(colourOnly.outcome.foul, true);
  assert.deepEqual(colourOnly.state.snooker!.scores, [0, 5], 'the blue is the ball concerned');
  assert.equal(colourOnly.state.balls[BLUE].pocketed, false, 'and it goes back on its spot');
  assert.equal(colourOnly.state.snooker!.onColour, false, 'a foul never leaves the next player on a colour');
});

test('an in-off puts the cue ball in hand, and the D still has a spot to play it from', () => {
  const state = only(frame(), [1, ...COLOURS]);
  Object.assign(state.balls[1], { x: 4, z: 1 });
  const inOff = settle(state, { firstContact: 1, potted: [0, 1] });
  assert.equal(inOff.outcome.scratched, true);
  assert.equal(inOff.state.phase, 'ball-in-hand');
  assert.equal(inOff.state.balls[0].pocketed, true);
  const spot = firstPlacementSpot(inOff.state, true);
  assert.ok(spot, 'the D is never so crowded that a scratch cannot be played');
  assert.ok(inPlacementZone(inOff.state, spot!));
  assert.ok(!inPlacementZone(inOff.state, { x: 0, z: 0 }), 'the blue spot is not in hand while the D has room');
});

test('a colour whose own spot is taken goes on the highest value spot that is free', () => {
  const state = only(frame(), [1, PINK, BLACK]);
  Object.assign(state.balls[0], { x: -4, z: 0 });
  Object.assign(state.balls[1], { x: -8, z: 0 });
  Object.assign(state.balls[PINK], SNOOKER_SPOTS[BLACK]);
  state.snooker!.onColour = true;
  const onBlack = settle(state, { firstContact: BLACK, potted: [BLACK] });
  assert.equal(onBlack.outcome.foul, false);
  assert.deepEqual(onBlack.state.snooker!.scores, [7, 0]);
  const black = onBlack.state.balls[BLACK];
  assert.equal(black.pocketed, false);
  assert.deepEqual({ x: black.x, z: black.z }, SNOOKER_SPOTS[PINK], 'the pink spot is the highest value one free');
});

test('the frame ends when the balls run out, and a level frame is decided on a respotted black', () => {
  const won = only(frame(), [BLACK]);
  won.snooker!.scores = [30, 12];
  const finish = settle(won, { firstContact: BLACK, potted: [BLACK] });
  assert.deepEqual(finish.state.snooker!.scores, [37, 12]);
  assert.equal(finish.state.winner, 0);
  assert.equal(finish.state.phase, 'over');

  const level = only(frame(), [BLACK]);
  level.snooker!.scores = [5, 12];
  const tied = settle(level, { firstContact: BLACK, potted: [BLACK] });
  assert.deepEqual(tied.state.snooker!.scores, [12, 12]);
  assert.equal(tied.state.winner, null);
  assert.equal(tied.state.snooker!.decider, true);
  assert.equal(tied.state.balls[BLACK].pocketed, false);
  assert.deepEqual({ x: tied.state.balls[BLACK].x, z: tied.state.balls[BLACK].z }, SNOOKER_SPOTS[BLACK]);
  assert.equal(tied.state.phase, 'ball-in-hand');

  const decided = settle(tied.state, { firstContact: null }, tied.state.turn);
  assert.equal(decided.state.winner, tied.state.turn === 0 ? 1 : 0, 'a foul on the respotted black loses the frame');
  assert.equal(decided.state.phase, 'over');
});

test('a player may concede, and settling never touches its inputs', () => {
  const state = frame();
  const conceded = concedeFrame(state, 0);
  assert.equal(conceded.winner, 1);
  assert.equal(conceded.snooker!.conceded, 0);
  assert.equal(conceded.phase, 'over');
  assert.equal(state.winner, null);

  const shot: ShotResult = { firstContact: 1, potted: [1, BLUE], railAfterContact: true, breakRails: [], offTable: [] };
  const before = structuredClone({ state, shot });
  const outcome = settleSnookerShot(state, shot, {
    legalBefore: snookerTargets(state, 0).map((b) => b.id),
    shooter: 0,
  });
  assert.deepEqual({ state, shot }, before);
  assert.deepEqual(
    settleSnookerShot(state, shot, { legalBefore: snookerTargets(state, 0).map((b) => b.id), shooter: 0 }),
    outcome,
  );
  assert.ok(SNOOKER_TABLE.pockets.length === 6);
});
