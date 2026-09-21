import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { arrangeBalls, edit } from './arrangements';
import { PoolGame, initPhysics } from '../src/simulation/game';
import { TABLE, type Hazard, type HazardKind, type TableEvent } from '../src/simulation/types';

before(async () => {
  await initPhysics();
});
const speed = (game: PoolGame, id = 0) => Math.hypot(game.state.balls[id].vx, game.state.balls[id].vz);
function setup(game: PoolGame, positions: Record<number, { x: number; z: number }>, hazards: Hazard[]) {
  arrangeBalls(game, positions, { hazards });
}
function settle(game: PoolGame) {
  for (let step = 0; game.state.phase === 'rolling' && step < 4000; step++) game.step();
  assert.notEqual(game.state.phase, 'rolling');
}
const portals = (): Hazard[] => [
  { id: 0, kind: 'portal', x: -2, z: 0, radius: 0.4, link: 1 },
  { id: 1, kind: 'portal', x: 2, z: 0, radius: 0.4, link: 0 },
];

test('a moving ball enters a portal once, preserves speed and emerges clear of the linked portal', () => {
  const game = new PoolGame('portal-transit');
  try {
    setup(game, { 0: { x: -2.65, z: 0 } }, portals());
    const events: TableEvent[] = [];
    game.onEvent = (event) => events.push(event);
    game.shoot({ angle: 0, power: 0.2 });
    let priorSpeed = speed(game);
    for (let step = 0; !game.state.balls[0].teleport && step < 120; step++) {
      priorSpeed = speed(game);
      game.step();
    }
    const cue = game.state.balls[0];
    assert.equal(cue.teleport, 1);
    assert.ok(cue.x >= 2.68 - 1e-5 && Math.abs(cue.z) < 1e-6);
    assert.ok(
      speed(game) <= priorSpeed && speed(game) > priorSpeed * 0.98,
      'teleportation preserves momentum apart from normal cloth friction',
    );
    const event = events.find((event) => event.hazard === 'portal')!;
    assert.ok(event);
    assert.ok(event.fromX! < -1.5 && Math.abs(event.fromZ!) < 1e-6);
    assert.ok(event.x > 2.6 && event.ball === 0);
    for (let step = 0; step < 12; step++) game.step();
    assert.equal(cue.teleport, 1, 'the linked portal must not immediately send the ball back');
    assert.equal(events.filter((event) => event.hazard === 'portal').length, 1);
  } finally {
    game.dispose();
  }
});

test('a portal refuses transit when all candidate exits are occupied by other balls', () => {
  const game = new PoolGame('portal-blocked');
  try {
    const positions: Record<number, { x: number; z: number }> = { 0: { x: -2.65, z: 0 } };
    [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI].forEach((angle, index) => {
      positions[index + 1] = { x: 2 + Math.cos(angle) * 0.68, z: Math.sin(angle) * 0.68 };
    });
    setup(game, positions, portals());
    const events: TableEvent[] = [];
    game.onEvent = (event) => events.push(event);
    game.shoot({ angle: 0, power: 0.2 });
    for (let step = 0; step < 36; step++) game.step();
    assert.equal(game.state.balls[0].teleport || 0, 0);
    assert.equal(events.filter((event) => event.hazard === 'portal').length, 0);
    assert.ok(game.state.balls[0].x < 0, 'a blocked portal leaves the incoming ball on its original side');
    for (let id = 1; id <= 6; id++)
      assert.equal(speed(game, id), 0, 'a blocked teleport must never push exit occupants');
  } finally {
    game.dispose();
  }
});

test('stationary balls inside portals or electrical pads never move or teleport on another ball’s shot', () => {
  for (const kind of ['portal', 'electric'] as const) {
    const game = new PoolGame(`stationary-${kind}`);
    try {
      const hazards = portals();
      hazards[0].kind = kind;
      setup(game, { 0: { x: -3, z: 0.8 }, 1: { x: -2, z: 0 } }, hazards);
      const events: TableEvent[] = [];
      game.onEvent = (event) => events.push(event);
      game.shoot({ angle: Math.PI, power: 0.03 });
      for (let step = 0; step < 36; step++) game.step();
      assert.equal(game.state.balls[1].x, -2);
      assert.equal(game.state.balls[1].z, 0);
      assert.equal(speed(game, 1), 0);
      assert.equal(game.state.balls[1].teleport || 0, 0);
      assert.equal(
        events.some((event) => event.kind === 'hazard' && event.ball === 1),
        false,
      );
    } finally {
      game.dispose();
    }
  }
});

test('water and slime add drag, with slime slowing a ball more than water', () => {
  const speeds: number[] = [];
  for (const kind of [null, 'water', 'slime'] as const) {
    const game = new PoolGame(`drag-${kind}`);
    try {
      setup(game, { 0: { x: -2.5, z: 0 } }, kind ? [{ id: 0, kind, x: -2, z: 0, radius: 0.8 }] : []);
      const events: TableEvent[] = [];
      game.onEvent = (event) => events.push(event);
      game.shoot({ angle: 0, power: 0.12 });
      for (let step = 0; step < 24; step++) game.step();
      speeds.push(speed(game));
      if (kind)
        assert.equal(
          events.filter((event) => event.hazard === kind).length,
          1,
          'a continuous puddle crossing emits one entry effect',
        );
    } finally {
      game.dispose();
    }
  }
  assert.ok(speeds[0] > speeds[1] && speeds[1] > speeds[2]);
  assert.ok(speeds[0] - speeds[2] > 0.3, 'slime must have a meaningful slowing effect');
});

