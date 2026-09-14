import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { initPhysics, PoolGame } from '../src/simulation/game';
import { CUE_CATALOG, DEFAULT_CUE, availableCues, equippedCue, getCue, type CueId } from '../src/simulation/cues';
import { LocalMatch } from '../src/match/local';
import { chooseShot } from '../src/simulation/ai';
import { activeSeat, type TableEvent } from '../src/simulation/types';
import { arrangeBalls, edit } from './arrangements';
before(initPhysics);

function isolated(id: CueId, withTarget = false) {
  const game = new PoolGame('cue-equipment', { level: 5 });
  arrangeBalls(game, withTarget ? { 0: { x: -1, z: 0 }, 1: { x: 0, z: 0 } } : { 0: { x: -3, z: 0 } });
  assert.equal(game.equipCue(0, id), true);
  return game;
}

test('five named woods unlock by level and equipment validates IDs, seats and shot phase', () => {
  assert.equal(CUE_CATALOG.length, 5);
  assert.equal(new Set(CUE_CATALOG.map((cue) => cue.wood)).size, 5);
  assert.equal(getCue('__proto__'), undefined);
  assert.equal(getCue({ id: DEFAULT_CUE }), undefined);
  assert.deepEqual([getCue(DEFAULT_CUE)!.power, getCue(DEFAULT_CUE)!.spin, getCue(DEFAULT_CUE)!.curve], [1, 1, 1]);
  for (let level = 1; level <= 5; level++) assert.equal(availableCues(level).length, level);
  const match = new LocalMatch({ seed: 'cue-locks', mode: 'online', options: { level: 2, format: 'doubles' } });
  try {
    assert.equal(
      match.dispatch({ type: 'equip', cue: 'maple-control' }, 2).ok,
      true,
      'reserved seats can equip while waiting in a lobby',
    );
    assert.equal(match.dispatch({ type: 'equip', cue: 'rosewood-power' }, 2).ok, false);
    assert.equal(match.dispatch({ type: 'equip', cue: '__proto__' as CueId }, 2).ok, false);
    assert.equal(match.dispatch({ type: 'equip', cue: DEFAULT_CUE }, 4).ok, false);
    assert.deepEqual(match.state.cues, [DEFAULT_CUE, DEFAULT_CUE, 'maple-control', DEFAULT_CUE]);
    match.setReady(true);
    assert.equal(match.dispatch({ type: 'shoot', shot: { angle: 0, power: 0.03 } }, 0).ok, true);
    assert.equal(match.capabilities.canEquip, false);
    assert.equal(match.dispatch({ type: 'equip', cue: DEFAULT_CUE }, 2).ok, false);
    const state = match.snapshot();
    state.phase = 'ball-in-hand';
    match.arrange(state);
    assert.equal(match.dispatch({ type: 'equip', cue: 'maple-control' }, 1).ok, true);
  } finally {
    match.dispose();
  }
});

test('default cue preserves strike speed, power cue hits harder and finesse cue produces stronger draw and curve', () => {
  const speeds = new Map<CueId, number>(),
    draws = new Map<CueId, number>(),
    curves = new Map<CueId, number>();
  for (const cue of CUE_CATALOG) {
    const straight = isolated(cue.id),
      draw = isolated(cue.id, true),
      curve = isolated(cue.id);
    try {
      straight.shoot({ angle: Math.PI / 6, power: 0.6 });
      const ball = straight.state.balls[0];
      speeds.set(cue.id, Math.hypot(ball.vx, ball.vz));
      assert.ok(
        Math.abs(Math.atan2(ball.vz, ball.vx) - Math.PI / 6) < 1e-10,
        'equipment cannot invent a new initial direction',
      );
      const events: TableEvent[] = [];
      draw.onEvent = (event) => events.push(event);
      draw.shoot({ angle: 0, power: 0.45, tipY: -0.8 });
      for (let i = 0; i < 100 && !events.some((event) => event.kind === 'ball'); i++) draw.step();
      for (let i = 0; i < 4; i++) draw.step();
      assert.ok(events.some((event) => event.kind === 'ball'));
      draws.set(cue.id, -draw.state.balls[0].vx);
      curve.shoot({ angle: 0, power: 0.4, tipX: 0.7, elevation: 0.75 });
      for (let i = 0; i < 60; i++) curve.step();
      assert.equal(curve.state.balls[0].airborne, false);
      curves.set(cue.id, curve.state.balls[0].z);
    } finally {
      straight.dispose();
      draw.dispose();
      curve.dispose();
    }
  }
  assert.ok(Math.abs(speeds.get(DEFAULT_CUE)! - (1.4 + 0.6 * 15)) < 1e-10);
  assert.ok(speeds.get('rosewood-power')! > speeds.get(DEFAULT_CUE)! * 1.07);
  assert.ok(speeds.get('maple-control')! < speeds.get(DEFAULT_CUE)!);
  assert.ok(draws.get('ebony-finesse')! > draws.get(DEFAULT_CUE)! * 1.05);
  assert.ok(curves.get('ebony-finesse')! > curves.get(DEFAULT_CUE)! * 1.15);
  assert.ok(curves.get('rosewood-power')! < curves.get(DEFAULT_CUE)!);
});

