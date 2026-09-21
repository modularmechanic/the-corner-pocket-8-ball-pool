import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { catchesRoom, RoomReflections } from '../src/render/room-reflections';
import { createPropInstaller, type PropInstaller, type SettledProps } from '../src/render/asset-installer';
import { graphicsBudget } from '../src/render/performance';
import { buildPubDrinks, setPubGlassTransmission } from '../src/render/pub-drinks';
import { installHeadlessPubAssets } from './headless-pub-assets';

test('reflections capture when the table is stable, once when the pub settles, then after later swaps', async () => {
  let settle!: (result: SettledProps) => void;
  const props = { revision: 0, settled: () => new Promise<SettledProps>((resolve) => (settle = resolve)) };
  const renderer = { extensions: { has: () => false }, compile: () => {} } as unknown as THREE.WebGLRenderer;
  const reflections = new RoomReflections(
    renderer,
    new THREE.Scene(),
    () => [],
    (capture) => capture(),
    props,
  );
  let captures = 0;
  (reflections as unknown as { capture: () => void }).capture = () => captures++;
  const frames = (seconds: number, idle = true) => {
    for (let t = 0; t < seconds; t += 0.1) reflections.update(0.1, idle);
  };

  frames(2);
  assert.equal(captures, 0, 'the table and its first props are still being built');
  frames(0.3);
  assert.equal(captures, 1);
  props.revision = 5;
  frames(10);
  assert.equal(captures, 1, 'swaps before the pub settles wait');
  settle({ loaded: [], failed: [] });
  await Promise.resolve();
  frames(0.2);
  assert.equal(captures, 2, 'the settled pub is captured once');
  frames(10);
  assert.equal(captures, 2);
  props.revision = 6;
  frames(3, false);
  assert.equal(captures, 2, 'never while balls roll');
  frames(0.2);
  assert.equal(captures, 3, 'a later swap recaptures');
  props.revision = 7;
  frames(5);
  assert.equal(captures, 3, 'the cooldown still holds');
  frames(4);
  assert.equal(captures, 4);
  reflections.dispose();
});

test('a prop request that never answers cannot freeze reflections on the placeholder capture', () => {
  const props = { revision: 0, settled: () => new Promise<SettledProps>(() => {}) };
  const renderer = { extensions: { has: () => false }, compile: () => {} } as unknown as THREE.WebGLRenderer;
  const reflections = new RoomReflections(
    renderer,
    new THREE.Scene(),
    () => [],
    (capture) => capture(),
    props,
  );
  let captures = 0;
  (reflections as unknown as { capture: () => void }).capture = () => captures++;
  const frames = (seconds: number) => {
    for (let t = 0; t < seconds; t += 0.1) reflections.update(0.1, true);
  };
  frames(2.3);
  assert.equal(captures, 1);
  props.revision = 3;
  frames(12);
  assert.equal(captures, 1, 'props are still arriving');
  frames(1);
  assert.equal(captures, 2, 'after 15 seconds the pub is treated as settled');
  frames(20);
  assert.equal(captures, 2);
  reflections.dispose();
});

