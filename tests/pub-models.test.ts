import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { disposePubObject, instancePubModel } from '../src/render/pub-models';

test('imported pub props retain authored transforms and rest on the requested surface', () => {
  const source = new THREE.Group(),
    geometry = new THREE.BoxGeometry(2, 3, 1),
    material = new THREE.MeshStandardMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, 2.5, 0);
  source.add(mesh);
  const placements = [
    { x: 8, y: -3.6, z: 2, height: 2.4, rotation: Math.PI / 2 },
    { x: -7, y: 0.325, z: -8, height: 0.6 },
  ];
  const props = instancePubModel(source, placements),
    instances = props.children[0] as THREE.InstancedMesh;
  assert.equal(props.children.length, 1);
  assert.equal(instances.count, 2);
  assert.equal(instances.geometry, geometry);
  assert.equal(instances.material, material);
  for (let i = 0; i < placements.length; i++) {
    const transform = new THREE.Matrix4();
    instances.getMatrixAt(i, transform);
    const bounds = new THREE.Box3()
      .setFromBufferAttribute(geometry.getAttribute('position') as THREE.BufferAttribute)
      .applyMatrix4(transform);
    assert.ok(Math.abs(bounds.min.y - placements[i].y) < 1e-6);
    assert.ok(Math.abs(bounds.max.y - bounds.min.y - placements[i].height) < 1e-6);
    assert.ok(Math.abs((bounds.min.x + bounds.max.x) / 2 - placements[i].x) < 1e-6);
  }
  assert.equal(source.children[0], mesh);
  assert.equal(mesh.position.y, 2.5);
  disposePubObject(props);
});

test('room disposal releases shared prop resources once and every instance allocation', () => {
  const source = new THREE.Group(),
    geometry = new THREE.BoxGeometry(),
    texture = new THREE.Texture(),
    material = new THREE.MeshStandardMaterial({ map: texture });
  source.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  const props = instancePubModel(source, [
    { x: 0, y: 0, z: 0 },
    { x: 3, y: 0, z: 0 },
  ]);
  let geometries = 0,
    materials = 0,
    textures = 0,
    instances = 0;
  geometry.addEventListener('dispose', () => geometries++);
  material.addEventListener('dispose', () => materials++);
  texture.addEventListener('dispose', () => textures++);
  props.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) object.addEventListener('dispose', () => instances++);
  });
  disposePubObject(props);
  assert.equal(geometries, 1);
  assert.equal(materials, 1);
  assert.equal(textures, 1);
  assert.equal(instances, 2);
});
