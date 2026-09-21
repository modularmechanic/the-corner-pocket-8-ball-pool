import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FROST_TRACK_CAPACITY, FrostVisuals, type FrostTrack } from '../src/render/frost-visuals';
import type { GameState, PlayerBuffs } from '../src/simulation/types';

const buffs = (frozen = 0): PlayerBuffs => ({ overdrive: 0, frozen, ward: 0, focus: 0, jammed: 0, sticky: 0 });
const ball = (id: number, x = 0, z = 0) => ({ id, x, z, vx: 0, vz: 0, pocketed: false });
/** Only the fields FrostVisuals reads; everything else is deliberately absent to prove the defensive reads. */
const state = (options: { frozen?: [number, number]; shot?: boolean; frost?: FrostTrack[]; pocketed?: boolean } = {}) =>
  ({
    mode: 'eight-ball',
    turn: 0,
    phase: 'ready',
    balls: [{ ...ball(0, 1, -0.5), pocketed: !!options.pocketed }, ball(1, 2, 0)],
    arcade: {
      buffs: [buffs(options.frozen?.[0] ?? 0), buffs(options.frozen?.[1] ?? 0)],
      activeShot: { overdrive: false, frozen: !!options.shot, ward: false, focus: false, sticky: false },
      frost: options.frost,
    },
  }) as unknown as GameState;

function harness() {
  const scene = new THREE.Scene(),
    frost = new FrostVisuals(scene);
  const mesh = (name: string) => scene.getObjectByName(name) as THREE.InstancedMesh;
  const crust = () => scene.getObjectByProperty('type', 'Group')!.children.find((c) => c.type === 'Group')!;
  const objects = () => {
    let count = 0;
    scene.traverse(() => count++);
    return count;
  };
  return { scene, frost, mesh, crust, objects };
}
const track = (id: number, life: number, x = id * 0.3, z = 0): FrostTrack => ({ id, x, z, life });
const alpha = (mesh: THREE.InstancedMesh, index: number) =>
  (mesh.geometry.getAttribute('color') as THREE.InstancedBufferAttribute).getW(index);
const scaleOf = (mesh: THREE.InstancedMesh, index: number) => {
  const matrix = new THREE.Matrix4(),
    size = new THREE.Vector3();
  mesh.getMatrixAt(index, matrix);
  return matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), size) ? size.x : size.x;
};

test('an unfrozen table draws nothing: every frost pool is empty and the crust is hidden', () => {
  const { frost, mesh, crust, objects } = harness(),
    baseline = objects();
  frost.update(state(), 1 / 60);
  assert.equal(crust().visible, false, 'no rime crust without the buff');
  for (const name of ['frost-tracks', 'frost-vapour', 'frost-shards', 'frost-snap'])
    assert.equal(mesh(name).visible, false, `${name} issues no draw when idle`);
  frost.update(state({ frost: [] }), 1 / 60);
  assert.equal(objects(), baseline, 'updating adds no scene objects');
});

test('the crust encases the cue ball while frozen and leaves the ball untouched when the buff ends', () => {
  const { frost, crust } = harness();
  frost.update(state({ frozen: [1, 0] }), 1 / 60);
  assert.equal(crust().visible, true);
  assert.ok(crust().scale.x > 1, 'frost slams on oversized rather than fading in');
  assert.ok(crust().position.x === 1 && crust().position.z === -0.5, 'the crust rides the cue ball');
  for (let i = 0; i < 40; i++) frost.update(state({ frozen: [1, 0] }), 1 / 60);
  assert.ok(Math.abs(crust().scale.x - 1) < 0.05, 'it settles to the ball size');
  for (let i = 0; i < 90; i++) frost.update(state(), 1 / 60);
  assert.equal(crust().visible, false, 'the buff ending returns the ball to normal');
});

test('the crust follows the shot in flight and hides with a pocketed cue ball', () => {
  const { frost, crust } = harness();
  frost.update(state({ shot: true }), 1 / 60);
  assert.equal(crust().visible, true, 'activeShot.frozen alone freezes the ball in flight');
  frost.update(state({ shot: true, pocketed: true }), 1 / 60);
  assert.equal(crust().visible, false);
});

