import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { PoolGame, initPhysics } from '../src/simulation/game';
import { arrangeBalls, edit } from './arrangements';
import type { TableEvent } from '../src/simulation/types';

before(async () => {
  await initPhysics();
});
function finish(game: PoolGame) {
  for (let i = 0; i < 4000 && game.state.phase === 'rolling'; i++) game.step();
  assert.notEqual(game.state.phase, 'rolling');
}

test('arrangements and snapshots detach all nested data while public state rejects mutation', () => {
  const game = new PoolGame('immutable-arrangement');
  try {
    const state = game.snapshot();
    state.balls[0].x = -4;
    state.arcade!.obstacles[0].hp = 0;
    game.arrange(state);
    state.balls[0].x = 4;
    state.arcade!.buffs[0].ward = 1;
    assert.equal(game.state.balls[0].x, -4);
    assert.equal(game.state.arcade!.buffs[0].ward, 0);
    assert.throws(() => {
      game.state.balls[0].x = 1;
    }, /read-only/);
    assert.throws(
      () => game.state.arcade!.pickups.push({ id: 99, x: 0, z: 0, radius: 0.1, available: true }),
      /read-only/,
    );
    const snapshot = game.snapshot();
    snapshot.balls[0].x = 3;
    assert.equal(game.state.balls[0].x, -4);
    const invalid = game.snapshot();
    invalid.balls[1].id = 0;
    assert.throws(() => game.arrange(invalid), /sixteen/);
    const nonfinite = game.snapshot();
    nonfinite.balls[0].vx = NaN;
    assert.throws(() => game.arrange(nonfinite), /finite/);
    assert.equal(game.state.balls[0].x, -4, 'invalid arrangements leave the current world intact');
    assert.equal(game.shoot({ angle: 0, power: 0.2 }), true);
    game.step();
    assert.ok(game.state.balls[0].x > -4);
  } finally {
    game.dispose();
  }
});

test('arranging arbitrary live/dead obstacle IDs rebuilds collision geometry and pocketed body activation', () => {
  const game = new PoolGame('arranged-colliders');
  try {
    arrangeBalls(game, { 0: { x: -2, z: 0 }, 1: { x: 3, z: 1 } });
    edit(game, (state) => {
      state.arcade!.obstacles = [{ id: 17, x: -0.7, z: 0, width: 0.5, depth: 0.8, hp: 2, maxHp: 2, material: 'wood' }];
    });
    const events: TableEvent[] = [];
    game.onEvent = (e) => events.push(e);
    game.shoot({ angle: 0, power: 0.2 });
    for (let i = 0; i < 80 && !events.some((e) => e.kind === 'obstacle'); i++) game.step();
    assert.ok(events.some((e) => e.kind === 'obstacle' && e.obstacle === 17));
    assert.equal(game.state.arcade!.obstacles[0].hp, 1);
    arrangeBalls(game, { 0: { x: -2, z: 0 }, 2: { x: -0.7, z: 0 } });
    edit(game, (state) => {
      state.phase = 'ready';
      state.arcade!.obstacles[0].hp = 0;
    });
    events.length = 0;
    game.shoot({ angle: 0, power: 0.2 });
    for (let i = 0; i < 80 && !events.some((e) => e.kind === 'ball'); i++) game.step();
    assert.ok(events.some((e) => e.kind === 'ball'));
    assert.equal(
      events.some((e) => e.kind === 'obstacle'),
      false,
    );
    assert.ok(game.state.balls[2].vx > 0, 'formerly pocketed numbered balls become real active colliders');
  } finally {
    game.dispose();
  }
});

test('a detached midair snapshot restores height, vertical velocity and the spin reservoir', () => {
  const original = new PoolGame('restore-flight'),
    restored = new PoolGame('unused-seed');
  try {
    arrangeBalls(original, { 0: { x: -4, z: 0 } }, { arcade: false });
    original.chalkCue();
    original.shoot({ angle: 0.15, power: 0.9, tipY: -0.75, tipX: 0.1, elevation: 0.2 });
    for (let i = 0; i < 8; i++) original.step();
    const snapshot = original.snapshot();
    assert.ok(snapshot.balls[0].airborne);
    assert.ok(snapshot.simulation!.cueSpin.energy > 0);
    restored.arrange(snapshot);
    assert.deepEqual(restored.snapshot(), snapshot);
    for (let i = 0; i < 12; i++) {
      original.step();
      restored.step();
      for (const field of ['x', 'z', 'elevation', 'vy', 'vx', 'vz'] as const)
        assert.ok(
          Math.abs((original.state.balls[0][field] ?? 0) - (restored.state.balls[0][field] ?? 0)) < 1e-5,
          field,
        );
    }
    finish(original);
    finish(restored);
    assert.equal(restored.state.shotCount, 1);
    assert.equal(restored.state.foul, original.state.foul);
    assert.equal(restored.state.turn, original.state.turn);
  } finally {
    original.dispose();
    restored.dispose();
  }
});

