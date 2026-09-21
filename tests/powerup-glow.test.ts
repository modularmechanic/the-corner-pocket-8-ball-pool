import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { Pickup, PowerUp, TableEvent } from '../src/simulation/types';
import { PowerupGlow } from '../src/render/powerup-glow';
import { POWER_CHARACTER } from '../src/render/powerup-icons';

type Resource = THREE.BufferGeometry | THREE.Material | THREE.Texture;

function harness() {
  const scene = new THREE.Scene();
  const disposed = new Set<Resource>();
  const track = (resource: Resource) => resource.addEventListener('dispose', () => disposed.add(resource));
  const glow = new PowerupGlow(scene, () => {
    const texture = new THREE.Texture();
    track(texture);
    return texture;
  });
  const resources = (root: THREE.Object3D) => {
    const found = new Set<Resource>();
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) found.add(mesh.geometry);
      const material = (object as THREE.Mesh | THREE.Sprite).material;
      for (const item of material ? (Array.isArray(material) ? material : [material]) : []) found.add(item);
    });
    for (const resource of found) track(resource);
    return found;
  };
  return { scene, glow, disposed, resources };
}

const pickup = (id: number, power: PowerUp, over: Partial<Pickup> = {}): Pickup => ({
  id,
  x: id - 2,
  z: 0.5,
  radius: 0.16,
  available: true,
  power,
  expiresAt: 20,
  ...over,
});
const event = (over: Partial<TableEvent>): TableEvent =>
  ({ kind: 'pickup', x: 0, z: 0, time: 0, strength: 1, ...over }) as TableEvent;
/** Everything the module parks in the scene that is currently drawing. */
const visible = (root: THREE.Object3D) => {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.visible && object.parent?.visible !== false) meshes.push(object);
  });
  return meshes;
};

test('every power gets its own pickup, in its own colour', () => {
  const { scene, glow } = harness();
  const powers = Object.keys(POWER_CHARACTER) as PowerUp[];
  const pickups = powers.map((power, i) => pickup(i, power));
  glow.update(pickups, undefined, null, 0, 1 / 60);
  assert.equal(glow.pickups.size, powers.length);
  const colors = new Set<string>();
  for (const power of powers) {
    const group = glow.pickups.get(powers.indexOf(power))!.group;
    assert.equal(group.parent, scene);
    const emissive = group.getObjectByProperty('type', 'Mesh');
    assert.ok(emissive, `${power} draws something`);
    colors.add(POWER_CHARACTER[power].color);
  }
  // Five powers, five readings: nothing shares a glow colour.
  assert.equal(colors.size, powers.length);
});

test('a pickup breathes, and is rebuilt only when its power changes', () => {
  const { glow } = harness();
  glow.update([pickup(1, 'overdrive')], undefined, null, 0, 1 / 60);
  const first = glow.pickups.get(1)!.group;
  const icon = first.children.find((child) => child.type === 'Group')!;
  const restAt = icon.position.y;
  glow.update([pickup(1, 'overdrive')], undefined, null, 0.42, 1 / 60);
  assert.equal(glow.pickups.get(1)!.group, first, 'the same pickup is not rebuilt');
  assert.notEqual(icon.position.y, restAt, 'it bobs');
  assert.notEqual(icon.rotation.y, 0, 'it turns');
  glow.update([pickup(1, 'frost')], undefined, null, 0.5, 1 / 60);
  assert.notEqual(glow.pickups.get(1)!.group, first, 'a different power is a different pickup');
});

test('a pickup runs visibly out of time, and lets go of its resources', () => {
  const { glow, disposed, resources } = harness();
  glow.update([pickup(1, 'ward', { expiresAt: 10 })], undefined, null, 0, 1 / 60);
  const visual = glow.pickups.get(1)!.group;
  // Only the fuse ring limits its draw range; every other ring draws whole (count Infinity).
  const drawn = () => {
    const rings = visual.children.filter(
      (child) => child instanceof THREE.Mesh && child.geometry instanceof THREE.RingGeometry,
    ) as THREE.Mesh[];
    return Math.max(...rings.map((ring) => ring.geometry.drawRange.count).filter(Number.isFinite));
  };
  glow.update([pickup(1, 'ward', { expiresAt: 10 })], undefined, null, 1, 1 / 60);
  const early = drawn();
  glow.update([pickup(1, 'ward', { expiresAt: 10 })], undefined, null, 8, 1 / 60);
  assert.ok(drawn() < early, 'the fuse drains towards the deadline');
  assert.ok(visual.scale.x < 1, 'and the pickup shrinks as it goes');

  const owned = resources(visual);
  glow.update([], undefined, null, 9, 1 / 60);
  assert.equal(glow.pickups.size, 0);
  for (const resource of owned) assert.ok(disposed.has(resource), 'a collected pickup disposes its own art');
});

