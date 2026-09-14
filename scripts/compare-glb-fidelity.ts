/** Worst per-vertex differences between an original GLB and its re-encoded copy, both decoded by the
 * runtime's GLTFLoader + MeshoptDecoder, in each file's own world space. Vertices may be reordered, so
 * each re-encoded vertex is matched to the closest original vertex of the same mesh and material.
 * Run: node --import tsx scripts/compare-glb-fidelity.ts original.glb encoded.glb
 * Prints {"positionMm","normalDegrees","uv"}; nulls when a vertex has no original within 3 mm. */
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { installHeadlessPubAssets } from '../tests/headless-pub-assets';

installHeadlessPubAssets();
type Vertex = [x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number];

async function meshes(file: string) {
  const bytes = fs.readFileSync(file),
    loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  // Images are irrelevant here; skip decoding them.
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const { scene } = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  scene.updateMatrixWorld(true);
  const result = new Map<string, Vertex[]>(),
    position = new THREE.Vector3(),
    normal = new THREE.Vector3();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const { attributes } = object.geometry as THREE.BufferGeometry,
      normalMatrix = new THREE.Matrix3().getNormalMatrix(object.matrixWorld);
    const vertices: Vertex[] = [];
    for (let i = 0; i < attributes.position.count; i++) {
      position.fromBufferAttribute(attributes.position, i).applyMatrix4(object.matrixWorld);
      if (attributes.normal) normal.fromBufferAttribute(attributes.normal, i).applyMatrix3(normalMatrix).normalize();
      else normal.set(0, 0, 0);
      vertices.push([
        ...position.toArray(),
        ...normal.toArray(),
        attributes.uv?.getX(i) ?? 0,
        attributes.uv?.getY(i) ?? 0,
      ] as Vertex);
    }
    const key = `${object.name}|${(object.material as THREE.Material).name}`;
    result.set(key, [...(result.get(key) ?? []), ...vertices]);
  });
  return result;
}

const [originalFile, encodedFile] = process.argv.slice(2);
const original = await meshes(originalFile),
  encoded = await meshes(encodedFile);
const CELL = 0.002,
  cell = (value: number) => Math.round(value / CELL);
let positionMm = 0,
  normalDegrees = 0,
  uv = 0,
  unmatched = original.size !== encoded.size;
for (const [key, vertices] of encoded) {
  const grid = new Map<string, Vertex[]>();
  for (const vertex of original.get(key) ?? []) {
    const id = `${cell(vertex[0])},${cell(vertex[1])},${cell(vertex[2])}`;
    grid.set(id, [...(grid.get(id) ?? []), vertex]);
  }
  for (const vertex of vertices) {
    let best: [number, number, number] | undefined,
      score = Infinity;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          for (const candidate of grid.get(`${cell(vertex[0]) + dx},${cell(vertex[1]) + dy},${cell(vertex[2]) + dz}`) ??
            []) {
            const mm = Math.hypot(vertex[0] - candidate[0], vertex[1] - candidate[1], vertex[2] - candidate[2]) * 1000;
            const degrees = THREE.MathUtils.radToDeg(
              Math.acos(
                THREE.MathUtils.clamp(
                  vertex[3] * candidate[3] + vertex[4] * candidate[4] + vertex[5] * candidate[5],
                  -1,
                  1,
                ),
              ),
            );
            const du = Math.hypot(vertex[6] - candidate[6], vertex[7] - candidate[7]);
            // Each difference relative to its acceptance limit, so seams pick their own normal and UV.
            const relative = mm / 1 + degrees / 0.25 + du / 5e-4;
            if (relative < score) {
              score = relative;
              best = [mm, degrees, du];
            }
          }
        }
    if (!best) {
      unmatched = true;
      continue;
    }
    positionMm = Math.max(positionMm, best[0]);
    normalDegrees = Math.max(normalDegrees, best[1]);
    uv = Math.max(uv, best[2]);
  }
}
console.log(
  JSON.stringify(unmatched ? { positionMm: null, normalDegrees: null, uv: null } : { positionMm, normalDegrees, uv }),
);
