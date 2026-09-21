import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZombieMatch } from '../src/match/zombie';
import { CUE_HOME, MAX_SHOT_SPEED, STILL_SPEED } from '../src/simulation/modes/zombie';
import { rackOptions, type Preferences } from '../src/ui/player-profile';
import type { TableEvent } from '../src/simulation/types';

/** Run the clock forward the way the render loop does, collecting whatever the run emitted. */
function settle(match: ZombieMatch): TableEvent[] {
  const events: TableEvent[] = [];
  for (let frame = 0; frame < 3000 && match.state.phase === 'rolling'; frame++) {
    match.update(1 / 60);
    events.push(...match.drainEvents());
  }
  assert.notEqual(match.state.phase, 'rolling');
  return events;
}

test('the menu picks the horde, and the horde needs its own authority rather than PoolGame', () => {
  const preferences = {
    layout: 'crossfire',
    level: 1,
    format: 'singles',
    rules: 'new',
    game: 'zombie',
  } as unknown as Preferences;
  // This is the same call main.ts makes, and its answer is what decides which authority is built.
  assert.equal(rackOptions(preferences, 'singles', null).mode, 'zombie');
  const match = new ZombieMatch({ seed: 'menu-horde' });
  try {
    const state = match.state;
    assert.equal(state.mode, 'zombie');
    assert.equal(state.phase, 'ready');
    // One cue ball and no object balls; the walkers ride as arcade obstacles, which is how the arena visuals find
    // them, and each one carries the walking speed the renderer detects a body by.
    assert.equal(state.balls.length, 1);
    assert.ok(state.arcade!.obstacles.length >= 5);
    assert.ok(state.arcade!.obstacles.every((body) => typeof (body as { speed?: number }).speed === 'number'));
  } finally {
    match.dispose();
  }
});

test('a shot kills, scores and puts the cue ball back on its spot', () => {
  const match = new ZombieMatch({ seed: 'menu-horde' });
  try {
    const before = match.state.arcade!.obstacles.length;
    assert.equal(match.dispatch({ type: 'shoot', shot: { angle: 0, power: 1 } }).ok, true);
    assert.equal(match.state.phase, 'rolling');
    const events = settle(match);
    const after = match.state;
    assert.ok(after.arcade!.obstacles.length < before, 'the shot took bodies off the table');
    assert.ok(after.arcade!.destroyed[0] > 0);
    assert.ok(after.arcade!.scores[0] > 0);
    // Kills reach the renderer in its own language: an obstacle strike that destroyed the body.
    const kills = events.filter((event) => event.kind === 'obstacle' && event.destroyed);
    assert.equal(kills.length, after.arcade!.destroyed[0]);
    assert.ok(kills.every((event) => typeof event.obstacle === 'number'));
    // The ball comes home for the next shot: there is no pocket and no ball in hand in this mode.
    assert.equal(after.phase, 'ready');
    assert.deepEqual({ x: after.balls[0].x, z: after.balls[0].z }, { x: CUE_HOME.x, z: CUE_HOME.z });
    assert.equal(Math.hypot(after.balls[0].vx, after.balls[0].vz), 0);
  } finally {
    match.dispose();
  }
});

test('a breach ends the run and a restart racks a fresh wave', () => {
  const match = new ZombieMatch({ seed: 'menu-horde' });
  try {
    for (let shot = 0; shot < 200 && match.state.phase !== 'over'; shot++) {
      match.dispatch({ type: 'shoot', shot: { angle: 0, power: 1 } });
      settle(match);
    }
    assert.equal(match.state.phase, 'over');
    assert.equal(match.actor.canAct, false);
    // A horde is not a frame: there is no level to advance to, only another run.
    assert.equal(match.capabilities.canAdvance, false);
    assert.equal(match.capabilities.canRematch, true);
    assert.equal(match.dispatch({ type: 'rematch' }).ok, true);
    assert.equal(match.state.phase, 'ready');
    assert.equal(match.state.arcade!.scores[0], 0);
    assert.ok(match.state.arcade!.obstacles.length >= 5);
  } finally {
    match.dispose();
  }
});

test('a shot with no pace on it is refused, and pool commands are quietly ignored', () => {
  const match = new ZombieMatch({ seed: 'menu-horde' });
  try {
    assert.equal(
      match.dispatch({ type: 'shoot', shot: { angle: 0, power: STILL_SPEED / MAX_SHOT_SPEED / 2 } }).ok,
      false,
    );
    assert.equal(match.state.phase, 'ready');
    // Cue locker, chalk and group belong to pool; the shell offers them anyway and they must not raise an error.
    assert.equal(match.dispatch({ type: 'chalk' }).ok, true);
    assert.equal(match.dispatch({ type: 'group', group: 'solids' }).ok, true);
    assert.equal(match.state.phase, 'ready');
  } finally {
    match.dispose();
  }
});
