import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { initPhysics } from '../src/simulation/game';
import { LocalMatch, MATCH_STEP } from '../src/match/local';
import { canAdvance, MAX_LEVEL, normalizeLevel } from '../src/match/policy';
import { activeSeat, type GameState } from '../src/simulation/types';
import { SnapshotTimeline, NETWORK_DELAY } from '../src/match/timeline';
before(initPhysics);
function settled(match: LocalMatch) { for (let i = 0; i < 4000 && match.state.phase === 'rolling'; i++) match.update(MATCH_STEP, { aiPaused: true }); assert.notEqual(match.state.phase, 'rolling'); }
function finish(match: LocalMatch, winner: 0 | 1) { const state = match.snapshot(); state.phase = 'over'; state.winner = winner; match.arrange(state); }

test('local and hosted matches execute the same commands, clock and Scotch doubles rotation', () => {
  const local = new LocalMatch({ seed: 'match-parity', mode: 'local', options: { format: 'doubles' } });
  const hosted = new LocalMatch({ seed: 'match-parity', mode: 'online', options: { format: 'doubles' } });
  try {
    hosted.setReady(true);
    for (const match of [local, hosted]) {
      assert.equal(match.dispatch({ type: 'shoot', shot: { angle: 0, power: .03 } }, 2).ok, false);
      assert.equal(match.dispatch({ type: 'chalk' }, 0).ok, true);
      assert.equal(match.dispatch({ type: 'shoot', shot: { angle: 0, power: .03 } }, 0).ok, true);
      settled(match);
      assert.equal(activeSeat(match.state), 1);
      assert.equal(match.dispatch({ type: 'place', x: -2.85, z: 0 }, 3).ok, false);
      assert.equal(match.dispatch({ type: 'place', x: -2.85, z: 0 }, 1).ok, true);
    }
    assert.deepEqual(local.snapshot(), hosted.snapshot());
    assert.deepEqual(local.drainEvents(), hosted.drainEvents());
  } finally { local.dispose(); hosted.dispose(); }
});

test('menu-paused AI leaves the match pickup clock running; incomplete online rooms pause only idle time', () => {
  const local = new LocalMatch({ seed: 'clock-policy', mode: 'ai' });
  const hosted = new LocalMatch({ seed: 'clock-policy', mode: 'online' });
  try {
    const before = local.snapshot();
    local.update(10, { aiPaused: true }); hosted.update(10);
    assert.ok(local.state.arcade!.clock! >= 9.999); assert.equal(hosted.state.arcade!.clock, 0);
    assert.deepEqual(local.state.balls, before.balls);
    assert.ok(local.drainEvents().some(event => event.kind === 'spawn'));
    hosted.setReady(true); hosted.update(10);
    assert.deepEqual(local.snapshot(), hosted.snapshot());
    assert.equal(hosted.dispatch({ type: 'shoot', shot: { angle: 0, power: .03 } }, 0).ok, true);
    hosted.setReady(false); settled(hosted);
    assert.equal(hosted.state.shotCount, 1, 'an in-flight shot settles after disconnection');
    const clock = hosted.state.arcade!.clock;
    hosted.update(10); assert.equal(hosted.state.arcade!.clock, clock);
  } finally { local.dispose(); hosted.dispose(); }
});

test('an idle match shares one frozen state view across frames until a command or shot changes the table', () => {
  const match = new LocalMatch({ seed: 'idle-view', mode: 'local' });
  try {
    const idle = match.state;
    // Four seconds of 60 Hz frames: the clock runs but the first timed spawn is at least five seconds away.
    for (let i = 0; i < 240; i++) match.update(1 / 60);
    const current = match.state;
    assert.equal(current.balls, idle.balls, 'idle frames must not re-snapshot the table');
    assert.equal(current.arcade!.pickups, idle.arcade!.pickups);
    assert.ok(current.arcade!.clock! > 3.99, 'the pickup clock stays current in the shared view');
    assert.ok(Object.isFrozen(current) && Object.isFrozen(current.arcade) && Object.isFrozen(current.balls[0]));
    assert.equal('simulation' in current, false, 'engine continuation metadata stays out of the presentation view');
    assert.ok(match.snapshot().simulation, 'restore snapshots keep continuation metadata');
    assert.equal(match.dispatch({ type: 'chalk' }).ok, true);
    assert.notEqual(match.state.balls, idle.balls); assert.equal(match.state.chalked[0], true);
    assert.equal(match.dispatch({ type: 'shoot', shot: { angle: 0, power: .6 } }).ok, true);
    const launched = match.state;
    assert.equal(launched.phase, 'rolling'); assert.ok(launched.balls[0].vx > 0);
    match.update(1 / 60);
    assert.ok(match.state.balls[0].x > launched.balls[0].x, 'rolling steps publish moving balls');
  } finally { match.dispose(); }
});

