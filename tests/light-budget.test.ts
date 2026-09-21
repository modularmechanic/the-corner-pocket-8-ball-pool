import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PracticalLightBudget, practicalLightLimits } from '../src/render/light-budget';

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
  for (let i = 0; i < 3; i++) scene.add(new THREE.SpotLight(0xffffff, 30));
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.05, 100);
  camera.position.set(-3, 2, 6);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const budget = new PracticalLightBudget(scene);
  return { scene, points, areas, camera, budget };
}

/** Same visibility/layer filter as WebGLRenderer's light collection. Zero intensity
 * still counts: it does not remove the light from the shader's loop. */
function count(scene: THREE.Scene, camera: THREE.Camera) {
  const result = { point: 0, area: 0, spot: 0 };
  scene.traverseVisible((object) => {
    if (!object.layers.test(camera.layers)) return;
    if (object instanceof THREE.PointLight) result.point++;
    if (object instanceof THREE.RectAreaLight) result.area++;
    if (object instanceof THREE.SpotLight) result.spot++;
  });
  return result;
}
function proxies(scene: THREE.Scene) {
  return scene
    .getObjectByName('adaptive-practical-lights')!
    .children.filter((light): light is THREE.PointLight => light instanceof THREE.PointLight && light.visible);
}
function settle(budget: PracticalLightBudget, camera: THREE.Camera) {
  for (let i = 0; i < 90; i++) budget.update(camera, 1 / 120, 0);
}

test('all presets enforce actual shader counts, spare table spots, and preserve authored lights', () => {
  const { scene, budget, camera, points, areas } = fixture();
  const intensities = points.map((light) => light.intensity);
  for (const quality of ['performance', 'auto', 'high', 'veryHigh', 'ultra'] as const) {
    for (const tier of ['refined', 'balanced', 'fast', 'light', 'minimum'] as const) {
      budget.configure(quality, tier);
      settle(budget, camera);
      const limits = practicalLightLimits(quality, tier);
      assert.deepEqual(count(scene, camera), { point: limits.points, area: limits.areas, spot: 3 });
      assert.deepEqual(budget.getCounts(), { pointLights: limits.points, areaLights: limits.areas });
      assert.ok(
        proxies(scene).some((light) => light.intensity > 0),
        'the bounded pool actually emits light',
      );
      assert.ok([...points, ...areas].every((light) => light.visible && light.layers.mask === 0));
      assert.deepEqual(
        points.map((light) => light.intensity),
        intensities,
      );
    }
  }
  budget.dispose();
});

test('camera orbit and same-tier reconfiguration retain settled lights without a blackout', () => {
  const { scene, budget, camera, points } = fixture();
  budget.configure('veryHigh', 'veryHigh');
  settle(budget, camera);
  const slots = proxies(scene),
    before = slots.map((light) => light.intensity);
  budget.configure('veryHigh', 'veryHigh');
  budget.update(camera, 1 / 120, 0);
  assert.deepEqual(
    slots.map((light) => light.intensity),
    before,
  );
  const positions = points.map((light) => light.position.clone());
  for (let frame = 0; frame < 360; frame++) {
    camera.position.set(Math.cos(frame / 60) * 6, 2, Math.sin(frame / 60) * 6);
    camera.lookAt(0, 0, 0);
    budget.update(camera, 1 / 120, 0);
    assert.deepEqual(count(scene, camera), { point: 6, area: 2, spot: 3 });
    assert.ok(
      slots.some((light) => light.intensity > 0),
      'orbit never blacks out the whole pool',
    );
  }
  points.forEach((light, index) => assert.ok(light.position.equals(positions[index])));
  budget.dispose();
});

test('a selected light retains runtime visibility, intensity and parent transforms', () => {
  const scene = new THREE.Scene(),
    parent = new THREE.Group();
  scene.add(parent);
  const source = new THREE.PointLight(0xffffff, 10, 10);
  parent.add(source);
  const camera = new THREE.PerspectiveCamera();
  camera.position.z = 4;
  const budget = new PracticalLightBudget(scene);
  settle(budget, camera);
  const proxy = proxies(scene).find((light) => light.intensity > 0)!;
  assert.equal(proxy.intensity, 10);
  source.intensity = 6;
  parent.position.x = 1;
  budget.update(camera, 1 / 120, 0);
  assert.equal(proxy.intensity, 6);
  assert.equal(proxy.position.x, 1);
  source.visible = false;
  budget.update(camera, 1 / 120, 0);
  assert.equal(proxy.intensity, 0);
  source.visible = true;
  parent.visible = false;
  budget.update(camera, 1 / 120, 0);
  assert.equal(proxy.intensity, 0);
  parent.visible = true;
  settle(budget, camera);
  assert.equal(proxy.intensity, 6);
  parent.removeFromParent();
  budget.update(camera, 1 / 120, 0);
  assert.equal(proxy.intensity, 0, 'detached sources cannot become ghost lights');
  budget.dispose();
});

