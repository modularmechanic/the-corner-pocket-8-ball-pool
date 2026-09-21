import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { arrangeBalls, edit } from './arrangements';
import { chooseShot, deadeyeShot } from '../src/simulation/ai';
import { initPhysics, PoolGame } from '../src/simulation/game';
import { createArcade, FROST_MELT, MARK_LIMIT } from '../src/simulation/arcade';
import { settleShot } from '../src/simulation/settlement';
import {
  initialState,
  legalTargets,
  POCKETS,
  type GameState,
  type ShotResult,
  type TableEvent,
} from '../src/simulation/types';

before(async () => {
  await initPhysics();
});
function settle(game: PoolGame) {
  let steps = 0;
  while (game.state.phase === 'rolling' && steps++ < 4000) game.step();
  assert.notEqual(game.state.phase, 'rolling', 'the shot must settle');
}
/** One soft straight shot up the table from the same lie, and how far the cue ball rolled. The pace is low on
 * purpose: the ball stops well short of the far cushion, so the distance is the roll and nothing else. */
function lengthOfShot(seed: string, prepare: (state: GameState) => void = () => {}, power = 0.06): number {
  const game = new PoolGame(seed);
  try {
    arrangeBalls(game, { 0: { x: -4.6, z: 0 }, 1: { x: 4.6, z: 2.4 } });
    // Past the break: a missed break would re-rack and put the cue ball back on its spot.
    edit(game, (state) => {
      state.shotCount = 1;
    });
    edit(game, prepare);
    game.shoot({ angle: 0, power });
    settle(game);
    return game.state.balls[0].x + 4.6;
  } finally {
    game.dispose();
  }
}

test('a frozen cue ball is heavy: it travels measurably less far than the same stroke unfrozen', () => {
  const free = lengthOfShot('frost-free');
  const frozen = lengthOfShot('frost-frozen', (state) => {
    state.arcade!.buffs[0].frozen = 1;
  });
  assert.ok(free > 3, 'the control shot must actually run up the table');
  assert.ok(frozen < free * 0.55, `frost must shorten the shot (${frozen.toFixed(2)}m against ${free.toFixed(2)}m)`);
});

test('a frozen cue ball comes off a cushion dead, keeping less speed than an ordinary one', () => {
  const speeds: number[] = [];
  for (const frozen of [false, true]) {
    const game = new PoolGame(`frost-cushion-${frozen}`);
    try {
      arrangeBalls(game, { 0: { x: 4.0, z: 0 }, 1: { x: -4.6, z: 2.4 } });
      if (frozen)
        edit(game, (state) => {
          state.arcade!.buffs[0].frozen = 1;
        });
      game.shoot({ angle: 0, power: 0.6 });
      // Ride through the cushion contact and read the speed the ball comes away with.
      let before = 0;
      for (let step = 0; step < 240; step++) {
        game.step();
        const speed = Math.hypot(game.state.balls[0].vx, game.state.balls[0].vz);
        if (game.state.balls[0].vx < 0) {
          speeds.push(speed / before);
          break;
        }
        before = speed;
      }
    } finally {
      game.dispose();
    }
  }
  assert.equal(speeds.length, 2, 'both cue balls must reach the end cushion');
  assert.ok(speeds[1] < speeds[0] * 0.75, `frost must deaden the rebound (${speeds[1]} against ${speeds[0]})`);
});

test('a frozen cue ball ices the cloth behind it and the ice evaporates on the arcade clock', () => {
  const game = new PoolGame('frost-trail');
  try {
    arrangeBalls(game, { 0: { x: -4.6, z: 0 }, 1: { x: 4.6, z: 2.4 } });
    edit(game, (state) => {
      state.arcade!.buffs[0].frozen = 1;
    });
    game.shoot({ angle: 0, power: 0.5 });
    settle(game);
    const trail = game.state.arcade!.frost ?? [];
    assert.ok(trail.length > 2, 'the frozen ball must leave a trail, not one patch');
    assert.ok(trail.every((mark) => mark.life > 0 && mark.life <= 1));
    assert.ok(trail.every((mark) => Number.isInteger(mark.id)));
    assert.equal(new Set(trail.map((mark) => mark.id)).size, trail.length, 'every mark is separately identified');
    game.advanceIdle(FROST_MELT / 2);
    assert.ok(
      (game.state.arcade!.frost ?? []).every((mark) => mark.life < 1),
      'ice melts with the clock',
    );
    game.advanceIdle(FROST_MELT);
    assert.equal((game.state.arcade!.frost ?? []).length, 0, 'spent ice is dropped');
  } finally {
    game.dispose();
  }
});

