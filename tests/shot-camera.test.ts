import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { initialState, TABLE } from '../src/simulation/types';
import { tableFramingBounds } from '../src/render/camera';
import {
  ShotCameraAim,
  ShotCameraRig,
  shotCameraPose,
  watchCameraPose,
  SHOT_WATCH_TRANSITION,
  SHOT_RETURN_TRANSITION,
} from '../src/render/shot-camera';

function cameraFor(pose: ReturnType<typeof shotCameraPose>, aspect: number) {
  const camera = new THREE.PerspectiveCamera(pose.fov, aspect, pose.near, pose.far);
  camera.position.copy(pose.position);
  camera.lookAt(pose.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

test('default view is low behind the cue with a large, centered foreground ball', () => {
  const state = initialState('shot-camera'),
    cue = state.balls[0],
    pose = shotCameraPose(state, { angle: 0 }, 16 / 9);
  const camera = cameraFor(pose, 16 / 9),
    center = new THREE.Vector3(cue.x, TABLE.radius, cue.z).project(camera);
  assert.equal(pose.mode, 'shoot');
  assert.ok(pose.position.x < cue.x - 1);
  assert.ok(pose.position.y < 1);
  assert.ok(
    Math.abs(Math.hypot(pose.position.x - cue.x, pose.position.z - cue.z) - 1.92) < 1e-10,
    'FPS distance is pulled back by about 35%',
  );
  assert.ok(Math.abs(center.x) < 1e-10);
  assert.ok(Math.abs(center.y + 0.47) < 1e-10);
  const top = new THREE.Vector3(cue.x, TABLE.radius * 2, cue.z).project(camera);
  const bottom = new THREE.Vector3(cue.x, 0, cue.z).project(camera);
  assert.ok(
    top.y - bottom.y > 0.32 && top.y - bottom.y < 0.45,
    'the pulled-back ball remains prominent without filling the foreground',
  );
  const target = new THREE.Vector3(cue.x + 2, TABLE.radius, cue.z).project(camera);
  assert.ok(target.y > center.y, 'object balls extend up the table in front of the cue');
});

test('cue spheres remain inside the viewport and in front of the near plane at every rail and portrait aspect', () => {
  for (const aspect of [0.35, 0.58, 0.81, 16 / 9, 2.4])
    for (const [x, z] of [
      [-2.85, 0],
      [5.48, 0],
      [-5.48, 2.63],
      [0, -2.63],
      [5.3, 2.5],
    ])
      for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7]) {
        const state = initialState('rail-camera');
        Object.assign(state.balls[0], { x, z });
        const pose = shotCameraPose(state, { angle, elevation: 0.3 }, aspect),
          camera = cameraFor(pose, aspect);
        for (let latitude = -Math.PI / 2; latitude <= Math.PI / 2; latitude += Math.PI / 8)
          for (let longitude = 0; longitude < Math.PI * 2; longitude += Math.PI / 8) {
            const point = new THREE.Vector3(
              x + Math.cos(latitude) * Math.cos(longitude) * TABLE.radius,
              TABLE.radius + Math.sin(latitude) * TABLE.radius,
              z + Math.cos(latitude) * Math.sin(longitude) * TABLE.radius,
            ).project(camera);
            assert.ok(
              Math.abs(point.x) < 1 && Math.abs(point.y) < 1,
              `cue clipping at aspect ${aspect}, cue ${x}/${z}, angle ${angle}`,
            );
            assert.ok(point.z > -1 && point.z < 1, 'the cue sphere must stay inside the camera depth range');
          }
        assert.ok(pose.position.y > TABLE.radius + 0.4, 'camera stays above the rails and cloth');
      }
});

