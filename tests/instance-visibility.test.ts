import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { InstanceVisibility } from '../src/render/instance-visibility';
import { instancePubModel, disposePubObject } from '../src/render/pub-models';

function fixture() {
  const source = new THREE.Group();
  source.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
  const room = new THREE.Group();
  const model = instancePubModel(source, [
    { x: -10, y: 0, z: -5 },
    { x: 0, y: 0, z: -5 },
    { x: 10, y: 0, z: -5 },
    { x: 0, y: 0, z: 5 },
  ]);
  room.add(model);
  const mesh = model.children[0] as THREE.InstancedMesh;
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 30);
  camera.updateMatrixWorld(true);
  return { room, model, mesh, camera, visibility: new InstanceVisibility(room) };
}

function xOf(mesh: THREE.InstancedMesh, index = 0) {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return matrix.elements[12];
}

test('individual instances outside the camera are omitted without adding draw calls or changing aggregate bounds', () => {
  const { room, mesh, camera, visibility } = fixture();
  const bounds = mesh.boundingSphere!.clone();
  visibility.update(camera, [], 0);
  assert.equal(mesh.count, 1);
  assert.equal(xOf(mesh), 0);
  assert.ok(mesh.boundingSphere!.equals(bounds));
  const version = mesh.instanceMatrix.version;
  visibility.update(camera, [], 0);
  assert.equal(mesh.instanceMatrix.version, version, 'a still camera causes no buffer upload');
  camera.position.x = 10;
  camera.updateMatrixWorld(true);
  visibility.update(camera, [], 0);
  assert.equal(mesh.count, 1);
  assert.equal(xOf(mesh), 10);
  camera.lookAt(10, 0, 10);
  camera.updateMatrixWorld(true);
  visibility.update(camera, [], 0);
  assert.equal(mesh.count, 0);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -5);
  camera.updateMatrixWorld(true);
  visibility.update(camera, [], 0);
  assert.equal(mesh.count, 1, 'empty batches reappear when the camera returns');
  assert.equal(xOf(mesh), 0);
  disposePubObject(room);
});

test('shadow casters are retained only for shadow cameras whose layers include them', () => {
  const { room, mesh, camera, visibility } = fixture();
  const shadow = camera.clone();
  shadow.position.x = 10;
  shadow.updateMatrixWorld(true);
  visibility.update(camera, [shadow], 0);
  assert.equal(mesh.count, 2);
  assert.deepEqual([xOf(mesh, 0), xOf(mesh, 1)], [0, 10]);
  shadow.layers.set(1);
  visibility.update(camera, [shadow], 0);
  assert.equal(mesh.count, 1, 'room props are excluded from the table-only shadow pass');
  disposePubObject(room);
});

test('reflections and arriving assets restore original transforms, colors and instance counts', () => {
  const { room, model, mesh, camera, visibility } = fixture();
  for (let i = 0; i < 4; i++) mesh.setColorAt(i, new THREE.Color(i / 4, 0, 0));
  const original = mesh.instanceMatrix.array.slice();
  const colors = mesh.instanceColor!.array.slice();
  visibility.update(camera, [], 0);
  assert.equal(mesh.instanceColor!.getX(0), 0.25);
  visibility.restore();
  assert.equal(mesh.count, 4);
  assert.deepEqual(mesh.instanceMatrix.array, original);
  assert.deepEqual(mesh.instanceColor!.array, colors);
  visibility.update(camera, [], 0);
  assert.equal(mesh.count, 1);
  // An asset swap changes the revision and can remove a previously culled placeholder.
  model.removeFromParent();
  const replacement = instancePubModel(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()), [
    { x: 0, y: 0, z: -4 },
    { x: 20, y: 0, z: -4 },
  ]);
  room.add(replacement);
  visibility.update(camera, [], 1);
  assert.equal((replacement.children[0] as THREE.InstancedMesh).count, 1);
  assert.equal(visibility.diagnostics().totalInstances, 2);
  disposePubObject(model);
  disposePubObject(room);
});

test('parent transforms and orthographic projection changes update visibility immediately', () => {
  const { room, mesh, visibility } = fixture();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 30);
  camera.updateMatrixWorld(true);
  visibility.update(camera, [], 0);
  assert.equal(mesh.count, 1);
  room.position.x = 10;
  visibility.update(camera, [], 0);
  assert.equal(mesh.count, 1);
  assert.equal(xOf(mesh), -10);
  camera.left = -30;
  camera.right = 30;
  camera.updateProjectionMatrix();
  visibility.update(camera, [], 0);
  assert.equal(mesh.count, 3);
  disposePubObject(room);
});

test('objects crossing a frustum edge remain visible, and unregistered animated instances are untouched', () => {
  const room = new THREE.Group();
  const model = instancePubModel(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial()), [
    { x: 1.8, y: -1, z: -5 },
  ]);
  room.add(model);
  const animated = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 2);
  room.add(animated);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 30);
  camera.updateMatrixWorld(true);
  const visibility = new InstanceVisibility(room);
  visibility.update(camera, [], 0);
  assert.equal((model.children[0] as THREE.InstancedMesh).count, 1);
  assert.equal(animated.count, 2);
  disposePubObject(room);
});
