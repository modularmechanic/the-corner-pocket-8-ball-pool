import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OverdriveFire, type BurnMark } from '../src/render/overdrive-fire';
import { createArcade } from '../src/simulation/arcade';
import { cueBallId, initialState, type GameState } from '../src/simulation/types';

function harness() {
  const scene = new THREE.Scene(),
    fire = new OverdriveFire(scene),
    camera = new THREE.PerspectiveCamera();
  const state: GameState = initialState('burn-test');
  state.arcade = createArcade('crossfire', 'burn-test', 3);
  const cue = state.balls[cueBallId(state)];
  const group = scene.getObjectByName('overdrive-fire');
  assert.ok(group, 'the module adds one named group to the scene');
  const mesh = (name: string) => group!.getObjectByName(name) as THREE.InstancedMesh;
  const step = (seconds = 1 / 60, steps = 1) => {
    for (let i = 0; i < steps; i++) fire.update(state, seconds, camera);
  };
  /** Push the cue ball along +x at `speed`, exactly as the render loop sees it mid-shot. */
  const roll = (distance: number, speed = 6, dt = 1 / 60) => {
    for (let travelled = 0; travelled < distance; travelled += speed * dt) {
      cue.x += speed * dt;
      cue.vx = speed;
      fire.update(state, dt, camera);
    }
  };
  return { scene, fire, state, cue, group: group!, mesh, step, roll };
}

test('nothing is drawn on clean cloth', () => {
  const { mesh, step } = harness();
  step(1 / 60, 10);
  for (const name of ['overdrive-char', 'overdrive-embers', 'overdrive-flames', 'overdrive-smoke'])
    assert.equal(mesh(name).count, 0, `${name} idles at zero instances`);
});

test('an overdrive cue ball burns marks into the cloth and keeps them after the shot', () => {
  const { state, cue, mesh, step, roll } = harness();
  state.phase = 'rolling';
  state.arcade!.activeShot.overdrive = true;
  cue.x = -4;
  roll(3);
  const burned = mesh('overdrive-char').count;
  assert.ok(burned >= 8, `a three-unit roll leaves a trail of marks, got ${burned}`);
  assert.ok(mesh('overdrive-embers').count > 0, 'fresh marks still glow');
  assert.ok(mesh('overdrive-flames').count > 0, 'the ball is visibly alight while rolling');
  // The shot ends: the fire goes out, the damage does not.
  state.phase = 'ready';
  state.arcade!.activeShot.overdrive = false;
  cue.vx = 0;
  step(1 / 60, 90);
  assert.equal(mesh('overdrive-flames').count, 0, 'the flames stop with the buff');
  assert.equal(mesh('overdrive-char').count, burned, 'every scorch mark persists after the shot');
});

test('embers cool to cold char while the char stays', () => {
  const { state, cue, mesh, step, roll } = harness();
  state.phase = 'rolling';
  state.arcade!.activeShot.overdrive = true;
  cue.x = -4;
  roll(1.5);
  const hot = mesh('overdrive-embers').count;
  state.phase = 'ready';
  state.arcade!.activeShot.overdrive = false;
  cue.vx = 0;
  step(0.05, 200);
  assert.ok(hot > 0 && mesh('overdrive-embers').count === 0, 'the coals go out');
  assert.ok(mesh('overdrive-char').count > 0, 'the burn itself is permanent damage');
});

test('the live mark count is capped and the oldest fade out', () => {
  const { state, cue, mesh, roll } = harness();
  state.phase = 'rolling';
  state.arcade!.activeShot.overdrive = true;
  cue.x = -5;
  // Far more travel than the budget: it must cap, not grow without bound.
  for (let lap = 0; lap < 12; lap++) {
    cue.x = -5;
    roll(10);
  }
  assert.ok(mesh('overdrive-char').count <= 96, 'never exceeds the decal capacity');
  assert.ok(mesh('overdrive-char').count >= 60, 'still shows a full trail of damage');
});