test('cue equipment survives snapshot restore and rematches, while lower-level resets remove locked choices', () => {
  const match = new LocalMatch({ seed: 'cue-preservation', mode: 'local', options: { level: 4, format: 'doubles' } });
  try {
    assert.equal(match.dispatch({ type: 'equip', cue: 'ebony-finesse' }, 2).ok, true);
    const state = match.snapshot();
    state.phase = 'over';
    state.winner = 0;
    match.arrange(state);
    assert.equal(match.dispatch({ type: 'rematch' }).ok, true);
    assert.equal(match.state.cues[2], 'ebony-finesse');
    const ended = match.snapshot();
    ended.phase = 'over';
    ended.winner = 0;
    match.arrange(ended);
    assert.equal(match.dispatch({ type: 'advance' }).ok, true);
    assert.equal(match.state.arcade!.level, 5);
    assert.equal(match.state.cues[2], 'ebony-finesse');
    assert.equal(match.dispatch({ type: 'reset', options: { level: 1 } }).ok, true);
    assert.deepEqual(match.state.cues, [DEFAULT_CUE, DEFAULT_CUE, DEFAULT_CUE, DEFAULT_CUE]);
    const invalid = match.snapshot();
    invalid.cues[0] = 'walnut-master';
    match.arrange(invalid);
    assert.equal(match.state.cues[0], DEFAULT_CUE, 'arrangement cannot sneak locked stats into a lower-level table');
  } finally {
    match.dispose();
  }
  const original = isolated('ebony-finesse'),
    restored = new PoolGame('other');
  try {
    original.shoot({ angle: 0, power: 0.4, tipX: 0.7, elevation: 0.75 });
    for (let i = 0; i < 15; i++) original.step();
    restored.arrange(original.snapshot());
    for (let i = 0; i < 30; i++) {
      original.step();
      restored.step();
    }
    assert.equal(equippedCue(restored.state).id, 'ebony-finesse');
    assert.ok(Math.abs(original.state.balls[0].z - restored.state.balls[0].z) < 1e-5);
  } finally {
    original.dispose();
    restored.dispose();
  }
});

test('AI uses unlocked seat equipment and adjusts power planning to its cue', () => {
  const match = new LocalMatch({
    seed: 'cue-ai',
    mode: 'ai',
    difficulty: 'expert',
    options: { level: 5, format: 'doubles' },
  });
  try {
    const state = match.snapshot();
    state.turn = 0;
    state.teamOrder = [1, 0];
    match.arrange(state);
    assert.equal(activeSeat(match.state), 2);
    assert.equal(
      match.dispatch({ type: 'equip', cue: 'ebony-finesse' }, 2).ok,
      false,
      'a human cannot control their AI partner’s equipment',
    );
    match.update(0.1);
    assert.equal(match.state.cues[2], 'walnut-master');
    assert.ok(match.aiPreview);
    assert.equal(match.thinking, true);
    const house = match.snapshot();
    house.cues[2] = DEFAULT_CUE;
    const stronger = structuredClone(house);
    stronger.cues[2] = 'rosewood-power';
    assert.ok(
      chooseShot(stronger, 'expert', () => 0.5).power < chooseShot(house, 'expert', () => 0.5).power,
      'AI compensates for the power cue instead of blindly overshooting',
    );
  } finally {
    match.dispose();
  }
});

test('every cue keeps full-power boosted tricks finite and within its initial energy reservoir', () => {
  for (const cue of CUE_CATALOG) {
    const game = new PoolGame(`cue-stress-${cue.id}`, { level: 5 });
    try {
      edit(game, (state) => {
        state.arcade!.hazards = [];
        state.arcade!.pickups = [];
        state.arcade!.obstacles = [];
        state.arcade!.buffs[0].overdrive = 1;
      });
      game.equipCue(0, cue.id);
      game.chalkCue();
      game.shoot({ angle: 0.015, power: 1, tipX: 0.3, tipY: -0.7, elevation: 0.5 });
      const energy = () =>
        game.state.balls.reduce(
          (sum, ball) =>
            sum +
            (ball.pocketed ? 0 : ball.vx ** 2 + ball.vz ** 2 + (ball.vy || 0) ** 2 + 19.62 * (ball.elevation || 0)),
          0,
        );
      const initial = energy() + game.snapshot().simulation!.cueSpin.energy;
      let steps = 0;
      while (game.state.phase === 'rolling' && steps++ < 4000) {
        game.step();
        assert.ok(energy() <= initial + 1e-3, `${cue.id} cannot create runaway energy`);
        assert.ok(
          game.state.balls.every((ball) =>
            [ball.x, ball.z, ball.vx, ball.vz, ball.elevation || 0, ball.vy || 0].every(Number.isFinite),
          ),
        );
      }
      assert.ok(steps < 4000);
    } finally {
      game.dispose();
    }
  }
});
