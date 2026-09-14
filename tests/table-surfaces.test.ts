import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createTableSurfaces } from '../src/render/table-surfaces';
import { TABLE } from '../src/simulation/types';

test('Blender baize loads high-resolution maps once and shares them with cushions', () => {
  const load = THREE.TextureLoader.prototype.load;
  const pending = new Map<string, { texture: THREE.Texture; complete: () => void }>();
  THREE.TextureLoader.prototype.load = (url, complete) => {
    const texture = new THREE.Texture();
    pending.set(url, { texture, complete: () => complete?.(texture) });
    return texture;
  };
  let surfaces: ReturnType<typeof createTableSurfaces>;
  try { surfaces = createTableSurfaces({ capabilities: { getMaxAnisotropy: () => 16 } } as THREE.WebGLRenderer); }
  finally { THREE.TextureLoader.prototype.load = load; }
  const { cloth, cushion } = surfaces;
  try {
    assert.equal(cloth.map, null, 'smooth matte fallback replaces coarse generated nap while loading');
    for (const [name, size] of [['color', 2048], ['normal', 1024], ['surface', 1024]] as const) {
      const path = `/textures/table/baize-${name}.png`;
      const png = readFileSync(new URL(`../public${path}`, import.meta.url));
      assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
      const asset = pending.get(path)!; assert.ok(asset, `loads ${name} bake`); asset.complete();
      assert.equal(asset.texture.anisotropy, 8);
      assert.equal(asset.texture.magFilter, THREE.LinearFilter);
      assert.equal(asset.texture.minFilter, THREE.LinearMipmapLinearFilter);
    }
    assert.equal(cloth.bumpMap, cloth.roughnessMap, 'Blender height R and roughness G share one allocation');
    assert.equal(cushion.map, cloth.map); assert.equal(cushion.bumpMap, cloth.bumpMap); assert.equal(cushion.normalMap, cloth.normalMap);
    assert.equal(cloth.map!.colorSpace, THREE.SRGBColorSpace);
    assert.equal(cloth.bumpMap!.colorSpace, THREE.NoColorSpace);
    assert.equal(cloth.normalMap!.colorSpace, THREE.NoColorSpace);
    assert.ok(cloth.bumpScale > 0 && cloth.bumpScale <= TABLE.radius * .0005, 'fine fibers cannot become large ridges');
    for (const material of [cloth, cushion]) {
      const shader = { fragmentShader: '#include <normal_fragment_maps>' } as Parameters<typeof material.onBeforeCompile>[0];
      material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
      assert.match(shader.fragmentShader, /USE_BUMPMAP.*USE_NORMALMAP_TANGENTSPACE/);
      assert.match(shader.fragmentShader, /perturbNormalArb.*dHdxy_fwd/);
    }
    const unique = new Set([cloth.map!, cloth.normalMap!, cloth.roughnessMap!, cloth.bumpMap!]);
    assert.equal(unique.size, 3);
    let disposed = 0;
    for (const texture of unique) texture.addEventListener('dispose', () => disposed++);
    surfaces.dispose(); surfaces.dispose();
    assert.equal(disposed, 3, 'shared cushion/cloth maps are disposed exactly once');
  } finally { surfaces.dispose(); }
});
