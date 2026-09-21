import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { arrangeBalls } from './arrangements';
import { PoolGame, initPhysics } from '../src/simulation/game';
import { RAMP_HEIGHT, rampFrame, rampSupportAt } from '../src/simulation/arcade';
import type { Hazard } from '../src/simulation/types';

before(async () => {
  await initPhysics();
});

const RAMP: Hazard = { id: 0, kind: 'ramp', x: -2, z: 0, radius: 0.58, angle: 0 };
const frame = rampFrame(RAMP);
/** Where the wedge starts and where its far edge ends, along the ramp's own axis. */
const toe = RAMP.x - frame.halfLength,
  back = RAMP.x + frame.halfLength;

interface Track {
  /** Highest the ball ever got above the cloth. */
  peak: number;
  /** Airborne past the far edge of the wedge: a genuine launch, not a slide. */
  flew: boolean;
  /** Reversed on the approach face before ever reaching the crest. */
  rolledBack: boolean;
  /** Furthest it climbed, as a fraction of the crest height. */
  turnedAt: number;
  steps: number;
  samples: { x: number; z: number; elevation: number; vx: number; vz: number }[];
}
/** Play one shot to a full stop, watching the cue ball every step of the way. */
function roll(game: PoolGame, angle: number, power: number, from: { x: number; z: number }): Track {
  arrangeBalls(game, { 0: from }, { hazards: [RAMP] });
  game.shoot({ angle, power });
  const track: Track = { peak: 0, flew: false, rolledBack: false, turnedAt: 0, steps: 0, samples: [] };
  while (game.state.phase === 'rolling' && track.steps < 8000) {
    game.step();
    track.steps++;
    const cue = game.state.balls[0];
    if (cue.pocketed) continue;
    const elevation = cue.elevation || 0;
    if (elevation > track.peak) {
      track.peak = elevation;
      track.turnedAt = elevation / RAMP_HEIGHT;
    }
    track.samples.push({ x: cue.x, z: cue.z, elevation, vx: cue.vx, vz: cue.vz });
    if (cue.x > back + 0.02 && elevation > 0.02) track.flew = true;
    if (!track.flew && cue.x < RAMP.x + frame.crest && cue.vx < -0.2 && elevation > 0) track.rolledBack = true;
  }
  assert.notEqual(game.state.phase, 'rolling', 'the shot must settle rather than roll forever');
  return track;
}

test('the wedge surface is a closed shape: zero at every base edge, the crest height along the ridge', () => {
  assert.equal(rampSupportAt(RAMP, toe, RAMP.z).height, 0);
  assert.equal(rampSupportAt(RAMP, back, RAMP.z).height, 0);
  assert.equal(rampSupportAt(RAMP, RAMP.x, RAMP.z + frame.halfWidth).height, 0);
  assert.equal(rampSupportAt(RAMP, toe - 0.01, RAMP.z).height, 0, 'and nothing at all outside the wedge');
  assert.ok(Math.abs(rampSupportAt(RAMP, RAMP.x + frame.crest, RAMP.z).height - RAMP_HEIGHT) < 1e-9);
  // Halfway up the approach face is halfway up in height, and a resting ball sits a little above it.
  const half = rampSupportAt(RAMP, (toe + RAMP.x + frame.crest) / 2, RAMP.z);
  assert.ok(Math.abs(half.height - RAMP_HEIGHT / 2) < 1e-9);
  assert.ok(half.lift > 1 && half.lift < 1.1);
});

test('a hard shot climbs the ramp, crests it and flies off the far end', () => {
  const game = new PoolGame('ramp-crest');
  try {
    const track = roll(game, 0, 0.55, { x: -3.4, z: 0 });
    assert.ok(track.flew, 'the ball leaves the crest genuinely airborne');
    assert.ok(track.peak > RAMP_HEIGHT * 1.5, `a crest launch rises well above the ramp (peak ${track.peak})`);
    assert.equal(track.rolledBack, false, 'a cresting ball never runs back down the approach face');
    // It climbed the face rather than teleporting up it: every sample on the approach side is at
    // or below the wedge surface plus the ball's own resting offset.
    for (const sample of track.samples) {
      if (sample.x > RAMP.x + frame.crest) break;
      const support = rampSupportAt(RAMP, sample.x, sample.z);
      assert.ok(sample.elevation <= support.height + 0.05, `never above its own ramp at x ${sample.x}`);
    }
  } finally {
    game.dispose();
  }
});

test('a soft shot stalls part-way up the ramp and rolls back the way it came', () => {
  const game = new PoolGame('ramp-stall');
  try {
    const track = roll(game, 0, 0.04, { x: -2.9, z: 0 });
    assert.ok(track.peak > 0.02, `the ball does climb the face (peak ${track.peak})`);
    assert.ok(track.turnedAt < 0.85, `but stalls below the crest (${(track.turnedAt * 100) | 0}% of the way up)`);
    assert.equal(track.flew, false, 'it never reaches the far side');
    assert.ok(track.rolledBack, 'and it runs back down under gravity');
    const last = track.samples.at(-1)!;
    assert.ok(last.x < toe + 0.01, `it comes off the toe it went up (x ${last.x})`);
    assert.equal(last.elevation, 0, 'and finishes on the cloth, not stranded on the slope');
  } finally {
    game.dispose();
  }
});

