import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface PubBatchResult {
  before: number;
  after: number;
  saved: number;
}
const retiredGeometry = new WeakMap<THREE.Object3D, Set<THREE.BufferGeometry>>();
const reports = new WeakMap<THREE.Object3D, PubBatchResult[]>();

/** Main-pass submissions, before frustum culling or shadow/reflection passes. */
export function countPubDraws(root: THREE.Object3D): number {
  let count = 0;
  root.traverseVisible((object) => {
    if (!(object instanceof THREE.Mesh) || (object instanceof THREE.InstancedMesh && object.count === 0)) return;
    const materials = Array.isArray(object.material)
      ? object.geometry.groups.map((group: { materialIndex?: number }) =>
          object.material instanceof Array ? object.material[group.materialIndex ?? 0] : object.material,
        )
      : [object.material];
    for (const material of materials)
      if (material?.visible)
        count += material.transparent && material.side === THREE.DoubleSide && !material.forceSinglePass ? 2 : 1;
  });
  return count;
}

/** Explicitly static scope only. `children` preserves each child group's transform,
 * visibility and animation; `subtree` is for one indivisible cutaway/prop section.
 * Animated screens opt out using userData.pubDynamic. Transparent objects retain
 * their original sorting boundaries and are never merged or newly instanced. */
