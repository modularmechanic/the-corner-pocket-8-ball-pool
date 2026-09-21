/**
 * Step 1 of the lightmap bake: get the procedural room into a file Blender can open.
 *
 * The pub is built in TypeScript at runtime, so there is nothing on disk to bake. This runs the real
 * `buildPub` headlessly — the same code path the browser runs, with the same layout constants — and
 * writes what it produced: one GLB of the static room, and a JSON of its lights (glTF cannot carry
 * three's RectAreaLight, and the intensity units need converting anyway).
 *
 * Only the room is exported. The table, cloth, balls and cue are mode-dependent or moving, so they keep
 * their real-time lighting and are not in the bake at all — not as targets, not as occluders.
 *
 * Run through `tools/bake-lighting/bake.sh`, not directly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { installHeadlessPubAssets } from '../../tests/headless-pub-assets';
import { createPropInstaller } from '../../src/render/asset-installer';
import { buildPub } from '../../src/render/pub';
import { lightmapMeshKey, LIGHTMAP_TARGETS } from '../../src/render/baked-lighting';

const outDir = fileURLToPath(new URL('./.cache/', import.meta.url));

// Node has Blob but not FileReader, and GLTFExporter uses one solely to read its finished blob.
if (!('FileReader' in globalThis))
  Object.defineProperty(globalThis, 'FileReader', {
    configurable: true,
    value: class {
      result: ArrayBuffer | null = null;
      onloadend: (() => void) | null = null;
      readAsArrayBuffer(blob: Blob) {
        void blob.arrayBuffer().then((buffer) => {
          this.result = buffer;
          this.onloadend?.();
        });
      }
    },
  });

/** three's photometric units to Cycles' radiometric watts.
 * Point/spot: three gives candela, irradiance = I/d². A Blender point light of P watts has
 * intensity P/(4π) per steradian, so P = 4π·I.
 * Rect area: three gives nits (cd/m²) = radiance L. A Blender area light of P watts over area A
 * emits radiance P/(A·π), so P = L·A·π. */
const pointWatts = (intensity: number) => 4 * Math.PI * intensity;
const areaWatts = (intensity: number, w: number, h: number) => intensity * w * h * Math.PI;

interface ExportedLight {
  type: 'point' | 'spot' | 'rect';
  name: string;
  position: [number, number, number];
  /** Rect and spot only: world quaternion. Rect lights face -Z, spots face -Z, same as Blender. */
  quaternion: [number, number, number, number];
  /** Linear-space RGB, already out of three's colour management. */
  color: [number, number, number];
  watts: number;
  /** Point/spot: three's `distance` cutoff, kept for reference. Cycles has no cutoff. */
  distance?: number;
  /** Spot only. */
  angle?: number;
  penumbra?: number;
  /** Rect only, in metres. */
  size?: [number, number];
  /** Soft-shadow radius. three's lights are points; a little size keeps the bake from looking stencilled. */
  radius: number;
}

function worldLights(root: THREE.Object3D): ExportedLight[] {
  const lights: ExportedLight[] = [];
  const position = new THREE.Vector3(),
    quaternion = new THREE.Quaternion(),
    scale = new THREE.Vector3();
  root.traverse((object) => {
    if (!(object instanceof THREE.Light)) return;
    let visible = object.visible;
    for (let parent = object.parent; parent; parent = parent.parent) if (!parent.visible) visible = false;
    if (!visible || object.intensity <= 0.0001) return;
    object.updateWorldMatrix(true, false);
    object.matrixWorld.decompose(position, quaternion, scale);
    const color: [number, number, number] = [object.color.r, object.color.g, object.color.b];
    const common = {
      name: object.name || object.type,
      position: position.toArray() as [number, number, number],
      quaternion: quaternion.toArray() as [number, number, number, number],
      color,
    };
    if (object instanceof THREE.RectAreaLight)
      lights.push({
        ...common,
        type: 'rect',
        watts: areaWatts(object.intensity, object.width, object.height),
        size: [object.width, object.height],
        radius: 0,
      });
    else if (object instanceof THREE.SpotLight)
      lights.push({
        ...common,
        type: 'spot',
        watts: pointWatts(object.intensity),
        distance: object.distance,
        angle: object.angle,
        penumbra: object.penumbra,
        radius: 0.05,
      });
    else if (object instanceof THREE.PointLight)
      lights.push({
        ...common,
        type: 'point',
        watts: pointWatts(object.intensity),
        distance: object.distance,
        // Bare bulbs behind glass shades. A few centimetres of source size is what softens the bounce.
        radius: 0.08,
      });
  });
  return lights;
}

/** Occluders smaller than this across are left out of the bake entirely. */
const OCCLUDER_MIN_SIZE = 0.3;

/** World-space bounding-box diagonal. */
function diagonal(mesh: THREE.Mesh): number {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  return geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld).getSize(new THREE.Vector3()).length();
}

/** World-space bounding-box area, used only to rank surfaces in the "you could also bake these" hint. */
function surfaceArea(mesh: THREE.Mesh): number {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const size = geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld).getSize(new THREE.Vector3());
  return 2 * (size.x * size.y + size.y * size.z + size.z * size.x);
}

/** One flat mesh per drawn surface, in world space, carrying only what Cycles needs: position,
 * normal, a lightmap UV for bake targets, and a plain colour for bounce tint. Instanced and merged
 * batches are expanded, because Blender bakes geometry, not draw calls. */