test('all three AI seats use authorized commands; humans cannot take over a doubles AI partner', () => {
  const match = new LocalMatch({ seed: 'ai-seats', mode: 'ai', options: { format: 'doubles' }, random: () => .5 });
  try {
    for (const seat of [1, 2, 3]) {
      const state = match.snapshot(); state.phase = 'ready'; state.turn = seat % 2 as 0 | 1; state.teamOrder[state.turn] = seat >= 2 ? 1 : 0;
      state.chalked = [false, false]; match.arrange(state);
      assert.equal(match.actor.controller, 'ai'); assert.equal(match.actor.canAct, false);
      assert.equal(match.dispatch({ type: 'chalk' }, seat).ok, false);
      match.update(.1, { aiPaused: true }); assert.equal(match.thinking, false);
      match.update(.1); assert.equal(match.thinking, true); assert.ok(match.aiPreview);
      match.pauseAI(); assert.equal(match.aiPreview, null);
      for (let i = 0; i < 13; i++) match.update(.1);
      assert.equal(match.state.phase, 'rolling');
      const events = match.drainEvents();
      assert.equal(events.filter(event => event.kind === 'cue').length, 1);
      assert.equal(events.filter(event => event.kind === 'chalk').length, 1);
    }
  } finally { match.dispose(); }
});

test('reset, rematch and progression share a level cap and reset event/AI state', () => {
  const match = new LocalMatch({ seed: 'progression', mode: 'ai', options: { level: MAX_LEVEL - 1 }, nextSeed: () => 'fresh-rack' });
  const online = new LocalMatch({ seed: 'online-reset', mode: 'online' });
  try {
    assert.equal(normalizeLevel(Infinity), 1); assert.equal(normalizeLevel(100), MAX_LEVEL);
    assert.equal(match.capabilities.canReset, true);
    assert.equal(match.capabilities.canAdvance, false);
    assert.equal(match.dispatch({ type: 'advance' }).ok, false);
    finish(match, 1); assert.equal(canAdvance(match.state, 'ai'), false); assert.equal(match.dispatch({ type: 'advance' }).ok, false);
    finish(match, 0); assert.equal(canAdvance(match.state, 'ai'), true); assert.equal(match.dispatch({ type: 'advance' }).ok, true);
    assert.equal(match.state.arcade!.level, MAX_LEVEL); assert.equal(match.state.seed, 'fresh-rack');
    finish(match, 0); assert.equal(match.dispatch({ type: 'advance' }).ok, false); assert.equal(match.dispatch({ type: 'rematch' }).ok, true);
    assert.deepEqual(match.drainEvents(), []);
    assert.equal(match.dispatch({ type: 'reset', seed: 'custom', options: { level: 2, format: 'doubles' } }).ok, true);
    assert.equal(match.state.seed, 'custom'); assert.equal(match.state.format, 'doubles'); assert.equal(match.state.arcade!.level, 2);
    online.setReady(true); assert.equal(online.capabilities.canReset, false); assert.equal(online.dispatch({ type: 'reset' }).ok, false);
    finish(online, 0); assert.equal(online.capabilities.canReset, true); assert.equal(online.dispatch({ type: 'reset' }, 1).ok, true);
  } finally { match.dispose(); online.dispose(); }
});

test('snapshot timeline samples collisions together and drops stale effects when the rack changes', () => {
  const match = new LocalMatch({ seed: 'timeline' });
  try {
    const before = match.snapshot(); before.phase = 'rolling'; before.shotCount = 1;
    const after = structuredClone(before); after.balls[0].x += 1; after.balls[1].x += 1;
    const timeline = new SnapshotTimeline();
    timeline.push(before, [], 100); timeline.push(after, [{ kind: 'ball', x: 0, z: 0, strength: 1, time: 1 }], 200);
    const sample = timeline.sample(150 + NETWORK_DELAY)!;
    assert.ok(Math.abs((sample.balls[0].x - before.balls[0].x) - (sample.balls[1].x - before.balls[1].x)) < 1e-10);
    assert.deepEqual(timeline.drainEvents(244), []); assert.equal(timeline.drainEvents(245).length, 1); assert.deepEqual(timeline.drainEvents(246), []);
    timeline.push(after, [{ kind: 'cue', x: 0, z: 0, strength: 1, time: 1 }], 300);
    const next: GameState = { ...before, seed: 'new-rack' }; timeline.push(next, [], 310);
    assert.equal(timeline.sample(310)!.seed, 'new-rack'); assert.deepEqual(timeline.drainEvents(1000), []);
  } finally { match.dispose(); }
});
