import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PracticalLightBudget, practicalLightLimits } from '../src/render/light-budget';

/** Camera-driven light pooling is off: the room's practicals visibly popped in and out as the camera
 * turned, and the room is authored to have all of them lit. These cover what ships — every authored
 * practical rendering directly, and the pool contributing nothing — plus the pure tier table, which
 * still decides shader light counts if the pooling is ever switched back on. */
function fixture() {
  const scene = new THREE.Scene(),
    points: THREE.PointLight[] = [],
    areas: THREE.RectAreaLight[] = [];
  for (let i = 0; i < 14; i++) {
    const light = new THREE.PointLight(i < 7 ? '#ffb16b' : '#a5d4ff', 8 + i, 8, 2);
    light.position.set(i < 7 ? -4 : 4, 2, (i % 7) - 3);
    scene.add(light);
    points.push(light);
  }
  for (let i = 0; i < 4; i++) {
    const light = new THREE.RectAreaLight(0xffffff, 2, 4, 2);
    light.position.set(i - 2, 3, -2);
    light.lookAt(0, 0, 0);
    scene.add(light);
    areas.push(light);
  }
  for (let i = 0; i < 3; i++) {
    const light = new THREE.SpotLight(0xffffff, 30);
    light.position.set(i - 1, 4, 0);
    scene.add(light);
  }
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.05, 100);
  camera.position.set(-3, 2, 6);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const budget = new PracticalLightBudget(scene);
  return { scene, points, areas, camera, budget };
}

/** Lights that would reach a shader: visible, anywhere in the scene. */
function count(scene: THREE.Scene) {
  const result = { point: 0, area: 0, spot: 0 };
  scene.traverseVisible((object) => {
    if (object instanceof THREE.PointLight) result.point++;
    if (object instanceof THREE.RectAreaLight) result.area++;
    if (object instanceof THREE.SpotLight) result.spot++;
  });
  return result;
}

/** Lights emitted by the budget's own proxy group, as opposed to the room's authored ones. */
function proxied(scene: THREE.Scene) {
  const result = { point: 0, area: 0 };
  const group = scene.getObjectByName('adaptive-practical-lights');
  if (!group) return result;
  group.traverseVisible((object) => {
    if (object instanceof THREE.PointLight && object.intensity > 0) result.point++;
    if (object instanceof THREE.RectAreaLight && object.intensity > 0) result.area++;
  });
  return result;
}

test('every authored practical stays lit at its own intensity, on every tier, with no proxy duplicates', () => {
  const { scene, budget, camera, points, areas } = fixture();
  const intensities = points.map((light) => light.intensity);
  for (const tier of ['refined', 'balanced', 'fast', 'light', 'minimum', 'refined'] as const) {
    budget.configure('auto', tier, 'refined');
    for (let i = 0; i < 60; i++) budget.update(camera, 1 / 120);
    assert.deepEqual(count(scene), { point: 14, area: 4, spot: 3 }, `${tier} leaves the room's own lights alone`);
    assert.deepEqual(proxied(scene), { point: 0, area: 0 }, `${tier} adds no second copy of any light`);
    assert.ok(
      points.every((light) => light.visible) && areas.every((light) => light.visible),
      `${tier} keeps every practical switched on`,
    );
    assert.deepEqual(
      points.map((light) => light.intensity),
      intensities,
      `${tier} never dims an authored light`,
    );
  }
  budget.dispose();
});

test('the reported light census is the room, not a fixed pool size', () => {
  const { scene, budget, points } = fixture();
  assert.deepEqual(budget.getCounts(), { pointLights: 14, areaLights: 4 });
  points[0].visible = false;
  points[1].intensity = 0;
  assert.deepEqual(budget.getCounts(), { pointLights: 12, areaLights: 4 }, 'an unlit practical is not counted');
  void scene;
  budget.dispose();
});

test('orbiting the camera never moves, dims or reassigns a light', () => {
  const { scene, budget, camera, points } = fixture();
  budget.configure('auto', 'fast');
  const before = points.map((light) => ({ position: light.position.clone(), intensity: light.intensity }));
  for (let frame = 0; frame < 360; frame++) {
    camera.position.set(Math.cos(frame / 60) * 6, 2, Math.sin(frame / 60) * 6);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    budget.update(camera, 1 / 120);
  }
  assert.deepEqual(count(scene), { point: 14, area: 4, spot: 3 }, 'the count a shader sees never changes');
  points.forEach((light, index) => {
    assert.ok(light.position.equals(before[index].position), 'a practical stays where it was authored');
    assert.equal(light.intensity, before[index].intensity);
  });
  budget.dispose();
});

test('reflection capture restores every practical it found, and leaves no duplicates enabled', () => {
  const { scene, budget, points, areas } = fixture();
  budget.configure('auto', 'minimum');
  const group = scene.getObjectByName('adaptive-practical-lights')!;
  // RoomReflections hides root gameplay objects before invoking its enclosure callback, so the
  // proxy group is already hidden when this begins.
  group.visible = false;
  // A practical the room deliberately switched off must come back switched off, not on.
  points[3].visible = false;
  assert.throws(() =>
    budget.withFullLighting(() => {
      assert.deepEqual(count(scene), { point: 13, area: 4, spot: 3 }, 'the capture sees the room as authored');
      throw Error('capture test');
    }),
  );
  assert.equal(group.visible, false);
  assert.ok(
    points.every((light, index) => light.visible === (index !== 3)),
    'a capture leaves every practical exactly as it found it',
  );
  assert.ok(areas.every((light) => light.visible));
  assert.deepEqual(proxied(scene), { point: 0, area: 0 });
  budget.dispose();
});

test('disposal restores original visibility, removes the proxy group, and spares the table lamps', () => {
  const { scene, budget, points } = fixture();
  points[2].visible = false;
  const budget2 = new PracticalLightBudget(scene);
  budget2.dispose();
  budget.dispose();
  assert.equal(scene.getObjectByName('adaptive-practical-lights'), undefined);
  assert.deepEqual(count(scene), { point: 13, area: 4, spot: 3 });
  assert.equal(points[2].visible, false, 'a light the room switched off stays off');
});

test('the tier table still maps quality and tier to shader light counts', () => {
  assert.deepEqual(practicalLightLimits('performance', 'performance'), { points: 3, areas: 1 });
  assert.deepEqual(practicalLightLimits('auto', 'minimum'), { points: 3, areas: 1 });
  assert.deepEqual(practicalLightLimits('auto', 'fast'), { points: 4, areas: 2 });
  assert.deepEqual(practicalLightLimits('auto', 'balanced'), { points: 6, areas: 2 });
  assert.deepEqual(practicalLightLimits('high', 'balanced'), { points: 8, areas: 3 });
  assert.deepEqual(practicalLightLimits('ultra', 'minimum'), { points: 12, areas: 4 });
});