// Ramps are a shape rather than a zone effect and are covered end to end in ramps.test.ts.
test('only entering a declared electric pad can add speed, with a matching visible event and one score award', () => {
  for (const kind of ['electric', 'water', 'slime', 'smoke'] satisfies HazardKind[]) {
    const game = new PoolGame(`hazard-energy-${kind}`);
    try {
      setup(game, { 0: { x: -2.5, z: 0 } }, [{ id: 0, kind, x: -2, z: 0, radius: 0.6, angle: 0 }]);
      const events: TableEvent[] = [];
      game.onEvent = (event) => events.push(event);
      game.shoot({ angle: 0, power: 0.12 });
      const before = speed(game);
      game.step();
      assert.equal(events.filter((event) => event.hazard === kind).length, 1);
      const energized = kind === 'electric';
      assert.equal(speed(game) > before, energized, `${kind} must obey its declared effect`);
      for (let step = 0; step < 10; step++) game.step();
      assert.equal(
        events.filter((event) => event.hazard === kind).length,
        1,
        'remaining on a pad cannot repeatedly boost or score',
      );
      assert.equal(game.state.arcade!.scores[0], energized ? 15 : 0);
    } finally {
      game.dispose();
    }
  }
});

test('smoke jams the active player only when the moving cue enters the cloud', () => {
  for (const cueInSmoke of [false, true]) {
    const game = new PoolGame(`smoke-${cueInSmoke}`);
    try {
      setup(game, cueInSmoke ? { 0: { x: -2.5, z: 0 } } : { 0: { x: -3, z: 0.8 }, 1: { x: -2.5, z: 0 } }, [
        { id: 0, kind: 'smoke', x: -2, z: 0, radius: 0.6 },
      ]);
      game.shoot({ angle: cueInSmoke ? 0 : Math.PI, power: 0.12 });
      if (!cueInSmoke) {
        edit(game, (state) => {
          state.balls[1].vx = 3;
        });
      }
      game.step();
      assert.equal(game.state.arcade!.buffs[0].jammed, cueInSmoke ? 1 : 0);
      assert.equal(game.state.arcade!.buffs[1].jammed, 0);
    } finally {
      game.dispose();
    }
  }
});

test('legal pots award points and a two-ball combo bonus; fouled pots award no pot points', () => {
  for (const count of [1, 2]) {
    const game = new PoolGame(`pot-score-${count}`, { layout: 'fortress' });
    try {
      const positions: Record<number, { x: number; z: number }> = { 0: { x: 0, z: -1.4 }, 1: { x: 0, z: -2.15 } };
      if (count === 2) positions[2] = { x: 0, z: 2.4 };
      setup(game, positions, []);
      edit(game, (state) => {
        state.shotCount = 1;
      });
      game.shoot({ angle: -Math.PI / 2, power: 0.2 });
      if (count === 2) {
        edit(game, (state) => {
          state.balls[2].vz = 3;
        });
      }
      settle(game);
      assert.equal(game.state.foul, false);
      assert.equal(game.state.lastPotted.length, count);
      assert.equal(game.state.arcade!.combo, count);
      assert.equal(game.state.arcade!.scores[0], count === 1 ? 100 : 225);
      assert.equal(game.state.arcade!.scores[1], 0);
    } finally {
      game.dispose();
    }
  }
  const game = new PoolGame('foul-pot-score');
  try {
    setup(game, { 0: { x: 0, z: -2.4 }, 1: { x: 0, z: 2.4 } }, []);
    edit(game, (state) => {
      state.shotCount = 1;
    });
    game.shoot({ angle: -Math.PI / 2, power: 0.2 });
    edit(game, (state) => {
      state.balls[1].vz = 3;
    });
    settle(game);
    assert.equal(game.state.balls[0].pocketed, true);
    assert.deepEqual(game.state.lastPotted, [1]);
    assert.equal(game.state.foul, true);
    assert.equal(game.state.arcade!.scores[0], 0);
    assert.equal(game.state.arcade!.combo, 0);
  } finally {
    game.dispose();
  }
});

test('a legally pocketed eight awards the rack-winning bonus', () => {
  const game = new PoolGame('win-score', { layout: 'fortress' });
  try {
    setup(game, { 0: { x: 0, z: -1.4 }, 8: { x: 0, z: -2.15 } }, []);
    edit(game, (state) => {
      state.shotCount = 1;
    });
    edit(game, (state) => {
      state.groups = ['solids', 'stripes'];
    });
    game.shoot({ angle: -Math.PI / 2, power: 0.2 });
    settle(game);
    assert.equal(game.state.phase, 'over');
    assert.equal(game.state.winner, 0);
    assert.equal(game.state.foul, false);
    assert.equal(game.state.arcade!.scores[0], 500);
  } finally {
    game.dispose();
  }
});