test('the rolling and placement views fit the table and ignore sudden cue-ball portal motion', () => {
  for (const phase of ['rolling', 'ball-in-hand', 'over'] as const)
    for (const aspect of [0.45, 0.8, 16 / 9]) {
      const state = initialState('watch-camera');
      state.phase = phase;
      state.lastShot = { angle: 0.4, power: 1 };
      const pose = shotCameraPose(state, { angle: 2.1 }, aspect),
        camera = cameraFor(pose, aspect);
      assert.equal(pose.mode, 'watch');
      for (const point of tableFramingBounds()) {
        const projected = point.project(camera);
        assert.ok(Math.abs(projected.x) < 0.93 && projected.y < 0.81 && projected.y > -0.87);
      }
      state.balls[0].x = 4.7;
      state.balls[0].z = -2;
      state.balls[0].elevation = 2;
      state.balls[0].teleport = 1;
      assert.deepEqual(
        shotCameraPose(state, { angle: 2.1 }, aspect),
        pose,
        'watch framing must not chase a teleported or jumping cue',
      );
    }
});

test('phase transitions pull back smoothly and reset returns immediately to the low shooter view', () => {
  const state = initialState('camera-transition'),
    camera = new THREE.PerspectiveCamera(),
    rig = new ShotCameraRig();
  rig.update(camera, state, { angle: 0 }, 16 / 9, 1 / 60);
  const close = camera.position.clone();
  state.phase = 'rolling';
  state.lastShot = { angle: 0, power: 1 };
  rig.update(camera, state, { angle: 0 }, 16 / 9, 1 / 60);
  const first = camera.position.clone();
  assert.ok(first.distanceTo(close) < 0.2, 'the first rolling frame must not hard-cut across the room');
  for (let i = 0; i < 80; i++) rig.update(camera, state, { angle: 0 }, 16 / 9, 1 / 60);
  assert.ok(camera.position.y > 8);
  state.phase = 'ready';
  rig.reset();
  rig.update(camera, state, { angle: Math.PI / 2 }, 16 / 9, 1 / 60);
  const target = shotCameraPose(state, { angle: Math.PI / 2 }, 16 / 9);
  assert.ok(camera.position.distanceTo(target.position) < 1e-10);
  assert.ok(camera.position.y < 1);
});

test('watch transition finishes within 0.58 seconds and reversals never jump on their first frame', () => {
  const state = initialState('timed-camera'),
    camera = new THREE.PerspectiveCamera(),
    rig = new ShotCameraRig();
  const anchor = rig.update(camera, state, { angle: 0 }, 16 / 9, 1 / 60).clone();
  anchor.y = -0.12;
  state.phase = 'rolling';
  state.lastShot = { angle: 0, power: 0.4 };
  for (let i = 0; i < 30; i++) rig.update(camera, state, { angle: 0 }, 16 / 9, 1 / 60);
  const final = watchCameraPose(0, 16 / 9, anchor);
  assert.equal(rig.isSettled, false, 'easing still settles gently at the end');
  for (let i = 0; i < 5; i++) rig.update(camera, state, { angle: 0 }, 16 / 9, 1 / 60);
  assert.ok(camera.position.distanceTo(final.position) < 1e-8);
  assert.equal(rig.isSettled, true);
  assert.equal(SHOT_WATCH_TRANSITION, 0.58);
  assert.equal(SHOT_RETURN_TRANSITION, 0.65);
  const previousPosition = camera.position.clone(),
    previousRotation = camera.quaternion.clone();
  state.phase = 'ready';
  state.balls[0].x = 5.48;
  state.balls[0].z = 2.5;
  state.balls[0].teleport = 1;
  rig.update(camera, state, { angle: Math.PI }, 16 / 9, 1 / 60);
  assert.ok(camera.position.distanceTo(previousPosition) < 0.01);
  assert.ok(camera.quaternion.angleTo(previousRotation) < 0.001);
  state.phase = 'rolling';
  const reversed = camera.position.clone();
  rig.update(camera, state, { angle: 0 }, 16 / 9, 1 / 60);
  assert.ok(
    camera.position.distanceTo(reversed) < 0.01,
    'interrupting a return uses the current pose, not an obsolete endpoint',
  );
});

