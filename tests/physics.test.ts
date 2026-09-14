import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { arrangeBalls, edit } from './arrangements';
import { initPhysics, PoolGame } from '../src/simulation/game';
import { obstructionAt, obstacleRay } from '../src/simulation/table-geometry';
import { TABLE, type ArenaLayout, type TableEvent } from '../src/simulation/types';

before(async () => {
  await initPhysics();
});
const layouts: ArenaLayout[] = ['crossfire', 'fortress', 'gauntlet'];
const energy = (game: PoolGame) => game.state.balls.reduce((total, ball) => total + ball.vx ** 2 + ball.vz ** 2, 0);
const isRolling = (game: PoolGame) => game.state.phase === 'rolling';
function settle(game: PoolGame) {
  let steps = 0;
  while (game.state.phase === 'rolling' && steps++ < 4000) game.step();
  assert.notEqual(game.state.phase, 'rolling', 'shot should settle within the simulation time limit');
  return steps;
}
function fixture(game: PoolGame, positions: Record<number, { x: number; z: number }>, keepObstacle?: number) {
  arrangeBalls(game, positions, { keepObstacle });
}

for (const layout of layouts) {
  test(`${layout}: the opening shot reaches the rack before any cushion or obstacle`, () => {
    const game = new PoolGame(`opening-${layout}`, { layout });
    try {
      const cue = game.state.balls[0],
        apex = game.state.balls[1];
      for (const hazard of game.state.arcade!.hazards) {
        if (hazard.x >= cue.x && hazard.x <= apex.x) {
          assert.ok(
            Math.abs(hazard.z - cue.z) > hazard.radius + TABLE.radius,
            'hazards must not interfere with the opening lane',
          );
        }
      }
      assert.ok(
        obstacleRay(game.state.arcade, cue.x, cue.z, 1, 0, TABLE.radius) > apex.x - cue.x - TABLE.radius * 2,
        'the initial cue-to-rack lane must be clear',
      );
      for (const ball of game.state.balls)
        assert.ok(
          !obstructionAt(game.state.arcade, ball.x, ball.z, TABLE.radius),
          `ball ${ball.id} must not spawn in an obstacle`,
        );
      const events: TableEvent[] = [];
      game.onEvent = (event) => events.push(event);
      assert.equal(game.shoot({ angle: 0, power: 1 }), true);
      let reachedRack = false;
      for (let step = 0; step < 120; step++) {
        const beforeX = cue.x;
        game.step();
        if (events.some((event) => event.kind === 'ball')) {
          reachedRack = true;
          break;
        }
        assert.ok(cue.x >= beforeX - 1e-5, 'the break cannot rebound before contacting the rack');
        assert.ok(cue.vx > 0, 'the break must still point toward the rack');
        assert.equal(
          events.some((event) => event.kind === 'obstacle' || event.kind === 'cushion'),
          false,
        );
      }
      assert.ok(reachedRack, 'a full-power opening shot must reach the rack in under a second');
    } finally {
      game.dispose();
    }
  });
}

test('stationary balls stay still until physical contact, including at maximum boosted speed', () => {
  const game = new PoolGame('contact-isolation', { layout: 'fortress' });
  try {
    fixture(game, { 0: { x: -3, z: 0 }, 1: { x: 0, z: 0 }, 2: { x: -3.8, z: 1 } });
    const events: TableEvent[] = [];
    game.onEvent = (event) => events.push(event);
    edit(game, (state) => {
      state.arcade!.buffs[0].overdrive = 1;
    });
    assert.equal(game.shoot({ angle: 0, power: 1 }), true);
    let contact = false;
    for (let step = 0; step < 24; step++) {
      game.step();
      contact ||= events.some((event) => event.kind === 'ball');
      if (!contact) {
        assert.equal(game.state.balls[1].x, 0);
        assert.equal(game.state.balls[1].vx, 0);
      }
      const isolated = game.state.balls[2];
      assert.ok(Math.abs(isolated.x + 3.8) < 1e-6 && Math.abs(isolated.z - 1) < 1e-6);
      assert.equal(Math.hypot(isolated.vx, isolated.vz), 0, 'an untouched ball must never acquire velocity');
    }
    assert.ok(contact);
    assert.ok(game.state.balls[1].x > 0.7, 'the struck ball receives the shot momentum');
  } finally {
    game.dispose();
  }
});

