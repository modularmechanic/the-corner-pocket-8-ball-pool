import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installHeadlessPubAssets } from './headless-pub-assets';
import { createPropInstaller } from '../src/render/asset-installer';
import { buildPub } from '../src/render/pub';
import { PUB_LAYOUT, pubBackZ, pubFrontZ, pubSideX } from '../src/render/pub-layout';
import { billiardFixtureVisible, updateBilliardFixture } from '../src/render/pub-interior';
import { fitTableCamera } from '../src/render/camera';
import { SNOOKER_TABLE } from '../src/simulation/modes/table';
import { TABLE } from '../src/simulation/types';

/** How far the cue mesh runs back from its tip. With a ball frozen against a cushion that is how much clear
 * space the cabinet needs on every side; the shooting camera sits nearer than this, so the cue is the binding
 * constraint. */
const CUE_REACH = 3.4;
/** Half extents of the widest cabinet slab, which TableModel scales with the slate. */
const cabinet = {
  x: 6.49 * (SNOOKER_TABLE.halfWidth / TABLE.halfWidth),
  z: 3.615 * (SNOOKER_TABLE.halfDepth / TABLE.halfDepth),
};

test('the room clears a full cue on all four sides of the 12-foot snooker cabinet', () => {
  const b = PUB_LAYOUT.bounds;
  assert.ok(b.right >= cabinet.x + CUE_REACH, `right wall ${b.right} < ${cabinet.x + CUE_REACH}`);
  assert.ok(-b.left >= cabinet.x + CUE_REACH, `left wall ${b.left}`);
  assert.ok(-b.back >= cabinet.z + CUE_REACH, `back wall ${b.back} < ${-(cabinet.z + CUE_REACH)}`);
  assert.ok(b.front >= cabinet.z + CUE_REACH, `front wall ${b.front} < ${cabinet.z + CUE_REACH}`);
  assert.equal(b.ceiling - PUB_LAYOUT.floor, 10);
  assert.ok(Math.abs(pubSideX(12) - pubSideX(9) - 3) < 1e-12);
  assert.ok(Math.abs(pubBackZ(-8.1) - pubBackZ(-10.56) - 2.46) < 1e-12);
  assert.ok(Math.abs(pubFrontZ(11.4) - pubFrontZ(7.25) - 4.15) < 1e-12);
});

test('no pub fitting stands in the band a cue and the shooting camera sweep around that cabinet', async () => {
  const errors = installHeadlessPubAssets();
  const scene = new THREE.Scene(),
    installer = createPropInstaller(),
    pub = buildPub(scene, installer);
  try {
    const settled = await installer.settled();
    assert.deepEqual([settled.failed, errors], [[], []]);
    scene.updateMatrixWorld(true);
    // The cue sits at ball height and its butt rides up to about 2 on an elevated shot; the shooting camera
    // sits near 1. Anything a pub keeps below the slate (benches, stools, tables) is under all of that.
    const low = 0.1,
      high = 2,
      keepX = cabinet.x + CUE_REACH,
      keepZ = cabinet.z + CUE_REACH;
    const world = new THREE.Matrix4(),
      instance = new THREE.Matrix4(),
      box = new THREE.Box3(),
      blocking: string[] = [];
    scene.traverseVisible((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry as THREE.BufferGeometry;
      geometry.computeBoundingBox();
      const count = object instanceof THREE.InstancedMesh ? object.count : 1;
      for (let i = 0; i < count; i++) {
        world.copy(object.matrixWorld);
        if (object instanceof THREE.InstancedMesh) {
          object.getMatrixAt(i, instance);
          world.multiply(instance);
        }
        box.copy(geometry.boundingBox!).applyMatrix4(world);
        if (box.max.y < low || box.min.y > high) continue;
        // The floor and ceiling slabs span the whole room and are not obstacles.
        if (box.max.x - box.min.x > 30 && box.max.z - box.min.z > 20) continue;
        if (box.min.x < keepX && box.max.x > -keepX && box.min.z < keepZ && box.max.z > -keepZ)
          blocking.push(
            `${object.name || object.parent?.name} at x[${box.min.x.toFixed(2)},${box.max.x.toFixed(2)}] ` +
              `z[${box.min.z.toFixed(2)},${box.max.z.toFixed(2)}]`,
          );
      }
    });
    assert.deepEqual(blocking, [], `${blocking.length} fittings stand in the cueing zone`);
  } finally {
    installer.dispose();
    pub.dispose();
  }
});

test('billiard fixture stays visible above the table in the default pub camera', () => {
  const camera = new THREE.PerspectiveCamera(39, 16 / 9, 0.1, 100);
  fitTableCamera(camera, new THREE.Vector3(0, -0.15, -1.5), new THREE.Vector3(0.035, 0.62, 0.784).normalize(), 16 / 9);
  assert.equal(billiardFixtureVisible(camera), true);
});

test('billiard fixture clears the playing surface in overhead and steep orbit views', () => {
  const overhead = new THREE.OrthographicCamera(-12, 12, 7, -7, 0.1, 100);
  overhead.position.set(0, 23, 0.001);
  overhead.lookAt(0, 0, 0);
  overhead.updateMatrixWorld(true);
  assert.equal(billiardFixtureVisible(overhead), false);
  const camera = new THREE.PerspectiveCamera(39, 16 / 9, 0.1, 100);
  fitTableCamera(camera, new THREE.Vector3(0, -0.15, -1.5), new THREE.Vector3(0, 0.99, 0.14).normalize(), 16 / 9);
  assert.equal(billiardFixtureVisible(camera), false);
  const fixture = new THREE.Group();
  updateBilliardFixture(fixture, camera);
  assert.equal(fixture.visible, false);
  fitTableCamera(camera, new THREE.Vector3(0, -0.15, -1.5), new THREE.Vector3(0.035, 0.62, 0.784).normalize(), 16 / 9);
  updateBilliardFixture(fixture, camera);
  assert.equal(fixture.visible, true);
});
