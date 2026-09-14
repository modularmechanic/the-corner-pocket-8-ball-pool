import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { arrangeBalls, edit } from './arrangements';
import { PoolGame, initPhysics } from '../src/simulation/game';
import { TABLE, type Shot, type TableEvent } from '../src/simulation/types';

before(async () => {
  await initPhysics();
});
type Position = { x: number; z: number; elevation?: number; vy?: number };
function fixture(positions: Record<number, Position>, arcade = false) {
  const game = new PoolGame('flight-fixture');
  arrangeBalls(game, positions, { arcade });
  const events: TableEvent[] = [];
  game.onEvent = (e) => events.push(e);
  return { game, events };
}
function settle(game: PoolGame) {
  let steps = 0;
  while (game.state.phase === 'rolling' && steps++ < 4000) game.step();
  assert.ok(steps < 4000, 'all flight must finish before the safety timeout');
}
const mechanical = (game: PoolGame) =>
  game.state.balls.reduce(
    (e, b) => e + (b.pocketed ? 0 : b.vx * b.vx + b.vz * b.vz + (b.vy || 0) ** 2 + 28 * (b.elevation || 0)),
    0,
  );

test('hard low-tip shots physically clear a ball that stops an equivalent center hit', () => {
  for (const tipY of [0, -0.8]) {
    const { game, events } = fixture({ 0: { x: -3, z: 0 }, 1: { x: -1, z: 0 } });
    try {
      game.shoot({ angle: 0, power: 1, tipY });
      let crossed = false,
        peak = 0;
      for (let i = 0; i < 45; i++) {
        game.step();
        peak = Math.max(peak, game.state.balls[0].elevation || 0);
        if (game.state.balls[0].x > -0.55) {
          crossed = true;
          break;
        }
      }
      if (tipY < 0) {
        assert.ok(crossed);
        assert.ok(peak > TABLE.radius * 2);
        assert.equal(
          events.some((e) => e.kind === 'ball'),
          false,
          'the elevated collider must clear the target',
        );
        assert.equal(game.state.balls[1].vx, 0);
        assert.equal(game.state.balls[1].x, -1);
        assert.ok(events.some((e) => e.kind === 'jump'));
      } else {
        assert.ok(events.some((e) => e.kind === 'ball'));
        assert.ok(game.state.balls[1].vx > 1);
        assert.equal(peak, 0, 'flat center strikes remain on the cloth');
      }
    } finally {
      game.dispose();
    }
  }
});

test('a low airborne glancing strike still hits the target through real sphere contact', () => {
  const { game, events } = fixture({ 0: { x: -3, z: 0 }, 1: { x: -2.25, z: 0.08 }, 2: { x: 2, z: 1.5 } });
  try {
    game.shoot({ angle: 0, power: 1, tipY: -0.8 });
    let collided = false;
    for (let i = 0; i < 30; i++) {
      game.step();
      if (events.some((e) => e.kind === 'ball')) {
        collided = true;
        break;
      }
    }
    assert.ok(collided, 'partial vertical overlap must collide instead of ghosting');
    assert.ok(game.state.balls[0].airborne);
    assert.ok(Math.hypot(game.state.balls[1].vx, game.state.balls[1].vz) > 1);
    assert.equal(game.state.balls[2].vx, 0);
    assert.equal(game.state.balls[2].vz, 0);
  } finally {
    game.dispose();
  }
});

test('an airborne object ball receives vertical momentum from a collision below its center', () => {
  const { game, events } = fixture({ 0: { x: -1, z: 0 }, 1: { x: 0, z: 0, elevation: 0.2, vy: -0.1 } });
  try {
    game.shoot({ angle: 0, power: 0.7 });
    let collided = false;
    for (let i = 0; i < 30; i++) {
      game.step();
      if (events.some((e) => e.kind === 'ball')) {
        collided = true;
        break;
      }
    }
    assert.ok(collided);
    assert.ok(game.state.balls[1].vy! > 1, 'the full 3D impulse lifts the object ball');
    assert.ok(game.state.balls[1].vx > 1);
    assert.ok(game.state.balls[1].airborne);
    const height = game.state.balls[1].elevation!;
    for (let i = 0; i < 8; i++) game.step();
    assert.ok(
      game.state.balls[1].elevation! > height,
      'height follows the upward impulse rather than a cosmetic animation',
    );
  } finally {
    game.dispose();
  }
});