test('a debuff lands the opposite way round from a buff', () => {
  const { scene, glow } = harness();
  glow.update([], undefined, null, 0, 1 / 60);
  const quiet = visible(scene).length;

  glow.emit(event({ kind: 'pickup', power: 'ward' }));
  glow.update([], undefined, null, 0.1, 0.1);
  const good = visible(scene).filter((mesh) => mesh.material instanceof THREE.MeshBasicMaterial);
  assert.ok(good.length > quiet, 'a buff plays something');
  // Nothing is stained: a gift leaves no mark on the cloth.
  assert.ok(!good.some((mesh) => mesh.material instanceof THREE.MeshBasicMaterial && !isAdditive(mesh)));
  const goodTone = tone(ringOf(good, 20));

  glow.emit(event({ kind: 'status', status: 'sticky' }));
  glow.update([], undefined, null, 0.2, 0.1);
  const bad = visible(scene).filter((mesh) => mesh.material instanceof THREE.MeshBasicMaterial);
  const stain = bad.find((mesh) => !isAdditive(mesh));
  assert.ok(stain, 'a debuff stains the cloth and a buff does not');
  const badRing = ringOf(bad, 0, 20);
  assert.ok(badRing, 'the blow is angular where the gift is round');
  const badTone = tone(badRing);
  assert.ok(badTone.r - badTone.b > 0.35, 'and it turns angry red');
  assert.ok(badTone.r - badTone.b > goodTone.r - goodTone.b + 0.25, 'far redder than any buff');

  glow.clear();
  glow.update([], undefined, null, 0.3, 1 / 60);
  assert.equal(visible(scene).length, quiet, 'a fresh rack leaves no moment behind');
});

test('the active-buff halo follows the cue ball, and turns on nobody', () => {
  const { scene, glow } = harness();
  glow.update([], { overdrive: 1 }, { x: 1.5, z: -0.5 }, 0, 1 / 60);
  const orbs = visible(scene).filter((mesh) => mesh.geometry instanceof THREE.SphereGeometry);
  assert.equal(orbs.length, 1, 'one orb a buff');
  assert.ok(Math.hypot(orbs[0].position.x - 1.5, orbs[0].position.z + 0.5) < 0.5, 'it circles the cue ball');

  glow.update([], { overdrive: 1, frozen: 1 }, { x: 0, z: 0 }, 0.5, 1 / 60);
  assert.equal(visible(scene).filter((mesh) => mesh.geometry instanceof THREE.SphereGeometry).length, 2);

  glow.update([], {}, { x: 0, z: 0 }, 1, 1 / 60);
  assert.equal(visible(scene).filter((mesh) => mesh.geometry instanceof THREE.SphereGeometry).length, 0);
});

test('missing arcade state is not a crash', () => {
  const { glow } = harness();
  glow.update(undefined, undefined, undefined, 0, 1 / 60);
  glow.update([{ id: 9, x: 0, z: 0, radius: 0.16, available: true } as Pickup], undefined, null, 0.1, 1 / 60);
  assert.equal(glow.pickups.size, 1, 'a pickup with no power still draws');
  glow.emit(event({ kind: 'pickup' }));
  glow.emit(event({ kind: 'cushion' }));
  glow.update(undefined, undefined, null, 0.2, 1 / 60);
  glow.dispose();
});

const isAdditive = (mesh: THREE.Mesh) => (mesh.material as THREE.Material).blending === THREE.AdditiveBlending;
/** The drawing ring whose segment count falls in [min, max): smooth for a gift, angular for a blow. */
const ringOf = (meshes: THREE.Mesh[], min: number, max = Infinity) =>
  meshes.find(
    (mesh) =>
      mesh.geometry instanceof THREE.RingGeometry &&
      mesh.geometry.parameters.thetaSegments >= min &&
      mesh.geometry.parameters.thetaSegments < max,
  ) as THREE.Mesh;
const tone = (mesh: THREE.Mesh) => (mesh.material as THREE.MeshBasicMaterial).color;
