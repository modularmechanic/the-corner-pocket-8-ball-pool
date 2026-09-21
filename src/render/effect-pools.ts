import * as THREE from 'three';

export interface Pooled {
  age: number;
  life: number;
}
export interface Spark extends Pooled {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: THREE.Color;
}
export interface Debris extends Pooled {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Euler;
  spin: THREE.Vector3;
  scale: THREE.Vector3;
  color: THREE.Color;
  steel: boolean;
}
export interface Ripple extends Pooled {
  x: number;
  z: number;
  color: THREE.Color;
  size: number;
}

export const pool = <T extends Pooled>(length: number, create: () => Omit<T, keyof Pooled>) =>
  Array.from({ length }, () => ({ ...create(), age: 1, life: 0 }) as T);
export function nextFree(items: readonly Pooled[], from: number) {
  while (from < items.length && items[from].age < items[from].life) from++;
  return from;
}
/** One draw call per effect kind: per-instance RGBA rides in an instanced `color` attribute (vertexColors with alpha). */
export function instanced<M extends THREE.Material>(
  name: string,
  geometry: THREE.BufferGeometry,
  material: M,
  capacity: number,
) {
  geometry.setAttribute(
    'color',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage),
  );
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = name;
  mesh.count = 0;
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}
