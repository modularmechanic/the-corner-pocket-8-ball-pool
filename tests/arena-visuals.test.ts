import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { Hazard, Obstacle, Pickup } from '../src/simulation/types';
import { ArenaVisuals } from '../src/render/arena-visuals';
import { createPropInstaller } from '../src/render/asset-installer';
import { TABLE_SHADOW_LAYER } from '../src/render/table-model';
import { rampCorners } from '../src/simulation/arcade';

type Resource = THREE.BufferGeometry | THREE.Material | THREE.Texture;
function harness() {
  const scene = new THREE.Scene(),
    textures: THREE.Texture[] = [];
  const disposed = new Set<Resource>(),
    tracked = new Set<Resource>();
  const track = (resource: Resource) => {
    if (tracked.has(resource)) return;
    tracked.add(resource);
    resource.addEventListener('dispose', () => disposed.add(resource));
  };
  const make = () => {
    const texture = new THREE.Texture();
    textures.push(texture);
    track(texture);
    return texture;
  };
  const arena = new ArenaVisuals(scene, { wood: make, smoke: make });
  /** Every geometry and material reachable from one arena group; textures are checked separately. */
  const resources = (root: THREE.Object3D) => {
    const found = new Set<Resource>();
    root.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) found.add(object.geometry);
      const material = (object as THREE.Mesh).material;
      for (const item of material ? (Array.isArray(material) ? material : [material]) : []) found.add(item);
    });
    return found;
  };
  const update = (arcade: { obstacles: Obstacle[]; hazards: Hazard[]; pickups: Pickup[] }, clock = 0) => {
    arena.update(structuredClone(arcade), clock, 1 / 60);
    for (const child of scene.children) for (const resource of resources(child)) track(resource);
  };
  return { scene, arena, textures, disposed, tracked, resources, update };
}
const obstacle = (id: number, material: Obstacle['material'], hp = 3): Obstacle => ({
  id,
  x: id - 3,
  z: -1,
  width: 0.6,
  depth: 0.25,
  hp,
  maxHp: 3,
  material,
});
const hazard = (id: number, kind: Hazard['kind'], x = id - 3): Hazard => ({
  id,
  kind,
  x,
  z: 1,
  radius: 0.5,
  angle: 0.3,
  ...(kind === 'portal' ? { link: id } : {}),
});
const pickup = (id: number, power: Pickup['power']): Pickup => ({
  id,
  x: id - 3,
  z: 0,
  radius: 0.16,
  available: true,
  power,
});

test('arena visuals add, update and remove obstacles and hazards by id without leaking', () => {
  const { scene, arena, textures, disposed, tracked, resources, update } = harness();
  const arcade = {
    obstacles: [obstacle(1, 'wood'), obstacle(2, 'steel'), obstacle(3, 'hex')],
    hazards: (['ramp', 'portal', 'electric', 'water', 'slime', 'smoke'] as const).map((kind, index) =>
      hazard(10 + index, kind),
    ),
    pickups: (['overdrive', 'frost', 'ward', 'focus', 'portal'] as const).map((power, index) =>
      pickup(20 + index, power),
    ),
  };
  update(arcade);
  assert.equal(scene.children.length, 9);
  assert.deepEqual([arena.obstacles.size, arena.hazards.size], [3, 6]);
  assert.equal(textures.length, 2, 'one wood texture and one shared smoke texture');
  for (const group of scene.children)
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) assert.ok(child.layers.isEnabled(TABLE_SHADOW_LAYER));
    });

  // Gameplay state changes animate the existing visuals.
  const groups = new Map(
    [...arena.obstacles, ...arena.hazards].map(([id, visual]) => [id, visual.group]),
  );
  arcade.obstacles[0].hp = 0;
  arcade.obstacles[1].hp = 1;
  update(arcade, 1);
  assert.equal(disposed.size, 0);
  for (const [id, visual] of [...arena.obstacles, ...arena.hazards])
    assert.equal(visual.group, groups.get(id));
  assert.equal(arena.obstacles.get(1)!.group.visible, false);
  const pips = arena.obstacles
    .get(2)!
    .group.children.filter(
      (child): child is THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> =>
        child instanceof THREE.Mesh && child.material instanceof THREE.MeshBasicMaterial,
    );
  assert.equal(pips.length, 3);
  assert.ok(
    !pips[0].material.color.equals(pips[1].material.color) && pips[1].material.color.equals(pips[2].material.color),
    'spent pips dim',
  );

  // Removed ids and reshaped items release everything they owned; the rest is untouched.
  const removed = [arena.obstacles.get(1)!, arena.hazards.get(15)!, arena.hazards.get(10)!].map(
    (visual) => resources(visual.group),
  );
  const kept = resources(arena.hazards.get(11)!.group);
  arcade.obstacles.shift();
  arcade.hazards.pop();
  arcade.hazards[0].x += 0.2;
  update(arcade, 2);
  assert.equal(scene.children.length, 7);
  assert.notEqual(arena.hazards.get(10)!.group, groups.get(10), 'a moved hazard is rebuilt');
  for (const group of removed)
    for (const resource of group) assert.ok(disposed.has(resource), `${resource.type} disposed`);
  for (const resource of kept) assert.ok(!disposed.has(resource));
  assert.ok(disposed.has(textures[0]), 'the wood texture follows its obstacle');
  assert.ok(!disposed.has(textures[1]), 'the smoke texture is shared by future smoke hazards');

  arena.dispose();
  assert.equal(scene.children.length, 0);
  for (const resource of tracked) assert.ok(disposed.has(resource), `${resource.type} disposed`);
});