test('maximum boosted shots cannot tunnel through a ball, even with a 30 Hz caller', () => {
  const game = new PoolGame('fast-contact', { layout: 'fortress' });
  try {
    fixture(game, { 0: { x: -1, z: 0 }, 1: { x: 0, z: 0 } });
    const events: TableEvent[] = [];
    game.onEvent = (event) => events.push(event);
    edit(game, (state) => {
      state.arcade!.buffs[0].overdrive = 1;
    });
    game.shoot({ angle: 0, power: 1 });
    for (let step = 0; step < 5; step++) game.step(1 / 30);
    assert.ok(events.some((event) => event.kind === 'ball'));
    assert.ok(game.state.balls[1].vx > 12, 'the target must receive a strong collision impulse');
    assert.ok(game.state.balls[0].vx < 3, 'the cue must give up most of its forward momentum');
    assert.ok(game.state.balls[0].x < game.state.balls[1].x);
  } finally {
    game.dispose();
  }
});

test('hard breaks across every layout remain finite, dissipate energy, settle and never drift afterward', () => {
  for (const layout of layouts)
    for (const boosted of [false, true])
      for (const angle of [0, 0.035, -0.035]) {
        const game = new PoolGame(`stress-${layout}-${boosted}-${angle}`, { layout, level: 5 });
        try {
          edit(game, (state) => {
            state.arcade!.hazards = [];
          });
          edit(game, (state) => {
            state.arcade!.pickups = [];
          });
          if (boosted)
            edit(game, (state) => {
              state.arcade!.buffs[0].overdrive = 1;
            });
          game.shoot({ angle, power: 1 });
          const startingEnergy = energy(game);
          let previousEnergy = startingEnergy;
          let steps = 0;
          while (game.state.phase === 'rolling' && steps++ < 4000) {
            game.step();
            assert.ok(energy(game) <= startingEnergy * 1.001, `${layout} must not create energy during a hard break`);
            assert.ok(
              energy(game) <= previousEnergy * 1.00001 + 1e-7,
              `${layout} must dissipate energy at every collision step`,
            );
            previousEnergy = energy(game);
            for (const ball of game.state.balls) {
              assert.ok([ball.x, ball.z, ball.vx, ball.vz].every(Number.isFinite));
              if (!ball.pocketed) {
                assert.ok(
                  Math.abs(ball.x) <= 5.96 && Math.abs(ball.z) <= 3.15,
                  `${layout}: ball ${ball.id} escaped the live playfield`,
                );
              }
            }
          }
          assert.ok(steps < 4000, `${layout} must settle`);
          assert.equal(energy(game), 0);
          const settled = game.snapshot();
          for (let idle = 0; idle < 240; idle++) assert.equal(game.step(), false);
          assert.deepEqual(game.state.balls, settled.balls, 'a completed shot cannot drift');
          assert.equal(game.state.shotCount, settled.shotCount, 'ready pickup timers cannot create additional turns');
          assert.equal(game.state.turn, settled.turn);
        } finally {
          game.dispose();
        }
      }
});