test('the room sweep takes metal and smooth glass, and leaves the matte room matte', () => {
  const keg = new THREE.MeshStandardMaterial({ metalness: 0.82, roughness: 0.38 });
  const brass = new THREE.MeshStandardMaterial({ metalness: 0.83, roughness: 0.26 });
  const mirror = new THREE.MeshPhysicalMaterial({ metalness: 0.82, roughness: 0.2, clearcoat: 1 });
  const glazing = new THREE.MeshPhysicalMaterial({ metalness: 0.05, roughness: 0.24, clearcoat: 0.7 });
  const drinkGlass = new THREE.MeshPhysicalMaterial({ roughness: 0.035, clearcoat: 0.85, transparent: true });
  for (const material of [keg, brass, mirror, glazing, drinkGlass])
    assert.ok(catchesRoom(material), `${material.type} r=${material.roughness} m=${material.metalness}`);

  // The dim room must not be lifted wholesale: an envMap also adds diffuse irradiance.
  const tile = new THREE.MeshStandardMaterial({ roughness: 0.22, metalness: 0.02 });
  const lacqueredOak = new THREE.MeshPhysicalMaterial({ roughness: 0.36, clearcoat: 0.85 });
  const plaster = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  const curtain = new THREE.MeshStandardMaterial({ roughness: 1, transparent: true, opacity: 0.6 });
  for (const material of [tile, lacqueredOak, plaster, curtain])
    assert.ok(!catchesRoom(material), `${material.type} r=${material.roughness} should stay matte`);

  assert.ok(!catchesRoom(new THREE.MeshBasicMaterial()));
  assert.ok(!catchesRoom(null));
});

test('real refraction is reserved for Ultra to avoid a second scene pass at 1440p', () => {
  assert.equal(graphicsBudget('ultra').glassTransmission, true);
  assert.equal(graphicsBudget('high').glassTransmission, false);
  assert.equal(graphicsBudget('veryHigh').glassTransmission, false);
  assert.equal(graphicsBudget('performance').glassTransmission, false);
  assert.equal(graphicsBudget('auto', 0).glassTransmission, false);
  for (const tier of [1, 2, 3, 4]) assert.equal(graphicsBudget('auto', tier).glassTransmission, false, `tier ${tier}`);
});

/** Parses nothing: the glassware under test is the placeholder drinks, which exist before any GLB lands. */
function drinksWithPlaceholders(): { room: THREE.Group; drinks: ReturnType<typeof buildPubDrinks> } {
  installHeadlessPubAssets();
  const hanging = <T>() => new Promise<T>(() => {});
  const installer: PropInstaller = createPropInstaller({ model: hanging, texture: hanging });
  const room = new THREE.Group();
  return { room, drinks: buildPubDrinks(room, installer) };
}

function glassMaterials(room: THREE.Object3D): THREE.MeshPhysicalMaterial[] {
  const found: THREE.MeshPhysicalMaterial[] = [];
  room.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      if (material instanceof THREE.MeshPhysicalMaterial && material.name.startsWith('Drink Glass'))
        if (!found.includes(material)) found.push(material);
  });
  return found;
}

test('a tier change converts every glass together, and never leaves one half converted', () => {
  const first = drinksWithPlaceholders();
  const glasses = glassMaterials(first.room);
  assert.ok(glasses.length >= 2, `expected placeholder glassware, found ${glasses.length}`);

  setPubGlassTransmission(false);
  for (const glass of glasses) {
    assert.equal(glass.transmission, 0);
    assert.equal(glass.transparent, true);
    assert.ok(glass.opacity < 1);
    assert.equal(glass.depthWrite, false);
  }

  setPubGlassTransmission(true);
  for (const glass of glasses) {
    assert.ok(glass.transmission > 0.5);
    assert.ok(glass.thickness > 0);
    // Alpha blending on top of refraction double counts the wall and dulls the liquid.
    assert.equal(glass.transparent, false);
    assert.equal(glass.opacity, 1);
    assert.equal(glass.depthWrite, true);
  }

  // Glassware built after the change arrives in the mode the room is already in.
  const later = drinksWithPlaceholders();
  for (const glass of glassMaterials(later.room)) assert.ok(glass.transmission > 0.5, glass.name);

  // A disposed room stops answering tier changes; the surviving one still does.
  later.drinks.dispose();
  const disposed = glassMaterials(later.room);
  setPubGlassTransmission(false);
  for (const glass of glasses) assert.equal(glass.transmission, 0);
  for (const glass of disposed) assert.ok(glass.transmission > 0.5, `${glass.name} outlived its room`);
  first.drinks.dispose();
  setPubGlassTransmission(false);
});
