import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installHeadlessPubAssets } from './headless-pub-assets';
import { createPropInstaller } from '../src/render/asset-installer';
import { buildPub } from '../src/render/pub';
import { lightmapMeshKey, LIGHTMAP_TARGETS } from '../src/render/baked-lighting';

/** The lightmap is baked against the room's geometry, so it goes stale the moment that geometry moves.
 * Nothing in the browser can notice that — a mismatched key just silently skips the surface — so this
 * is where a stale bake gets caught: it fails as soon as a baked surface is resized or moved, and the
 * fix is to re-run tools/bake-lighting/bake.sh. */
test('every baked surface still exists in the room, so the shipped lightmap is not stale', async () => {
  const errors = installHeadlessPubAssets();
  const scene = new THREE.Scene(),
    installer = createPropInstaller(),
    pub = buildPub(scene, installer);
  const settled = await installer.settled();
  assert.deepEqual([settled.failed, errors], [[], []]);
  scene.updateMatrixWorld(true);

  const found = new Map<string, number>();
  pub.group.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return;
    const key = lightmapMeshKey(object);
    if (key) found.set(key, (found.get(key) ?? 0) + 1);
  });

  for (const key of LIGHTMAP_TARGETS)
    assert.equal(
      found.get(key),
      1,
      `no single surface in the room matches baked key "${key}" — re-run tools/bake-lighting/bake.sh`,
    );
  pub.dispose();
  installer.dispose();
});

test('a surface key moves with the surface, so a moved wall invalidates its bake', () => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 2));
  mesh.updateMatrixWorld(true);
  const first = lightmapMeshKey(mesh);
  assert.ok(first);
  mesh.position.x += 1;
  mesh.updateMatrixWorld(true);
  assert.notEqual(lightmapMeshKey(mesh), first, 'moving the surface changes its key');
  mesh.position.x -= 1;
  mesh.scale.set(2, 1, 1);
  mesh.updateMatrixWorld(true);
  assert.notEqual(lightmapMeshKey(mesh), first, 'resizing the surface changes its key');
});