test('Overdrive scorches the cloth, and the scorch outlives the shot that burned it', () => {
  const game = new PoolGame('overdrive-burn');
  try {
    arrangeBalls(game, { 0: { x: -4.6, z: 0 }, 1: { x: 4.6, z: 2.4 } });
    edit(game, (state) => {
      state.arcade!.buffs[0].overdrive = 1;
    });
    const unburned = game.state.arcade!.burns;
    assert.equal(unburned, undefined, 'an unburned table carries no marks');
    game.shoot({ angle: 0, power: 0.6 });
    settle(game);
    const burns = game.state.arcade!.burns ?? [];
    assert.ok(burns.length > 4, 'the flame must lay a trail of scorches');
    assert.ok(burns.every((mark) => mark.heat > 0 && mark.heat <= 1 && mark.radius > 0));
    assert.ok(burns[burns.length - 1].heat > 0.7, 'the freshest scorch is still fierce');
    // The next player's ordinary stroke does not clear them: the table carries the damage.
    edit(game, (state) => {
      state.phase = 'ready';
      state.turn = 1;
    });
    game.shoot({ angle: Math.PI, power: 0.2 });
    settle(game);
    assert.ok((game.state.arcade!.burns ?? []).length >= burns.length, 'scorches persist past the shot');
  } finally {
    game.dispose();
  }
});

test('a ball crossing a scorch mark decelerates faster than one on clean cloth', () => {
  const scorched = (state: GameState) => {
    state.arcade!.burns = [];
    for (let x = -4.2; x < -0.4; x += 0.34)
      state.arcade!.burns.push({ id: state.arcade!.burns.length, x, z: 0, radius: 0.26, heat: 1 });
  };
  const clean = lengthOfShot('burn-clean');
  const burnt = lengthOfShot('burn-scorched', scorched);
  assert.ok(clean > 3, 'the control shot must reach past the burnt patch');
  assert.ok(burnt < clean - 0.5, `scorched cloth must cost real distance (${burnt.toFixed(2)} vs ${clean.toFixed(2)})`);
});

test('cloth marks are capped and replay exactly from a snapshot', () => {
  const first = new PoolGame('mark-bounds'),
    second = new PoolGame('mark-bounds');
  try {
    for (const game of [first, second]) {
      arrangeBalls(game, { 0: { x: -4.6, z: 0 }, 1: { x: 4.6, z: 2.4 } });
      edit(game, (state) => {
        state.arcade!.buffs[0].overdrive = 1;
      });
      game.shoot({ angle: 0.28, power: 1 });
    }
    for (let step = 0; step < 600; step++) {
      first.step();
      second.step();
      assert.ok((first.state.arcade!.burns ?? []).length <= MARK_LIMIT, 'marks stay bounded');
    }
    assert.deepEqual(first.snapshot(), second.snapshot(), 'two identical engines burn identical marks');
    const restored = new PoolGame('mark-bounds');
    try {
      restored.arrange(first.snapshot());
      assert.deepEqual(restored.state.arcade!.burns, first.state.arcade!.burns);
      for (let step = 0; step < 120; step++) {
        first.step();
        restored.step();
      }
      assert.deepEqual(restored.snapshot(), first.snapshot(), 'a rebuilt table keeps burning the same trail');
    } finally {
      restored.dispose();
    }
  } finally {
    first.dispose();
    second.dispose();
  }
});

test('a rebuilt table refuses impossible marks instead of poisoning the physics', () => {
  const game = new PoolGame('mark-validation');
  try {
    edit(game, (state) => {
      state.arcade!.burns = [
        { id: 0, x: Number.NaN, z: 0, radius: 0.26, heat: 1 },
        { id: 1, x: 0.5, z: 0, radius: 0.26, heat: Number.POSITIVE_INFINITY },
        { id: 2, x: 900, z: 0, radius: 0.26, heat: 1 },
        { id: 3, x: 1.5, z: 0, radius: 0.26, heat: 4 },
      ];
      state.arcade!.frost = [{ id: 4, x: 0, z: 0, life: Number.NaN }];
    });
    assert.deepEqual(
      (game.state.arcade!.burns ?? []).map((mark) => mark.id),
      [3],
    );
    assert.equal(game.state.arcade!.burns![0].heat, 1, 'an out-of-range heat is clamped into 0..1');
    assert.deepEqual(game.state.arcade!.frost, []);
  } finally {
    game.dispose();
  }
});

test('Deadeye sinks the ball being aimed at, where the same stroke without it misses', () => {
  const potted: boolean[] = [];
  const events: TableEvent[][] = [];
  for (const armed of [false, true]) {
    const game = new PoolGame(`deadeye-${armed}`);
    try {
      arrangeBalls(game, { 0: { x: -2, z: 0 }, 1: { x: 2, z: 0 } });
      edit(game, (state) => {
        state.shotCount = 1;
      });
      if (armed)
        edit(game, (state) => {
          state.arcade!.buffs[0].focus = 1;
        });
      const log: TableEvent[] = [];
      game.onEvent = (event) => log.push(event);
      // Dead straight at the middle of the object ball: it cannons into the end cushion, nowhere near a pocket.
      game.shoot({ angle: 0, power: 0.35 });
      settle(game);
      potted.push(game.state.balls[1].pocketed);
      events.push(log);
      if (armed) {
        assert.equal(game.state.arcade!.buffs[0].focus, 0, 'the charge is spent on the shot it perfects');
        assert.equal(game.state.arcade!.activeShot.focus, true);
      }
    } finally {
      game.dispose();
    }
  }
  assert.equal(potted[0], false, 'the unaided stroke must miss');
  assert.equal(potted[1], true, 'Deadeye must sink its target');
  assert.ok(events[1].some((event) => event.kind === 'pocket' && event.ball === 1));
});