test('breakable obstacles lose HP and their destroyed collider no longer blocks the lane', () => {
  const game = new PoolGame('durability', { layout: 'fortress', level: 3 });
  try {
    const obstacle = game.snapshot().arcade!.obstacles[0],
      start = { x: obstacle.x - obstacle.width / 2 - 1, z: obstacle.z };
    assert.equal(obstacle.maxHp, 3);
    const events: TableEvent[] = [];
    game.onEvent = (e) => events.push(e);
    for (const remainingHp of [2, 1, 0]) {
      fixture(game, { 0: start }, obstacle.id);
      edit(game, (s) => {
        s.phase = 'ready';
      });
      assert.equal(game.shoot({ angle: 0, power: 0.2 }), true);
      for (let i = 0; game.state.arcade!.obstacles[0].hp > remainingHp && i < 180; i++) game.step();
      assert.equal(game.state.arcade!.obstacles[0].hp, remainingHp);
    }
    assert.equal(events.filter((e) => e.kind === 'obstacle' && e.destroyed).length, 1);
    assert.equal(
      game.state.arcade!.scores[game.state.turn],
      obstacle.maxHp * 50 + events.filter((e) => e.kind === 'pickup').length * 25,
    );
    assert.ok(events.some((e) => e.kind === 'spawn' && e.x === obstacle.x && e.z === obstacle.z && e.power));
    fixture(game, { 0: start }, obstacle.id);
    edit(game, (s) => {
      s.phase = 'ready';
    });
    const priorHits = events.filter((e) => e.kind === 'obstacle').length;
    game.shoot({ angle: 0, power: 0.2 });
    for (let i = 0; i < 45; i++) game.step();
    assert.ok(
      game.state.balls[0].x > obstacle.x + obstacle.width / 2 + TABLE.radius,
      'destroyed blocks must have no invisible collision',
    );
    assert.equal(events.filter((e) => e.kind === 'obstacle').length, priorHits);
  } finally {
    game.dispose();
  }
});

test('queued frost weakens exactly the affected player’s next shot', () => {
  const game = new PoolGame('power-lifetime');
  try {
    fixture(game, { 0: { x: -2.85, z: 0 }, 1: { x: 2, z: 0 } });
    edit(game, (state) => {
      state.arcade!.buffs[1].frozen = 1;
    });
    game.shoot({ angle: Math.PI, power: 0.03 });
    assert.ok(Math.abs(speedOfCue() - 1.85) < 1e-8);
    settle(game);
    assert.equal(game.state.turn, 1);
    assert.equal(game.state.arcade!.buffs[1].frozen, 1);
    if (game.state.phase === 'ball-in-hand') assert.equal(game.placeCue(-2.85, 0), true);
    game.shoot({ angle: 0, power: 1 });
    assert.ok(Math.abs(speedOfCue() - 16.4 * 0.65) < 1e-8);
    assert.equal(game.state.arcade!.buffs[1].frozen, 0);
    assert.equal(game.state.arcade!.activeShot.frozen, true);
    function speedOfCue() {
      return Math.hypot(game.state.balls[0].vx, game.state.balls[0].vz);
    }
  } finally {
    game.dispose();
  }
});

test('ball-in-hand rejects live obstacles and accepts clear felt', () => {
  const game = new PoolGame('placement-obstacles');
  try {
    edit(game, (state) => {
      state.phase = 'ball-in-hand';
    });
    const obstacle = game.state.arcade!.obstacles[0];
    assert.equal(game.placeCue(obstacle.x, obstacle.z), false);
    assert.equal(game.placeCue(obstacle.x + obstacle.width / 2 + TABLE.radius / 2, obstacle.z), false);
    assert.equal(game.placeCue(-2.85, 0), true);
  } finally {
    game.dispose();
  }
});

test('queued Heavy cue adds drag for one shot and Deadeye is consumed into that shot’s preview state', () => {
  const speeds: number[] = [];
  for (const affected of [false, true]) {
    const game = new PoolGame(`queued-status-${affected}`);
    try {
      fixture(game, { 0: { x: -2, z: 0 }, 1: { x: 3, z: 0 } });
      if (affected) {
        edit(game, (state) => {
          state.arcade!.buffs[0].sticky = 1;
        });
        edit(game, (state) => {
          state.arcade!.buffs[0].focus = 1;
        });
      }
      game.shoot({ angle: 0, power: 0.2 });
      assert.equal(game.state.arcade!.activeShot.sticky, affected);
      assert.equal(game.state.arcade!.activeShot.focus, affected);
      assert.equal(game.state.arcade!.buffs[0].sticky, 0);
      assert.equal(game.state.arcade!.buffs[0].focus, 0);
      for (let step = 0; step < 24; step++) game.step();
      speeds.push(Math.hypot(game.state.balls[0].vx, game.state.balls[0].vz));
    } finally {
      game.dispose();
    }
  }
  assert.ok(speeds[1] < speeds[0] - 0.2, 'Heavy cue meaningfully increases cloth drag');
});