export function batchPubStatic(root: THREE.Object3D, scope: 'children' | 'subtree' = 'children'): PubBatchResult {
  const before = countPubDraws(root),
    objects: THREE.Mesh[] = [];
  root.updateWorldMatrix(true, true);
  const visit = (object: THREE.Object3D) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.SkinnedMesh || Array.isArray(object.material))
      return;
    if (!object.visible || object.userData.pubDynamic || object.children.length || object.morphTargetInfluences?.length)
      return;
    if (
      !object.geometry.attributes.position ||
      object.customDepthMaterial ||
      object.customDistanceMaterial ||
      object.matrixWorld.determinant() < 0
    )
      return;
    for (let parent = object.parent; parent && parent !== root; parent = parent.parent)
      if (!parent.visible || parent.userData.pubDynamic) return;
    if (object.material.transparent || ('transmission' in object.material && Number(object.material.transmission) > 0))
      return;
    if (object.geometry.drawRange.start !== 0 || Number.isFinite(object.geometry.drawRange.count)) return;
    if (object instanceof THREE.InstancedMesh && (object.instanceColor || object.morphTexture)) return;
    if (
      object.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender ||
      object.onAfterRender !== THREE.Object3D.prototype.onAfterRender
    )
      return;
    objects.push(object);
  };
  if (scope === 'subtree') root.traverse(visit);
  else root.children.forEach(visit);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert(),
    local = new THREE.Matrix4(),
    instance = new THREE.Matrix4();
  const flags = (mesh: THREE.Mesh) =>
    `${(mesh.material as THREE.Material).uuid}/${mesh.castShadow}/${mesh.receiveShadow}/${mesh.layers.mask}/${mesh.renderOrder}/${mesh.frustumCulled}`;
  const configure = (target: THREE.Mesh, source: THREE.Mesh) => {
    target.castShadow = source.castShadow;
    target.receiveShadow = source.receiveShadow;
    target.layers.mask = source.layers.mask;
    target.renderOrder = source.renderOrder;
    target.frustumCulled = source.frustumCulled;
    target.matrixAutoUpdate = false;
    if (target instanceof THREE.InstancedMesh) target.userData.staticInstances = true;
    target.name = `pub-batch:${(source.material as THREE.Material).name || source.name || (source.material as THREE.Material).type}`;
  };
  const retire = (mesh: THREE.Mesh) => {
    let geometries = retiredGeometry.get(root);
    if (!geometries) {
      geometries = new Set();
      retiredGeometry.set(root, geometries);
    }
    geometries.add(mesh.geometry);
    mesh.removeFromParent();
    if (mesh instanceof THREE.InstancedMesh) mesh.dispose();
  };
  // Reuse real authored geometry. This combines cabinet copies and existing
  // single-instance picture frames without expanding their vertex buffers.
  const repeated = new Map<string, THREE.Mesh[]>();
  for (const object of objects) {
    const key = `${flags(object)}/${object.geometry.uuid}`;
    const group = repeated.get(key) ?? [];
    group.push(object);
    repeated.set(key, group);
  }
  const instanced = new Set<THREE.Mesh>();
  for (const group of repeated.values()) {
    if (group.length < 2) continue;
    const count = group.reduce((sum, mesh) => sum + (mesh instanceof THREE.InstancedMesh ? mesh.count : 1), 0);
    const mesh = new THREE.InstancedMesh(group[0].geometry, group[0].material, count);
    configure(mesh, group[0]);
    let index = 0;
    for (const original of group) {
      local.multiplyMatrices(inverse, original.matrixWorld);
      if (original instanceof THREE.InstancedMesh)
        for (let i = 0; i < original.count; i++) {
          original.getMatrixAt(i, instance);
          mesh.setMatrixAt(index++, new THREE.Matrix4().multiplyMatrices(local, instance));
        }
      else mesh.setMatrixAt(index++, local);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    for (const original of group) {
      instanced.add(original);
      retire(original);
    }
    root.add(mesh);
  }
  const mergeable = new Map<string, THREE.Mesh[]>();
  for (const object of objects) {
    if (instanced.has(object) || object instanceof THREE.InstancedMesh) continue;
    if (
      Object.values(object.geometry.attributes).some(
        (attribute) => attribute instanceof THREE.InterleavedBufferAttribute,
      )
    )
      continue;
    // Attribute schemas must agree; no dropped UVs, normals, colours or tangents.
    const schema = Object.entries(object.geometry.attributes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([name, attribute]) =>
          `${name}:${attribute.itemSize}:${attribute.normalized}:${attribute.array.constructor.name}`,
      )
      .join('|');
    const key = `${flags(object)}/${schema}`;
    const group = mergeable.get(key) ?? [];
    group.push(object);
    mergeable.set(key, group);
  }
  for (const group of mergeable.values()) {
    if (group.length < 2) continue;
    // Bound upload/merge work; exceptionally large authored meshes remain intact.
    const vertices = group.reduce(
      (sum, mesh) => sum + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count),
      0,
    );
    if (vertices > 250_000) continue;
    const parts = group.map((object) => {
      const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
      // Quantized GLB attributes are normalized integers holding only [-1,1], with the mesh offset and
      // scale on its node. Baking the world matrix into them would wrap positions around the origin.
      // Today only the gallery prints get here (applyPoolPhotoRegion de-interleaves them): the compressed
      // GLBs load positions and normals interleaved, and interleaved meshes are never merged (above).
      for (const [name, attribute] of Object.entries(geometry.attributes))
        if (attribute.normalized || !(attribute.array instanceof Float32Array)) {
          const values = new Float32Array(attribute.count * attribute.itemSize);
          for (let i = 0; i < values.length; i++)
            values[i] = attribute.getComponent(Math.floor(i / attribute.itemSize), i % attribute.itemSize);
          geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
        }
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld));
      return geometry;
    });
    const geometry = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    // Commit only after a successful merge. Failed batches keep their originals.
    if (!geometry) continue;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, group[0].material);
    configure(mesh, group[0]);
    for (const original of group) retire(original);
    root.add(mesh);
  }
  const after = countPubDraws(root),
    result = { before, after, saved: before - after };
  const history = reports.get(root) ?? [];
  history.push(result);
  reports.set(root, history);
  return result;
}

/** Original buffers can also be shared outside a batch. Keep them until the
 * owning room's normal disposal, then release each resource once via its Set. */
export function collectRetiredPubGeometry(root: THREE.Object3D, geometries: Set<THREE.BufferGeometry>): void {
  root.traverse((object) => {
    for (const geometry of retiredGeometry.get(object) ?? []) geometries.add(geometry);
    retiredGeometry.delete(object);
  });
}

export function pubBatchDiagnostics(root: THREE.Object3D) {
  const sections: { name: string; before: number; after: number; saved: number }[] = [];
  root.traverse((object) => {
    for (const result of reports.get(object) ?? [])
      if (result.saved) sections.push({ name: object.name || 'static pub props', ...result });
  });
  return {
    visibleDrawCalls: countPubDraws(root),
    constructionSubmissionsRemoved: sections.reduce((sum, section) => sum + section.saved, 0),
    sections,
  };
}
