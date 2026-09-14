import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { Hazard, Obstacle, Pickup } from '../src/simulation/types';
import { ArenaVisuals } from '../src/render/arena-visuals';
import { TABLE_SHADOW_LAYER } from '../src/render/table-model';

type Resource = THREE.BufferGeometry | THREE.Material | THREE.Texture;
function harness() {
  const scene = new THREE.Scene(), textures: THREE.Texture[] = [];
  const disposed = new Set<Resource>(), tracked = new Set<Resource>();
  const track = (resource: Resource) => { if (tracked.has(resource)) return; tracked.add(resource); resource.addEventListener('dispose', () => disposed.add(resource)); };
  const make = () => { const texture = new THREE.Texture(); textures.push(texture); track(texture); return texture; };
  const arena = new ArenaVisuals(scene, { wood: make, smoke: make });
  /** Every geometry and material reachable from one arena group; textures are checked separately. */
  const resources = (root: THREE.Object3D) => {
    const found = new Set<Resource>();
    root.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) found.add(object.geometry);
      const material = (object as THREE.Mesh).material;
      for (const item of material ? Array.isArray(material) ? material : [material] : []) found.add(item);
    });
    return found;
  };
  const update = (arcade: { obstacles: Obstacle[]; hazards: Hazard[]; pickups: Pickup[] }, clock = 0) => {
    arena.update(structuredClone(arcade), clock, 1 / 60);
    for (const child of scene.children) for (const resource of resources(child)) track(resource);
  };
  return { scene, arena, textures, disposed, tracked, resources, update };
}
const obstacle = (id: number, material: Obstacle['material'], hp = 3): Obstacle => ({ id, x: id - 3, z: -1, width: .6, depth: .25, hp, maxHp: 3, material });
const hazard = (id: number, kind: Hazard['kind'], x = id - 3): Hazard => ({ id, kind, x, z: 1, radius: .5, angle: .3, ...(kind === 'portal' ? { link: id } : {}) });
const pickup = (id: number, power: Pickup['power']): Pickup => ({ id, x: id - 3, z: 0, radius: .16, available: true, power });

test('arena visuals add, update and remove obstacles, hazards and pickups by id without leaking', () => {
  const { scene, arena, textures, disposed, tracked, resources, update } = harness();
  const arcade = {
    obstacles: [obstacle(1, 'wood'), obstacle(2, 'steel'), obstacle(3, 'hex')],
    hazards: (['ramp', 'portal', 'electric', 'water', 'slime', 'smoke'] as const).map((kind, index) => hazard(10 + index, kind)),
    pickups: (['overdrive', 'frost', 'ward', 'focus', 'portal'] as const).map((power, index) => pickup(20 + index, power)),
  };
  update(arcade);
  assert.equal(scene.children.length, 14);
  assert.deepEqual([arena.obstacles.size, arena.hazards.size, arena.pickups.size], [3, 6, 5]);
  assert.equal(textures.length, 2, 'one wood texture and one shared smoke texture');
  for (const group of scene.children) group.traverse(child => { if (child instanceof THREE.Mesh) assert.ok(child.layers.isEnabled(TABLE_SHADOW_LAYER)); });

  // Gameplay state changes animate the existing visuals.
  const groups = new Map([...arena.obstacles, ...arena.hazards, ...arena.pickups].map(([id, visual]) => [id, visual.group]));
  arcade.obstacles[0].hp = 0; arcade.obstacles[1].hp = 1; arcade.pickups[0].available = false;
  update(arcade, 1);
  assert.equal(disposed.size, 0);
  for (const [id, visual] of [...arena.obstacles, ...arena.hazards, ...arena.pickups]) assert.equal(visual.group, groups.get(id));
  assert.equal(arena.obstacles.get(1)!.group.visible, false); assert.equal(arena.pickups.get(20)!.group.visible, false);
  const pips = arena.obstacles.get(2)!.group.children.filter((child): child is THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> => child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial);
  assert.equal(pips.length, 3);
  assert.ok(!pips[0].material.color.equals(pips[1].material.color) && pips[1].material.color.equals(pips[2].material.color), 'spent pips dim');

  // Removed ids and reshaped items release everything they owned; the rest is untouched.
  const removed = [arena.obstacles.get(1)!, arena.hazards.get(15)!, arena.pickups.get(24)!, arena.hazards.get(10)!].map(visual => resources(visual.group));
  const kept = resources(arena.hazards.get(11)!.group);
  arcade.obstacles.shift(); arcade.hazards.pop(); arcade.pickups.pop(); arcade.hazards[0].x += .2;
  update(arcade, 2);
  assert.equal(scene.children.length, 11);
  assert.notEqual(arena.hazards.get(10)!.group, groups.get(10), 'a moved hazard is rebuilt');
  for (const group of removed) for (const resource of group) assert.ok(disposed.has(resource), `${resource.type} disposed`);
  for (const resource of kept) assert.ok(!disposed.has(resource));
  assert.ok(disposed.has(textures[0]), 'the wood texture follows its obstacle');
  assert.ok(!disposed.has(textures[1]), 'the smoke texture is shared by future smoke hazards');

  arena.dispose();
  assert.equal(scene.children.length, 0);
  for (const resource of tracked) assert.ok(disposed.has(resource), `${resource.type} disposed`);
});

test('electric arcs animate within one preallocated buffer', () => {
  const { arena, update } = harness();
  const warn = console.warn, warnings: unknown[] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    update({ obstacles: [], hazards: [hazard(1, 'electric')], pickups: [] }, 0);
    const arcs = arena.hazards.get(1)!.group.children.find((child): child is THREE.LineSegments => child instanceof THREE.LineSegments)!;
    const position = arcs.geometry.getAttribute('position') as THREE.BufferAttribute, before = Array.from(position.array);
    assert.equal(position.count, 48);
    assert.ok(before.some(value => value !== 0));
    update({ obstacles: [], hazards: [hazard(1, 'electric')], pickups: [] }, .5);
    assert.equal(arcs.geometry.getAttribute('position'), position);
    assert.notDeepEqual(Array.from(position.array), before, 'the lightning jumps');
    for (let i = 0; i < position.count; i++) assert.ok(arcs.geometry.boundingSphere!.containsPoint(new THREE.Vector3().fromBufferAttribute(position, i)));
    assert.deepEqual(warnings, []);
  } finally { console.warn = warn; }
});