test('post-shot pullback preserves heading, level horizon and a straight horizontal path from every cue position', () => {
  for (const aspect of [0.58, 16 / 9])
    for (const angle of [-2.2, -0.7, 0, 0.8, 2.6])
      for (const [x, z] of [
        [-2.85, 0],
        [4.8, 2.3],
        [-4.8, -2.3],
      ]) {
        const state = initialState('no-camera-twist');
        Object.assign(state.balls[0], { x, z });
        const camera = new THREE.PerspectiveCamera(),
          rig = new ShotCameraRig();
        rig.update(camera, state, { angle }, aspect, 1 / 120);
        const initial = camera.position.clone(),
          side = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
        state.phase = 'rolling';
        state.lastShot = { angle, power: 0.7 };
        for (let i = 0; i < 72; i++) {
          rig.update(camera, state, { angle: angle + 1.8 }, aspect, 1 / 120);
          const direction = camera.getWorldDirection(new THREE.Vector3()),
            heading = Math.atan2(direction.z, direction.x);
          assert.ok(
            Math.abs(Math.atan2(Math.sin(heading - angle), Math.cos(heading - angle))) < 1e-8,
            'no automatic yaw/orbit toward the table center',
          );
          assert.ok(
            Math.abs(camera.position.clone().sub(initial).dot(side)) < 1e-8,
            'pullback does not slide sideways',
          );
          assert.ok(
            Math.abs(new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).y) < 1e-8,
            'the horizon never rolls',
          );
        }
        assert.equal(rig.isSettled, true);
        for (const point of tableFramingBounds()) {
          const projected = point.project(camera);
          assert.ok(Math.abs(projected.x) < 0.93 && projected.y < 0.81 && projected.y > -0.87);
        }
      }
});

test('AI setup and repeated AI shots retain the spectator heading even when aim reverses or the cue teleports', () => {
  const state = initialState('stable-ai-view'),
    camera = new THREE.PerspectiveCamera(),
    rig = new ShotCameraRig();
  rig.update(camera, state, { angle: 0.7 }, 16 / 9, 1 / 120);
  state.phase = 'rolling';
  state.lastShot = { angle: 0.7, power: 0.6 };
  for (let i = 0; i < 75; i++) rig.update(camera, state, { angle: 0.7 }, 16 / 9, 1 / 120);
  const position = camera.position.clone(),
    rotation = camera.quaternion.clone();
  for (const angle of [-2.8, 2.4, -0.2]) {
    state.phase = 'ready';
    state.balls[0].x += 1;
    state.balls[0].teleport = (state.balls[0].teleport ?? 0) + 1;
    for (let i = 0; i < 45; i++) rig.update(camera, state, { angle }, 16 / 9, 1 / 120, true);
    state.phase = 'rolling';
    state.lastShot = { angle, power: 0.6 };
    for (let i = 0; i < 45; i++) rig.update(camera, state, { angle }, 16 / 9, 1 / 120, true);
    assert.ok(camera.position.distanceTo(position) < 1e-9);
    assert.ok(camera.quaternion.angleTo(rotation) < 1e-7);
    assert.equal(rig.isSettled, true);
  }
  // Temporary user orbit changes the physical camera but must retain the saved
  // spectator anchor when that hold is released.
  camera.position.set(10, 12, 8);
  camera.lookAt(0, 0, 0);
  rig.reset(true);
  rig.update(camera, state, { angle: -2.8 }, 16 / 9, 0, true);
  assert.ok(camera.position.distanceTo(position) < 1e-9);
  assert.ok(camera.quaternion.angleTo(rotation) < 1e-7);
  state.phase = 'ready';
  for (let i = 0; i < 84; i++) {
    rig.update(camera, state, { angle: 0.7 }, 16 / 9, 1 / 120, false);
    const forward = camera.getWorldDirection(new THREE.Vector3());
    assert.ok(
      Math.abs(Math.atan2(forward.z, forward.x) - 0.7) < 1e-8,
      'returning to the human retains their aim, never the AI preview yaw',
    );
  }
  assert.equal(rig.isSettled, true);
  state.phase = 'ready';
  rig.reset();
  rig.update(camera, state, { angle: -2.8 }, 16 / 9, 0, false);
  const fps = shotCameraPose(state, { angle: -2.8 }, 16 / 9);
  assert.ok(camera.position.distanceTo(fps.position) < 1e-9, 'explicit F can still enter the AI shooter view');
});

