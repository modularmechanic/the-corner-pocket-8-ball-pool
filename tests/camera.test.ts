import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  advanceOrbit,
  applyOverheadFit,
  clampOrbit,
  fitTableCamera,
  fitOverheadCamera,
  fitOverheadView,
  CameraTransition,
  TemporaryCameraView,
  rayFromViewport,
  orbitDirection,
  orbitFromDirection,
  tableFramingBounds,
} from '../src/render/camera';

test('orbit pixel deltas stay finite and bounded through repeated full rotations', () => {
  let angles = orbitFromDirection(new THREE.Vector3(0.035, 0.62, 0.784));
  for (let i = 0; i < 10000; i++) {
    angles = advanceOrbit(angles, i % 2 ? 31 : -23, i % 7 ? 12 : -70);
    assert.ok(Number.isFinite(angles.yaw) && Number.isFinite(angles.pitch));
    assert.ok(angles.yaw >= -Math.PI && angles.yaw < Math.PI);
    assert.ok(angles.pitch >= (22 * Math.PI) / 180 - 1e-9 && angles.pitch <= (78 * Math.PI) / 180 + 1e-9);
  }
  assert.deepEqual(advanceOrbit(angles, Infinity, 0), angles);
  assert.deepEqual(advanceOrbit(angles, 0, NaN), angles);
});

test('full table and legs fit portrait and landscape at every orbit quadrant', () => {
  for (const aspect of [375 / 646, 820 / 1013, 16 / 9, 1440 / 900])
    for (const yaw of [0, Math.PI / 2, -Math.PI / 2, Math.PI])
      for (const pitch of [0.15, 0.7, 1.5]) {
        const camera = new THREE.PerspectiveCamera(39, aspect, 0.1, 100);
        const distance = fitTableCamera(
          camera,
          new THREE.Vector3(0, -0.35, 0),
          orbitDirection(clampOrbit({ yaw, pitch })),
          aspect,
        );
        assert.ok(Number.isFinite(distance) && distance > 0);
        for (const point of tableFramingBounds()) {
          const ndc = point.project(camera);
          assert.ok(Math.abs(ndc.x) < 0.92001, `horizontal clipping at aspect ${aspect}, yaw ${yaw}`);
          assert.ok(ndc.y < 0.80001 && ndc.y > -0.86001, `vertical clipping at aspect ${aspect}, yaw ${yaw}`);
        }
      }
});

test('screen rays recover table aiming coordinates after orbit and resize', () => {
  const raycaster = new THREE.Raycaster(),
    plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.18);
  for (const aspect of [0.58, 1.78])
    for (const yaw of [-2.4, -0.6, 0, 1.8]) {
      const camera = new THREE.PerspectiveCamera(39, aspect, 0.1, 100);
      fitTableCamera(
        camera,
        new THREE.Vector3(0, -0.15, -1.5),
        orbitDirection(clampOrbit({ yaw, pitch: 0.62 })),
        aspect,
      );
      for (const [x, z] of [
        [-5, -2],
        [0, 0],
        [4.9, 2.1],
      ]) {
        const point = new THREE.Vector3(x, 0.18, z),
          projected = point.clone().project(camera);
        raycaster.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera);
        const recovered = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
        assert.ok(recovered && recovered.distanceTo(point) < 1e-8);
      }
    }
});

test('actual airborne height remains visibly above the ground in orbit views', () => {
  for (const yaw of [0, 1.5, Math.PI]) {
    const camera = new THREE.PerspectiveCamera(39, 1.6, 0.1, 100);
    fitTableCamera(camera, new THREE.Vector3(0, -0.35, 0), orbitDirection(clampOrbit({ yaw, pitch: 0.65 })), 1.6);
    const ground = new THREE.Vector3(0, 0.18, 0).project(camera),
      air = new THREE.Vector3(0, 2.18, 0).project(camera);
    assert.ok(air.y > ground.y + 0.1);
  }
});

test('overhead view centers the table exactly and fits landscape and portrait without unused room bias', () => {
  for (const aspect of [0.4, 0.58, 0.82, 1, 16 / 9, 2.4]) {
    const camera = new THREE.OrthographicCamera(-8, 8, 4, -4, 0.1, 100);
    fitOverheadCamera(camera, aspect);
    const center = new THREE.Vector3(0, 0, 0).project(camera);
    assert.ok(Math.abs(center.x) < 1e-12 && Math.abs(center.y) < 1e-12);
    let maximum = 0;
    for (const x of [-6.55, 6.55])
      for (const z of [-3.68, 3.68]) {
        const corner = new THREE.Vector3(x, 0, z).project(camera);
        assert.ok(Math.abs(corner.x) < 0.91 && Math.abs(corner.y) < 0.87);
        maximum = Math.max(maximum, Math.abs(corner.x), Math.abs(corner.y));
      }
    assert.ok(maximum > 0.8, 'the table should use the viewport instead of drifting into a distant corner');
  }
});