test('ice tracks fade and shrink with life, vanish at zero and stay inside one bounded draw', () => {
  const { frost, mesh } = harness(),
    tracks = mesh('frost-tracks');
  frost.update(state({ frost: [track(1, 1), track(2, 0.5), track(3, 0)] }), 1 / 60);
  assert.equal(tracks.count, 2, 'a spent track is dropped');
  assert.ok(tracks.visible);
  assert.ok(alpha(tracks, 0) > alpha(tracks, 1), 'older ice is fainter');
  assert.ok(scaleOf(tracks, 0) > scaleOf(tracks, 1), 'evaporating ice shrinks');
  frost.update(state({ frost: Array.from({ length: 80 }, (_, i) => track(i, 1)) }), 1 / 60);
  assert.equal(tracks.count, FROST_TRACK_CAPACITY, 'the live track count is capped');
  frost.update(state({ frost: [] }), 1 / 60);
  assert.equal(tracks.visible, false, 'an empty pool issues no draw');
});

test('a track keeps its own size and spin across frames so the patch does not swim', () => {
  const { frost, mesh } = harness(),
    tracks = mesh('frost-tracks');
  const sizeAt = () => {
    frost.update(state({ frost: [track(7, 1)] }), 1 / 60);
    return scaleOf(tracks, 0);
  };
  assert.equal(sizeAt(), sizeAt(), 'the patch is keyed to the stable track id');
});

test('evaporating ice puffs vapour once per threshold, not every frame', () => {
  const { frost, mesh } = harness(),
    wisps = mesh('frost-vapour');
  frost.update(state({ frost: [track(1, 0.9)] }), 1 / 60);
  assert.equal(wisps.count, 0);
  frost.update(state({ frost: [track(1, 0.4)] }), 1 / 60);
  assert.equal(wisps.count, 1, 'crossing the first threshold puffs');
  frost.update(state({ frost: [track(1, 0.3)] }), 1 / 60);
  assert.equal(wisps.count, 1, 'staying below it does not puff again');
  frost.update(state({ frost: [track(1, 0.1)] }), 1 / 60);
  assert.equal(wisps.count, 2, 'the last of the ice puffs again');
});

test('frost landing fires one cold snap per buff, for either player', () => {
  const { frost, mesh } = harness(),
    rings = mesh('frost-snap'),
    shards = mesh('frost-shards');
  frost.update(state(), 1 / 60);
  assert.equal(rings.count, 0);
  frost.update(state({ frozen: [0, 1] }), 1 / 60);
  assert.ok(rings.count >= 1 && shards.count > 0, 'the snap rings and ice chips fire');
  const fired = shards.count;
  frost.update(state({ frozen: [0, 1] }), 1 / 60);
  assert.ok(shards.count <= fired, 'a held buff does not re-fire the snap');
  for (let i = 0; i < 80; i++) frost.update(state({ frozen: [0, 1] }), 1 / 60);
  assert.equal(rings.visible, false, 'the snap is transient');
});

test('a state without arcade, buffs or a frost array is survivable', () => {
  const { frost, mesh } = harness();
  frost.update({ balls: [], turn: 0, mode: 'eight-ball' } as unknown as GameState, 1 / 60);
  frost.update({} as unknown as GameState, 0);
  assert.equal(mesh('frost-tracks').visible, false);
});

test('dispose returns the scene to its starting size and frees the geometry', () => {
  const scene = new THREE.Scene(),
    baseline = scene.children.length;
  const frost = new FrostVisuals(scene),
    disposed: unknown[] = [];
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.addEventListener('dispose', () => disposed.push(mesh.geometry));
  });
  frost.update(state({ frozen: [1, 0], frost: [track(1, 1)] }), 1 / 60);
  frost.dispose();
  assert.equal(scene.children.length, baseline);
  assert.ok(disposed.length >= 5, 'every geometry it owns is released');
});
