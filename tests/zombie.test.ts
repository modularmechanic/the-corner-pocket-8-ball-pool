import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  breached,
  CUE_HOME,
  fire,
  hordeHp,
  hordeSize,
  hordeSpeed,
  initialZombieState,
  KILL_SCORE,
  MAX_SHOT_TICKS,
  resolveShot,
  spawnWave,
  step,
  WAVE_BONUS,
  ZOMBIE_DT,
  ZOMBIE_MODE,
  zombieRack,
  zombieRadius,
  type Zombie,
  type ZombieState,
} from '../src/simulation/modes/zombie';
import { EIGHT_BALL_TABLE } from '../src/simulation/modes/table';

const T = EIGHT_BALL_TABLE;
/** A stationary body, so a test that is about the cue ball is not also about the walk. */
const body = (id: number, x: number, z: number, hp = 1, speed = 0): Zombie => ({
  id,
  x,
  z,
  width: 0.34,
  depth: 0.34,
  hp,
  maxHp: hp,
  material: 'wood',
  speed,
});
/** A run with a hand-placed horde. */
function run(zombies: Zombie[], seed = 'graveyard'): ZombieState {
  const state = initialZombieState(seed);
  state.zombies = zombies;
  return state;
}
const speedOf = (state: ZombieState) => Math.hypot(state.cue.vx, state.cue.vz);

test('the run starts with the cue ball on its spot and wave one formed up at the far end', () => {
  const state = initialZombieState('graveyard');
  assert.equal(state.phase, 'aim');
  assert.deepEqual({ x: state.cue.x, z: state.cue.z }, CUE_HOME);
  assert.equal(state.cue.id, 0, 'the cue ball is ball 0, as every other mode assumes');
  assert.deepEqual(zombieRack(), [{ id: 0, ...CUE_HOME, vx: 0, vz: 0, pocketed: false }]);
  assert.equal(state.zombies.length, hordeSize(1));
  assert.equal(state.wave, 1);
  assert.equal(state.score, 0);
  for (const zombie of state.zombies)
    assert.ok(zombie.x > CUE_HOME.x + 3, 'the horde starts at the far end, well clear of the player');
});

test('a wave spawns inside the cushions and never overlapping itself, on every wave', () => {
  for (let wave = 1; wave <= 12; wave++) {
    const zombies = spawnWave('graveyard', wave);
    assert.equal(zombies.length, hordeSize(wave));
    for (const zombie of zombies) {
      const r = zombieRadius(zombie);
      assert.ok(Math.abs(zombie.x) + r < T.halfWidth, `wave ${wave} body ${zombie.id} is on the slate lengthways`);
      assert.ok(Math.abs(zombie.z) + r < T.halfDepth, `wave ${wave} body ${zombie.id} is on the slate across`);
      assert.ok(!breached(zombie), `wave ${wave} does not spawn on top of the player`);
    }
    for (const a of zombies)
      for (const b of zombies)
        if (a.id < b.id)
          assert.ok(
            Math.hypot(a.x - b.x, a.z - b.z) >= zombieRadius(a) + zombieRadius(b),
            `wave ${wave} bodies ${a.id} and ${b.id} spawned inside each other`,
          );
  }
});

test('waves escalate: more of them, walking faster, taking more hits', () => {
  assert.ok(hordeSize(6) > hordeSize(1));
  assert.ok(hordeSpeed(6) > hordeSpeed(1));
  assert.ok(hordeHp(6) > hordeHp(1));
  const late = spawnWave('graveyard', 9);
  assert.equal(late[0].hp, hordeHp(9));
  assert.equal(late[0].maxHp, late[0].hp, 'the pip renderer reads maxHp');
  assert.notEqual(late[0].material, 'wood', 'a tougher body reads as a tougher crate');
  // The curves cap, so a very long run cannot produce an unplayable wave.
  assert.equal(hordeSize(40), hordeSize(11));
  assert.equal(hordeSpeed(40), hordeSpeed(18));
  assert.equal(hordeHp(40), hordeHp(10));
});

