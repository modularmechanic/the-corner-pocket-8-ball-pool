import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TABLE, initialState } from '../src/simulation/types';
import { TABLE_RAILS } from '../src/simulation/table-geometry';
import { TableModel, TABLE_SHADOW_LAYER, type TableModelSurfaces } from '../src/render/table-model';
import { ORIGINAL_TABLE_OCCLUDERS } from './table-model-snapshot';

function buildTable(scene: THREE.Scene, balls = Array.from({ length: 16 }, () => new THREE.Texture())) {
  const surfaces: TableModelSurfaces = {
    walnut: new THREE.MeshPhysicalMaterial(),
    sideWood: new THREE.MeshPhysicalMaterial(),
    darkWood: new THREE.MeshPhysicalMaterial(),
    brass: new THREE.MeshPhysicalMaterial(),
    cloth: new THREE.MeshPhysicalMaterial(),
    cushion: new THREE.MeshPhysicalMaterial(),
    leather: new THREE.MeshPhysicalMaterial(),
    rubber: new THREE.MeshStandardMaterial(),
    pocketVoid: new THREE.MeshBasicMaterial(),
  };
  return new TableModel(scene, surfaces, {
    plaque: new THREE.Texture(),
    brushedSteel: new THREE.Texture(),
    coinFace: new THREE.Texture(),
    balls,
  });
}
const named = (model: TableModel, name: string) => model.occluders.filter((object) => object.name === name);
const near = (actual: number, expected: number, message: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} != ${expected}`);

test('table model sizes cloth, cushions and rail caps from the simulated table', () => {
  const model = buildTable(new THREE.Scene());
  const [cloth] = named(model, 'Cloth bed'),
    clothBox = new THREE.Box3().setFromObject(cloth);
  near(clothBox.max.x, TABLE.halfWidth + TABLE.radius, 'cloth half width');
  near(clothBox.min.x, -TABLE.halfWidth - TABLE.radius, 'cloth half width');
  near(clothBox.max.z, TABLE.halfDepth + TABLE.radius, 'cloth half depth');
  near(clothBox.min.z, -TABLE.halfDepth - TABLE.radius, 'cloth half depth');
  const cushions = named(model, 'Cushion');
  assert.equal(cushions.length, TABLE_RAILS.length);
  let cushionBackX = 0,
    cushionBackZ = 0;
  for (const [index, rail] of TABLE_RAILS.entries()) {
    const box = new THREE.Box3().setFromObject(cushions[index]);
    near(box.max.x - box.min.x, rail.halfWidth * 2, 'cushion width');
    near(box.max.z - box.min.z, rail.halfDepth * 2, 'cushion depth');
    near((box.max.x + box.min.x) / 2, rail.x, 'cushion x');
    near((box.max.z + box.min.z) / 2, rail.z, 'cushion z');
    if (rail.z === 0) {
      near(Math.abs(rail.x) - rail.halfWidth, TABLE.halfWidth, 'end cushion face');
      cushionBackX = Math.abs(rail.x) + rail.halfWidth;
    } else {
      near(Math.abs(rail.z) - rail.halfDepth, TABLE.halfDepth, 'side cushion face');
      cushionBackZ = Math.abs(rail.z) + rail.halfDepth;
    }
  }
  const caps = named(model, 'Rail cap');
  assert.equal(caps.length, 4);
  for (const cap of caps) {
    const box = new THREE.Box3().setFromObject(cap),
      end = box.max.z - box.min.z > box.max.x - box.min.x;
    const inner = end
      ? Math.min(Math.abs(box.min.x), Math.abs(box.max.x))
      : Math.min(Math.abs(box.min.z), Math.abs(box.max.z));
    const outer = end
      ? Math.max(Math.abs(box.min.x), Math.abs(box.max.x))
      : Math.max(Math.abs(box.min.z), Math.abs(box.max.z));
    assert.ok(inner > (end ? TABLE.halfWidth : TABLE.halfDepth) + TABLE.radius, 'caps leave the cloth uncovered');
    assert.ok(
      inner <= (end ? cushionBackX : cushionBackZ) && outer > (end ? cushionBackX : cushionBackZ),
      'caps cover the cushion backs',
    );
  }
});

test('table occluders are exactly the objects the table model added to the scene', () => {
  const scene = new THREE.Scene(),
    pub = new THREE.Group();
  scene.add(pub);
  const model = buildTable(scene);
  const ball = new THREE.Mesh();
  scene.add(ball);
  assert.deepEqual(
    new Set(model.occluders),
    new Set(scene.children.filter((object) => object !== pub && object !== ball)),
  );
  assert.equal(new Set(model.occluders).size, model.occluders.length);
  assert.ok(model.occluders.includes(model.pocketDetails.group) && model.occluders.includes(model.details.group));
  const controls: THREE.Object3D[] = [];
  for (const object of model.occluders)
    object.traverse((child) => {
      if (child instanceof THREE.Mesh)
        assert.ok(child.layers.isEnabled(TABLE_SHADOW_LAYER), 'every table mesh casts table shadows');
      if (child.userData.tableControl) controls.push(child);
    });
  assert.deepEqual(new Set(controls), new Set([...model.chalkControls, model.details.coinControl]));
});

test('table model reproduces every occluder of the original PoolScene table', () => {
  const model = buildTable(new THREE.Scene());
  assert.equal(model.occluders.length, ORIGINAL_TABLE_OCCLUDERS.length);
  for (const [index, [type, ...expected]] of ORIGINAL_TABLE_OCCLUDERS.entries()) {
    const object = model.occluders[index],
      box = new THREE.Box3().setFromObject(object);
    assert.equal(object.type, type, `occluder ${index} type`);
    const actual = [...object.position.toArray(), ...box.min.toArray(), ...box.max.toArray()];
    for (const [axis, value] of actual.entries())
      assert.ok(
        Math.abs(value - expected[axis]) < 1e-9,
        `occluder ${index} value ${axis}: ${value} != ${expected[axis]}`,
      );
  }
});

test('coin return waits for fading balls and leaves shared ball maps to their owner', () => {
  const balls = Array.from({ length: 16 }, () => new THREE.Texture()),
    details = buildTable(new THREE.Scene(), balls).details;
  const returned = (id: number) =>
    details.group.children.find(
      (child): child is THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial> =>
        child instanceof THREE.Mesh && child.material.map === balls[id],
    )!;
  const state = initialState('coin-return');
  state.balls[3].pocketed = true;
  details.update(state, 0.3, new Map([[3, {}]]));
  details.update(state, 0.3, new Map([[3, {}]]));
  assert.equal(returned(3).visible, false, 'a ball still fading on the table has not reached the return');
  details.update(state, 0.3, new Map());
  assert.equal(returned(3).visible, false, 'the arrival delay starts once the ball leaves the table');
  details.update(state, 0.3, new Map());
  assert.equal(returned(3).visible, true);
  const disposed = new Set<THREE.Texture>();
  for (const texture of balls) texture.addEventListener('dispose', () => disposed.add(texture));
  details.dispose();
  assert.equal(disposed.size, 0);
});
