import * as THREE from 'three';
import { PUB_LAYOUT } from './pub-layout';

export const PUB_BOUNDS = PUB_LAYOUT.bounds;
export function pubCutaway(camera: { x: number; y: number; z: number }) {
  return {
    left: camera.x > PUB_BOUNDS.left + 0.45,
    right: camera.x < PUB_BOUNDS.right - 0.45,
    back: camera.z > PUB_BOUNDS.back + 0.45,
    front: camera.z < PUB_BOUNDS.front - 0.45,
    ceiling: camera.y < PUB_BOUNDS.ceiling - 0.65,
  };
}

/** Keep the hanging fixture in oblique views, but remove its silhouette before it covers the table. */
export function billiardFixtureVisible(camera: THREE.Camera): boolean {
  if (camera instanceof THREE.OrthographicCamera) return false;
  const table = new THREE.Box2(),
    fixture = new THREE.Box2();
  for (const x of [-6.45, 6.45])
    for (const z of [-3.5, 3.5]) {
      const p = new THREE.Vector3(x, 0.4, z).project(camera);
      table.expandByPoint(new THREE.Vector2(p.x, p.y));
    }
  for (const x of [-3, 3])
    for (const y of [3.75, 6.25])
      for (const z of [-0.86, 0.86]) {
        const p = new THREE.Vector3(x, y, z).project(camera);
        fixture.expandByPoint(new THREE.Vector2(p.x, p.y));
      }
  table.expandByScalar(0.012);
  return !table.intersectsBox(fixture);
}
const fixtureViews = new WeakMap<THREE.Group, { view: THREE.Matrix4; projection: THREE.Matrix4 }>();
export function updateBilliardFixture(group: THREE.Group, camera: THREE.Camera): void {
  const last = fixtureViews.get(group);
  if (last && last.view.equals(camera.matrixWorldInverse) && last.projection.equals(camera.projectionMatrix)) return;
  group.visible = billiardFixtureVisible(camera);
  if (last) {
    last.view.copy(camera.matrixWorldInverse);
    last.projection.copy(camera.projectionMatrix);
  } else
    fixtureViews.set(group, { view: camera.matrixWorldInverse.clone(), projection: camera.projectionMatrix.clone() });
}