test('returning from perspective orbit to overhead blends projection and keeps picking correct', () => {
  const perspective = new THREE.PerspectiveCamera(39, 16 / 9, 0.035, 120);
  fitTableCamera(perspective, new THREE.Vector3(0, -0.35, 0), orbitDirection({ yaw: 0.7, pitch: 0.7 }), 16 / 9);
  const overhead = new THREE.OrthographicCamera(-8, 8, 4, -4, 0.1, 100);
  fitOverheadCamera(overhead, 16 / 9);
  const blend = new CameraTransition(),
    plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.18);
  blend.begin(perspective);
  assert.ok(blend.active);
  assert.deepEqual(blend.camera.projectionMatrix, perspective.projectionMatrix);
  assert.ok(blend.camera.position.distanceTo(perspective.position) < 1e-12);
  for (let i = 0; i < 75; i++) {
    blend.update(overhead, 1 / 60);
    for (const point of [
      new THREE.Vector3(-4, 0.18, -1),
      new THREE.Vector3(0, 0.18, 0),
      new THREE.Vector3(4, 0.18, 1),
    ]) {
      const projected = point.clone().project(blend.camera),
        ray = rayFromViewport(blend.camera, projected.x, projected.y);
      const recovered = ray.intersectPlane(plane, new THREE.Vector3());
      assert.ok(recovered && recovered.distanceTo(point) < 1e-7, 'projection-aware picking must survive lens blending');
    }
  }
  blend.update(overhead, 1 / 60);
  assert.equal(blend.active, false);
  assert.ok(blend.camera.position.distanceTo(overhead.position) < 1e-12);
  assert.ok(blend.camera.quaternion.angleTo(overhead.quaternion) < 1e-7);
  assert.deepEqual(blend.camera.projectionMatrix, overhead.projectionMatrix);
});

test("touch overhead fit frames the whole table inside the controls' free area on phones and tablets, never the whole canvas", () => {
  // Canvas-sized viewports (visible area with browser bars) and the pixels the scoreboard, tools, dial, Engage, Shoot, mode tabs and slider cover.
  const cases = [
    {
      name: 'small phone portrait 360x584',
      width: 360,
      height: 584,
      insets: { top: 121, right: 94, bottom: 300, left: 8 },
      rotated: false,
    },
    {
      name: 'phone portrait 390x664',
      width: 390,
      height: 664,
      insets: { top: 121, right: 94, bottom: 300, left: 8 },
      rotated: false,
    },
    {
      name: 'tall phone portrait 390x844',
      width: 390,
      height: 844,
      insets: { top: 121, right: 98, bottom: 316, left: 8 },
      rotated: true,
    },
    {
      name: 'phone landscape 844x340',
      width: 844,
      height: 340,
      insets: { top: 64, right: 178, bottom: 8, left: 190 },
      rotated: false,
    },
    {
      name: 'tablet portrait 768x1024',
      width: 768,
      height: 1024,
      insets: { top: 153, right: 112, bottom: 296, left: 8 },
      rotated: false,
    },
    {
      name: 'tablet landscape 1024x768',
      width: 1024,
      height: 768,
      insets: { top: 188, right: 180, bottom: 8, left: 244 },
      rotated: false,
    },
    // A measurement that leaves no room (a collapsed HUD): controls get 85% of the height, the table the rest.
    {
      name: 'crowded 390x844',
      width: 390,
      height: 844,
      insets: { top: 500, right: 0, bottom: 400, left: 0 },
      rotated: false,
    },
  ];
  for (const { name, width, height, insets, rotated } of cases) {
    const fit = fitOverheadView(width, height, insets),
      camera = new THREE.OrthographicCamera(-8, 8, 4, -4, 0.1, 100);
    applyOverheadFit(camera, fit);
    assert.equal(fit.rotated, rotated, `${name}: the long table axis follows the screen axis that frames it larger`);
    const pixel = (x: number, z: number) => {
      const p = new THREE.Vector3(x, 0, z).project(camera);
      return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
    };
    const vertical = Math.min(1, (height * 0.85) / (insets.top + insets.bottom)),
      horizontal = Math.min(1, (width * 0.85) / (insets.left + insets.right || 1));
    const free = {
      left: insets.left * horizontal,
      right: width - insets.right * horizontal,
      top: insets.top * vertical,
      bottom: height - insets.bottom * vertical,
    };
    assert.notDeepEqual(
      fit,
      fitOverheadView(width, height, { top: 0, right: 0, bottom: 0, left: 0 }),
      `${name}: never the whole canvas`,
    );
    const center = pixel(0, 0);
    assert.ok(
      Math.abs(center.x - (free.left + free.right) / 2) < 1e-6 &&
        Math.abs(center.y - (free.top + free.bottom) / 2) < 1e-6,
      `${name}: table centered in the free area`,
    );
    const corners = [-6.6, 6.6].flatMap((x) => [-3.72, 3.72].map((z) => pixel(x, z)));
    for (const corner of corners)
      assert.ok(
        corner.x >= free.left - 1e-6 &&
          corner.x <= free.right + 1e-6 &&
          corner.y >= free.top - 1e-6 &&
          corner.y <= free.bottom + 1e-6,
        `${name}: corner ${JSON.stringify(corner)} is clear of the controls`,
      );
    const spanX = Math.max(...corners.map((c) => c.x)) - Math.min(...corners.map((c) => c.x)),
      spanY = Math.max(...corners.map((c) => c.y)) - Math.min(...corners.map((c) => c.y));
    assert.equal(spanY > spanX, rotated, `${name}: rotated puts the long axis up the screen`);
    assert.ok(
      Math.max(spanX / (free.right - free.left), spanY / (free.bottom - free.top)) > 0.93,
      `${name}: the table fills its limiting free dimension`,
    );
    // A viewport ray still picks the table point under a finger in the offset, rotated frustum.
    const point = new THREE.Vector3(2.4, 0.18, -1.1),
      ndc = point.clone().project(camera);
    assert.ok(
      rayFromViewport(camera, ndc.x, ndc.y)
        .intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.18), new THREE.Vector3())!
        .distanceTo(point) < 1e-7,
    );
  }
  assert.deepEqual(
    fitOverheadView(0, NaN, { top: NaN, right: -5, bottom: 0, left: 0 }),
    fitOverheadView(16, 9, { top: 0, right: 0, bottom: 0, left: 0 }),
  );
});