test('an offscreen emitter is kept when its influence reaches the view', () => {
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  const source = new THREE.PointLight(0xffffff, 10, 5);
  source.position.z = 1; // Behind the camera, but illuminates its first four metres.
  scene.add(source);
  const budget = new PracticalLightBudget(scene);
  settle(budget, camera);
  assert.ok(proxies(scene).some((light) => light.intensity === 10));
  source.position.z = 10;
  settle(budget, camera);
  assert.ok(proxies(scene).every((light) => light.intensity === 0));
  budget.dispose();
});

test('replacement lights fade down at their old position before moving', () => {
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera();
  camera.position.z = 5;
  const sources = [10, 10, 1].map((intensity, i) => {
    const source = new THREE.PointLight(0xffffff, intensity, 10);
    source.position.x = i - 1;
    scene.add(source);
    return source;
  });
  const budget = new PracticalLightBudget(scene);
  budget.configure('performance', 'performance');
  settle(budget, camera);
  const slots = proxies(scene),
    positions = slots.map((light) => light.position.clone());
  sources[2].intensity = 100;
  for (let i = 0; i < 30; i++) {
    budget.update(camera, 1 / 120, 0);
    slots.forEach((light, index) => {
      if (!light.position.equals(positions[index])) assert.equal(light.intensity, 0, 'reassignment happens at zero');
      positions[index].copy(light.position);
    });
  }
  settle(budget, camera);
  assert.ok(slots.some((light) => light.position.x === 1 && light.intensity === 100));
  budget.dispose();
});

test('a gameplay flash takes a slot immediately without increasing shader counts', () => {
  const { scene, camera, budget } = fixture();
  const flash = new THREE.PointLight(0xffffff, 0, 20);
  flash.position.copy(camera.position);
  flash.userData.performanceFlash = true;
  scene.add(flash);
  budget.configure('performance', 'performance');
  budget.update(camera, 1 / 120, 1);
  flash.intensity = 100;
  budget.update(camera, 1 / 120, 1);
  assert.ok(proxies(scene).some((light) => light.intensity === 100));
  assert.deepEqual(count(scene, camera), { point: 2, area: 1, spot: 3 });
  budget.dispose();
});

test('reflection capture restores original layers and runtime visibility, including after failure', () => {
  const { scene, budget, camera, points } = fixture();
  budget.configure('performance', 'performance');
  const group = scene.getObjectByName('adaptive-practical-lights')!;
  group.visible = false; // RoomReflections already hid root gameplay groups.
  points[3].visible = false;
  assert.throws(() =>
    budget.withFullLighting(() => {
      assert.deepEqual(count(scene, camera), { point: 13, area: 4, spot: 3 });
      budget.withFullLighting(() => assert.equal(count(scene, camera).point, 13));
      assert.equal(count(scene, camera).point, 13, 'nested capture retains authored lighting');
      throw Error('capture test');
    }),
  );
  assert.equal(group.visible, false);
  assert.ok(points.every((light, i) => light.visible === (i !== 3) && light.layers.mask === 0));
  group.visible = true;
  assert.deepEqual(count(scene, camera), { point: 2, area: 1, spot: 3 });
  budget.dispose();
  assert.equal(points[3].visible, false);
  assert.deepEqual(count(scene, camera), { point: 13, area: 4, spot: 3 });
});

test('asset revisions discover arriving lights and materials without scanning a settled scene', () => {
  const { scene, camera, budget } = fixture();
  budget.update(camera, 1 / 120, 1);
  let scans = 0;
  const traverse = scene.traverse;
  scene.traverse = function (callback) {
    scans++;
    traverse.call(this, callback);
  };
  for (let i = 0; i < 1000; i++) budget.update(camera, 1 / 120, 1);
  assert.equal(scans, 0);
  const light = new THREE.PointLight(),
    material = new THREE.MeshStandardMaterial();
  scene.add(light, new THREE.Mesh(new THREE.BoxGeometry(), material));
  const key = material.customProgramCacheKey();
  budget.update(camera, 1 / 120, 2);
  assert.equal(light.layers.mask, 0);
  assert.notEqual(material.customProgramCacheKey(), key);
  assert.deepEqual(count(scene, camera), { point: 4, area: 2, spot: 3 });
  budget.dispose();
  assert.equal(light.layers.mask, 1);
});

test('non-default source layer masks survive capture and disposal', () => {
  const scene = new THREE.Scene(),
    light = new THREE.PointLight();
  light.layers.set(3);
  scene.add(light);
  const budget = new PracticalLightBudget(scene);
  assert.equal(light.layers.mask, 0);
  budget.withFullLighting(() => assert.equal(light.layers.mask, 8));
  assert.equal(light.layers.mask, 0);
  budget.dispose();
  assert.equal(light.layers.mask, 8);
});
