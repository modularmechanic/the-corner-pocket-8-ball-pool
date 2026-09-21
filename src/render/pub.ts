import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { canvasTexture } from './materials';
import { buildPubInterior, updateBilliardFixture } from './pub-interior';
import { buildPubDressing } from './pub-dressing';
import {
  buildPubSportsProps,
  PUB_SPORTS_BOOTH_TABLES,
  PUB_SPORTS_LOOSE_TABLES,
  PUB_SPORTS_STOOL_PLACEMENTS,
  PUB_SPORTS_TAP_PLACEMENTS,
} from './pub-sports-props';
import { PUB_WOOD_MAPS, provideWood, useWood } from './pub-wood';
/** Scanned oak for the room's walls: colour, and a bump map built from the same plate. */
const PUB_WALL_OAK_MAPS = [
  ['map', 'textures/pub/wall-oak-color.webp'],
  ['bumpMap', 'textures/pub/wall-oak-bump.webp'],
] as const;
import { buildPubGallery } from './pub-gallery';
import { buildPubDrinks } from './pub-drinks';
import { InstanceVisibility } from './instance-visibility';
import { buildPubEntertainment } from './pub-entertainment';
import { PUB_LAYOUT, pubBackZ, pubFrontZ, pubSideX } from './pub-layout';
import { disposePubObject, type PubPlacement } from './pub-models';
import { batchPubStatic, pubBatchDiagnostics } from './pub-batching';
import { buildPubClubDecor } from './pub-club-decor';
import { PROP_ANISOTROPY, type PropInstaller } from './asset-installer';
import { PUB_PROPS } from './pub-props';
import { FLOOR, pubBuildKit } from './pub-build-kit';
import { buildPubBackBar, buildPubCueRack, buildPubGlassware } from './pub-back-bar';
import { buildPubJukebox } from './pub-jukebox';
import { buildPubContactShadows, buildPubSeating } from './pub-seating';