test('jump trajectories rise, fall, land on cloth and settle with synchronized collider heights', () => {
  const { game, events } = fixture({ 0: { x: -4, z: 0 } });
  try {
    game.shoot({ angle: 0, power: 0.9, tipY: -0.8 });
    let descending = false,
      peak = 0;
    for (let i = 0; i < 120 && game.state.phase === 'rolling'; i++) {
      game.step();
      const cue = game.state.balls[0];
      peak = Math.max(peak, cue.elevation || 0);
      descending ||= (cue.vy || 0) < -0.5;
      assert.ok(
        cue.elevation! >= 0 && Number.isFinite(cue.vy),
        'flight snapshots contain physical height and vertical velocity',
      );
      if (events.some((e) => e.kind === 'land')) break;
    }
    assert.ok(peak > 0.25 && descending);
    assert.ok(events.some((e) => e.kind === 'land'));
    settle(game);
    const cue = game.state.balls[0];
    assert.equal(cue.elevation, 0);
    assert.equal(cue.vy, 0);
    assert.equal(cue.airborne, false);
    const settled = game.snapshot().balls;
    for (let i = 0; i < 60; i++) game.step();
    assert.deepEqual(game.state.balls, settled);
  } finally {
    game.dispose();
  }
});

test('airborne balls pass over pocket mouths and become off-table fouls without pot credit', () => {
  const { game, events } = fixture({ 0: { x: -3, z: 1 }, 1: { x: 0, z: -2.45, elevation: 0.8 } });
  try {
    edit(game, (state) => {
      state.shotCount = 1;
    });
    game.shoot({ angle: 0, power: 0.03 });
    edit(game, (state) => {
      state.balls[1].vz = -8;
    });
    for (let i = 0; i < 20 && !events.some((e) => e.kind === 'out'); i++) game.step();
    assert.equal(
      events.some((e) => e.kind === 'pocket' && e.ball === 1),
      false,
      'a high ball must not be sucked into a pocket',
    );
    assert.ok(events.some((e) => e.kind === 'out' && e.ball === 1));
    settle(game);
    assert.equal(game.state.foul, true);
    assert.equal(game.state.balls[1].pocketed, false, 'off-table object balls return to play');
    assert.equal(game.state.lastPotted.includes(1), false);
    assert.equal(game.state.balls[1].elevation, 0);
  } finally {
    game.dispose();
  }
});

test('airborne cue balls ignore terrain, portals and power-ups beneath their flight', () => {
  const { game, events } = fixture({ 0: { x: -3, z: 0 } }, true);
  try {
    edit(game, (state) => {
      state.arcade!.hazards = [
        { id: 0, kind: 'electric', x: -1.7, z: 0, radius: 0.23 },
        { id: 1, kind: 'water', x: -1.7, z: 0, radius: 0.23 },
        { id: 2, kind: 'smoke', x: -1.7, z: 0, radius: 0.23 },
        { id: 3, kind: 'portal', x: -1.7, z: 0, radius: 0.23, link: 4 },
        { id: 4, kind: 'portal', x: 3, z: 1.5, radius: 0.23, link: 3 },
      ];
    });
    edit(game, (state) => {
      state.arcade!.pickups = [{ id: 5, x: -1.7, z: 0, radius: 0.16, available: true, power: 'ward' }];
    });
    game.shoot({ angle: 0, power: 1, tipY: -0.8 });
    while (game.state.balls[0].x < -0.8 && game.state.phase === 'rolling') game.step();
    assert.ok(game.state.balls[0].airborne);
    assert.equal(game.state.balls[0].teleport || 0, 0);
    assert.equal(
      events.some((e) => e.kind === 'hazard' || e.kind === 'pickup'),
      false,
    );
    assert.equal(game.state.arcade!.pickups[0].available, true);
    assert.equal(game.state.arcade!.scores[0], 0);
  } finally {
    game.dispose();
  }
});