test('scratch shield restores a pocketed cue, while an unshielded scratch leaves it pocketed', () => {
  for (const shielded of [false, true]) {
    const game = new PoolGame(`shield-${shielded}`);
    try {
      fixture(game, { 0: { x: 0, z: -2.4 }, 1: { x: 3, z: 0 } });
      // Past the break: a scratching break with no cushions would re-rack instead.
      edit(game, (state) => {
        state.shotCount = 1;
      });
      if (shielded)
        edit(game, (state) => {
          state.arcade!.buffs[0].ward = 1;
        });
      const events: TableEvent[] = [];
      game.onEvent = (event) => events.push(event);
      game.shoot({ angle: -Math.PI / 2, power: 0.2 });
      settle(game);
      assert.ok(events.some((event) => event.kind === 'pocket' && event.ball === 0));
      assert.equal(game.state.balls[0].pocketed, !shielded);
      if (shielded)
        assert.ok(!obstructionAt(game.state.arcade, game.state.balls[0].x, game.state.balls[0].z, TABLE.radius));
      assert.equal(game.state.arcade!.buffs[0].ward, 0, 'shield is consumed by this shot');
    } finally {
      game.dispose();
    }
  }
});

test('scratch shield never rescues a scratch when the eight is also pocketed', () => {
  const game = new PoolGame('eight-shield');
  try {
    fixture(game, { 0: { x: 0, z: -2.4 }, 8: { x: 0, z: 2.4 } });
    edit(game, (state) => {
      state.shotCount = 1;
    });
    edit(game, (state) => {
      state.groups = ['solids', 'stripes'];
    });
    edit(game, (state) => {
      state.arcade!.buffs[0].ward = 1;
    });
    game.shoot({ angle: -Math.PI / 2, power: 0.2 });
    edit(game, (state) => {
      state.balls[8].vz = 3;
    });
    settle(game);
    assert.equal(game.state.phase, 'over');
    assert.equal(game.state.winner, 1);
    assert.equal(game.state.balls[0].pocketed, true);
    assert.equal(game.state.balls[8].pocketed, true);
  } finally {
    game.dispose();
  }
});

// Direct center-pocket shots must be captured at speed, without ricocheting off a jaw first.
test('all six pockets capture hard and boosted center shots without bouncing back', () => {
  const pockets = [
    { x: -5.66, z: -2.82 },
    { x: 0, z: -2.95 },
    { x: 5.66, z: -2.82 },
    { x: -5.66, z: 2.82 },
    { x: 0, z: 2.95 },
    { x: 5.66, z: 2.82 },
  ];
  for (const pocket of pockets)
    for (const boosted of [false, true]) {
      const game = new PoolGame(`pocket-${pocket.x}-${pocket.z}-${boosted}`);
      try {
        const length = Math.hypot(pocket.x, pocket.z),
          dx = pocket.x / length,
          dz = pocket.z / length;
        fixture(game, { 0: { x: pocket.x - dx * 1.8, z: pocket.z - dz * 1.8 } });
        if (boosted)
          edit(game, (state) => {
            state.arcade!.buffs[0].overdrive = 1;
          });
        const events: TableEvent[] = [];
        game.onEvent = (event) => events.push(event);
        game.shoot({ angle: Math.atan2(dz, dx), power: 1 });
        for (let step = 0; step < 48 && !game.state.balls[0].pocketed; step++) game.step();
        assert.equal(game.state.balls[0].pocketed, true, `pocket ${pocket.x},${pocket.z}, boosted=${boosted}`);
        assert.equal(
          events.filter((e) => e.kind === 'cushion').length,
          0,
          'a shot into the mouth cannot bounce before capture',
        );
        assert.equal(events.filter((e) => e.kind === 'pocket').length, 1);
      } finally {
        game.dispose();
      }
    }
});