test('rail-clearance changes are damped while the final cue anchor remains exact', () => {
  const state = initialState('rail-smoothing');
  state.balls[0].x = 5.48;
  const camera = new THREE.PerspectiveCamera(),
    rig = new ShotCameraRig();
  rig.update(camera, state, { angle: 0 }, 16 / 9, 1 / 60);
  const before = camera.position.clone();
  const target = shotCameraPose(state, { angle: Math.PI }, 16 / 9);
  rig.update(camera, state, { angle: Math.PI }, 16 / 9, 1 / 60);
  assert.ok(
    camera.position.distanceTo(before) < target.position.distanceTo(before) * 0.3,
    'one aim event cannot snap the eye across the rail',
  );
  for (let i = 0; i < 100; i++) rig.update(camera, state, { angle: Math.PI }, 16 / 9, 1 / 60);
  const cue = new THREE.Vector3(state.balls[0].x, TABLE.radius, state.balls[0].z).project(camera);
  assert.ok(Math.abs(cue.y + 0.47) < 1e-8);
});

test('mouse yaw uses movement only, supports full turns and preserves keyboard adjustments without a feedback loop', () => {
  const input = new ShotCameraAim();
  let angle = 0.2;
  assert.equal(input.angleAt(500, 1000, angle), angle, 'entering the canvas starts a stable movement anchor');
  angle = input.angleAt(600, 1000, angle);
  assert.ok(angle > 0.2);
  const moved = angle;
  for (let i = 0; i < 120; i++) angle = input.angleAt(600, 1000, angle);
  assert.equal(angle, moved, 'a fixed cursor must never keep rotating when the camera catches up');
  angle += 0.1;
  assert.equal(input.angleAt(600, 1000, angle), angle, 'keyboard aim changes must remain intact');
  const full = input.angleAt(1600, 1000, angle);
  assert.ok(Math.abs(Math.atan2(Math.sin(full - angle), Math.cos(full - angle))) < 1e-10);
  input.reset();
  assert.equal(input.angleAt(20, 1000, angle), angle, 're-entering after a menu or camera change cannot jump aim');
  assert.equal(input.angleAt(NaN, 1000, angle), angle);
  assert.equal(input.angleAt(400, 0, angle), angle);
});

test('projected low-view targets and cue pullback retain a useful screen direction as aim circles the table', () => {
  for (const aspect of [0.58, 16 / 9])
    for (const angle of [-3, -1, 0, 1.2, 3]) {
      const state = initialState('aim-projection'),
        cue = state.balls[0];
      const pose = shotCameraPose(state, { angle }, aspect),
        camera = cameraFor(pose, aspect);
      const origin = new THREE.Vector3(cue.x, TABLE.radius, cue.z).project(camera);
      const forward = new THREE.Vector3(cue.x + Math.cos(angle), TABLE.radius, cue.z + Math.sin(angle)).project(camera);
      const right = new THREE.Vector3(
        cue.x - Math.sin(angle) * 0.4,
        TABLE.radius,
        cue.z + Math.cos(angle) * 0.4,
      ).project(camera);
      assert.ok(forward.y - origin.y > 0.1, 'pulling down the screen remains a usable cue-power gesture');
      assert.ok(right.x > origin.x, 'positive yaw follows the camera’s screen-right direction');
    }
});
