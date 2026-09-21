import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { initPhysics, PoolGame } from '../src/simulation/game';
import {
  cueBallId,
  initialState,
  legalTargets,
  newRack,
  optionalPlacement,
  seededRandom,
  TABLE,
  type ShotResult,
} from '../src/simulation/types';
import { BILLIARD_SPOT, initialBilliardsState, type BilliardsState } from '../src/simulation/modes/billiards';
import { initialSnookerState } from '../src/simulation/modes/snooker';
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

test('the striker’s cue ball is the mode’s, not always ball 0', () => {
  const billiards = initialBilliardsState('two-cue-balls');
  // English Billiards deals a cue ball each: White to player 0, Yellow to player 1.
  assert.equal(cueBallId(billiards), 0);
  assert.equal(cueBallId({ ...billiards, turn: 1 }), 2);
  // The explicit player wins over the turn, which is what the AI and a settlement on `context.shooter` need.
  assert.equal(cueBallId(billiards, 1), 2);
  assert.equal(cueBallId({ ...billiards, turn: 1 }, 0), 0);
  // Every other mode has exactly one cue ball and must be untouched by the above.
  for (const state of [initialState('pool'), initialSnookerState('snooker'), { mode: 'zombie' as const, turn: 0 }])
    for (const turn of [0, 1] as const) assert.equal(cueBallId({ ...state, turn }), 0, `${state.mode} turn ${turn}`);

  // A real caller: with Yellow off the table, player 1 must place it, and White's lie is none of their business.
  const placing = {
    ...billiards,
    turn: 1 as const,
    phase: 'ball-in-hand' as const,
    balls: billiards.balls.map((ball) => ({ ...ball, pocketed: ball.id === 2 })),
  };
  assert.equal(optionalPlacement(placing), false, 'player 1 is in hand: Yellow is off the table');
  assert.equal(optionalPlacement({ ...placing, turn: 0 }), true, 'player 0 may still play White from where it lies');
});

const settle = (game: PoolGame) => {
  let steps = 0;
  while (game.state.phase === 'rolling' && steps++ < 6000) game.step();
  assert.ok(steps < 6000, 'the shot settled');
};

test('a snooker frame driven through the shared engine is judged by snooker, not by eight-ball', () => {
  const state = initialSnookerState('shared-dispatch');
  state.phase = 'ready';
  // The cue ball straight behind a red that sits in front of a middle pocket: a plain one-point pot.
  Object.assign(state.balls[0], { x: 0, z: 2 });
  Object.assign(state.balls[1], { x: 0, z: 4.6 });
  const game = new PoolGame('shared-dispatch');
  try {
    game.arrange(state);
    assert.equal(game.shoot({ angle: Math.PI / 2, power: 0.35 }), true);
    settle(game);
    assert.deepEqual(game.state.lastPotted, [1]);
    // Snooker's settlement: a red scores one and leaves the striker on a colour. Eight-ball's settlement knows
    // nothing of `snooker`, so a score here can only have come from dispatching to the mode.
    assert.deepEqual(game.state.snooker!.scores, [1, 0]);
    assert.equal(game.state.snooker!.onColour, true);
    assert.equal(game.state.foul, false);
    assert.equal(game.state.turn, 0, 'a scoring stroke keeps the striker at the table');
    // Eight-ball's own bookkeeping stays untouched: no group was assigned by potting a "solid".
    assert.deepEqual(game.state.groups, [null, null]);
  } finally {
    game.dispose();
  }
});

test('a billiards stroke struck with Yellow records its contacts, so a cannon scores', () => {
  const state = initialBilliardsState('yellow-cannon');
  state.phase = 'ready';
  state.turn = 1;
  // Player 1 plays Yellow. Red and White sit side by side, so a straight stroke touches both: a cannon.
  Object.assign(state.balls[2], { x: -1, z: 0, pocketed: false });
  Object.assign(state.balls[1], { x: 1, z: 0.2, pocketed: false });
  Object.assign(state.balls[0], { x: 1, z: -0.2, pocketed: false });
  const game = new PoolGame('yellow-cannon');
  try {
    game.arrange(state);
    assert.equal(game.shoot({ angle: 0, power: 0.4 }), true);
    settle(game);
    // A collision handler that only watched ball 0 would record no contact for a Yellow-struck shot at all,
    // so there would be no cannon, no two points, and the turn would pass.
    assert.equal(game.state.foul, false);
    assert.deepEqual((game.state as BilliardsState).billiards.scores, [0, 2]);
    assert.equal((game.state as BilliardsState).billiards.cannonRun, 1);
    assert.equal(game.state.turn, 1, 'a scoring stroke keeps the striker at the table');
  } finally {
    game.dispose();
  }
});

test('a billiards cue ball that goes in-off stays in hand while the Red is spotted', () => {
  const state = initialBilliardsState('in-off');
  state.phase = 'ready';
  state.turn = 1;
  Object.assign(state.balls[2], { x: 0, z: 4.6, pocketed: false });
  Object.assign(state.balls[1], { x: 0, z: 4.97, pocketed: false });
  Object.assign(state.balls[0], { x: -5, z: 0, pocketed: false });
  const game = new PoolGame('in-off');
  try {
    game.arrange(state);
    assert.equal(game.shoot({ angle: Math.PI / 2, power: 0.5, tipY: 0.7 }), true);
    settle(game);
    // Section 3 Rule 4: the Red potted scores three and the in-off off the Red another three.
    assert.deepEqual((game.state as BilliardsState).billiards.scores, [0, 6]);
    // Section 2 Rule 13: the Red comes back on its spot, but a pocketed cue ball is never spotted — it is in hand.
    assert.equal(game.state.balls[1].pocketed, false);
    assert.deepEqual({ x: game.state.balls[1].x, z: game.state.balls[1].z }, BILLIARD_SPOT);
    assert.equal(game.state.balls[2].pocketed, true, 'Yellow stays off the table');
    assert.equal(game.state.phase, 'ball-in-hand');
    assert.equal(game.state.turn, 1);
  } finally {
    game.dispose();
  }
});

test('the game is constructed in the mode it was asked for, arena furniture and all', () => {
  for (const [mode, balls] of [
    ['eight-ball', 16],
    ['snooker', 22],
    ['billiards', 3],
  ] as const) {
    const game = new PoolGame(`built-${mode}`, { mode });
    try {
      assert.equal(game.state.balls.length, balls, mode);
      assert.equal(game.state.mode ?? 'eight-ball', mode);
      // The arcade arena is pub-table furniture: snooker and billiards have no rule that could judge a hit on it.
      assert.equal(!!game.state.arcade, mode === 'eight-ball', `${mode} arcade`);
    } finally {
      game.dispose();
    }
  }
  // The zombie mode runs its own engine, so reaching the cue-sports one is a wiring bug and says so out loud.
  assert.throws(() => new PoolGame('zombie-wiring', { mode: 'zombie' }), /not cue sports/);
});