test('simulation burns drive the marks when supplied, keyed by id', () => {
  const { state, mesh, step } = harness();
  const burns: BurnMark[] = [
    { id: 1, x: -2, z: 0.5, radius: 0.25, heat: 1 },
    { id: 2, x: -1, z: 0.5, radius: 0.25, heat: 0.4 },
  ];
  (state.arcade as unknown as { burns: BurnMark[] }).burns = burns;
  step(1 / 60, 2);
  assert.equal(mesh('overdrive-char').count, 2, 'one decal per simulation burn');
  // The same ids again must reuse their slots rather than pile up duplicates.
  step(1 / 60, 20);
  assert.equal(mesh('overdrive-char').count, 2, 'stable ids do not accumulate decals');
  burns.push({ id: 3, x: 0, z: 0.5, radius: 0.25, heat: 1 });
  step(1 / 60, 2);
  assert.equal(mesh('overdrive-char').count, 3, 'a new burn adds a decal');
  // A cooled burn the simulation drops fades out instead of popping.
  burns.shift();
  step(1 / 60, 2);
  assert.equal(mesh('overdrive-char').count, 3, 'a dropped burn is still fading');
  step(0.05, 30);
  assert.equal(mesh('overdrive-char').count, 2, 'and is gone once it has faded');
});

test('a malformed burn record is ignored rather than drawn at the origin', () => {
  const { state, mesh, step } = harness();
  (state.arcade as unknown as { burns: unknown[] }).burns = [
    { id: 1, x: Number.NaN, z: 0, radius: 0.2, heat: 1 },
    { id: 2, x: 1, z: 1 },
  ];
  step(1 / 60, 2);
  assert.equal(mesh('overdrive-char').count, 1, 'only the usable record is drawn');
  assert.ok(mesh('overdrive-char').count > 0);
});

test('the buff landing fires an ignition burst exactly once', () => {
  const { state, fire, group, mesh, step } = harness();
  step(1 / 60, 2);
  assert.equal(mesh('overdrive-flames').count, 0);
  state.arcade!.buffs[0].overdrive = 1;
  step(1 / 60);
  const shock = group.children.find((child) => child instanceof THREE.Mesh && 'RingGeometry' === child.geometry.type);
  assert.ok(mesh('overdrive-flames').count > 20, 'the landing throws a real burst of fire');
  assert.ok(shock?.visible, 'and an expanding shockwave ring');
  assert.ok(mesh('overdrive-char').count > 0, 'the cloth is scorched where it landed');
  const burst = mesh('overdrive-flames').count;
  step(1 / 60, 2);
  // Two frames of the steady burn add a handful of licks; a second burst would add dozens.
  assert.ok(mesh('overdrive-flames').count < burst + 20, 'the burst does not retrigger while the buff is held');
  fire.dispose();
});

test('a rack reset wipes the cloth clean', () => {
  const { state, fire, cue, mesh, roll, step } = harness();
  state.phase = 'rolling';
  state.arcade!.activeShot.overdrive = true;
  cue.x = -4;
  roll(2);
  assert.ok(mesh('overdrive-char').count > 0);
  fire.clear();
  state.phase = 'ready';
  state.arcade!.activeShot.overdrive = false;
  step();
  assert.equal(mesh('overdrive-char').count, 0, 'no scorch survives a new rack');
  assert.equal(mesh('overdrive-flames').count, 0);
});

test('dispose releases the group and its resources', () => {
  const { scene, fire, group } = harness();
  const disposed = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
  const track = (resource: THREE.BufferGeometry | THREE.Material | THREE.Texture) =>
    resource.addEventListener('dispose', () => disposed.add(resource));
  const expected: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.geometry) return;
    expected.push(mesh.geometry, mesh.material as THREE.Material);
    const map = (mesh.material as THREE.MeshBasicMaterial).map;
    if (map) expected.push(map);
  });
  for (const resource of expected) track(resource);
  fire.dispose();
  assert.equal(scene.getObjectByName('overdrive-fire'), undefined, 'the group leaves the scene');
  for (const resource of expected) assert.ok(disposed.has(resource), `${resource.type} was disposed`);
});

test('a table with no arcade state costs nothing', () => {
  const scene = new THREE.Scene(),
    fire = new OverdriveFire(scene);
  const state = initialState('plain-eight-ball');
  for (let i = 0; i < 30; i++) fire.update(state, 1 / 60);
  const group = scene.getObjectByName('overdrive-fire')!;
  for (const child of group.children) assert.equal(child.visible, false, `${child.name || child.type} stays hidden`);
  fire.dispose();
});
