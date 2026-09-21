import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEADEYE_BEATS,
  deadeyeArmed,
  deadeyeCinematic,
  deadeyePoseAt,
  deadeyeTimeScale,
  type DeadeyeBeat,
} from '../src/render/deadeye-cinematic';
import { EIGHT_BALL_TABLE, SNOOKER_TABLE } from '../src/simulation/modes/table';
import { PUB_LAYOUT } from '../src/render/pub-layout';

const BEATS: DeadeyeBeat[] = ['strike', 'travel', 'pot'];
const { bounds, floor } = PUB_LAYOUT;

/** Every ball lie and heading the sequence can be composed on, on both slates. */
function* subjects(spec = EIGHT_BALL_TABLE) {
  for (const x of [-spec.halfWidth + 0.2, -2.4, 0, 2.4, spec.halfWidth - 0.2])
    for (const z of [-spec.halfDepth + 0.2, 0, spec.halfDepth - 0.2])
      for (let step = 0; step < 16; step++) {
        const angle = (step * Math.PI * 2) / 16;
        for (const pocket of [undefined, ...spec.pockets]) yield { x, z, angle, pocket };
      }
}

// The bug this guards is the one the project has already been bitten by: a camera that leaves the room
// shows the outside of the box and the void behind it. Everything here is composed over the slate, which
// is well inside the walls and has nothing above it but the balls.
test('no beat ever puts the eye outside the room or under the cloth', () => {
  for (const spec of [EIGHT_BALL_TABLE, SNOOKER_TABLE])
    for (const subject of subjects(spec))
      for (const beat of BEATS)
        for (let i = 0; i <= 10; i++) {
          const pose = deadeyePoseAt(beat, i / 10, subject, spec);
          const p = pose.position;
          assert.ok(
            p.x > bounds.left && p.x < bounds.right && p.z > bounds.back && p.z < bounds.front && p.y > floor,
            `${beat} at ${(i / 10).toFixed(1)} escaped to (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`,
          );
          // The cabinet tops out at 0.24: over the cloth the eye may sit on the slate, off it must clear the rail.
          const overRail = Math.abs(p.x) > spec.halfWidth - 0.22 || Math.abs(p.z) > spec.halfDepth - 0.22;
          assert.ok(
            Math.abs(p.x) <= spec.halfWidth + 1.6 &&
              Math.abs(p.z) <= spec.halfDepth + 1.6 &&
              p.y >= (overRail ? 0.41 : 0.25),
            `${beat} at ${(i / 10).toFixed(1)} fouled the cabinet at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`,
          );
          assert.ok(pose.fov > 20 && pose.fov < 70, `${beat} asked for a ${pose.fov} degree lens`);
          assert.ok(
            pose.position.distanceTo(pose.target) > 0.2,
            `${beat} at ${(i / 10).toFixed(1)} collapsed onto its own aim point`,
          );
        }
});

// Every move has to ease, and no move may jump: a cut or a snap is what makes a cinematic feel cheap.
test('every beat eases, and no frame of it jumps', () => {
  for (const subject of subjects())
    for (const beat of BEATS) {
      let previous = deadeyePoseAt(beat, 0, subject);
      for (let i = 1; i <= 60; i++) {
        const pose = deadeyePoseAt(beat, i / 60, subject);
        const step = pose.position.distanceTo(previous.position);
        assert.ok(step < 0.28, `${beat} jumped ${step.toFixed(3)} units in one sixtieth of the beat`);
        assert.ok(Math.abs(pose.fov - previous.fov) < 1.2, `${beat} snapped the lens by ${pose.fov - previous.fov}`);
        previous = pose;
      }
      // Smootherstep: a beat starts and ends at rest.
      const start = deadeyePoseAt(beat, 0, subject).position.distanceTo(deadeyePoseAt(beat, 0.02, subject).position);
      const middle = deadeyePoseAt(beat, 0.49, subject).position.distanceTo(
        deadeyePoseAt(beat, 0.51, subject).position,
      );
      assert.ok(start <= middle + 1e-9, `${beat} does not ease in`);
    }
});

test('the slow motion breathes and always hands full speed back', () => {
  assert.equal(deadeyeTimeScale('strike', 0), 1);
  // It must never crawl to a stop, and it must never run faster than the world.
  for (const beat of BEATS)
    for (let i = 0; i <= 20; i++) {
      const scale = deadeyeTimeScale(beat, i / 20);
      assert.ok(scale >= 0.1 && scale <= 1, `${beat} asked for a ${scale} time scale`);
    }
  // The travel beat builds rather than dragging.
  assert.ok(deadeyeTimeScale('travel', 1) > deadeyeTimeScale('travel', 0));
  // The pot slams back down, then releases completely before the camera is handed over.
  assert.ok(deadeyeTimeScale('pot', 0.3) < deadeyeTimeScale('travel', 1));
  assert.equal(deadeyeTimeScale('pot', 1), 1);
  // Nothing playing means nothing slowed.
  assert.equal(deadeyeCinematic.timeScale, 1);
});

// The hard rule: an ordinary shot must never reach this camera.
test('only a shot struck by a player holding deadeye can arm it', () => {
  const balls = [{ id: 0, x: 0, z: 0, vx: 4, vz: 0, pocketed: false }];
  const rolling = (focus: boolean) => ({
    phase: 'rolling' as const,
    balls,
    shotCount: 3,
    seed: 'seed',
    arcade: { activeShot: { focus } } as never,
  });
  assert.equal(deadeyeArmed(rolling(false)), false);
  assert.equal(deadeyeArmed(undefined), false);
  assert.equal(deadeyeArmed({ phase: 'rolling', balls, shotCount: 3, seed: 'seed' }), false);
  assert.equal(deadeyeArmed(rolling(true)), true);

  assert.equal(deadeyeCinematic.start(rolling(false)), false);
  assert.equal(deadeyeCinematic.running, false);
  // A shot with no arcade state at all — every other mode — is refused the same way.
  assert.equal(deadeyeCinematic.start({ phase: 'rolling', balls, shotCount: 3, seed: 'seed' }), false);
  assert.equal(deadeyeCinematic.running, false);

  assert.equal(deadeyeCinematic.start(rolling(true)), true);
  assert.equal(deadeyeCinematic.running, true);
  assert.ok(deadeyeCinematic.timeScale < 1 || deadeyeCinematic.currentBeat === 'strike');
  // Any input cuts to the end, and the end is full speed with no pose left to apply.
  deadeyeCinematic.skip();
  assert.equal(deadeyeCinematic.running, false);
  assert.equal(deadeyeCinematic.timeScale, 1);
  assert.equal(deadeyeCinematic.sample(0.016), null);
});

test('a shot that never pots hands the camera back instead of hanging on', () => {
  const balls = [{ id: 0, x: 0, z: 0, vx: 4, vz: 0, pocketed: false }];
  assert.equal(
    deadeyeCinematic.start({
      phase: 'rolling',
      balls,
      shotCount: 1,
      seed: 'seed',
      arcade: { activeShot: { focus: true } } as never,
    }),
    true,
  );
  const limit = DEADEYE_BEATS.strike + DEADEYE_BEATS.travel + 2;
  let elapsed = 0;
  while (deadeyeCinematic.sample(1 / 60) && elapsed < limit) elapsed += 1 / 60;
  assert.ok(elapsed < limit, 'the sequence never released the camera');
  assert.equal(deadeyeCinematic.running, false);
  assert.equal(deadeyeCinematic.timeScale, 1);
});