test('the cue ball caroms off a body instead of stopping, and the body dies', () => {
  let state = fire(run([body(0, -3, 0)]), { angle: 0, power: 1 });
  const launch = speedOf(state);
  while (state.kills === 0 && state.phase === 'rolling') state = step(state);
  assert.equal(state.kills, 1);
  assert.equal(state.zombies.length, 0, 'the body is gone the moment it is hit');
  assert.ok(state.cue.vx < 0, 'a head-on hit sends the ball back down the table');
  assert.ok(speedOf(state) > launch * 0.5, 'the ball keeps most of its pace through the carom');
});

test('several kills in one shot pay a rising combo', () => {
  // A stray out of the line of fire that no shot here can kill, so the wave bonus never muddies the score.
  const stray = body(9, 4, 2, 99);
  const outcome = resolveShot(run([body(0, -3, 0.1), body(1, -3, -0.1), stray]), { angle: 0, power: 1 });
  assert.equal(outcome.state.kills, 2);
  assert.equal(outcome.state.score, KILL_SCORE + 2 * KILL_SCORE);
  assert.equal(outcome.state.bestCombo, 2);
  const kills = outcome.events.filter((event) => event.kind === 'kill');
  assert.deepEqual(
    kills.map((event) => event.combo),
    [1, 2],
  );
  assert.deepEqual(
    kills.map((event) => event.points),
    [KILL_SCORE, 2 * KILL_SCORE],
  );
  // A single kill on the next shot starts the combo over.
  const second = resolveShot({ ...outcome.state, zombies: [body(2, -3, 0), stray] }, { angle: 0, power: 1 });
  assert.equal(second.state.score, 3 * KILL_SCORE + KILL_SCORE);
  assert.equal(second.state.bestCombo, 2, 'the best combo of the run survives');
});

test('a tough body takes several hits before it goes down', () => {
  let state = fire(run([body(0, -3, 0, 3)]), { angle: 0, power: 1 });
  while (state.phase === 'rolling' && state.zombies.length && state.zombies[0].hp === 3) state = step(state);
  assert.equal(state.kills, 0, 'the first hit only wounds it');
  assert.equal(state.zombies[0].hp, 2);
  assert.equal(state.events.filter((event) => event.kind === 'hit').length, 1);
});

test('the shot settles with the cue ball back on its spot', () => {
  const outcome = resolveShot(run([]), { angle: 0.4, power: 1 });
  assert.equal(outcome.state.phase, 'aim');
  assert.deepEqual({ x: outcome.state.cue.x, z: outcome.state.cue.z }, CUE_HOME);
  assert.equal(speedOf(outcome.state), 0);
  assert.ok(outcome.ticks > 0 && outcome.ticks < MAX_SHOT_TICKS, `settled in ${outcome.ticks} steps`);
  assert.equal(outcome.state.shots, 1);
});

test('there are no pockets: the ball comes off the cushions and stays on the table', () => {
  // Straight at a middle pocket mouth, which on the pub table would swallow it.
  const outcome = resolveShot(run([]), { angle: Math.PI / 2, power: 1 });
  assert.ok(
    outcome.events.some((event) => event.kind === 'cushion' && event.strength > 0),
    'the ball rebounds off the cushion',
  );
  assert.equal(outcome.state.phase, 'aim');
  assert.equal(outcome.state.kills, 0);
});

test('a body that reaches the cue ball spot ends the run', () => {
  const walker = body(0, CUE_HOME.x + T.radius + 0.17 + 0.02, 0, 1, 1.2);
  const outcome = resolveShot(run([walker]), { angle: Math.PI / 2, power: 0.2 });
  assert.equal(outcome.state.phase, 'over');
  assert.equal(speedOf(outcome.state), 0);
  assert.ok(outcome.events.some((event) => event.kind === 'breach'));
  assert.ok(outcome.state.message.includes('wave 1'));
  // The run is finished: nothing moves again.
  assert.equal(fire(outcome.state, { angle: 0, power: 1 }), outcome.state);
  assert.equal(step(outcome.state), outcome.state);
});

test('clearing the horde banks the wave bonus and racks the next wave', () => {
  const outcome = resolveShot(run([]), { angle: 0, power: 0.3 });
  assert.equal(outcome.state.wave, 2);
  assert.equal(outcome.state.score, WAVE_BONUS * 1);
  assert.equal(outcome.state.zombies.length, hordeSize(2));
  assert.ok(outcome.events.some((event) => event.kind === 'wave' && event.wave === 2));
  assert.deepEqual(
    outcome.state.zombies.map((zombie) => zombie.id),
    outcome.state.zombies.map((_, index) => hordeSize(1) + index),
    'ids never repeat across waves, so a renderer can key visuals by id',
  );
});