function collectGeometry(root: THREE.Object3D) {
  const targets: { key: string; mesh: THREE.Mesh }[] = [];
  const occluders: THREE.Mesh[] = [];
  /** Every single-instance surface with its key and world area, so a failed match can suggest fixes. */
  const candidates: { key: string; area: number }[] = [];
  const matrix = new THREE.Matrix4(),
    instance = new THREE.Matrix4();
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return;
    for (let parent = object.parent; parent; parent = parent.parent) if (!parent.visible) return;
    const source = object.geometry as THREE.BufferGeometry;
    if (!source.attributes.position) return;
    const material = (Array.isArray(object.material) ? object.material[0] : object.material) as THREE.Material & {
      color?: THREE.Color;
      transparent?: boolean;
      opacity?: number;
    };
    // Glass and neon do not make useful diffuse occluders and would darken the room wrongly.
    if (material.transparent && (material.opacity ?? 1) < 0.9) return;
    const counts = object instanceof THREE.InstancedMesh ? object.count : 1;
    // Keyed from the live mesh, exactly as the browser will key it — not from the flattened copy below.
    const key = counts === 1 ? lightmapMeshKey(object) : null;
    if (key) candidates.push({ key, area: surfaceArea(object) });
    const isTarget = !!key && LIGHTMAP_TARGETS.includes(key);
    // Bottles, glasses and tap handles cost most of the room's triangles and bounce almost no light
    // onto anything. Diffuse GI is low frequency; dropping them barely moves the result and makes the
    // intermediate file an order of magnitude smaller.
    if (!isTarget && diagonal(object) < OCCLUDER_MIN_SIZE) return;
    for (let i = 0; i < counts; i++) {
      matrix.copy(object.matrixWorld);
      if (object instanceof THREE.InstancedMesh) {
        object.getMatrixAt(i, instance);
        matrix.multiply(instance);
      }
      const geometry = (source.index ? source.toNonIndexed() : source.clone()) as THREE.BufferGeometry;
      // Only a bake target needs UVs; an occluder is just a surface light bounces off.
      const keep = isTarget ? ['position', 'normal', 'uv'] : ['position', 'normal'];
      for (const name of Object.keys(geometry.attributes)) if (!keep.includes(name)) geometry.deleteAttribute(name);
      geometry.applyMatrix4(matrix);
      geometry.computeBoundingBox();
      const colour = material.color ?? new THREE.Color(0.5, 0.5, 0.5);
      const flat = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: colour.clone(),
          roughness: 'roughness' in material ? ((material as THREE.MeshStandardMaterial).roughness ?? 0.8) : 0.8,
          metalness: 'metalness' in material ? ((material as THREE.MeshStandardMaterial).metalness ?? 0) : 0,
        }),
      );
      if (isTarget) {
        flat.name = `BAKE_${key}`;
        targets.push({ key, mesh: flat });
      } else {
        flat.name = `OCC_${occluders.length}`;
        occluders.push(flat);
      }
    }
  });
  candidates.sort((a, b) => b.area - a.area);
  return { targets, occluders, candidates };
}

async function main() {
  const errors = installHeadlessPubAssets();
  const scene = new THREE.Scene(),
    installer = createPropInstaller(),
    pub = buildPub(scene, installer);
  const settled = await installer.settled();
  if (settled.failed.length || errors.length)
    throw new Error(`props failed to load: ${[...settled.failed, ...errors].join(', ')}`);

  // The cutaway hides whichever walls the camera is behind. A bake needs the room closed.
  let collected!: ReturnType<typeof collectGeometry>;
  let lights!: ExportedLight[];
  pub.withEnclosedRoom(() => {
    scene.updateMatrixWorld(true);
    collected = collectGeometry(pub.group);
    lights = worldLights(pub.group);
  });

  const out = new THREE.Scene();
  for (const { mesh } of collected.targets) out.add(mesh);
  for (const mesh of collected.occluders) out.add(mesh);

  fs.mkdirSync(outDir, { recursive: true });
  const glb = (await new GLTFExporter().parseAsync(out, { binary: true, onlyVisible: false })) as ArrayBuffer;
  fs.writeFileSync(path.join(outDir, 'room.glb'), Buffer.from(glb));
  fs.writeFileSync(
    path.join(outDir, 'lights.json'),
    JSON.stringify({ lights, targets: collected.targets.map((t) => t.key) }, null, 1),
  );

  const found = collected.targets.map((t) => t.key);
  const missing = LIGHTMAP_TARGETS.filter((key) => !found.includes(key));
  console.log(
    `exported ${collected.targets.length} bake target(s), ${collected.occluders.length} occluder(s), ${lights.length} light(s)`,
  );
  console.log(`  -> ${path.join(outDir, 'room.glb')} (${(Buffer.from(glb).length / 1e6).toFixed(1)} MB)`);
  if (missing.length) {
    console.error(`\nNo mesh in the room matches these LIGHTMAP_TARGETS keys:`);
    for (const key of missing) console.error(`  ${key}`);
    console.error(`The room's geometry changed. The largest surfaces present now, with their keys:`);
    for (const { key } of collected.candidates.slice(0, 12)) console.error(`  ${key}`);
    console.error(`Update LIGHTMAP_TARGETS in src/render/baked-lighting.ts and re-run.`);
    process.exitCode = 1;
  }
  pub.dispose();
  installer.dispose();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
