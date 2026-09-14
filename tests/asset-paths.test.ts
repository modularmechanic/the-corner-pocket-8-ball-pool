import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { PUB_PROPS } from '../src/render/pub';
import { PUB_BRICK_MAPS } from '../src/render/pub-interior';
import { PUB_DRESSING_PROPS } from '../src/render/pub-dressing';
import { PUB_DRINK_PROPS } from '../src/render/pub-drinks';
import { PUB_ENTERTAINMENT_PROPS } from '../src/render/pub-entertainment';
import { PUB_GALLERY_PROPS } from '../src/render/pub-gallery';
import { PUB_CLUB_DECOR_PROPS } from '../src/render/pub-club-decor';
import { BAIZE_MAPS, WOOD_SCAN_MAPS } from '../src/render/table-surfaces';

/** Every string leaf that names a file; slot names such as 'map' are skipped. */
const files = (value: unknown): string[] => typeof value === 'string'
  ? (/\.\w+$/.test(value) ? [value] : [])
  : Object.values(value as object).flatMap(files);

test('every prop path the render modules request exists under public/', () => {
  const paths = files([PUB_PROPS, PUB_BRICK_MAPS, PUB_DRESSING_PROPS, PUB_DRINK_PROPS, PUB_ENTERTAINMENT_PROPS, PUB_GALLERY_PROPS, PUB_CLUB_DECOR_PROPS, BAIZE_MAPS, WOOD_SCAN_MAPS]);
  for (const path of paths) {
    assert.ok(!path.startsWith('/'), `${path} is relative to the base URL`);
    assert.ok(existsSync(new URL(`../public/${path}`, import.meta.url)), `public/${path} exists`);
  }
  // A text glTF also needs the buffers and images it references beside it.
  for (const path of paths.filter(path => path.endsWith('.gltf'))) {
    const gltf = JSON.parse(readFileSync(new URL(`../public/${path}`, import.meta.url), 'utf8')) as { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
    for (const { uri } of [...gltf.buffers ?? [], ...gltf.images ?? []]) if (uri && !uri.startsWith('data:')) {
      assert.ok(existsSync(new URL(uri, new URL(`../public/${path}`, import.meta.url))), `${path} references ${uri}`);
    }
  }
});

// Quantized positions move mesh offsets onto node transforms; code that reuses raw geometry
// (gallery artwork, instanced props) then places it at the room origin.
test('no pub model uses KHR_mesh_quantization', () => {
  const glbs = files([PUB_PROPS, PUB_DRESSING_PROPS, PUB_DRINK_PROPS, PUB_ENTERTAINMENT_PROPS, PUB_GALLERY_PROPS, PUB_CLUB_DECOR_PROPS]).filter(path => path.endsWith('.glb'));
  assert.ok(glbs.length > 30);
  for (const path of glbs) {
    const glb = readFileSync(new URL(`../public/${path}`, import.meta.url));
    const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString()) as { extensionsUsed?: string[] };
    assert.ok(!json.extensionsUsed?.includes('KHR_mesh_quantization'), `${path} is not quantized`);
  }
});