test('Deadeye is kept, not wasted, when the table offers no pot at all', () => {
  const game = new PoolGame('deadeye-snookered');
  try {
    // One solid left, ringed by stripes so every route from it to every pocket is blocked.
    const ring: Record<number, { x: number; z: number }> = {};
    POCKETS.forEach((pocket, index) => {
      const length = Math.hypot(pocket.x, pocket.z);
      ring[9 + index] = { x: (pocket.x / length) * 0.42, z: (pocket.z / length) * 0.42 };
    });
    arrangeBalls(game, { 0: { x: -1.5, z: 0 }, 1: { x: 0, z: 0 }, ...ring });
    edit(game, (state) => {
      state.shotCount = 1;
      state.groups = ['solids', 'stripes'];
      state.arcade!.buffs[0].focus = 1;
    });
    const aim = Math.PI / 2;
    game.shoot({ angle: aim, power: 0.4 });
    assert.equal(game.state.lastShot!.angle, aim, 'the player\u2019s own stroke stands');
    assert.equal(game.state.arcade!.buffs[0].focus, 1, 'an unspendable charge stays armed');
  } finally {
    game.dispose();
  }
});

test('the ward lasts the visit while the owner keeps potting, but never follows them onto the black', () => {
  const base = (): GameState => {
    const state = initialState('ward-visit');
    state.arcade = createArcade('crossfire', 'ward-visit');
    state.shotCount = 1;
    state.groups = ['solids', 'stripes'];
    state.arcade.activeShot.ward = true;
    return state;
  };
  const shot = (changes: Partial<ShotResult>): ShotResult => ({
    firstContact: 1,
    potted: [],
    railAfterContact: true,
    breakRails: [],
    ...changes,
  });
  const settleWith = (state: GameState, result: ShotResult) =>
    settleShot(state, result, { legalBefore: legalTargets(state, 0).map((b) => b.id), shooter: 0 });

  const kept = settleWith(base(), shot({ potted: [1] }));
  assert.equal(kept.state.turn, 0);
  assert.equal(kept.state.arcade!.buffs[0].ward, 1, 'the shield holds while the table is held');

  const missed = settleWith(base(), shot({}));
  assert.equal(missed.state.turn, 1);
  assert.equal(missed.state.arcade!.buffs[0].ward, 0, 'the shield ends with the visit');

  // Potting the last solid leaves the shooter on the black: the shield must not block their own winning pot.
  const onBlack = base();
  for (const id of [2, 3, 4, 5, 6, 7]) onBlack.balls[id].pocketed = true;
  const cleared = settleWith(onBlack, shot({ potted: [1] }));
  assert.equal(cleared.state.turn, 0);
  assert.equal(cleared.state.arcade!.buffs[0].ward, 0, 'a shield does not follow the shooter onto the black');
});

test('the AI spends its Deadeye and refuses to aim a pot at a black its own ward is shielding', () => {
  const game = new PoolGame('ai-powerups');
  try {
    arrangeBalls(game, { 0: { x: -2, z: 0 }, 1: { x: 2, z: 0 } });
    edit(game, (state) => {
      state.shotCount = 1;
      state.arcade!.buffs[0].focus = 1;
    });
    // The AI hands back the perfect stroke rather than its own aim at the ball's centre, which pots nothing.
    const shot = chooseShot(game.snapshot(), 'expert', () => 0.5);
    assert.ok(Math.abs(shot.angle) > 0.01, 'a Deadeye stroke is the cut that pots, not the straight miss');
    game.shoot(shot);
    settle(game);
    assert.equal(game.state.balls[1].pocketed, true, 'the AI must cash its Deadeye');

    // On the black with the shield up there is no pot to aim at: the AI plays the table instead of the pocket.
    const onBlack = game.snapshot();
    onBlack.groups = ['solids', 'stripes'];
    for (const ball of onBlack.balls) ball.pocketed = ball.id !== 0 && ball.id !== 8;
    Object.assign(onBlack.balls[0], { x: -2, z: 0, vx: 0, vz: 0, pocketed: false });
    Object.assign(onBlack.balls[8], { x: 3, z: 1, vx: 0, vz: 0, pocketed: false });
    onBlack.phase = 'ready';
    onBlack.turn = 0;
    onBlack.arcade!.buffs[0] = { overdrive: 0, frozen: 0, ward: 0, focus: 0, jammed: 0, sticky: 0 };
    assert.ok(deadeyeShot(onBlack, 0), 'the black is pottable with no shield up');
    onBlack.arcade!.buffs[0].ward = 1;
    assert.equal(deadeyeShot(onBlack, 0), null, 'a shielded black offers no pot for the AI to aim at');
  } finally {
    game.dispose();
  }
});
