import { edit } from './arrangements';
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { PoolGame, initPhysics } from '../src/simulation/game';
import { createArcade } from '../src/simulation/arcade';
import { obstacleRay, obstructionAt } from '../src/simulation/table-geometry';
import { initialState, newRack, TABLE, type ArenaLayout, type PowerUp, type ShotResult, type TableEvent } from '../src/simulation/types';

before(async () => { await initPhysics(); });
const rolling = (game: PoolGame) => game.state.phase === 'rolling';
const shot = (potted: number[] = []): ShotResult => ({ firstContact: 1, potted, railAfterContact: true, breakRails: [1, 2, 3, 4] });
test('seeded layouts vary between racks, reproduce exactly and keep props clear of balls and the break lane', () => {
  for (const layout of ['crossfire', 'fortress', 'gauntlet'] satisfies ArenaLayout[]) {
    assert.deepEqual(createArcade(layout, 'same-seed'), createArcade(layout, 'same-seed'));
    assert.notDeepEqual(createArcade(layout, 'first-rack'), createArcade(layout, 'second-rack'));
    for (let seedNumber = 0; seedNumber < 60; seedNumber++) {
      const level = seedNumber % 5 + 1;
      const seed = `layout-${seedNumber}`, arena = createArcade(layout, seed, level), balls = newRack(seed);
      assert.equal(arena.level, level);
      assert.equal(arena.obstacles.length, level);
      assert.equal(arena.hazards.length, Math.min(3, level - 1));
      assert.equal(arena.portalTurns, 0);
      assert.ok(arena.hazards.every(h => h.kind !== 'portal'));
      if (level === 1) assert.ok(arena.obstacles.every(o => o.material === 'wood' && o.maxHp === 1));
      assert.ok(obstacleRay(arena, -2.85, 0, 1, 0, TABLE.radius) > 5.04);
      for (const ball of balls) assert.ok(!obstructionAt(arena, ball.x, ball.z, TABLE.radius));
      for (const obstacle of arena.obstacles) for (const other of arena.obstacles) {
        if (obstacle.id === other.id) continue;
        assert.ok(Math.abs(obstacle.x - other.x) >= (obstacle.width + other.width) / 2 || Math.abs(obstacle.z - other.z) >= (obstacle.depth + other.depth) / 2, 'blocks must not overlap');
      }
      const circles = [...arena.hazards, ...arena.pickups];
      for (const circle of circles) {
        assert.ok(!obstructionAt(arena, circle.x, circle.z, circle.radius), 'surface props must not overlap blocks');
        assert.ok(Math.abs(circle.x) + circle.radius < TABLE.halfWidth && Math.abs(circle.z) + circle.radius < TABLE.halfDepth);
        const laneX = Math.max(-2.85, Math.min(2.55, circle.x));
        assert.ok(Math.hypot(circle.x - laneX, circle.z) > circle.radius + TABLE.radius, 'the break lane must not collect pickups or trigger hazards');
        for (const ball of balls) assert.ok(Math.hypot(circle.x - ball.x, circle.z - ball.z) > circle.radius + TABLE.radius);
        for (const other of circles) if (circle !== other) assert.ok(Math.hypot(circle.x - other.x, circle.z - other.z) > circle.radius + other.radius, 'surface props must not overlap each other');
      }
      assert.equal(arena.pickups.length, 2);
      assert.ok(arena.pickups.every(p => p.available && p.power && p.expiresAt! >= 12 && p.expiresAt! <= 20));
      for (const portal of arena.hazards.filter(h => h.kind === 'portal')) {
        const target = arena.hazards.find(h => h.id === portal.link);
        assert.equal(target?.kind, 'portal'); assert.equal(target?.link, portal.id);
      }
    }
  }
});