test('restoring a rolling shot preserves earlier pot/contact, queued portal reward and doubles settlement', () => {
  const original = new PoolGame('restore-settlement', { format: 'doubles' }),
    restored = new PoolGame('unused');
  try {
    arrangeBalls(original, { 0: { x: 0, z: -1 }, 1: { x: 0, z: -2.4 }, 2: { x: 3, z: 1 } });
    edit(original, (state) => {
      state.shotCount = 1;
      state.arcade!.pickups = [{ id: 11, x: 0, z: -1.45, radius: 0.16, available: true, power: 'portal' }];
    });
    original.shoot({ angle: -Math.PI / 2, power: 0.16 });
    for (let i = 0; i < 120 && !original.state.balls[1].pocketed; i++) original.step();
    assert.equal(original.state.phase, 'rolling');
    assert.equal(original.state.balls[1].pocketed, true);
    const snapshot = original.snapshot();
    assert.equal(snapshot.simulation!.shotResult.firstContact, 1);
    assert.equal(snapshot.simulation!.portalRewardPending, true);
    restored.arrange(snapshot);
    finish(original);
    finish(restored);
    for (const game of [original, restored]) {
      assert.equal(game.state.foul, false);
      assert.equal(game.state.turn, 0);
      assert.deepEqual(game.state.teamOrder, [1, 0]);
      assert.deepEqual(game.state.lastPotted, [1]);
      assert.equal(game.state.arcade!.scores[0], 125);
      assert.equal(game.state.arcade!.portalTurns, 2);
    }
    assert.deepEqual(original.state.arcade!.hazards, restored.state.arcade!.hazards);
  } finally {
    original.dispose();
    restored.dispose();
  }
});

test('ready-table restore and idle catchup preserve seeded pickup scheduling without moving balls', () => {
  const stepped = new PoolGame('restore-timers'),
    fast = new PoolGame('restore-timers'),
    restored = new PoolGame('unused');
  try {
    for (let i = 0; i < 15 * 120; i++) stepped.step();
    fast.advanceIdle(15);
    assert.equal(stepped.state.arcade!.pickups.length, fast.state.arcade!.pickups.length);
    for (let i = 0; i < fast.state.arcade!.pickups.length; i++) {
      const a = stepped.state.arcade!.pickups[i],
        b = fast.state.arcade!.pickups[i];
      assert.equal(a.id, b.id);
      assert.equal(a.power, b.power);
      assert.equal(a.x, b.x);
      assert.equal(a.z, b.z);
      assert.ok(Math.abs(a.expiresAt! - b.expiresAt!) < 1e-7);
    }
    restored.arrange(stepped.snapshot());
    for (let i = 0; i < 12 * 120; i++) {
      stepped.step();
      restored.step();
    }
    assert.deepEqual(restored.snapshot(), stepped.snapshot());
    assert.deepEqual(fast.state.balls, stepped.state.balls);
  } finally {
    stepped.dispose();
    fast.dispose();
    restored.dispose();
  }
});

test('restoring an existing collision does not repeat its contact event or damage', () => {
  const original = new PoolGame('restore-contact'),
    restored = new PoolGame('unused');
  try {
    arrangeBalls(original, { 0: { x: -1.3, z: 0 }, 1: { x: 0, z: 0 } });
    const events: TableEvent[] = [];
    original.onEvent = (e) => events.push(e);
    original.shoot({ angle: 0, power: 0.3, tipY: 0.6 });
    for (let i = 0; i < 120 && !events.some((e) => e.kind === 'ball'); i++) original.step();
    assert.ok(events.some((e) => e.kind === 'ball'));
    const snapshot = original.snapshot();
    assert.ok(snapshot.simulation!.activeContacts!.some((key) => key.includes('ball:0') && key.includes('ball:1')));
    restored.arrange(snapshot);
    const repeated: TableEvent[] = [];
    restored.onEvent = (e) => repeated.push(e);
    original.step();
    restored.step();
    assert.equal(
      repeated.some((e) => e.kind === 'ball'),
      false,
    );
    assert.ok(
      Math.abs(original.state.balls[0].vx - restored.state.balls[0].vx) < 0.01,
      'follow spin cannot be applied twice when restoring contact',
    );
  } finally {
    original.dispose();
    restored.dispose();
  }
});