test('the horde only walks while a shot is in flight', () => {
  const state = initialZombieState('graveyard');
  assert.deepEqual(step(state), state, 'a step while aiming changes nothing');
  const rolling = fire(state, { angle: 0, power: 0.5 });
  const after = step(rolling);
  assert.ok(after.zombies[0].x < rolling.zombies[0].x, 'and a step while rolling walks the horde towards the player');
  assert.ok(
    Math.abs(rolling.zombies[0].x - after.zombies[0].x - hordeSpeed(1) * ZOMBIE_DT) < 1e-12,
    'by exactly one fixed timestep of walking',
  );
});

test('a shot with no pace on it is not a shot', () => {
  const state = initialZombieState('graveyard');
  assert.equal(fire(state, { angle: 0, power: 0 }), state);
  assert.equal(fire(state, { angle: 0, power: Number.NaN }), state, 'and neither is a broken one');
  assert.equal(fire(state, { angle: Number.POSITIVE_INFINITY, power: 1 }).cue.vz, 0);
  assert.equal(fire(state, { angle: 0, power: 4 }).cue.vx, fire(state, { angle: 0, power: 1 }).cue.vx, 'power clamps');
});

test('the same seed and the same shots replay exactly', () => {
  const shots = [
    { angle: 0.05, power: 1 },
    { angle: -0.2, power: 0.8 },
    { angle: 0.35, power: 0.95 },
    { angle: -0.4, power: 1 },
  ];
  const play = (seed: string) => {
    let state = initialZombieState(seed);
    const events = [];
    const ticks = [];
    for (const shot of shots) {
      const outcome = resolveShot(state, shot);
      state = outcome.state;
      events.push(...outcome.events);
      ticks.push(outcome.ticks);
    }
    return { state, events, ticks };
  };
  const first = play('graveyard'),
    second = play('graveyard');
  assert.deepEqual(first.state, second.state);
  assert.deepEqual(first.events, second.events);
  assert.deepEqual(first.ticks, second.ticks);
  assert.ok(first.ticks.every((count) => count > 0));
  // A different seed is a different horde, so the same shots land differently.
  const other = play('boneyard');
  assert.notDeepEqual(other.state.zombies, first.state.zombies);
});

test('the input state is never mutated', () => {
  const state = initialZombieState('graveyard');
  const snapshot = structuredClone(state);
  const rolling = fire(state, { angle: 0, power: 1 });
  assert.deepEqual(state, snapshot);
  const rollingSnapshot = structuredClone(rolling);
  step(rolling);
  assert.deepEqual(rolling, rollingSnapshot);
  resolveShot(state, { angle: 0, power: 1 });
  assert.deepEqual(state, snapshot);
});

test('every shot of a long run settles at a bounded step count', () => {
  let state = initialZombieState('graveyard');
  let fired = 0;
  for (let shot = 0; shot < 40 && state.phase !== 'over'; shot++) {
    const outcome = resolveShot(state, { angle: (shot % 9) * 0.12 - 0.48, power: 1 });
    assert.ok(outcome.ticks < MAX_SHOT_TICKS, `shot ${shot} settled in ${outcome.ticks} steps`);
    assert.ok(['aim', 'over'].includes(outcome.state.phase));
    state = outcome.state;
    fired++;
  }
  assert.ok(fired > 1);
  assert.ok(state.kills > 0, 'shots down the table actually hit the horde');
});

test('the mode exposes the seam fields it can honour, on the pub table', () => {
  assert.equal(ZOMBIE_MODE.id, 'zombie');
  assert.equal(ZOMBIE_MODE.table, EIGHT_BALL_TABLE);
  assert.equal(ZOMBIE_MODE.dt, ZOMBIE_DT);
  assert.equal(ZOMBIE_MODE.initialState('graveyard').mode, 'zombie');
  assert.equal(ZOMBIE_MODE.rack('graveyard').length, 1, 'one cue ball, no object balls');
  const state = initialZombieState('graveyard');
  assert.deepEqual(ZOMBIE_MODE.legalTargets(state), state.zombies, 'targets are bodies, not balls');
});
