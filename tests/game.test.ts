import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initPhysics, PoolGame } from '../src/simulation/game';
import { initialState, legalTargets, newRack, seededRandom, TABLE, type ShotResult } from '../src/simulation/types';
import { settleShot } from '../src/simulation/settlement';
import { edit } from './arrangements';
import { chooseShot, choosePlacement } from '../src/simulation/ai';
before(async () => {
  await initPhysics();
});
const result = (overrides: Partial<ShotResult> = {}): ShotResult => ({
  firstContact: 1,
  potted: [],
  railAfterContact: true,
  breakRails: [1, 2, 3, 4],
  ...overrides,
});

test('rack seed is repeatable, complete, non-overlapping and has a legal eight and corners', () => {
  assert.deepEqual(newRack('ABC123'), newRack('ABC123'));
  assert.notDeepEqual(newRack('ABC123'), newRack('DEF456'));
  const balls = newRack('ABC123');
  assert.equal(new Set(balls.map((b) => b.id)).size, 16);
  assert.equal(balls[8].z, 0);
  const corners = balls.filter((b) => Math.abs(b.z) > TABLE.radius * 3.9);
  assert.equal(corners.length, 2);
  assert.ok(corners.some((b) => b.id < 8));
  assert.ok(corners.some((b) => b.id > 8));
  for (const a of balls)
    for (const b of balls) if (a.id !== b.id) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= TABLE.radius * 2);
});
test('shot validation rejects invalid, duplicate and out-of-range shots', () => {
  const game = new PoolGame('validation');
  try {
    assert.equal(game.shoot({ angle: NaN, power: 0.5 }), false);
    assert.equal(game.shoot({ angle: 0, power: Infinity }), false);
    assert.equal(game.shoot({ angle: 0, power: 2 }), false);
    assert.equal(game.shoot({ angle: 0, power: 0.9 }), true);
    assert.equal(game.shoot({ angle: 0, power: 0.9 }), false);
  } finally {
    game.dispose();
  }
});
test('full physical break contacts the rack and settles without escaping the table', () => {
  const game = new PoolGame('physical-break');
  try {
    edit(game, (state) => {
      delete state.arcade;
    });
    game.shoot({ angle: 0, power: 0.95 });
    let steps = 0;
    while (game.state.phase === 'rolling' && steps++ < 4000) game.step();
    assert.ok(steps < 4000);
    assert.equal(game.state.shotCount, 1);
    assert.ok(game.state.balls.filter((b) => b.id > 0).some((b) => Math.abs(b.z) > 1));
    for (const b of game.state.balls.filter((b) => !b.pocketed)) {
      assert.ok(Math.abs(b.x) < 6);
      assert.ok(Math.abs(b.z) < 3.2);
      assert.ok(Number.isFinite(b.x));
      assert.equal(b.vx, 0);
    }
  } finally {
    game.dispose();
  }
});
test('scratch gives the next player ball in hand and invalid placements are rejected', () => {
  const game = new PoolGame('scratch');
  try {
    const state = game.snapshot();
    delete state.arcade;
    state.shotCount = 1;
    game.arrange(settleShot(state, result({ potted: [0] }), { legalBefore: [1, 2, 3] }).state);
    assert.equal(game.state.turn, 1);
    assert.equal(game.state.phase, 'ball-in-hand');
    assert.equal(game.placeCue(100, 0), false);
    assert.equal(game.placeCue(NaN, 0), false);
    assert.equal(game.placeCue(game.state.balls[1].x, game.state.balls[1].z), false);
    assert.equal(game.placeCue(-3, 1), true);
    assert.equal(game.state.balls[0].pocketed, false);
    assert.equal(game.state.phase, 'ready');
  } finally {
    game.dispose();
  }
});
test('AI difficulty changes precision, and every AI can complete a playable sequence', () => {
  const example = initialState('precision');
  example.shotCount = 1;
  assert.notDeepEqual(
    chooseShot(example, 'casual', () => 0.9),
    chooseShot(example, 'expert', () => 0.9),
  );
  for (const difficulty of ['casual', 'regular', 'expert'] as const) {
    const game = new PoolGame(`ai-${difficulty}`),
      random = seededRandom('stable-ai');
    try {
      for (let i = 0; i < 12 && game.state.phase !== 'over'; i++) {
        if (game.state.phase === 'ball-in-hand') {
          const p = choosePlacement(game.state);
          assert.equal(game.placeCue(p.x, p.z), true);
        }
        const shot = chooseShot(game.state, difficulty, random);
        assert.ok(Number.isFinite(shot.angle));
        assert.ok(shot.power > 0 && shot.power <= 1);
        assert.equal(game.shoot(shot), true);
        for (let steps = 0; game.state.phase === 'rolling' && steps < 4000; steps++) game.step();
        assert.notEqual(game.state.phase, 'rolling');
      }
      assert.ok(game.state.shotCount > 1);
    } finally {
      game.dispose();
    }
  }
});
