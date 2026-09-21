import * as THREE from 'three';

/**
 * Path-traced indirect light, baked offline and applied to the static room.
 *
 * WebGL has no ray-query API, so nothing here is traced at runtime. `tools/bake-lighting/bake.sh`
 * renders the room in Blender Cycles — a real path tracer — and ships the result as a texture.
 *
 * Only the *indirect* diffuse pass is baked. The room's own lamps keep casting real-time direct light
 * and shadows exactly as before; the lightmap adds the bounce they were never able to compute, which
 * is the part three cannot do at all. That split is why the two can be added together without
 * double-counting, and why anything dynamic (table, cloth, balls, cue) is simply left out of the bake:
 * it still gets its full real-time lighting, and it was never contributing baked light to begin with.
 */

/** Identifies a surface by what it is and where it sits, so a mesh built by procedural code with no
 * stable name can still be matched between the exporter and the browser. World-space size, centre and
 * triangle count, rounded to a centimetre. If the room's geometry changes, the key changes and the
 * lightmap is silently not applied — which is the correct failure: re-run the bake. */
export function lightmapMeshKey(mesh: THREE.Mesh): string | null {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const position = geometry.attributes.position;
  if (!position) return null;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
  const size = box.getSize(new THREE.Vector3()),
    centre = box.getCenter(new THREE.Vector3());
  const n = (value: number) => (Math.round(value * 100) / 100).toFixed(2);
  const triangles = (geometry.index?.count ?? position.count) / 3;
  return `${n(size.x)}x${n(size.y)}x${n(size.z)}@${n(centre.x)},${n(centre.y)},${n(centre.z)}#${triangles}`;
}

/** Surfaces that carry a baked lightmap, by `lightmapMeshKey`. Every key here must name a mesh whose
 * UV0 is already a usable lightmap unwrap (0..1, no overlap), because that is the UV set the bake
 * writes into and the only one these meshes have. The floor is a single PlaneGeometry, so it qualifies
 * as built. Box and cylinder surfaces wrap the same 0..1 onto every face and need a generated second
 * UV set before they can be added — see the report. */
export const LIGHTMAP_TARGETS: readonly string[] = ['55.10x0.00x49.30@0.00,-3.60,-2.90#2'];

/** Where the bake writes, relative to `public/`. */
export const LIGHTMAP_TEXTURE = 'lightmaps/pub-indirect.webp';

/** The bake is in the same linear units as the room's lights, so 1 is the physically matched value.
 * It is a knob because the room is art-directed, not measured: turn it down if the bounce reads hot. */
export const LIGHTMAP_INTENSITY = 1;

const applied = new WeakSet<THREE.Material>();
let pending: Promise<THREE.Texture | null> | null = null;

function lightmapTexture(): Promise<THREE.Texture | null> {
  if (!pending)
    pending = new THREE.TextureLoader()
      .loadAsync(LIGHTMAP_TEXTURE)
      .then((texture) => {
        texture.channel = 1;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = false;
        texture.needsUpdate = true;
        return texture;
      })
      // No bake yet, or a stale path: the room keeps its real-time lighting and says so once.
      .catch(() => {
        console.warn(`[baked-lighting] no lightmap at ${LIGHTMAP_TEXTURE}; run tools/bake-lighting/bake.sh`);
        return null;
      });
  return pending;
}

/**
 * Binds the baked lightmap to any target surface under `root` that does not have it yet.
 * Safe to call repeatedly: each material is bound once, and non-target meshes are never touched.
 * Returns the number of surfaces newly bound.
 */
export function applyBakedLighting(root: THREE.Object3D): void {
  if (!LIGHTMAP_TARGETS.length) return;
  const matched: THREE.Mesh[] = [];
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return;
    const material = object.material as THREE.MeshStandardMaterial;
    if (!material || Array.isArray(material) || !('lightMap' in material) || applied.has(material)) return;
    const key = lightmapMeshKey(object);
    if (!key || !LIGHTMAP_TARGETS.includes(key)) return;
    matched.push(object);
  });
  if (!matched.length) return;
  void lightmapTexture().then((texture) => {
    if (!texture) return;
    for (const mesh of matched) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (applied.has(material)) continue;
      // The bake wrote into UV0, which for these surfaces is already a clean 0..1 unwrap.
      // three reads lightMap from uv1, so point uv1 at the same buffer rather than duplicating it.
      const geometry = mesh.geometry as THREE.BufferGeometry;
      if (!geometry.attributes.uv1 && geometry.attributes.uv) geometry.setAttribute('uv1', geometry.attributes.uv);
      material.lightMap = texture;
      material.lightMapIntensity = LIGHTMAP_INTENSITY;
      material.needsUpdate = true;
      applied.add(material);
    }
  });
}
