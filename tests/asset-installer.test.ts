import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPropInstaller, type PropLoader } from '../src/render/asset-installer';
import { instancePubModel } from '../src/render/pub-models';

/** In-memory loader: every parse is counted and completes only when the test says so. */
function fakeLoader() {
  const parses = new Map<string, number>();
  const requests = new Map<string, { resolve: (value: never) => void; reject: (error: Error) => void }>();
  const request = <T>(url: string) => new Promise<T>((resolve, reject) => {
    parses.set(url, (parses.get(url) ?? 0) + 1);
    requests.set(url, { resolve: resolve as (value: never) => void, reject });
  });
  const loader: PropLoader = { model: url => request(url), texture: url => request(url) };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return {
    loader, parses, flush,
    async arrive(url: string, value: THREE.Object3D | THREE.Texture) { requests.get(url)!.resolve(value as never); await flush(); },
    async fail(url: string) { requests.get(url)!.reject(new Error(`404 ${url}`)); await flush(); },
  };
}
function prop() {
  const scene = new THREE.Group(), geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), transparent: true });
  scene.add(new THREE.Mesh(geometry, material));
  return { scene, geometry, material };
}
function placeholderIn(parent: THREE.Object3D, material = new THREE.MeshStandardMaterial()) {
  const placeholder = new THREE.Group(), geometry = new THREE.BoxGeometry();
  placeholder.add(new THREE.Mesh(geometry, material)); parent.add(placeholder);
  const disposed = { geometry: 0, material: 0 };
  geometry.addEventListener('dispose', () => disposed.geometry++); material.addEventListener('dispose', () => disposed.material++);
  return { placeholder, disposed };
}

test('a path requested four times is parsed and prepared once, then instanced for each request', async () => {
  const fake = fakeLoader(), props = createPropInstaller(fake.loader), room = new THREE.Group();
  let prepared = 0;
  for (let i = 0; i < 4; i++) props.model('models/pub/wall-panel.glb', { parent: room, placements: [{ x: i, y: 0, z: 0 }], prepare: () => prepared++ });
  const { scene, material } = prop();
  await fake.arrive('/models/pub/wall-panel.glb', scene);
  assert.deepEqual([...fake.parses], [['/models/pub/wall-panel.glb', 1]]);
  assert.equal(prepared, 1); assert.equal(room.children.length, 4); assert.equal(props.revision, 4);
  assert.equal(material.depthWrite, false, 'transparent GLB materials never write depth');
  assert.equal(material.map!.anisotropy, 8);
  assert.deepEqual(await props.settled(), { loaded: ['models/pub/wall-panel.glb'], failed: [] });
});

test('a swap hides, removes and frees the placeholder but keeps resources the room still draws', async () => {
  const fake = fakeLoader(), props = createPropInstaller(fake.loader), room = new THREE.Group();
  const shared = new THREE.MeshStandardMaterial(), bar = new THREE.Mesh(new THREE.BoxGeometry(), shared); room.add(bar);
  const { placeholder, disposed } = placeholderIn(room, shared);
  props.model('models/pub/booth-bench.glb', { parent: room, placements: [{ x: 0, y: 0, z: 0 }], placeholder });
  assert.equal(placeholder.visible, true, 'placeholders stay visible until the prop arrives');
  await fake.arrive('/models/pub/booth-bench.glb', prop().scene);
  assert.equal(placeholder.visible, false); assert.equal(placeholder.parent, null);
  assert.equal(disposed.geometry, 1); assert.equal(disposed.material, 0, 'the bar still draws the shared material');
});

test('a failed prop keeps its placeholder, warns once and is reported when settled', async t => {
  const warn = t.mock.method(console, 'warn', () => {});
  const fake = fakeLoader(), props = createPropInstaller(fake.loader), room = new THREE.Group();
  const { placeholder, disposed } = placeholderIn(room);
  props.model('models/pub/missing.glb', { parent: room, placeholder });
  props.model('models/pub/missing.glb', { parent: room });
  const settled = props.settled();
  await fake.fail('/models/pub/missing.glb');
  assert.equal(placeholder.parent, room); assert.equal(placeholder.visible, true); assert.equal(disposed.geometry, 0);
  assert.equal(warn.mock.callCount(), 1); assert.match(String(warn.mock.calls[0].arguments[0]), /\/models\/pub\/missing\.glb/);
  assert.deepEqual(await settled, { loaded: [], failed: ['models/pub/missing.glb'] }); assert.equal(props.revision, 0);
});

test('a preparation that rejects the source frees it and keeps the placeholder', async t => {
  t.mock.method(console, 'warn', () => {});
  const fake = fakeLoader(), props = createPropInstaller(fake.loader), room = new THREE.Group();
  const { placeholder } = placeholderIn(room), { scene, geometry } = prop();
  let freed = 0; geometry.addEventListener('dispose', () => freed++);
  props.model('models/pub/sports-tv.glb', { parent: room, placeholder, prepare: () => { throw new Error('no screen material'); } });
  await fake.arrive('/models/pub/sports-tv.glb', scene);
  assert.equal(freed, 1); assert.equal(placeholder.visible, true); assert.equal(room.children.length, 1);
  assert.deepEqual((await props.settled()).failed, ['models/pub/sports-tv.glb']);
});