test('desktop 1440x900 overhead framing is unchanged; the touch fit only applies when insets are given', () => {
  const camera = new THREE.OrthographicCamera(-8, 8, 4, -4, 0.1, 100);
  fitOverheadCamera(camera, 1440 / 900);
  const halfHeight = 6.6 / (1.6 * 0.9);
  assert.ok(
    Math.abs(camera.top - halfHeight) < 1e-12 &&
      Math.abs(camera.bottom + halfHeight) < 1e-12 &&
      Math.abs(camera.right - halfHeight * 1.6) < 1e-12 &&
      Math.abs(camera.left + halfHeight * 1.6) < 1e-12,
  );
  assert.deepEqual(camera.up.toArray(), [0, 0, -1]);
  const touch = fitOverheadView(1440, 900, { top: 0, right: 0, bottom: 0, left: 0 });
  assert.equal(touch.rotated, false, 'a landscape screen keeps the long axis across');
  assert.ok(Math.abs(touch.left + touch.right) < 1e-12 && Math.abs(touch.top + touch.bottom) < 1e-12);
});

test('temporary mouse or keyboard orbit preserves the chosen camera and inspection pose until release', () => {
  for (const [overhead, inspection] of [
    [false, false],
    [true, false],
    [false, true],
  ]) {
    const hold = new TemporaryCameraView(),
      target = new THREE.Vector3(0, -0.35, 0),
      inspectionPose = { position: new THREE.Vector3(1, 2, 3), target: new THREE.Vector3(4, 5, 6) };
    hold.begin({ overhead, inspection, inspectionPose, target, orbit: null });
    assert.ok(hold.active);
    target.set(9, 9, 9);
    inspectionPose.position.set(7, 7, 7);
    hold.begin({ overhead: false, inspection: false, target: new THREE.Vector3(), orbit: { yaw: 1, pitch: 1 } });
    const prior = hold.release()!;
    assert.equal(prior.overhead, overhead);
    assert.equal(prior.inspection, inspection);
    assert.equal(prior.orbit, null);
    assert.deepEqual(prior.target, new THREE.Vector3(0, -0.35, 0));
    assert.deepEqual(prior.inspectionPose!.position, new THREE.Vector3(1, 2, 3));
    assert.equal(hold.active, false);
    assert.equal(hold.release(), null, 'release is safe after cancellation or a duplicate keyup');
  }
});