export { PUB_PROPS };
RectAreaLightUniformsLib.init();
/** Panel centres on a 3-unit pitch through `anchor`, keeping every panel clear of the wall it ends on. */
function panelRun(from: number, to: number, anchor: number): number[] {
  const pitch = 3,
    first = Math.ceil((from + pitch / 2 - anchor) / pitch),
    last = Math.floor((to - pitch / 2 - anchor) / pitch);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => anchor + (first + i) * pitch);
}
/** Dispose `installer` before the returned room, so no prop arrives into a disposed room. */
export function buildPub(scene: THREE.Scene, installer: PropInstaller) {
  // Placements handed to the generated props are module-level, so a second build must start clean.
  for (const list of [
    PUB_SPORTS_TAP_PLACEMENTS,
    PUB_SPORTS_STOOL_PLACEMENTS,
    PUB_SPORTS_BOOTH_TABLES,
    PUB_SPORTS_LOOSE_TABLES,
  ])
    list.length = 0;
  const room = new THREE.Group();
  scene.add(room);
  const backBar = new THREE.Group(),
    backWallFittings = new THREE.Group();
  backBar.name = 'pub-rear-bar';
  backBar.position.z = PUB_LAYOUT.backShift;
  backBar.add(backWallFittings);
  room.add(backBar);
  const glows: THREE.MeshStandardMaterial[] = [];
  // The room's joinery takes the same scanned oak as the walls, at a finer repeat.
  const walnut = new THREE.MeshStandardMaterial({
    normalScale: new THREE.Vector2(0.24, 0.24),
    color: '#c6a88a',
    roughness: 0.62,
  });
  useWood(walnut, 'walnut', 1.4, 1.4);
  const brass = new THREE.MeshStandardMaterial({ color: '#bc9556', metalness: 0.78, roughness: 0.32 });
  const blackMetal = new THREE.MeshStandardMaterial({ color: '#232b29', metalness: 0.7, roughness: 0.43 });
  const leather = new THREE.MeshPhysicalMaterial({ color: '#4e2025', roughness: 0.57, clearcoat: 0.18 });
  const roomKit = pubBuildKit(room, glows, installer);
  const barKit = pubBuildKit(backBar, glows, installer);
  const { installModel } = roomKit;
  const floor = new THREE.MeshStandardMaterial({
    normalScale: new THREE.Vector2(0.35, 0.35),
    color: '#d6c7a9',
    roughness: 0.87,
    metalness: 0.01,
  });
  for (const [slot, path] of PUB_PROPS.stone)
    installer.texture(path, {
      prepare: (texture) => {
        if (slot === 'map') texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(4.5 * PUB_LAYOUT.expansion, 4 * PUB_LAYOUT.expansion);
      },
      use: (texture) => {
        floor[slot] = texture;
        floor.needsUpdate = true;
      },
    });
  const floorMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(38 * PUB_LAYOUT.expansion, 34 * PUB_LAYOUT.expansion),
    floor,
  );
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.set(0, FLOOR, -2 * PUB_LAYOUT.expansion);
  floorMesh.receiveShadow = true;
  room.add(floorMesh);
  // Scanned oak planks (woodtexture.png, mirrored into a seamless tile) with a bump map derived from
  // its own luminance, so the boards catch the room's lamps instead of reading as a printed pattern.
  const wall = new THREE.MeshStandardMaterial({ color: '#c9b393', roughness: 0.76 });
  for (const grain of ['oak', 'walnut', 'tiles'] as const)
    installer.texture(PUB_WOOD_MAPS[grain], { use: (texture) => provideWood(grain, texture) });
  for (const [slot, path] of PUB_WALL_OAK_MAPS)
    installer.texture(path, {
      use: (texture) => {
        if (slot === 'map') texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        // Box faces carry 0..1 UVs, so this is what sets plank size across a long wall.
        texture.repeat.set(6, 2.1);
        texture.anisotropy = PROP_ANISOTROPY;
        wall[slot] = texture;
        wall.bumpScale = 1.1;
        wall.needsUpdate = true;
      },
    });
  const interior = buildPubInterior(room, installer, { wood: walnut, brass, wall, metal: blackMetal });
  const billiardFixture = new THREE.Group();
  billiardFixture.name = 'billiard-light-fixture';
  room.add(billiardFixture);
  installModel(PUB_PROPS.lamp, [{ x: 0, y: 3.75, z: 0, height: 2.5 }], [], billiardFixture);
  const bar = buildPubBackBar(
    barKit,
    installer,
    { room, backBar, backWallFittings },
    { walnut, brass, blackMetal, leather },
  );
  buildPubJukebox(roomKit, room, brass);
  const seating = buildPubSeating(roomKit, room, { walnut, brass, blackMetal, leather, countertop: bar.countertop });
  const { addPint, fallbackTaps } = seating;
  const { box, cylinder } = roomKit;
  const tapPlacements: PubPlacement[] = [];
  fallbackTaps.position.z = PUB_LAYOUT.backShift;
  for (const x of [-4.9, 0, 4.9]) {
    box(1.28, 0.045, 0.62, blackMetal, x, 0.3475, -8.12, 0.035, fallbackTaps);
    for (const dx of [-0.37, 0, 0.37]) {
      cylinder(0.055, 0.07, 0.85, brass, x + dx, 0.785, -8.21, fallbackTaps);
      const spout = cylinder(0.035, 0.035, 0.32, brass, x + dx, 0.99, -8.06, fallbackTaps);
      spout.rotation.x = Math.PI / 2;
      box(0.11, 0.24, 0.1, leather, x + dx, 1.2, -8.19, 0.025, fallbackTaps);
    }
    tapPlacements.push({ x, y: 0.325, z: pubBackZ(-8.12), height: 1.172 });
    addPint(x + 0.88, 0.325, pubBackZ(-7.78), 0.2);
  }
  buildPubGlassware(barKit, interior.walls.back, { brass, blackMetal, leather }, bar.shelfLevels);
  installModel(PUB_PROPS.bench, seating.benchPlacements, [seating.fallbackBenches]);
  // Tables are the generated models: the booths take the long one, the loose tables the round one.
  PUB_SPORTS_BOOTH_TABLES.push(...seating.boothTablePlacements);
  PUB_SPORTS_LOOSE_TABLES.push(...seating.looseTablePlacements);
  seating.fallbackTables.visible = false;
  installModel(PUB_PROPS.chair, seating.chairPlacements, [seating.fallbackChairs]);
  installModel(PUB_PROPS.pint, seating.pintPlacements, [seating.fallbackPints]);

  buildPubContactShadows(room, {
    stoolPositions: bar.stoolPositions,
    tablePlacements: seating.tablePlacements,
    benchPlacements: seating.benchPlacements,
    chairPlacements: seating.chairPlacements,
  });

  // The counter's taps are the generated tower, installed with the other generated props so it gets
  // its projected UVs and steel material; these placements are handed over for that.
  PUB_SPORTS_TAP_PLACEMENTS.push(...tapPlacements.map((p) => ({ ...p, height: 1.7 })));
  fallbackTaps.visible = false;
  // Full moulded panels face inward along both side walls and the rear wings. The runs are derived from the
  // room bounds at their original 3-unit pitch, so a wider pub keeps the wainscot unbroken into the corners
  // instead of leaving bare plaster past the last authored panel.
  const panels: PubPlacement[] = [];
  for (const x of panelRun(-PUB_LAYOUT.bounds.right, PUB_LAYOUT.bounds.right, 1.5))
    if (Math.abs(x) >= 10.5) panels.push({ x, y: FLOOR, z: pubBackZ(-11.14) });
  installModel(PUB_PROPS.wallPanel, panels, [], interior.walls.back);
  for (const side of [-1, 1]) {
    const sidePanels: PubPlacement[] = [];
    for (const z of panelRun(PUB_LAYOUT.bounds.back, PUB_LAYOUT.bounds.front, 0.1))
      sidePanels.push({ x: pubSideX(side * 14.57), y: FLOOR, z, rotation: (-side * Math.PI) / 2, height: 2.15 });
    installModel(PUB_PROPS.wallPanel, sidePanels, [], side < 0 ? interior.walls.left : interior.walls.right);
  }
  installModel(
    PUB_PROPS.wallPanel,
    panelRun(-PUB_LAYOUT.bounds.right, PUB_LAYOUT.bounds.right, 0)
      .filter((x) => Math.abs(x) >= 6)
      .map((x) => ({ x, y: FLOOR, z: pubFrontZ(11.7), rotation: Math.PI, height: 2.15 })),
    [],
    interior.walls.front,
  );
  buildPubCueRack(barKit, backBar, { walnut, brass });
  // Back-wall fittings follow the rear cutaway too, so a rear orbit never looks through opaque framed prints.
  for (const object of [...backBar.children])
    if (object instanceof THREE.Mesh && object.position.z < -10.2) backWallFittings.add(object);
  const dressing = buildPubDressing(room, installer, interior.walls);
  buildPubSportsProps(room, installer, interior.walls);
  buildPubGallery(room, installer, interior.walls);
  const drinks = buildPubDrinks(room, installer, { shelfParent: interior.walls.back });
  const entertainment = buildPubEntertainment(room, installer, interior.walls);
  const clubDecor = buildPubClubDecor(interior.walls, installer);
  // Group boundaries remain intact: placeholder swaps, walls, screens and the
  // hanging fixture can still change independently. No work runs per frame.
  for (const section of [room, backBar, backWallFittings]) batchPubStatic(section);
  const instanceVisibility = new InstanceVisibility(room);
  return {
    group: room,
    diagnostics: () => ({
      ...pubBatchDiagnostics(room),
      ...instanceVisibility.diagnostics(),
      clubDecor: clubDecor.diagnostics(),
    }),
    updateVisibility(camera: THREE.Camera, shadowCameras: readonly THREE.Camera[]) {
      instanceVisibility.update(camera, shadowCameras, installer.revision);
    },
    withEnclosedRoom(capture: () => void) {
      instanceVisibility.restore();
      const objects = [...Object.values(interior.walls), backWallFittings, billiardFixture];
      const visibility = objects.map((object) => object.visible);
      try {
        for (const object of objects) object.visible = true;
        capture();
      } finally {
        objects.forEach((object, index) => (object.visible = visibility[index]));
      }
    },
    update(time: number, camera: THREE.Camera) {
      interior.update(camera);
      backWallFittings.visible = interior.walls.back.visible;
      updateBilliardFixture(billiardFixture, camera);
      dressing.update(time);
      entertainment.update(time, camera);
      for (let i = 0; i < glows.length; i++) glows[i].emissiveIntensity = 1.7 + Math.sin(time * 0.6 + i) * 0.05;
    },
    dispose() {
      entertainment.dispose();
      drinks.dispose();
      clubDecor.dispose();
      room.removeFromParent();
      disposePubObject(room);
    },
  };
}
