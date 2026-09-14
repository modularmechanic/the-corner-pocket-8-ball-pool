import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createPropInstaller } from '../src/render/asset-installer';
import { createTableSurfaces } from '../src/render/table-surfaces';
import { TABLE } from '../src/simulation/types';

test('Blender baize loads high-resolution maps once and shares them with cushions', async () => {
  const pending = new Map<string, { texture: THREE.Texture; parses: number; arrive: () => void }>();
  const texture = (url: string) =>
    new Promise<THREE.Texture>((resolve) => {
      const asset = pending.get(url) ?? { texture: new THREE.Texture(), parses: 0, arrive: () => {} };
      asset.parses++;
      asset.arrive = () => resolve(asset.texture);
      pending.set(url, asset);
    });
  const installer = createPropInstaller({ model: (url) => Promise.reject(new Error(url)), texture });
  const surfaces = createTableSurfaces(installer);
  const { cloth, cushion, walnut } = surfaces;
  try {
    assert.equal(cloth.map, null, 'smooth matte placeholder replaces coarse generated nap while loading');
    for (const [name, size] of [
      ['color', 2048],
      ['normal', 1024],
      ['surface', 1024],
    ] as const) {
      const path = `textures/table/baize-${name}.png`;
      const png = readFileSync(new URL(`../public/${path}`, import.meta.url));
      assert.equal(png.readUInt32BE(16), size);
      assert.equal(png.readUInt32BE(20), size);
      const asset = pending.get(`/${path}`)!;
      assert.ok(asset, `loads ${name} bake`);
      assert.equal(asset.parses, 1);
      asset.arrive();
    }
    const grain = walnut.map!;
    for (const path of ['/wood-color.jpg', '/wood-normal.jpg', '/wood-roughness.jpg']) pending.get(path)!.arrive();
    await installer.settled();
    for (const map of [cloth.map!, cloth.normalMap!, cloth.bumpMap!]) {
      assert.equal(map.anisotropy, 8);
      assert.equal(map.magFilter, THREE.LinearFilter);
      assert.equal(map.minFilter, THREE.LinearMipmapLinearFilter);
    }
    assert.equal(cloth.bumpMap, cloth.roughnessMap, 'Blender height R and roughness G share one allocation');
    assert.equal(cushion.map, cloth.map);
    assert.equal(cushion.bumpMap, cloth.bumpMap);
    assert.equal(cushion.normalMap, cloth.normalMap);
    assert.equal(cloth.map!.colorSpace, THREE.SRGBColorSpace);
    assert.equal(cloth.bumpMap!.colorSpace, THREE.NoColorSpace);
    assert.equal(cloth.normalMap!.colorSpace, THREE.NoColorSpace);
    assert.ok(
      cloth.bumpScale > 0 && cloth.bumpScale <= TABLE.radius * 0.0005,
      'fine fibers cannot become large ridges',
    );
    assert.equal(
      walnut.map!.source,
      pending.get('/wood-color.jpg')!.texture.source,
      'the rotated walnut shares the scan upload',
    );
    assert.equal(walnut.map!.colorSpace, THREE.SRGBColorSpace);
    assert.equal(walnut.map!.rotation, Math.PI / 2);
    assert.notEqual(walnut.map, grain, 'the seeded grain placeholder is swapped out');
    for (const material of [cloth, cushion]) {
      const shader = { fragmentShader: '#include <normal_fragment_maps>' } as Parameters<
        typeof material.onBeforeCompile
      >[0];
      material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
      assert.match(shader.fragmentShader, /USE_BUMPMAP.*USE_NORMALMAP_TANGENTSPACE/);
      assert.match(shader.fragmentShader, /perturbNormalArb.*dHdxy_fwd/);
    }
    const unique = new Set([cloth.map!, cloth.normalMap!, cloth.roughnessMap!, cloth.bumpMap!]);
    assert.equal(unique.size, 3);
    let disposed = 0;
    for (const map of unique) map.addEventListener('dispose', () => disposed++);
    surfaces.dispose();
    surfaces.dispose();
    assert.equal(disposed, 3, 'shared cushion/cloth maps are disposed exactly once');
  } finally {
    surfaces.dispose();
    installer.dispose();
  }
});