test('approach speed alone decides how far up the ramp a ball gets', () => {
  const climbs: number[] = [];
  for (const power of [0.035, 0.05, 0.065]) {
    const game = new PoolGame(`ramp-speed-${power}`);
    try {
      climbs.push(roll(game, 0, power, { x: -2.9, z: 0 }).peak);
    } finally {
      game.dispose();
    }
  }
  assert.ok(climbs[0] < climbs[1] && climbs[1] < climbs[2], `faster climbs higher: ${climbs.join(', ')}`);
  assert.ok(climbs[0] < RAMP_HEIGHT && climbs[2] >= RAMP_HEIGHT, `the crest is a threshold: ${climbs.join(', ')}`);
});

test('a ball crossing the ramp at an angle is deflected by the slope, not snapped to the ramp axis', () => {
  const game = new PoolGame('ramp-oblique');
  try {
    const entry = Math.PI / 5,
      start = { x: -2.9, z: -0.75 };
    const track = roll(game, entry, 0.3, start);
    assert.ok(track.peak > 0.01, 'the flank is climbed rather than bounced off');
    const exit = track.samples.find((s) => s.x > back)!;
    assert.ok(exit, 'the ball gets across');
    const heading = Math.atan2(exit.vz, exit.vx);
    assert.ok(Math.abs(heading - entry) > 0.05, `the slope turns the ball (in ${entry}, out ${heading})`);
    assert.ok(Math.abs(heading) > 0.12, 'and never snaps it onto the ramp direction');
  } finally {
    game.dispose();
  }
});

test('a ramp only counts the ball that is actually riding it, and scores it once', () => {
  const game = new PoolGame('ramp-score');
  try {
    arrangeBalls(game, { 0: { x: -3.2, z: 0 } }, { hazards: [RAMP] });
    const rides: number[] = [];
    game.onEvent = (event) => {
      if (event.kind === 'hazard' && event.hazard === 'ramp') {
        const cue = game.state.balls[0];
        rides.push((cue.elevation || 0) - rampSupportAt(RAMP, cue.x, cue.z).height);
      }
    };
    game.shoot({ angle: 0, power: 0.4 });
    for (let step = 0; game.state.phase === 'rolling' && step < 8000; step++) game.step();
    assert.notEqual(game.state.phase, 'rolling');
    assert.ok(rides.length >= 1);
    for (const clearance of rides) assert.ok(clearance < 0.08, `reported only while on the wedge (${clearance})`);
    assert.equal(game.state.arcade!.scores[0], 15, 'however many times it rides, a ramp pays out once');
  } finally {
    game.dispose();
  }
});

test('a ball flying over a ramp is untouched by it', () => {
  const game = new PoolGame('ramp-flyover');
  try {
    arrangeBalls(game, { 0: { x: -3.2, z: 0 } }, { hazards: [RAMP] });
    const hazards: string[] = [];
    game.onEvent = (event) => {
      if (event.kind === 'hazard') hazards.push(event.hazard!);
    };
    // A jump shot: hard and low on the cue ball, which the engine already turns into real lift.
    game.shoot({ angle: 0, power: 1, tipY: -0.78 });
    let cleared = false;
    for (let step = 0; game.state.phase === 'rolling' && step < 8000 && !cleared; step++) {
      game.step();
      const cue = game.state.balls[0];
      const support = rampSupportAt(RAMP, cue.x, cue.z);
      if (support.height > 0 && (cue.elevation || 0) > support.height + 0.2) cleared = true;
    }
    assert.ok(cleared, 'the shot really did pass clear above the wedge');
    assert.deepEqual(hazards, [], 'clearing a ramp in the air is not riding it');
    assert.equal(game.state.arcade!.scores[0], 0);
  } finally {
    game.dispose();
  }
});

test('every approach to the ramp settles, with the ball off the wedge and on the cloth', () => {
  for (const [angle, power, x, z] of [
    [0, 0.04, -2.9, 0],
    [0, 0.5, -3.2, 0],
    [Math.PI / 4, 0.25, -3.2, -0.6],
    [Math.PI / 2, 0.12, -2, -1.1],
    [Math.PI, 0.3, -1.1, 0.2],
  ] as const) {
    const game = new PoolGame(`ramp-rest-${angle}-${power}`);
    try {
      const track = roll(game, angle, power, { x, z });
      assert.ok(track.steps < 3000, `settles promptly (${track.steps} steps at angle ${angle})`);
      const last = track.samples.at(-1)!;
      assert.equal(last.elevation, 0, `a settled ball is on the cloth (angle ${angle})`);
      assert.equal(
        rampSupportAt(RAMP, last.x, last.z).height,
        0,
        `a settled ball is never left standing on the wedge (${last.x}, ${last.z})`,
      );
    } finally {
      game.dispose();
    }
  }
});
