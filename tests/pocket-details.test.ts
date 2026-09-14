import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { POCKETS } from '../src/simulation/types';
import { buildPocketDetails, createPocketedSlabGeometry, createPocketedPanelGeometry, createPocketedClothGeometry, POCKET_APERTURE } from '../src/render/pocket-details';

test('table foundation geometry leaves true through-holes at all six simulated pockets', () => {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  for (const [width, depth, thickness] of [[12.98, 7.23, .5], [12.9, 7.16, .055], [12.84, 7.1, .27], [12.46, 6.69, .055]]) {
    const geometry = createPocketedSlabGeometry(width, depth, thickness), mesh = new THREE.Mesh(geometry, material);
    mesh.updateMatrixWorld(true);
    for (const pocket of POCKETS) {
      const ray = new THREE.Raycaster(new THREE.Vector3(pocket.x, 1, pocket.z), new THREE.Vector3(0, -1, 0));
      assert.equal(ray.intersectObject(mesh).length, 0, `slab ${width} must not cap pocket ${pocket.x},${pocket.z}`);
      ray.ray.origin.z -= Math.sign(pocket.z) * (POCKET_APERTURE + .08);
      assert.ok(ray.intersectObject(mesh).length > 0, 'material remains beside the pocket');
    }
    geometry.dispose();
  }
  material.dispose();
});

test('pocket center stays open to a deep bottom and approach rays are not blocked by decorative hardware', () => {
  const scene = new THREE.Scene();
  const surfaces = {
    brass: new THREE.MeshPhysicalMaterial(), leather: new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide }),
    rubber: new THREE.MeshStandardMaterial(), pocketVoid: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  };
  const details = buildPocketDetails(scene, surfaces);
  for (const pocket of POCKETS) {
    const down = new THREE.Raycaster(new THREE.Vector3(pocket.x, 1, pocket.z), new THREE.Vector3(0, -1, 0));
    const hit = down.intersectObject(details.group, true)[0];
    assert.ok(hit); assert.ok(hit.point.y < -.8, 'the center opens into a recessed throat');
    const direction = new THREE.Vector3(pocket.x, 0, pocket.z).normalize();
    const start = new THREE.Vector3(pocket.x, .18, pocket.z).addScaledVector(direction, -.8);
    const approach = new THREE.Raycaster(start, direction, 0, .8);
    assert.equal(approach.intersectObject(details.group, true).length, 0, 'metal/leather do not cross the center approach');
  }
  details.dispose(); assert.equal(details.group.parent, null);
  for (const material of Object.values(surfaces)) material.dispose();
});

test('cloth edges and all apron/rail cap contours leave the complete pocket aperture visible', () => {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), group = new THREE.Group();
  const cloth = new THREE.Mesh(createPocketedClothGeometry(11.76, 6.06), material); group.add(cloth);
  for (const [width, height, depth, x, y, z] of [
    [12.42, 1.04, .32, 0, -.88, -3.165], [.32, 1.04, 6.33, -6.05, -.88, 0], [.32, 1.04, 6.33, 6.05, -.88, 0],
    [12.42, .3, .32, 0, -.51, 3.165], [2.39, .54, .32, -5.015, -.94, 3.165], [3.89, .54, .32, 4.265, -.94, 3.165],
    [11.8, .23, .4, 0, .1, -3.29], [11.8, .23, .4, 0, .1, 3.29], [.42, .23, 6.12, -6.11, .1, 0], [.42, .23, 6.12, 6.11, .1, 0],
  ]) {
    const panel = new THREE.Mesh(createPocketedPanelGeometry(width, depth, height, x, z, .04, y + height / 2 < 0 ? 'throat' : 'mouth'), material);
    panel.position.set(x, y, z); group.add(panel);
  }
  group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  for (const pocket of POCKETS) for (const radius of [0, .1, .2, .3]) for (let angle = 0; angle < 32; angle++) {
    ray.ray.origin.set(pocket.x + Math.cos(angle * Math.PI / 16) * radius, 1, pocket.z + Math.sin(angle * Math.PI / 16) * radius);
    assert.equal(ray.intersectObject(group, true).length, 0, `open aperture ${pocket.x},${pocket.z} radius ${radius} angle ${angle}`);
  }
  // Clipping must not accidentally discard intact cloth in a corner or create
  // a huge stray triangle spanning the mouth of a pocket.
  for (let x = -5.8; x < 5.81; x += .2) for (let z = -3; z < 3.01; z += .2) {
    if (POCKETS.some(pocket => Math.hypot(x - pocket.x, z - pocket.z) < POCKET_APERTURE + .01)) continue;
    ray.ray.origin.set(x, 1, z); assert.ok(ray.intersectObject(cloth).length > 0, `cloth remains at ${x},${z}`);
  }
  group.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); }); material.dispose();
});

test('the leather sleeve remains visible in front of the slab and apron cut walls', () => {
  const scene = new THREE.Scene(), wood = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const surfaces = {
    brass: new THREE.MeshPhysicalMaterial(), leather: new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide }),
    rubber: new THREE.MeshStandardMaterial(), pocketVoid: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  };
  const details = buildPocketDetails(scene, surfaces), timber: THREE.Mesh[] = [];
  for (const [width, depth, height, y] of [[12.98, 7.23, .5, -.42], [12.9, 7.16, .055, -.22], [12.84, 7.1, .27, -.18]]) {
    const mesh = new THREE.Mesh(createPocketedSlabGeometry(width, depth, height), wood); mesh.position.y = y; scene.add(mesh); timber.push(mesh);
  }
  const apron = new THREE.Mesh(createPocketedPanelGeometry(12.42, .32, 1.04, 0, -3.165, .06, 'throat'), wood);
  apron.position.set(0, -.88, -3.165); scene.add(apron); timber.push(apron); scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(); ray.far = .5;
  for (const pocket of POCKETS) for (const y of [-.12, -.25, -.5]) for (let i = 0; i < 16; i++) {
    ray.ray.origin.set(pocket.x, y, pocket.z); ray.ray.direction.set(Math.cos(i * Math.PI / 8), 0, Math.sin(i * Math.PI / 8));
    const hit = ray.intersectObjects(scene.children, true)[0];
    assert.ok(hit); assert.equal((hit.object as THREE.Mesh).material, surfaces.leather, 'wood must sit behind the actual lining');
  }
  details.dispose(); for (const mesh of timber) mesh.geometry.dispose(); wood.dispose(); for (const material of Object.values(surfaces)) material.dispose();
});