test('fast shots outside the pocket mouth still rebound from the cushion instead of being swallowed', () => {
  for (const x of [-5.05, -0.6, 0.6, 5.05])
    for (const side of [-1, 1]) {
      const game = new PoolGame(`jaw-graze-${x}-${side}`);
      try {
        fixture(game, { 0: { x, z: side * 1.5 } });
        edit(game, (state) => {
          state.arcade!.buffs[0].overdrive = 1;
        });
        const events: TableEvent[] = [];
        game.onEvent = (event) => events.push(event);
        game.shoot({ angle: (side * Math.PI) / 2, power: 1 });
        for (let step = 0; step < 24 && !events.some((e) => e.kind === 'cushion'); step++) game.step();
        assert.ok(events.some((e) => e.kind === 'cushion'));
        assert.equal(game.state.balls[0].pocketed, false);
        assert.ok(game.state.balls[0].vz * side < 0, 'the cushion must return a near-mouth miss to the table');
      } finally {
        game.dispose();
      }
    }
});

test('shot geometry validates finite elevation and an in-bounds tip disc without consuming chalk on rejection', () => {
  const game = new PoolGame('shot-geometry');
  try {
    assert.equal(game.chalkCue(), true);
    assert.equal(game.chalkCue(), false);
    for (const extra of [
      { elevation: NaN },
      { elevation: -0.01 },
      { elevation: Math.PI / 3 + 0.001 },
      { tipX: Infinity },
      { tipX: 0.81 },
      { tipX: 0.6, tipY: 0.6 },
    ]) {
      assert.equal(game.shoot({ angle: 0, power: 0.5, ...extra }), false);
      assert.equal(game.state.chalked[0], true);
    }
    const events: TableEvent[] = [];
    game.onEvent = (event) => events.push(event);
    assert.equal(game.shoot({ angle: 0.1, power: 0.5, elevation: 0.4, tipX: 0.3, tipY: -0.4 }), true);
    assert.equal(game.state.chalked[0], false);
    assert.equal(game.chalkCue(), false);
    assert.deepEqual(game.state.lastShot, { angle: 0.1, power: 0.5, elevation: 0.4, tipX: 0.3, tipY: -0.4 });
    const cue = events.find((e) => e.kind === 'cue')!;
    assert.equal(cue.chalked, true);
    assert.equal(cue.elevation, 0.4);
    assert.equal(cue.tipX, 0.3);
    assert.equal(cue.tipY, -0.4);
  } finally {
    game.dispose();
  }
});

test('top spin follows and bottom spin draws only after a real cue-ball collision', () => {
  for (const tipY of [-0.7, 0.7]) {
    const game = new PoolGame(`follow-draw-${tipY}`);
    try {
      fixture(game, { 0: { x: -1, z: 0 }, 1: { x: 0, z: 0 }, 2: { x: -3, z: 1.4 } });
      let contact = false;
      game.onEvent = (event) => {
        if (event.kind === 'ball') contact = true;
      };
      game.shoot({ angle: 0, power: 0.4, tipY });
      for (let step = 0; !contact && step < 120; step++) {
        assert.ok(game.state.balls[0].vx > 0, 'draw cannot pull the cue backward before contact');
        game.step();
      }
      assert.ok(contact);
      for (let step = 0; step < 8; step++) game.step();
      assert.ok(game.state.balls[0].vx * Math.sign(tipY) > 0.25, 'cue motion must match the selected follow/draw spin');
      assert.equal(game.state.balls[2].vx, 0);
      assert.equal(game.state.balls[2].vz, 0);
      assert.ok(Math.abs(game.state.balls[2].x + 3) < 1e-6 && Math.abs(game.state.balls[2].z - 1.4) < 1e-6);
    } finally {
      game.dispose();
    }
  }
});

