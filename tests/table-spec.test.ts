import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cushionGaps,
  EIGHT_BALL_TABLE,
  MODES,
  modeOf,
  pocketsFor,
  SNOOKER_TABLE,
  tableOf,
} from '../src/simulation/modes';
import { initialSnookerState, snookerTargets } from '../src/simulation/modes/snooker';
import {
  firstPlacementSpot,
  firstTableBoundary,
  inPlacementZone,
  nosesOf,
  RAIL_RESTITUTION,
  railsOf,
  TABLE_NOSES,
  TABLE_RAILS,
} from '../src/simulation/table-geometry';
import { initialState, POCKETS, TABLE, type GameState } from '../src/simulation/types';

/** The pool cushions and jaws exactly as they were hand-written before `railsOf`/`nosesOf` derived them, copied
 * from the pre-refactor source. Pinned here rather than compared against the derived arrays, so that deriving the
 * eight-ball table wrong fails this test instead of quietly agreeing with itself. */
const HAND_WRITTEN_RAILS = [-1, 1].flatMap((sign) => [
  { x: sign * 5.83, z: 0, halfWidth: 0.13, halfDepth: 2.48, y: 0.13, halfHeight: 0.3, restitution: RAIL_RESTITUTION },
  ...[-2.84, 2.84].map((x) => ({
    x,
    z: sign * 2.98,
    halfWidth: 2.43,
    halfDepth: 0.13,
    y: 0.13,
    halfHeight: 0.3,
    restitution: RAIL_RESTITUTION,
  })),
]);
const HAND_WRITTEN_NOSES = [-1, 1].flatMap((side) =>
  [-5.2, -0.41, 0.41, 5.2].map((x) => ({
    x,
    z: side * (Math.abs(x) > 5 ? 2.91 : 2.87),
    radius: 0.075,
    y: 0.13,
    restitution: 0.8,
  })),
);

test('the pool table is still hand-written and the derived geometry reproduces it exactly', () => {
  assert.deepEqual({ ...EIGHT_BALL_TABLE.pockets }, { ...POCKETS });
  assert.deepEqual(pocketsFor(TABLE.halfWidth, TABLE.halfDepth), POCKETS);
  assert.deepEqual(railsOf(EIGHT_BALL_TABLE), HAND_WRITTEN_RAILS);
  assert.deepEqual(nosesOf(EIGHT_BALL_TABLE), HAND_WRITTEN_NOSES);
  assert.deepEqual(TABLE_RAILS, HAND_WRITTEN_RAILS);
  assert.deepEqual(TABLE_NOSES, HAND_WRITTEN_NOSES);
  assert.equal(tableOf(initialState('eight')), EIGHT_BALL_TABLE);
  assert.equal(tableOf({}), EIGHT_BALL_TABLE, 'a state written before modes existed is eight-ball');
  assert.equal(modeOf({}).id, 'eight-ball');
});

test('the snooker table is a 12-footer: twice as long as it is wide, with tighter mouths and matching cushion gaps', () => {
  assert.equal(SNOOKER_TABLE.halfWidth / SNOOKER_TABLE.halfDepth, 2);
  assert.ok(SNOOKER_TABLE.halfWidth > EIGHT_BALL_TABLE.halfWidth * 1.7);
  assert.ok(SNOOKER_TABLE.pocketRadius < EIGHT_BALL_TABLE.pocketRadius);
  assert.equal(SNOOKER_TABLE.radius, EIGHT_BALL_TABLE.radius, 'one ball size, one physics tuning');
  const gaps = cushionGaps(SNOOKER_TABLE.pocketRadius),
    pool = cushionGaps(EIGHT_BALL_TABLE.pocketRadius);
  assert.ok(gaps.corner < pool.corner && gaps.middle < pool.middle, 'a tighter mouth pulls the cushions in with it');
  assert.equal(SNOOKER_TABLE.pockets.length, 6);
  for (const pocket of SNOOKER_TABLE.pockets)
    assert.ok(Math.abs(pocket.x) <= SNOOKER_TABLE.halfWidth && Math.abs(pocket.z) <= SNOOKER_TABLE.halfDepth + 0.2);
});

test('contact rays follow the mode table, so a snooker frame sees its own cushions and mouths', () => {
  const snooker = initialSnookerState('geometry');
  for (const ball of snooker.balls) ball.pocketed = true;
  const cue = { x: 0, z: 0 };
  const toSide = firstTableBoundary(snooker, { x: 3, z: 0 }, Math.PI / 2);
  assert.equal(toSide.kind, 'rail');
  assert.ok(
    toSide.distance > EIGHT_BALL_TABLE.halfDepth,
    'the pool cushion would have stopped the ray far short of the snooker one',
  );
  for (const pocket of SNOOKER_TABLE.pockets) {
    const contact = firstTableBoundary(snooker, cue, Math.atan2(pocket.z, pocket.x));
    assert.equal(contact.kind, 'pocket', `mouth at ${pocket.x},${pocket.z} is open`);
  }
});

test('ball in hand honours the mode: the pool kitchen, the snooker D', () => {
  const pool = initialState('placement');
  assert.ok(inPlacementZone(pool, { x: -3, z: 0 }));
  assert.ok(!inPlacementZone(pool, { x: 3, z: 0 }));

  const snooker = initialSnookerState('placement');
  const { headStringX, dRadius } = SNOOKER_TABLE.placement;
  assert.ok(dRadius);
  assert.ok(inPlacementZone(snooker, { x: headStringX - dRadius! * 0.5, z: 0 }));
  assert.ok(
    !inPlacementZone(snooker, { x: headStringX - dRadius! - 0.5, z: 0 }),
    'behind the baulk line but outside the D is not the D',
  );
  assert.ok(!inPlacementZone(snooker, { x: headStringX + 0.5, z: 0 }), 'past the baulk line is never in the D');
  const spot = firstPlacementSpot(snooker, true);
  assert.ok(spot);
  assert.ok(Math.hypot(spot!.x - headStringX, spot!.z) <= dRadius! + 1e-9);
});

test('the registry exposes one shape per mode and each rack matches its own table', () => {
  for (const spec of Object.values(MODES)) {
    const state: GameState = spec.initialState(`registry-${spec.id}`);
    assert.equal(spec.rack(`registry-${spec.id}`).length, state.balls.length);
    assert.equal(tableOf(state), spec.table);
    assert.ok(spec.legalTargets(state, 0).length > 0);
    for (const ball of state.balls) {
      assert.ok(Math.abs(ball.x) < spec.table.halfWidth - spec.table.radius);
      assert.ok(Math.abs(ball.z) < spec.table.halfDepth - spec.table.radius);
    }
  }
  assert.equal(MODES.snooker.legalTargets, snookerTargets);
});
