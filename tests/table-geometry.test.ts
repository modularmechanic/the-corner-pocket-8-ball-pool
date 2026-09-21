import { test } from 'node:test';
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import { initPhysics } from '../src/simulation/game';
import { createArcade, spawnTemporaryPortals } from '../src/simulation/arcade';
import { chooseShot } from '../src/simulation/ai';
import { initialState, POCKETS, TABLE, type ArenaLayout, type GameState } from '../src/simulation/types';
import {
  firstTableContact,
  firstTableBoundary,
  isClearBallSpot,
  isClearLayoutBlock,
  isClearLayoutHazard,
  isClearLayoutPickup,
  isClearPickupSpawn,
  isClearPortalSpawn,
  obstructionAt,
  roundedBoxRay,
  segmentClearOfTable,
  surfaceDragAt,
  rollingDeceleration,
  STICKY_DRAG,
  TABLE_RAILS,
  TABLE_NOSES,
} from '../src/simulation/table-geometry';

function emptyTable(): GameState {
  const state = initialState('geometry');
  state.arcade = createArcade('crossfire', state.seed);
  state.arcade.obstacles = [];
  state.arcade.hazards = [];
  state.arcade.pickups = [];
  for (const ball of state.balls) ball.pocketed = true;
  return state;
}
function close(actual: number, expected: number, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
}

test('grounded contact rays use real cushions and leave all six pocket mouths open', () => {
  const state = emptyTable();
  assert.equal(TABLE_RAILS.length, 6);
  assert.equal(TABLE_NOSES.length, 8);
  const side = firstTableContact(state, { x: 0, z: 0 }, 0);
  assert.equal(side.kind, 'rail');
  close(side.distance, TABLE.halfWidth - TABLE.radius);
  const long = firstTableContact(state, { x: 2, z: 0 }, Math.PI / 2);
  assert.equal(long.kind, 'rail');
  close(long.distance, TABLE.halfDepth - TABLE.radius);
  for (const pocket of POCKETS) {
    const hit = firstTableContact(state, { x: 0, z: 0 }, Math.atan2(pocket.z, pocket.x));
    assert.equal(hit.kind, 'pocket', `mouth at ${pocket.x},${pocket.z}`);
    close(hit.distance, Math.hypot(pocket.x, pocket.z) - TABLE.pocketRadius);
    assert.ok(segmentClearOfTable(state, { x: 0, z: 0 }, pocket));
  }
});

test('rounded block sweep agrees with point clearance at corners instead of using square inflation', () => {
  const state = emptyTable(),
    box = { id: 3, x: 0, z: 0, width: 1, depth: 1, hp: 1, maxHp: 1, material: 'wood' as const };
  state.arcade!.obstacles = [box];
  const direction = Math.SQRT1_2,
    hit = roundedBoxRay({ x: -2, z: -2 }, direction, direction, box, TABLE.radius);
  close(hit, 1.5 * Math.SQRT2 - TABLE.radius);
  const at = { x: -2 + direction * hit, z: -2 + direction * hit };
  assert.equal(obstructionAt(state.arcade, at.x - direction * 0.001, at.z - direction * 0.001, TABLE.radius), false);
  assert.equal(obstructionAt(state.arcade, at.x + direction * 0.001, at.z + direction * 0.001, TABLE.radius), true);
  const trace = firstTableContact(state, { x: -2, z: -2 }, Math.PI / 4);
  assert.equal(trace.kind, 'obstacle');
  assert.equal(trace.id, 3);
  close(trace.distance, hit);
  box.hp = 0;
  assert.notEqual(firstTableContact(state, { x: -2, z: -2 }, Math.PI / 4).kind, 'obstacle');
});

