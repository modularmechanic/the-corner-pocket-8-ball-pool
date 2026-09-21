import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clampOrbit, fitTableCamera, maxDistanceInsideRoom, orbitDirection } from '../src/render/camera';
import { EIGHT_BALL_TABLE, SNOOKER_TABLE } from '../src/simulation/modes/table';
import { PUB_LAYOUT } from '../src/render/pub-layout';

const { bounds, floor } = PUB_LAYOUT;
/** Inside the walls and above the floor. The CEILING is deliberately not a limit: `pubCutaway` lifts the
 * roof once the camera clears it, so a high orbit looks down into the room rather than at the outside of a
 * box — and under a ten-unit ceiling no portrait viewport could frame the table otherwise. What must never
 * happen is passing a WALL, which is what shows the exterior shell and the void behind it. */
const inside = (p: THREE.Vector3) =>
  p.x > bounds.left && p.x < bounds.right && p.z > bounds.back && p.z < bounds.front && p.y > floor;

/** Every orbit the player can reach, at the pitches `clampOrbit` allows. */
function* orbits() {
  for (let step = 0; step < 48; step++) {
    const yaw = -Math.PI + (step * Math.PI * 2) / 48;
    for (const degrees of [22, 30, 38, 45, 52, 60, 70, 78])
      yield orbitDirection(clampOrbit({ yaw, pitch: (degrees * Math.PI) / 180 }));
  }
}

// Framing is analytic and will happily ask for a distance that puts the eye through a wall — which shows
// the outside of the room box and the void behind it. The room is the hard limit.
test('the framing camera never passes a wall, on any table', () => {
  for (const [name, spec] of [
    ['eight-ball', EIGHT_BALL_TABLE],
    ['snooker', SNOOKER_TABLE],
  ] as const)
    for (const aspect of [21 / 9, 16 / 9, 4 / 3, 3 / 4])
      for (const direction of orbits()) {
        const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 500);
        fitTableCamera(camera, new THREE.Vector3(0, 0, 0), direction, aspect, spec);
        assert.ok(
          inside(camera.position),
          `${name} at aspect ${aspect.toFixed(2)} escaped to (${camera.position.x.toFixed(2)}, ${camera.position.y.toFixed(2)}, ${camera.position.z.toFixed(2)}); walls are x ${bounds.left.toFixed(1)}..${bounds.right.toFixed(1)}, z ${bounds.back.toFixed(1)}..${bounds.front.toFixed(1)}, floor ${floor}`,
        );
      }
});

test('the room limit is the binding one only when framing asks for more than fits', () => {
  const target = new THREE.Vector3(0, 0, 0);
  // Straight along +x, the limit is the right wall less its margin.
  const limit = maxDistanceInsideRoom(target, new THREE.Vector3(1, 0, 0));
  assert.ok(limit < bounds.right, `expected a limit inside the right wall, got ${limit}`);
  assert.ok(limit > bounds.right - 1.5, `expected the limit close to the wall, got ${limit}`);
  // A ray parallel to every wall it never meets is unbounded rather than zero.
  assert.equal(maxDistanceInsideRoom(target, new THREE.Vector3(0, 0, 0)), Infinity);
});