test('a prop arriving after dispose is freed and never attached', async () => {
  const fake = fakeLoader(), props = createPropInstaller(fake.loader), room = new THREE.Group();
  const { placeholder } = placeholderIn(room), { scene, geometry } = prop(), texture = new THREE.Texture();
  let freed = 0, bound = 0; geometry.addEventListener('dispose', () => freed++); texture.addEventListener('dispose', () => freed++);
  props.model('models/pub/cask-stack.glb', { parent: room, placeholder });
  props.model('models/pub/cask-stack.glb', { parent: room });
  props.texture('wood-color.jpg', { use: () => bound++ });
  props.dispose();
  await fake.arrive('/models/pub/cask-stack.glb', scene); await fake.arrive('/wood-color.jpg', texture);
  assert.equal(freed, 2, 'shared late results are freed exactly once'); assert.equal(bound, 0);
  assert.deepEqual(room.children, [placeholder]); assert.equal(props.revision, 0);
});

test('a dependent load requested while its parent attaches keeps the pub unsettled', async () => {
  const fake = fakeLoader(), props = createPropInstaller(fake.loader), room = new THREE.Group();
  const atlasMaterial = new THREE.MeshStandardMaterial(), placeholderMap = new THREE.Texture();
  let placeholderFreed = 0; placeholderMap.addEventListener('dispose', () => placeholderFreed++);
  let settled = false;
  props.model('models/pub/pub-photo-frame.glb', { use: frame => {
    room.add(frame);
    props.texture('textures/pub/gallery-atlas.webp', { placeholder: placeholderMap, use: texture => { atlasMaterial.map = texture; } });
  } });
  props.settled().then(() => settled = true);
  await fake.arrive('/models/pub/pub-photo-frame.glb', prop().scene);
  assert.equal(settled, false); assert.equal(props.revision, 1);
  const atlas = new THREE.Texture();
  await fake.arrive('/textures/pub/gallery-atlas.webp', atlas);
  assert.equal(settled, true); assert.equal(props.revision, 2);
  assert.equal(atlasMaterial.map, atlas); assert.equal(atlas.anisotropy, 8); assert.equal(placeholderFreed, 1);
  assert.deepEqual(await props.settled(), { loaded: ['models/pub/pub-photo-frame.glb', 'textures/pub/gallery-atlas.webp'], failed: [] });
});

test('a placeholder source shared by two requests is freed only after the last one settles', async t => {
  t.mock.method(console, 'warn', () => {});
  const fake = fakeLoader(), props = createPropInstaller(fake.loader), shelf = new THREE.Group(), counter = new THREE.Group();
  const source = new THREE.Group(), geometry = new THREE.BoxGeometry(), label = new THREE.Texture();
  source.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: label })));
  let freed = 0; geometry.addEventListener('dispose', () => freed++);
  const shelfPlaceholder = instancePubModel(source, [{ x: 0, y: 0, z: 0 }]), counterPlaceholder = instancePubModel(source, [{ x: 1, y: 0, z: 0 }]);
  shelf.add(shelfPlaceholder); counter.add(counterPlaceholder); new THREE.Scene().add(shelf, counter);
  props.model('models/pub/bottle-lod.glb', { parent: shelf, placeholder: shelfPlaceholder });
  props.model('models/pub/bottle.glb', { parent: counter, placeholder: counterPlaceholder });
  await fake.arrive('/models/pub/bottle-lod.glb', prop().scene);
  assert.equal(shelfPlaceholder.parent, null); assert.equal(freed, 0, 'the counter placeholder still draws the source');
  await fake.arrive('/models/pub/bottle.glb', prop().scene);
  assert.equal(freed, 1);

  // A failing last request keeps its placeholder and therefore the shared source.
  const kept = new THREE.BoxGeometry(), keptSource = new THREE.Group(), room = new THREE.Group();
  keptSource.add(new THREE.Mesh(kept, new THREE.MeshStandardMaterial()));
  let keptFreed = 0; kept.addEventListener('dispose', () => keptFreed++);
  const first = instancePubModel(keptSource, [{ x: 0, y: 0, z: 0 }]), second = instancePubModel(keptSource, [{ x: 1, y: 0, z: 0 }]);
  new THREE.Scene().add(room); room.add(first, second);
  props.model('models/pub/stout.glb', { parent: room, placeholder: first });
  props.model('models/pub/missing-stout.glb', { parent: room, placeholder: second });
  await fake.arrive('/models/pub/stout.glb', prop().scene); await fake.fail('/models/pub/missing-stout.glb');
  assert.equal(keptFreed, 0); assert.equal(second.parent, room);
});

test('a throwing use restores placeholder visibility and reports the path only as failed', async t => {
  t.mock.method(console, 'warn', () => {});
  const fake = fakeLoader(), props = createPropInstaller(fake.loader), room = new THREE.Group();
  const { placeholder, disposed } = placeholderIn(room), other = placeholderIn(room);
  props.model('models/pub/slot-cabinet.glb', { parent: room, placeholder: other.placeholder });
  props.model('models/pub/slot-cabinet.glb', { placeholder, use: () => { throw new Error('no anchor'); } });
  await fake.arrive('/models/pub/slot-cabinet.glb', prop().scene);
  assert.equal(placeholder.visible, true); assert.equal(placeholder.parent, room); assert.equal(disposed.geometry, 0);
  assert.equal(other.placeholder.parent, null, 'the request that attached still swapped');
  assert.deepEqual(await props.settled(), { loaded: [], failed: ['models/pub/slot-cabinet.glb'] });
});

test('a texture placeholder the scene still draws stays allocated', async () => {
  const fake = fakeLoader(), props = createPropInstaller(fake.loader), room = new THREE.Group(), grain = new THREE.Texture();
  new THREE.Scene().add(room); room.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: grain })));
  const { placeholder } = placeholderIn(room);
  let freed = 0; grain.addEventListener('dispose', () => freed++);
  props.texture('wood-color.jpg', { placeholder: [placeholder, grain], use: () => {} });
  await fake.arrive('/wood-color.jpg', new THREE.Texture());
  assert.equal(placeholder.parent, null); assert.equal(freed, 0);
});