test('the cue collects each displayed power once, queues the next shot’s effect and awards pickup points', () => {
  for (const power of ['overdrive','frost','ward','focus','portal'] satisfies PowerUp[]) {
    const game = new PoolGame(`visible-pickup-${power}`);
    try {
      edit(game,state=>{state.arcade!.hazards=[];state.arcade!.pickups=[{id:0,x:-2.1,z:0,radius:.16,available:true,power,expiresAt:15}];});
      const arcade=game.state.arcade!;
      assert.equal(game.snapshot().arcade!.pickups[0].power, power);
      const events: TableEvent[] = []; game.onEvent = event => events.push(event);
      game.shoot({ angle: 0, power: .03 });
      for (let step = 0; step < 48; step++) game.step();
      const rewards = events.filter(event => event.kind === 'pickup');
      assert.equal(rewards.length, 1);
      const reward = rewards[0]; assert.equal(reward.power, power); assert.ok(reward.power);
      assert.ok(!arcade.pickups.some(p => p.id === 0 && p.available));
      assert.equal(arcade.scores[0], 25);
      assert.equal(Object.values(arcade.activeShot).some(Boolean), false, 'a collected effect cannot change an already rolling shot');
      if (reward.power === 'frost') assert.equal(arcade.buffs[1].frozen, 1);
      else if (reward.power === 'portal') assert.equal(arcade.portalTurns, 0, 'the new portal pair waits for the rolling shot to finish');
      else assert.equal(arcade.buffs[0][reward.power], 1);
      for (let step = 0; step < 12; step++) game.step();
      assert.equal(events.filter(event => event.kind === 'pickup').length, 1);
    } finally { game.dispose(); }
  }
});

test('an untouched stationary ball cannot collect a pickup during another ball’s shot', () => {
  const game = new PoolGame('stationary-pickup');
  try {
    const target = game.state.balls[1];
    edit(game,state=>{state.arcade!.hazards = [];});
    edit(game,state=>{state.arcade!.pickups = [{ id: 0, x: target.x, z: target.z, radius: .16, available: true }];});
    game.shoot({ angle: Math.PI, power: .03 });
    for (let step = 0; step < 48; step++) game.step();
    assert.equal(game.state.arcade!.pickups[0].available, true);
    assert.equal(game.state.arcade!.scores[0], 0);
  } finally { game.dispose(); }
});

test('visible pickups spawn and expire on a deterministic ready-table clock without moving any balls', () => {
  const first = new PoolGame('timed-pickups', { level: 5 }), second = new PoolGame('timed-pickups', { level: 5 });
  try {
    const initialBalls = first.snapshot().balls;
    assert.equal(first.state.arcade!.pickups.length, 2);
    const spawned: { at: number; lifetime: number }[] = [], expired: number[] = [];
    first.onEvent = event => {
      if (event.kind === 'spawn') {
        const a = first.state.arcade!, pickup = a.pickups.find(p => p.id === event.pickup)!;
        assert.ok(pickup.power && pickup.power === event.power);
        spawned.push({ at: a.clock!, lifetime: pickup.expiresAt! - a.clock! });
        assert.ok(!obstructionAt(a, pickup.x, pickup.z, pickup.radius));
        assert.ok(first.state.balls.every(b => b.pocketed || Math.hypot(b.x - pickup.x, b.z - pickup.z) > TABLE.radius + pickup.radius));
        assert.ok(!(pickup.x > -3.41 && pickup.x < 3.26 && Math.abs(pickup.z) < .62), 'spawns must keep the central break lane clear');
      }
      if (event.kind === 'expire') expired.push(event.pickup!);
    };
    for (let step = 0; step < 36 * 120; step++) {
      first.step(); second.step();
      const active = first.state.arcade!.pickups.filter(p => p.available);
      assert.ok(active.length <= 3);
      assert.equal(new Set(active.map(p => p.id)).size, active.length);
      assert.ok(active.every(p => p.power && p.expiresAt! > first.state.arcade!.clock!));
    }
    assert.deepEqual(first.snapshot(), second.snapshot(), 'the same seed and elapsed simulation steps reproduce the pickup timeline');
    assert.deepEqual(first.state.balls, initialBalls, 'timers and spawning cannot wake resting balls');
    assert.ok(spawned.length >= 3);
    assert.ok(spawned[0].at >= 5 && spawned[0].at <= 9 + 1 / 120);
    assert.ok(spawned.every(item => item.lifetime >= 12 && item.lifetime <= 20));
    assert.ok(expired.includes(0) && expired.includes(1), 'initial pickups expire too');
    const clock = first.state.arcade!.clock!;
    first.shoot({ angle: Math.PI, power: .03 }); first.step();
    assert.ok(first.state.arcade!.clock! > clock, 'the same clock continues while a shot rolls');
    edit(first,state=>{state.phase = 'over';}); edit(first,state=>{state.winner = 0;});
    const finished = first.snapshot();
    for (let step = 0; step < 120; step++) first.step();
    assert.deepEqual(first.snapshot(), finished, 'a completed rack stops the pickup clock');
  } finally { first.dispose(); second.dispose(); }
});