test('shared rail and jaw ray distances agree with Rapier sphere casts', async () => {
  await initPhysics();
  const state = emptyTable(),
    sphere = new RAPIER.Ball(TABLE.radius);
  const rotation = { x: 0, y: 0, z: 0, w: 1 },
    zero = { x: 0, y: 0, z: 0 };
  const colliders = [
    ...TABLE_RAILS.map((rail) => ({
      shape: new RAPIER.Cuboid(rail.halfWidth, rail.halfHeight, rail.halfDepth),
      position: { x: rail.x, y: rail.y, z: rail.z },
    })),
    ...TABLE_NOSES.map((nose) => ({
      shape: new RAPIER.Ball(nose.radius),
      position: { x: nose.x, y: nose.y, z: nose.z },
    })),
  ];
  let compared = 0;
  for (const origin of [
    { x: 0, z: 0 },
    { x: -3, z: 1.6 },
    { x: 4, z: -0.8 },
  ])
    for (let i = 0; i < 120; i++) {
      const angle = (i * Math.PI) / 60,
        hit = firstTableBoundary(state, origin, angle);
      if (hit.kind !== 'rail') continue;
      const velocity = { x: Math.cos(angle), y: 0, z: Math.sin(angle) };
      let physical = Infinity;
      for (const collider of colliders) {
        const result = sphere.castShape(
          { ...origin, y: TABLE.radius },
          rotation,
          velocity,
          collider.shape,
          collider.position,
          rotation,
          zero,
          0,
          30,
          true,
        );
        if (result) physical = Math.min(physical, result.time_of_impact);
      }
      close(hit.distance, physical, 0.001);
      compared++;
    }
  assert.ok(compared > 250);
});

test('first contact orders balls, obstacles and portals by actual entry distance', () => {
  const state = emptyTable();
  Object.assign(state.balls[0], { x: -3, z: 0, pocketed: false });
  Object.assign(state.balls[1], { x: 1, z: 0, pocketed: false });
  state.arcade!.hazards = [
    { id: 7, kind: 'portal', x: -1, z: 0, radius: 0.3, link: 8 },
    { id: 8, kind: 'portal', x: 3, z: 2, radius: 0.3, link: 7 },
  ];
  let hit = firstTableContact(state, state.balls[0], 0);
  assert.equal(hit.kind, 'portal');
  assert.equal(hit.id, 7);
  close(hit.distance, 1.7);
  assert.equal(segmentClearOfTable(state, state.balls[0], state.balls[1]), false);
  // Entering a portal depends on the center, not an inflated ball radius.
  assert.notEqual(firstTableContact(state, { x: -3, z: 0.31 }, 0).kind, 'portal');
  Object.assign(state.balls[1], { x: -2.5 });
  hit = firstTableContact(state, state.balls[0], 0);
  assert.equal(hit.kind, 'ball');
  assert.equal(hit.id, 1);
  close(hit.distance, 0.14);
  state.balls[1].elevation = 0.5;
  assert.equal(firstTableContact(state, state.balls[0], 0).kind, 'portal');
});

test('AI and aiming reject the same portal-blocked initial route', () => {
  const state = emptyTable();
  state.shotCount = 1;
  state.groups = ['solids', 'stripes'];
  Object.assign(state.balls[0], { x: -3, z: 0, pocketed: false });
  Object.assign(state.balls[1], { x: 1, z: 0, pocketed: false });
  const original = chooseShot(state, 'expert', () => 0.5);
  const portal = {
    id: 0,
    kind: 'portal' as const,
    x: -3 + Math.cos(original.angle) * 2,
    z: Math.sin(original.angle) * 2,
    radius: 0.12,
    link: 1,
  };
  state.arcade!.hazards = [portal, { id: 1, kind: 'portal', x: -4, z: 2, radius: 0.12, link: 0 }];
  assert.equal(firstTableContact(state, state.balls[0], original.angle).kind, 'portal');
  const adjusted = chooseShot(state, 'expert', () => 0.5);
  assert.notEqual(firstTableContact(state, state.balls[0], adjusted.angle).kind, 'portal');
  assert.ok(Math.abs(adjusted.angle - original.angle) > 0.005);
});

test('rays may depart a cushion after banking instead of colliding again at zero distance', () => {
  const state = emptyTable(),
    bounce = { x: 2, z: TABLE.halfDepth - TABLE.radius };
  assert.ok(firstTableBoundary(state, bounce, -Math.PI / 2).distance > 5);
  assert.ok(segmentClearOfTable(state, bounce, { x: 2, z: 0 }));
});