test('side spin changes the cue’s cushion exit while elevated side strikes produce a small bounded curve', () => {
  for (const tipX of [-0.7, 0.7]) {
    const game = new PoolGame(`side-cushion-${tipX}`);
    try {
      fixture(game, { 0: { x: 0, z: 0 } });
      let cushion = false;
      game.onEvent = (event) => {
        if (event.kind === 'cushion') cushion = true;
      };
      game.shoot({ angle: 0, power: 0.7, tipX });
      for (let step = 0; !cushion && step < 240; step++) game.step();
      assert.ok(cushion);
      assert.ok(game.state.balls[0].vx < 0);
      assert.ok(game.state.balls[0].vz * Math.sign(tipX) > 0.1);
    } finally {
      game.dispose();
    }
  }
  const speeds: number[] = [],
    lateral: number[] = [];
  for (const elevation of [0, 0.5]) {
    const game = new PoolGame(`swerve-${elevation}`);
    try {
      fixture(game, { 0: { x: -3, z: 0 } });
      game.shoot({ angle: 0, power: 0.7, tipX: 0.7, elevation });
      speeds.push(Math.hypot(game.state.balls[0].vx, game.state.balls[0].vz));
      for (let step = 0; step < 30; step++) game.step();
      lateral.push(game.state.balls[0].vz);
    } finally {
      game.dispose();
    }
  }
  assert.ok(speeds[1] < speeds[0], 'raising the cue reduces horizontal power');
  assert.equal(lateral[0], 0);
  assert.ok(lateral[1] > 0.01 && lateral[1] < 0.2, 'swerve should be perceptible but controlled');
});

test('chalking improves off-center efficiency for one shot without increasing center-hit power', () => {
  const speeds: number[] = [];
  for (const chalked of [false, true])
    for (const tipX of [0, 0.8]) {
      const game = new PoolGame(`chalk-${chalked}-${tipX}`);
      try {
        fixture(game, { 0: { x: -2, z: 0 } });
        if (chalked) assert.equal(game.chalkCue(), true);
        game.shoot({ angle: 0, power: 0.5, tipX });
        speeds.push(game.state.balls[0].vx);
        assert.equal(game.state.chalked[0], false);
        assert.equal(game.state.arcade!.activeShot.chalked, chalked);
      } finally {
        game.dispose();
      }
    }
  assert.equal(speeds[0], speeds[2]);
  assert.ok(speeds[3] > speeds[1] && speeds[3] < speeds[2]);
});

test('extreme spin and elevated Overdrive breaks remain bounded and settle without moving untouched balls', () => {
  for (const [tipX, tipY, elevation] of [
    [0, -0.8, 0],
    [0, 0.8, 0.6],
    [0.8, 0, 0.5],
    [-0.5, -0.6, Math.PI / 3],
  ]) {
    const game = new PoolGame(`spin-energy-${tipX}-${tipY}`, { level: 5 });
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
      game.shoot({ angle: 0, power: 1, tipX, tipY, elevation });
      const initial = energy(game);
      let steps = 0;
      while (game.state.phase === 'rolling' && steps++ < 4000) {
        game.step();
        assert.ok(energy(game) < initial * 1.075 + 1e-6, 'spin conversion cannot inject unbounded energy into a rack');
        assert.ok(game.state.balls.every((b) => [b.x, b.z, b.vx, b.vz].every(Number.isFinite)));
      }
      assert.ok(steps < 4000);
      assert.equal(energy(game), 0);
    } finally {
      game.dispose();
    }
  }
});

test('only the moving white cue ball can collect visible power-ups', () => {
  const game = new PoolGame('white-only-pickup');
  try {
    fixture(game, { 0: { x: -3, z: 1 }, 1: { x: -2, z: 0 } });
    edit(game, (state) => {
      state.arcade!.pickups = [{ id: 0, x: -1.7, z: 0, radius: 0.16, available: true, power: 'ward', expiresAt: 15 }];
    });
    const events: TableEvent[] = [];
    game.onEvent = (event) => events.push(event);
    game.shoot({ angle: Math.PI, power: 0.03 });
    edit(game, (state) => {
      state.balls[1].vx = 3;
    });
    for (let step = 0; step < 24; step++) game.step();
    assert.ok(game.state.balls[1].x > -1.7, 'the numbered ball crosses the pickup');
    assert.equal(game.state.arcade!.pickups[0].available, true);
    assert.equal(events.filter((e) => e.kind === 'pickup').length, 0);
    assert.equal(game.state.arcade!.scores[0], 0);
  } finally {
    game.dispose();
  }
});
