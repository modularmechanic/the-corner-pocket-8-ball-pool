import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { POOL_DECADE_GALLERIES, poolPhotoRegion, applyPoolPhotoRegion } from '../src/render/pub-gallery';
import { PUB_CLUB_DECOR } from '../src/render/pub-club-decor';
import { readFileSync } from 'node:fs';
import { PUB_LAYOUT } from '../src/render/pub-layout';

test('twenty dated pool photos fill five decade groups without crossing the wall crown', () => {
  assert.deepEqual(
    POOL_DECADE_GALLERIES.map((era) => era.decade),
    ['1980s', '1990s', '2000s', '2010s', '2020s'],
  );
  const years = POOL_DECADE_GALLERIES.flatMap((era) => [...era.years]);
  assert.equal(years.length, 20);
  assert.equal(new Set(years).size, 20);
  for (const era of POOL_DECADE_GALLERIES) {
    assert.equal(era.years.length, 4);
    assert.ok(era.years.every((year) => String(year).startsWith(era.decade.slice(0, 3))));
    assert.ok(era.bottom + era.rowStep + era.size + 0.21 < 6.1, 'every frame clears the crown moulding');
    if (era.wall === 'front')
      assert.ok(Math.abs(era.centre) - 0.68 - era.size / 2 - 0.07 > 3.5, 'front photos clear the doorway');
    else
      assert.ok(
        era.centre - 0.68 - era.size / 2 - 0.07 > -6.3 && era.centre + 0.68 + era.size / 2 + 0.07 < 6.3,
        'right photos clear both televisions',
      );
  }
  const nineties = POOL_DECADE_GALLERIES[1],
    noughties = POOL_DECADE_GALLERIES[2];
  assert.ok(nineties.bottom + nineties.rowStep + nineties.size + 0.21 < noughties.bottom - 0.07);
  assert.ok(
    noughties.bottom + noughties.rowStep + noughties.size + 0.21 <
      PUB_CLUB_DECOR.neons.front.y - PUB_CLUB_DECOR.neons.front.height / 2,
  );
});

test('photo atlas cells retain top-row orientation and do not bleed into adjacent prints', () => {
  const regions = Array.from({ length: 4 }, (_, index) => poolPhotoRegion(index));
  for (const region of regions) {
    assert.ok(region.x > 0 && region.y > 0);
    assert.ok(region.x + region.width < 1 && region.y + region.height < 1);
  }
  for (let index = 0; index < 4; index++) {
    const imported = new THREE.PlaneGeometry(1, 1),
      sourceUV = imported.getAttribute('uv');
    for (let i = 0; i < sourceUV.count; i++) sourceUV.setY(i, 1 - sourceUV.getY(i));
    const geometry = applyPoolPhotoRegion(imported, index),
      uv = geometry.getAttribute('uv');
    const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i)),
      vs = Array.from({ length: uv.count }, (_, i) => uv.getY(i));
    assert.ok(index % 2 === 0 ? Math.max(...us) < 0.5 : Math.min(...us) > 0.5);
    assert.ok(index < 2 ? Math.max(...vs) < 0.5 : Math.min(...vs) > 0.5);
    assert.ok(uv.getY(0) < uv.getY(2), 'glTF top image vertices sample the top of their tile');
    geometry.dispose();
    imported.dispose();
  }
});

test('Blender-authored club assets contain the bounded geometry, UVs and no exported lights', () => {
  let triangles = 0,
    primitives = 0,
    neons = 0;
  for (const wall of ['left', 'right', 'front']) {
    const bytes = readFileSync(new URL(`../public/models/pub/club-decor-${wall}.glb`, import.meta.url));
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    assert.equal(gltf.scenes.length, 1, 'only the dedicated authoring scene is exported');
    assert.ok(!gltf.extensions?.KHR_lights_punctual, 'neon adds no scene lights');
    for (const mesh of gltf.meshes)
      for (const primitive of mesh.primitives) {
        primitives++;
        triangles += gltf.accessors[primitive.indices].count / 3;
        const name = gltf.materials[primitive.material].name.replace(/\.\d+$/, '');
        if (name === 'Club archival print' || name === 'Baked club neon glow')
          assert.ok(
            'TEXCOORD_0' in primitive.attributes,
            'authored display planes retain UVs for their canvas materials',
          );
        if (name === 'Baked club neon glow') neons++;
      }
    assert.ok(
      gltf.nodes.every((node: { name: string }) => node.name !== 'Cube'),
      'the original factory cube was not exported',
    );
  }
  assert.ok(triangles < 6_000);
  assert.equal(primitives, 13);
  assert.equal(neons, 2);
  assert.ok(PUB_CLUB_DECOR.trophies.z + PUB_CLUB_DECOR.trophies.width / 2 < 2.1);
  assert.ok(PUB_CLUB_DECOR.neons.front.y + PUB_CLUB_DECOR.neons.front.height / 2 < PUB_LAYOUT.bounds.ceiling);
});
