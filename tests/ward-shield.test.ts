import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { initialState, cueBallId, type GameState, type TableEvent } from '../src/simulation/types';
import { createArcade } from '../src/simulation/arcade';
import { WardShield } from '../src/render/ward-shield';

function warded(owner: 0 | 1, turn: 0 | 1 = owner, ward = 1): GameState {
  const state = initialState('ward-test');
  state.turn = turn;
  state.arcade = createArcade();
  state.arcade.buffs[owner].ward = ward;
  return state;
}
/** Settle the fade so `strength` is not still ramping when the assertion runs. */
function settle(shield: WardShield, state: GameState, frames = 60) {
  for (let i = 0; i < frames; i++) shield.update(state, 1 / 60);
}
/** Every shell in the rig, in construction order: cue ball first, black second. */
function shells(scene: THREE.Scene) {
  const found: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[] = [];
  scene.traverse((object) => {
    const material = (object as THREE.Mesh).material as THREE.Material | undefined;
    if (material instanceof THREE.ShaderMaterial && material.uniforms.uImpact)
      found.push(object as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>);
  });
  return found;
}

test('the shield rides the striker cue ball and the black on its owner turn', () => {
  const scene = new THREE.Scene(),
    shield = new WardShield(scene),
    state = warded(0);
  settle(shield, state);
  const rigs = shells(scene);
  assert.equal(rigs.length, 2);
  for (const shell of rigs) assert.ok(shell.material.uniforms.uStrength.value > 0.9);
  const cue = state.balls[cueBallId(state)],
    black = state.balls.find((b) => b.id === 8)!;
  assert.ok(rigs[0].parent!.position.distanceTo(new THREE.Vector3(cue.x, 0.18, cue.z)) < 1e-6);
  assert.ok(rigs[1].parent!.position.distanceTo(new THREE.Vector3(black.x, 0.18, black.z)) < 1e-6);
  shield.dispose();
});

test('it hides on the other player turn and returns when the owner is back', () => {
  const scene = new THREE.Scene(),
    shield = new WardShield(scene);
  const mine = warded(0, 0),
    theirs = warded(0, 1);
  settle(shield, mine);
  const shell = shells(scene)[0];
  assert.ok(shell.material.uniforms.uStrength.value > 0.9, 'shown for the owner');
  settle(shield, theirs);
  assert.ok(shell.material.uniforms.uStrength.value < 0.01, 'hidden for the opponent');
  assert.equal(scene.children[0].visible, false);
  settle(shield, mine);
  assert.ok(shell.material.uniforms.uStrength.value > 0.9, 'back on the owner turn');
  assert.equal(scene.children[0].visible, true);
  shield.dispose();
});

test('no ward means nothing is drawn', () => {
  const scene = new THREE.Scene(),
    shield = new WardShield(scene),
    state = warded(0, 0, 0);
  settle(shield, state);
  assert.equal(scene.children[0].visible, false);
  shield.dispose();
});

test('a ward-tagged save event ripples the shield it hit', () => {
  const scene = new THREE.Scene(),
    shield = new WardShield(scene),
    state = warded(1, 1);
  settle(shield, state);
  const shell = shells(scene)[1];
  const save: TableEvent = { kind: 'power', power: 'ward', ball: 8, x: 5.66, z: 2.82, strength: 1, time: 0 };
  // A ball this shield is not on, and an untagged pocket event, must leave it alone.
  shield.handleEvent({ ...save, ball: 3 });
  shield.handleEvent({ ...save, power: undefined, status: undefined, kind: 'pocket' });
  shield.update(state, 1 / 60);
  assert.ok(shell.material.uniforms.uImpact.value > 8, 'unrelated events do not ripple');
  assert.ok(shell.material.uniforms.uFlash.value < 0.01, 'and do not flare');
  shield.handleEvent(save);
  shield.update(state, 1 / 60);
  assert.ok(shell.material.uniforms.uImpact.value < 0.1, 'the ripple restarted');
  assert.ok(shell.material.uniforms.uFlash.value > 0.5, 'the impact flared');
  const dir = shell.material.uniforms.uImpactDir.value as THREE.Vector3;
  assert.ok(Math.abs(dir.length() - 1) < 1e-6, 'the ripple has a direction');
  // It fades rather than latching on.
  settle(shield, state, 90);
  assert.ok(shell.material.uniforms.uFlash.value < 0.01, 'the flare fades');
  shield.dispose();
});

test('billiards uses the striker own cue ball rather than ball 0', () => {
  const scene = new THREE.Scene(),
    shield = new WardShield(scene),
    state = warded(1, 1);
  state.mode = 'billiards';
  Object.assign(
    state.balls.find((b) => b.id === 2)!,
    { x: -1.2, z: 0.4 },
  );
  assert.equal(cueBallId(state), 2);
  settle(shield, state);
  assert.ok(shells(scene)[0].parent!.position.distanceTo(new THREE.Vector3(-1.2, 0.18, 0.4)) < 1e-6);
  shield.dispose();
});

test('dispose detaches the group and frees every geometry and material', () => {
  const scene = new THREE.Scene(),
    shield = new WardShield(scene);
  const disposed = new Set<THREE.BufferGeometry | THREE.Material>();
  const tracked = new Set<THREE.BufferGeometry | THREE.Material>();
  settle(shield, warded(0), 2);
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    for (const resource of [mesh.geometry, ...(Array.isArray(mesh.material) ? mesh.material : [mesh.material])])
      if (resource && !tracked.has(resource)) {
        tracked.add(resource);
        resource.addEventListener('dispose', () => disposed.add(resource));
      }
  });
  assert.ok(tracked.size >= 4);
  shield.dispose();
  assert.equal(scene.children.length, 0);
  for (const resource of tracked) assert.ok(disposed.has(resource), 'every resource released');
});