test('arena visuals rebuild an id whose kind or material changes', () => {
  const { arena, textures, disposed, resources, update } = harness();
  const arcade = { obstacles: [obstacle(1, 'wood')], hazards: [hazard(2, 'water')], pickups: [pickup(3, 'frost')] };
  update(arcade);
  const before = [arena.obstacles.get(1)!, arena.hazards.get(2)!].map((visual) => ({
    group: visual.group,
    owned: resources(visual.group),
  }));
  arcade.obstacles[0].material = 'steel';
  arcade.hazards[0].kind = 'electric';
  update(arcade, 1);
  const after = [arena.obstacles.get(1)!, arena.hazards.get(2)!];
  for (const [index, { group, owned }] of before.entries()) {
    assert.notEqual(after[index].group, group);
    for (const resource of owned) assert.ok(disposed.has(resource), `${resource.type} disposed`);
  }
  assert.ok(disposed.has(textures[0]), 'the wood grain leaves with the wooden obstacle');
  assert.equal(textures.length, 1, 'steel needs no wood texture');
  assert.ok(
    after[1].group.children.some((child) => child instanceof THREE.LineSegments),
    'the electric hazard has arcs',
  );
  const bodies = after[0].group.children.filter(
    (child): child is THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial> =>
      child instanceof THREE.Mesh && child.material instanceof THREE.MeshPhysicalMaterial,
  );
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].material.map, null);
});

test('obstacle hit flashes fade and clear for a fresh rack', () => {
  const { arena, update } = harness(),
    arcade = { obstacles: [obstacle(1, 'hex')], hazards: [], pickups: [] };
  update(arcade);
  const body = arena.obstacles
    .get(1)!
    .group.children.find(
      (child): child is THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial> =>
        child instanceof THREE.Mesh && child.material instanceof THREE.MeshPhysicalMaterial,
    )!;
  assert.equal(arena.strikeObstacle(1)?.material, 'hex');
  assert.equal(arena.strikeObstacle(99), undefined);
  update(arcade);
  assert.ok(body.material.emissiveIntensity > 0.5);
  arena.clearFlashes();
  update(arcade);
  assert.equal(body.material.emissiveIntensity, 0);
});

test('electric arcs animate within one preallocated buffer', () => {
  const { arena, update } = harness();
  const warn = console.warn,
    warnings: unknown[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    update({ obstacles: [], hazards: [hazard(1, 'electric')], pickups: [] }, 0);
    const arcs = arena.hazards
      .get(1)!
      .group.children.find((child): child is THREE.LineSegments => child instanceof THREE.LineSegments)!;
    const position = arcs.geometry.getAttribute('position') as THREE.BufferAttribute,
      before = Array.from(position.array);
    assert.equal(position.count, 48);
    assert.ok(before.some((value) => value !== 0));
    update({ obstacles: [], hazards: [hazard(1, 'electric')], pickups: [] }, 0.5);
    assert.equal(arcs.geometry.getAttribute('position'), position);
    assert.notDeepEqual(Array.from(position.array), before, 'the lightning jumps');
    for (let i = 0; i < position.count; i++)
      assert.ok(arcs.geometry.boundingSphere!.containsPoint(new THREE.Vector3().fromBufferAttribute(position, i)));
    assert.deepEqual(warnings, []);
  } finally {
    console.warn = warn;
  }
});

