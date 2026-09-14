import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { choosePlacement, chooseShot } from '../src/simulation/ai';
import { createArcade } from '../src/simulation/arcade';
import { obstructionAt } from '../src/simulation/table-geometry';
import { PoolGame, initPhysics } from '../src/simulation/game';
import { initialState, TABLE, type ArenaLayout } from '../src/simulation/types';

before(async () => { await initPhysics(); });
function openTarget() {
  const state = initialState('ai-controlled');
  state.shotCount = 1; state.groups = ['solids', 'stripes']; state.arcade = createArcade('crossfire', state.seed);
  state.arcade.obstacles = []; state.arcade.hazards = []; state.arcade.pickups = [];
  for (const ball of state.balls) ball.pocketed = ball.id > 1;
  Object.assign(state.balls[0], { x: -3, z: 0 }); Object.assign(state.balls[1], { x: 1, z: 0 });
  return state;
}

test('AI changes its direct shot when a portal interrupts the cue-to-target route', () => {
  const state = openTarget(), original = chooseShot(state, 'expert', () => .5);
  const portal = { id: 0, kind: 'portal' as const, x: -3 + Math.cos(original.angle) * 2, z: Math.sin(original.angle) * 2, radius: .07, link: 1 };
  state.arcade!.hazards = [portal, { id: 1, kind: 'portal', x: -4, z: 2, radius: .07, link: 0 }];
  const adjusted = chooseShot(state, 'expert', () => .5);
  assert.ok(Math.abs(adjusted.angle - original.angle) > .005);
  const dx = Math.cos(adjusted.angle), dz = Math.sin(adjusted.angle);
  const along = Math.max(0, Math.min(3.65, (portal.x + 3) * dx + portal.z * dz));
  const separation = Math.hypot(portal.x + 3 - along * dx, portal.z - along * dz);
  assert.ok(separation > portal.radius, 'the chosen initial route must avoid portal transit');
});

test('AI accounts for queued frost, Overdrive and Heavy cue when choosing shot power', () => {
  const base = openTarget(), normal = chooseShot(base, 'expert', () => .5);
  const powers: Record<string, number> = {};
  for (const effect of ['frozen', 'overdrive', 'sticky'] as const) {
    const state = structuredClone(base); state.arcade!.buffs[0][effect] = 1;
    const shot = chooseShot(state, 'expert', () => .5);
    assert.ok(Number.isFinite(shot.angle) && Number.isFinite(shot.power));
    assert.ok(shot.power > 0 && shot.power <= 1);
    powers[effect] = shot.power;
  }
  assert.ok(powers.frozen > normal.power, 'frost requires a stronger cue input');
  assert.ok(powers.overdrive < normal.power, 'Overdrive requires less cue input for the same route');
  assert.ok(powers.sticky > normal.power, 'Heavy cue requires compensation for extra drag');
});

test('AI ball-in-hand placement avoids hazards and blocks and is accepted by the actual engine', () => {
  for (const layout of ['crossfire', 'fortress', 'gauntlet'] satisfies ArenaLayout[]) for (let seed = 0; seed < 4; seed++) {
    const game = new PoolGame(`ai-placement-${seed}`, { layout, level: seed + 2 });
    try {
      const arrangement = game.snapshot();
      arrangement.shotCount = 1; arrangement.phase = 'ball-in-hand'; arrangement.balls[0].pocketed = true;
      game.arrange(arrangement);
      const point = choosePlacement(game.state);
      assert.ok(!obstructionAt(game.state.arcade, point.x, point.z, TABLE.radius));
      assert.ok(game.state.arcade!.hazards.every(h => Math.hypot(point.x - h.x, point.z - h.z) > h.radius + TABLE.radius));
      assert.equal(game.placeCue(point.x, point.z), true);
    } finally { game.dispose(); }
  }
});