test('jump lift responds to low contact, cue elevation and shot power without making ordinary draw shots jump', () => {
  const shots: Shot[] = [
    { angle: 0, power: 1 },
    { angle: 0, power: 0.4, tipY: -0.8 },
    { angle: 0, power: 0.75, tipY: -0.8 },
    { angle: 0, power: 1, tipY: -0.8 },
    { angle: 0, power: 1, elevation: Math.PI / 3 },
  ];
  const lifts: number[] = [];
  for (const shot of shots) {
    const { game } = fixture({ 0: { x: -3, z: 0 } });
    try {
      game.shoot(shot);
      lifts.push(game.state.balls[0].vy || 0);
    } finally {
      game.dispose();
    }
  }
  assert.equal(lifts[0], 0);
  assert.equal(lifts[1], 0);
  assert.ok(lifts[2] > 0.45 && lifts[3] > lifts[2]);
  assert.ok(lifts[4] > 1);
});

test('cloth draw grows with strike power and elevated side contact curves in the chosen direction', () => {
  const draws: number[] = [];
  for (const power of [0.2, 0.45]) {
    const { game, events } = fixture({ 0: { x: -1, z: 0 }, 1: { x: 0, z: 0 } });
    try {
      game.shoot({ angle: 0, power, tipY: -0.8 });
      for (let i = 0; i < 100 && !events.some((e) => e.kind === 'ball'); i++) game.step();
      for (let i = 0; i < 4; i++) game.step();
      assert.equal(game.state.balls[0].airborne, false);
      draws.push(-game.state.balls[0].vx);
    } finally {
      game.dispose();
    }
  }
  assert.ok(draws[0] > 0.1 && draws[1] > draws[0] * 1.4, 'a stronger low contact produces stronger post-contact draw');
  for (const tipX of [-0.7, 0.7]) {
    const curves: number[] = [];
    for (const elevation of [0, 0.75]) {
      const { game } = fixture({ 0: { x: -3, z: 0 } });
      try {
        game.shoot({ angle: 0, power: 0.4, tipX, elevation });
        for (let i = 0; i < 60; i++) game.step();
        curves.push(game.state.balls[0].z);
        assert.equal(game.state.balls[0].airborne, false);
      } finally {
        game.dispose();
      }
    }
    assert.equal(curves[0], 0);
    assert.ok(curves[1] * Math.sign(tipX) > 0.015, 'raised side contact grips the felt into a visible curve');
  }
});

test('boosted jump and side-draw tricks stay finite and bound total flight energy', () => {
  for (const [tipX, tipY, elevation] of [
    [0, -0.8, 0],
    [0.3, -0.7, 0.5],
    [-0.7, -0.3, Math.PI / 3],
    [0, 0, Math.PI / 3],
  ]) {
    const game = new PoolGame(`flight-stress-${tipX}-${tipY}`, { level: 5 });
    try {
      edit(game, (state) => {
        state.arcade!.hazards = [];
      });
      edit(game, (state) => {
        state.arcade!.pickups = [];
      });
      edit(game, (state) => {
        state.arcade!.buffs[0].overdrive = 1;
      });
      game.chalkCue();
      game.shoot({ angle: 0.015, power: 1, tipX, tipY, elevation });
      const initial = mechanical(game);
      let steps = 0;
      while (game.state.phase === 'rolling' && steps++ < 4000) {
        game.step(1 / 30);
        assert.ok(
          mechanical(game) <= initial * 1.16 + 1e-5,
          'spin may release its bounded initial reservoir, never runaway energy',
        );
        assert.ok(
          game.state.balls.every((b) => [b.x, b.z, b.vx, b.vz, b.elevation || 0, b.vy || 0].every(Number.isFinite)),
        );
      }
      assert.ok(steps < 4000);
      assert.equal(
        game.state.balls.some((b) => b.airborne),
        false,
      );
    } finally {
      game.dispose();
    }
  }
});