/** A stand-in for the zombie GLB: one skinned mesh, one bone, one clip named like the real one. */
function riggedSource() {
  const root = new THREE.Group(),
    bone = new THREE.Bone();
  bone.name = 'hip';
  const geometry = new THREE.BoxGeometry(0.18, 0.5, 0.18),
    count = geometry.attributes.position.count;
  const index = new Uint16Array(count * 4),
    weight = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) weight[i * 4] = 1;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(index, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weight, 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  root.add(bone, mesh);
  mesh.bind(new THREE.Skeleton([bone]));
  root.animations = [
    new THREE.AnimationClip('Shamble', 2, [
      new THREE.VectorKeyframeTrack('hip.position', [0, 1, 2], [0, 0, 0, 0, 0.1, 0, 0, 0, 0]),
    ]),
  ];
  return { root, geometry, material: mesh.material as THREE.Material };
}
const walker = (id: number, x: number, z = 0): Obstacle & { speed: number } => ({
  id,
  x,
  z,
  width: 0.34,
  depth: 0.34,
  hp: 1,
  maxHp: 1,
  material: 'wood',
  speed: 0.5,
});
const skinnedIn = (group: THREE.Object3D) => {
  const found: THREE.SkinnedMesh[] = [];
  group.traverse((child) => {
    if (child instanceof THREE.SkinnedMesh) found.push(child);
  });
  return found;
};

test('walking obstacles animate in place, take rigged bodies when the model lands, and recycle them', async () => {
  const scene = new THREE.Scene(),
    make = () => new THREE.Texture();
  let resolve!: (value: THREE.Object3D) => void;
  const props = createPropInstaller({
    model: () => new Promise<THREE.Object3D>((r) => (resolve = r)),
    texture: () => Promise.reject(new Error('no textures')),
  });
  const arena = new ArenaVisuals(scene, { wood: make, smoke: make }, props);
  const horde = [walker(1, 2), walker(2, 2, 0.5)];
  const update = (clock = 0) => arena.update({ obstacles: structuredClone(horde), hazards: [], pickups: [] }, clock, 1 / 60);

  // The crate stands in until the model arrives.
  update();
  const groups = [...arena.obstacles.values()].map((visual) => visual.group);
  assert.equal(groups.length, 2);
  assert.deepEqual(skinnedIn(scene), []);
  assert.ok(groups[0].children.length > 0, 'the crate is drawn');

  const { root, geometry, material } = riggedSource();
  resolve(root);
  await props.settled();

  // Walking moves and turns the same visual rather than rebuilding it, and each body plays its own clip.
  for (const body of horde) body.x -= 0.02;
  update(1 / 60);
  assert.deepEqual(
    [...arena.obstacles.values()].map((visual) => visual.group),
    groups,
    'a step never rebuilds the visual',
  );
  const bodies = skinnedIn(scene);
  assert.equal(bodies.length, 2, 'one clone per walker');
  assert.notEqual(bodies[0].skeleton, bodies[1].skeleton, 'each clone owns its skeleton');
  assert.equal(bodies[0].geometry, geometry, 'geometry stays shared with the source');
  assert.equal(groups[0].position.x, horde[0].x);
  // The model faces +z after glTF's turn, so walking down -x points it a quarter turn clockwise.
  assert.ok(Math.abs(groups[0].rotation.y - Math.atan2(-1, 0)) < 1e-9);
  const hips = groups.map((group) => {
    let bone: THREE.Bone | undefined;
    group.traverse((child) => {
      if (child instanceof THREE.Bone) bone ??= child;
    });
    return bone!;
  });
  assert.notEqual(hips[0].position.y, hips[1].position.y, 'ids start the clip at different points');

  // A dead body hands its clone back; the next id reuses it instead of cloning again.
  const retired = bodies[1];
  horde.pop();
  update(2 / 60);
  assert.equal(skinnedIn(scene).length, 1);
  horde.push(walker(3, 2, -0.5));
  update(3 / 60);
  horde[1].x -= 0.02;
  update(4 / 60);
  const reused = skinnedIn(scene);
  assert.equal(reused.length, 2);
  assert.ok(reused.includes(retired), 'the pooled body comes back rather than a fresh skeleton');

  const disposed = new Set<THREE.BufferGeometry | THREE.Material>();
  for (const resource of [geometry, material]) resource.addEventListener('dispose', () => disposed.add(resource));
  arena.dispose();
  assert.equal(scene.children.length, 0);
  assert.deepEqual([...disposed], [geometry, material], 'the shared model is freed once, at teardown');
});

test('the drawn ramp is the same wedge the simulation collides against', () => {
  const { arena, update } = harness();
  const ramp = hazard(1, 'ramp');
  update({ obstacles: [], hazards: [ramp], pickups: [] });
  const group = arena.hazards.get(1)!.group;
  const corners = rampCorners(ramp).flat();
  const wedge = group.children.find(
    (child) => child instanceof THREE.Mesh && child.geometry.getAttribute('position')?.count === 6,
  ) as THREE.Mesh;
  assert.ok(wedge, 'the ramp draws a six-cornered wedge');
  assert.deepEqual([...wedge.geometry.getAttribute('position').array], corners.map((n) => Math.fround(n)));
  // The group carries the ramp onto the table, so the mesh vertices are in the simulation's ramp frame.
  assert.deepEqual([group.position.x, group.position.z], [ramp.x, ramp.z]);
  assert.equal(group.rotation.y, -ramp.angle!);
});