test('named ball policies retain tactical margins and ward rescue avoids hazards and pockets', () => {
  const state = emptyTable(),
    point = { x: -2, z: 1 };
  Object.assign(state.balls[1], { x: point.x + 0.39, z: point.z, pocketed: false });
  assert.equal(isClearBallSpot(state, point, 0, 'placement'), true);
  assert.equal(isClearBallSpot(state, point, 0, 'ai-placement'), false);
  assert.equal(isClearBallSpot(state, point, 0, 'portal-exit'), false);
  assert.equal(
    isClearBallSpot(state, state.balls[1], 1, 'object-respot'),
    true,
    'respot ignores only the ball being moved',
  );
  state.balls[1].pocketed = true;
  state.arcade!.hazards = [{ id: 0, kind: 'water', ...point, radius: 0.4 }];
  assert.equal(isClearBallSpot(state, point, 0, 'placement'), true);
  assert.equal(isClearBallSpot(state, point, 0, 'ai-fallback'), true);
  assert.equal(isClearBallSpot(state, point, 0, 'ward-respot'), false);
  state.arcade!.hazards[0].kind = 'portal';
  assert.equal(isClearBallSpot(state, point, 0, 'ai-fallback'), false);
  for (const pocket of POCKETS) assert.equal(isClearBallSpot(state, pocket, 0, 'ward-respot'), false);
  assert.equal(isClearBallSpot(state, { x: Infinity, z: 0 }, 0, 'placement'), false);
});

test('surface drag takes the strongest overlapping zone and composes sticky cue drag once', () => {
  const state = emptyTable();
  state.arcade!.hazards = [
    { id: 0, kind: 'water', x: 0, z: 0, radius: 1 },
    { id: 1, kind: 'slime', x: 0.5, z: 0, radius: 1 },
    { id: 2, kind: 'electric', x: 0.5, z: 0, radius: 1 },
  ];
  close(surfaceDragAt(state.arcade, { x: -2, z: 0 }), 1);
  close(surfaceDragAt(state.arcade, { x: -0.8, z: 0 }), 2.5);
  close(surfaceDragAt(state.arcade, { x: 0, z: 0 }), 4.5);
  close(rollingDeceleration(10), 1.62);
  close(rollingDeceleration(10, surfaceDragAt(state.arcade, { x: 0, z: 0 }) * STICKY_DRAG), 1.62 * 4.5 * 2.4);
});

test('seeded layouts stay deterministic and satisfy the same shared clearance policies', () => {
  for (const layout of [
    'crossfire',
    'fortress',
    'gauntlet',
    'riptide',
    'livewire',
    'blackout',
  ] satisfies ArenaLayout[])
    for (let level = 1; level <= 5; level++)
      for (let seed = 0; seed < 8; seed++) {
        const state = initialState(`geometry-layout-${seed}`),
          arcade = createArcade(layout, state.seed, level);
        assert.deepEqual(arcade, createArcade(layout, state.seed, level));
        const staged = { ...arcade, obstacles: [], hazards: [], pickups: [] } as typeof arcade;
        for (const block of arcade.obstacles) {
          assert.ok(isClearLayoutBlock(staged, state.balls, block));
          staged.obstacles.push(block);
        }
        for (const hazard of arcade.hazards) {
          assert.ok(isClearLayoutHazard(staged, state.balls, hazard));
          staged.hazards.push(hazard);
        }
        for (const pickup of arcade.pickups) {
          assert.ok(isClearLayoutPickup(staged, state.balls, pickup, pickup.radius));
          staged.pickups.push(pickup);
        }
        state.arcade = arcade;
        const first = firstTableContact(state, state.balls[0], 0);
        assert.equal(first.kind, 'ball');
        assert.equal(first.id, 1);
      }
});

test('pickup and temporary portal policies keep spawned objects separated and reproducible', () => {
  const state = emptyTable();
  assert.equal(isClearPickupSpawn(state, { x: 0, z: 0 }), false, 'break corridor is reserved');
  assert.equal(isClearPickupSpawn(state, { x: 20, z: 0 }), false, 'spawn policy is bounded by the table');
  assert.equal(isClearPickupSpawn(state, { x: -2, z: 1.2 }), true);
  const copy = structuredClone(state);
  assert.equal(spawnTemporaryPortals(state), true);
  assert.equal(spawnTemporaryPortals(copy), true);
  assert.deepEqual(state.arcade!.hazards, copy.arcade!.hazards);
  const points: { x: number; z: number }[] = [];
  for (const portal of state.arcade!.hazards) {
    assert.ok(isClearPortalSpawn(state, portal, portal.radius, points));
    points.push(portal);
  }
  assert.ok(Math.hypot(points[0].x - points[1].x, points[0].z - points[1].z) >= 3);
});
