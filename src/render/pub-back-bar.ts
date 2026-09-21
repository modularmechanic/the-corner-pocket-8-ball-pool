import * as THREE from 'three';
import { canvasTexture } from './materials';
import { PUB_LAYOUT, pubBackZ } from './pub-layout';
import { PUB_SPORTS_STOOL_PLACEMENTS } from './pub-sports-props';
import { PUB_PROPS } from './pub-props';
import { FLOOR, type PubBuildKit } from './pub-build-kit';
import type { PubPlacement } from './pub-models';
import type { PropInstaller } from './asset-installer';
import { requestWoodScan } from './table-surfaces';

interface BarMaterials {
  walnut: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  blackMetal: THREE.MeshStandardMaterial;
  leather: THREE.MeshPhysicalMaterial;
}

/** The rear bar itself: bottle gantry, counter, mirror, lit shelves, house sign and stools. */
export function buildPubBackBar(
  kit: PubBuildKit,
  installer: PropInstaller,
  groups: { room: THREE.Group; backBar: THREE.Group; backWallFittings: THREE.Group },
  materials: BarMaterials,
) {
  const { box, cylinder, neon, installModel } = kit;
  const { room, backBar, backWallFittings } = groups;
  const { walnut, brass, blackMetal, leather } = materials;
  box(PUB_LAYOUT.bounds.right * 2, 2.15, 0.28, walnut, 0, FLOOR + 1.075, -11.22, 0.01);
  for (let x = PUB_LAYOUT.bounds.left + 0.8; x <= PUB_LAYOUT.bounds.right - 0.8; x += 1.4) {
    box(0.075, 2.1, 0.07, brass, x, FLOOR + 1.07, -11.045, 0.01);
    box(1.15, 0.055, 0.035, brass, x + 0.65, FLOOR + 0.22, -11.02, 0.01);
  }
  box(PUB_LAYOUT.bounds.right * 2 - 0.1, 0.14, 0.4, walnut, 0, FLOOR + 2.18, -11.07, 0.025);
  // Substantial raised bar, inset panels and a polished overhanging countertop.
  box(17.8, 3.72, 1.32, walnut, 0, FLOOR + 1.86, -8.1, 0.08);
  const countertop = new THREE.MeshPhysicalMaterial({
    color: '#b79a78',
    normalScale: new THREE.Vector2(0.13, 0.13),
    roughness: 0.36,
    clearcoat: 0.85,
    clearcoatRoughness: 0.17,
  });
  requestWoodScan(installer, (slot, scan) => {
    for (const material of [walnut, countertop]) {
      material[slot] = scan;
      material.needsUpdate = true;
    }
  });
  box(18.25, 0.19, 1.72, countertop, 0, 0.23, -8.1, 0.075);
  const insetWood = new THREE.MeshStandardMaterial({ color: '#39271d', roughness: 0.5 });
  for (let x = -7.5; x <= 7.5; x += 2.5) {
    box(2.16, 2.4, 0.025, insetWood, x, -1.48, -7.422, 0.05);
    for (const sx of [-1, 1]) box(0.025, 2.25, 0.03, brass, x + sx * 1.02, -1.48, -7.398, 0.005);
    for (const sy of [-1, 1]) box(2.05, 0.025, 0.03, brass, x, -1.48 + sy * 1.12, -7.398, 0.005);
  }
  box(17.8, 0.065, 0.055, neon('#ffbc69', 1.55), 0, 0.065, -7.405, 0.008);
  const footRail = cylinder(0.055, 0.055, 17.2, brass, 0, FLOOR + 0.44, -6.91);
  footRail.rotation.z = Math.PI / 2;
  for (const x of [-7, -3.5, 0, 3.5, 7]) {
    const bracket = cylinder(0.027, 0.027, 0.42, brass, x, FLOOR + 0.44, -7.12);
    bracket.rotation.x = Math.PI / 2;
  }
  const mirror = new THREE.Mesh(
    new THREE.PlaneGeometry(16.6, 4.8),
    new THREE.MeshPhysicalMaterial({ color: '#42514b', metalness: 0.82, roughness: 0.2, clearcoat: 1 }),
  );
  mirror.position.set(0, 1.0, -11.065);
  backBar.add(mirror);
  for (const x of [-8.45, 8.45]) box(0.13, 5.15, 0.14, brass, x, 1, -10.98, 0.02);
  for (const y of [-1.55, 3.55]) box(17.05, 0.13, 0.14, brass, 0, y, -10.98, 0.02);
  const shelfLevels = [-0.95, 0.45, 1.85];
  for (const y of shelfLevels) {
    box(16.5, 0.11, 0.9, walnut, 0, y, -10.62, 0.025);
    box(16.4, 0.025, 0.035, neon('#efb56c', 1.45), 0, y - 0.048, -10.255, 0.006);
  }
  // Broad shelf lighting gives glass and polished wood soft reflections.
  const shelfLight = new THREE.RectAreaLight('#ffdbaf', 3.8, 15.4, 0.65);
  shelfLight.position.set(0, 3.1, -9.3);
  shelfLight.lookAt(0, 0.3, -10.65);
  backBar.add(shelfLight);
  const barBounce = new THREE.RectAreaLight('#f0c39b', 1.4, 15, 2.5);
  barBounce.position.set(0, 1.1, -4.9);
  barBounce.lookAt(0, -1.1, -8.1);
  backBar.add(barBounce);
  const tableApronBounce = new THREE.RectAreaLight('#dfc5ab', 0.72, 8, 1.8);
  tableApronBounce.position.set(0, -0.4, 6.6);
  tableApronBounce.lookAt(0, -2.3, 0);
  room.add(tableApronBounce);
  const bottleColors = ['#315e39', '#654128', '#385c5d', '#75562c', '#244d37', '#6d2930'];
  const bottleGeometry = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.105, 0),
      new THREE.Vector2(0.13, 0.045),
      new THREE.Vector2(0.13, 0.45),
      new THREE.Vector2(0.09, 0.53),
      new THREE.Vector2(0.047, 0.57),
      new THREE.Vector2(0.047, 0.78),
      new THREE.Vector2(0, 0.79),
    ],
    20,
  );
  const bottlePlacements: PubPlacement[][] = PUB_PROPS.bottles.map(() => []),
    bottleFallbacks: THREE.Group[] = PUB_PROPS.bottles.map(() => {
      const group = new THREE.Group();
      backWallFittings.add(group);
      return group;
    });
  for (let row = 0; row < 3; row++)
    for (let i = 0; i < 24; i++) {
      const cluster = Math.floor(i / 4),
        within = i % 4;
      const x = -7.6 + cluster * 2.8 + within * 0.32 + ((row + within) % 3) * 0.04,
        y = shelfLevels[row] + 0.055,
        kind = (i + row * 3) % PUB_PROPS.bottles.length;
      const bottle = new THREE.Mesh(
        bottleGeometry,
        new THREE.MeshPhysicalMaterial({
          color: bottleColors[(i + row * 3) % bottleColors.length],
          roughness: 0.15,
          clearcoat: 1,
          metalness: 0.08,
        }),
      );
      bottle.position.set(x, y, -10.56);
      bottle.scale.y = 0.8 + ((i * 7 + row) % 5) * 0.12;
      bottle.castShadow = true;
      bottleFallbacks[kind].add(bottle);
      const label = new THREE.Mesh(
        new THREE.CylinderGeometry(0.132, 0.132, 0.18, 20),
        new THREE.MeshStandardMaterial({ color: (i + row) % 3 ? '#ccbc91' : '#392b24', roughness: 0.9 }),
      );
      label.position.set(x, y + 0.29 * bottle.scale.y, -10.56);
      bottleFallbacks[kind].add(label);
      bottlePlacements[kind].push({
        x,
        y,
        z: -10.56,
        height: 0.79 * bottle.scale.y,
        rotation: (((i * 11 + row) % 7) - 3) * 0.07,
      });
    }
  for (let i = 0; i < 8; i++) {
    const kind = i % 4,
      x = (i < 4 ? -6.3 : 5.6) + (i % 4) * 0.28;
    const bottle = new THREE.Mesh(
      bottleGeometry,
      new THREE.MeshPhysicalMaterial({ color: bottleColors[kind], roughness: 0.14, clearcoat: 1 }),
    );
    bottle.position.set(x, 0.325, -8.66);
    bottle.scale.y = 0.83 + (i % 3) * 0.1;
    bottleFallbacks[kind].add(bottle);
    bottlePlacements[kind].push({
      x,
      y: 0.325,
      z: -8.66,
      height: 0.79 * bottle.scale.y,
      rotation: ((i % 3) - 0.5) * 0.16,
    });
  }
  // Shelf-sized bottles keep their authored labels and silhouettes; embossed
  // lettering and tiny radial bevels use the separately authored shelf meshes.
  PUB_PROPS.bottles.forEach((path, i) =>
    installModel(path, bottlePlacements[i], [bottleFallbacks[i]], backWallFittings),
  );
  const signTexture = canvasTexture(2048, 384, (ctx) => {
    ctx.fillStyle = '#12251e';
    ctx.fillRect(0, 0, 2048, 384);
    ctx.strokeStyle = '#ad8e52';
    ctx.lineWidth = 8;
    ctx.strokeRect(15, 15, 2018, 354);
    ctx.fillStyle = '#ead7a8';
    ctx.textAlign = 'center';
    ctx.font = '96px Georgia';
    ctx.fillText('THE CORNER POCKET', 1024, 184);
    ctx.font = '30px Georgia';
    ctx.fillStyle = '#bd9c60';
    ctx.fillText('B I L L I A R D S   ·   B E E R   ·   G O O D   C O M P A N Y', 1024, 272);
  });
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(9.5, 1.78),
    new THREE.MeshStandardMaterial({ map: signTexture, roughness: 0.7, emissive: '#dab578', emissiveIntensity: 0.15 }),
  );
  sign.position.set(0, 4.9, -11.03);
  backBar.add(sign);
  for (const x of [-6.6, 6.6]) {
    box(0.14, 0.58, 0.18, brass, x, 4.55, -10.9, 0.03);
    const bulb = cylinder(0.2, 0.16, 0.5, neon('#ffd89b', 2), x, 4.15, -10.75);
    bulb.castShadow = false;
    const light = new THREE.PointLight('#ffc27d', 22, 7, 2);
    light.position.set(x, 3.9, -9.7);
    backBar.add(light);
  }
  const stoolPositions = [-5.8, -2.9, 0, 2.9, 5.8].map((x) => ({ x, z: -5.94 }));
  const fallbackStools = new THREE.Group();
  backBar.add(fallbackStools);
  for (const { x, z } of stoolPositions) {
    cylinder(0.53, 0.5, 0.19, leather, x, FLOOR + 2.81, z, fallbackStools);
    cylinder(0.09, 0.15, 2.58, blackMetal, x, FLOOR + 1.31, z, fallbackStools);
    cylinder(0.54, 0.61, 0.08, blackMetal, x, FLOOR + 0.06, z, fallbackStools);
    const rest = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.035, 8, 36), brass);
    rest.rotation.x = Math.PI / 2;
    rest.position.set(x, FLOOR + 0.95, z);
    fallbackStools.add(rest);
  }
  // The counter's stools are the generated model, installed with the other generated props; these
  // positions are handed over for that. backBar carries a z offset, so they are converted to world.
  PUB_SPORTS_STOOL_PLACEMENTS.push(
    ...stoolPositions.map(({ x, z }) => ({
      x,
      y: FLOOR,
      z: z + PUB_LAYOUT.backShift,
      height: 2.99,
      rotation: Math.PI,
    })),
  );
  fallbackStools.visible = false;
  return { countertop, shelfLevels, stoolPositions };
}

/** The service side of the bar: glass racks on the shelves, towels, the order terminal and trays. */
export function buildPubGlassware(
  kit: PubBuildKit,
  shelfParent: THREE.Group,
  materials: Pick<BarMaterials, 'brass' | 'blackMetal' | 'leather'>,
  shelfLevels: readonly number[],
) {
  const { box, cylinder } = kit;
  const { brass, blackMetal, leather } = materials;
  // A working back bar: glass racks, folded towels, an order terminal and serving trays.
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: '#d5e6db',
    transparent: true,
    opacity: 0.23,
    roughness: 0.12,
    metalness: 0.03,
    clearcoat: 1,
    depthWrite: false,
  });
  const glassGeometry = new THREE.CylinderGeometry(0.095, 0.075, 0.31, 14, 1, true),
    stemGeometry = new THREE.CylinderGeometry(0.02, 0.02, 0.16, 8),
    footGeometry = new THREE.CylinderGeometry(0.095, 0.095, 0.018, 14);
  const glasses = new THREE.InstancedMesh(glassGeometry, glassMaterial, 42),
    stems = new THREE.InstancedMesh(stemGeometry, glassMaterial, 42),
    feet = new THREE.InstancedMesh(footGeometry, glassMaterial, 42),
    matrix = new THREE.Matrix4();
  for (let i = 0; i < 42; i++) {
    const x = -7.65 + (i % 14) * 1.17,
      y = shelfLevels[Math.floor(i / 14)] + 0.055;
    glasses.setMatrixAt(i, matrix.makeTranslation(x, y + 0.31, pubBackZ(-10.12)));
    stems.setMatrixAt(i, matrix.makeTranslation(x, y + 0.09, pubBackZ(-10.12)));
    feet.setMatrixAt(i, matrix.makeTranslation(x, y + 0.012, pubBackZ(-10.12)));
  }
  shelfParent.add(glasses, stems, feet);
  const towel = new THREE.MeshStandardMaterial({ color: '#e4d9ba', roughness: 1 });
  for (const x of [-6.3, 1.3]) {
    box(0.62, 0.06, 0.44, towel, x, 0.37, -7.89, 0.018);
    box(0.025, 0.009, 0.39, leather, x - 0.19, 0.405, -7.89, 0.003);
    box(0.025, 0.009, 0.39, leather, x + 0.19, 0.405, -7.89, 0.003);
  }
  box(0.85, 0.13, 0.57, blackMetal, 7.6, 0.405, -8.05, 0.04);
  const till = box(0.8, 0.59, 0.09, blackMetal, 7.6, 0.72, -8.2, 0.045);
  till.rotation.x = -0.2;
  box(
    0.65,
    0.39,
    0.012,
    new THREE.MeshStandardMaterial({ color: '#74a894', emissive: '#86bfa9', emissiveIntensity: 0.13 }),
    7.6,
    0.74,
    -8.132,
    0.02,
  );
  for (const x of [-6.9, 6.3]) {
    const tray = cylinder(0.33, 0.33, 0.045, brass, x, 0.36, -7.86);
    tray.material = brass;
  }
}

/** Wall-mounted cue rack with full-length cues, chalk shelf and framed club prints. */
export function buildPubCueRack(
  kit: PubBuildKit,
  backBar: THREE.Group,
  materials: Pick<BarMaterials, 'walnut' | 'brass'>,
) {
  const { box, cylinder } = kit;
  const { walnut, brass } = materials;
  for (const x of [-12.55, -11.7, -10.85, -10]) {
    const cue = cylinder(
      0.028,
      0.056,
      4.0,
      new THREE.MeshStandardMaterial({ color: '#b89055', roughness: 0.4 }),
      x,
      FLOOR + 2.2,
      -10.77,
    );
    cue.rotation.z = -0.025;
  }
  box(3.45, 0.13, 0.4, walnut, -11.28, FLOOR + 0.2, -10.72, 0.025);
  box(3.45, 0.12, 0.23, walnut, -11.28, FLOOR + 3.7, -10.75, 0.025);
  for (const x of [-12.3, 12.3]) {
    box(1.8, 2.4, 0.15, brass, x, 2.15, -11.02, 0.04);
    const art = canvasTexture(256, 384, (ctx) => {
      ctx.fillStyle = '#202f27';
      ctx.fillRect(0, 0, 256, 384);
      ctx.fillStyle = '#bb9b65';
      ctx.textAlign = 'center';
      ctx.font = '32px Georgia';
      ctx.fillText(x < 0 ? 'EST. 1928' : 'OPEN LATE', 128, 67);
      ctx.beginPath();
      ctx.arc(128, 205, 78, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#26332a';
      ctx.beginPath();
      ctx.arc(128, 205, 62, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d9c795';
      ctx.font = 'bold 65px Georgia';
      ctx.fillText('8', 128, 227);
    });
    const print = new THREE.Mesh(
      new THREE.PlaneGeometry(1.62, 2.23),
      new THREE.MeshStandardMaterial({ map: art, roughness: 0.83 }),
    );
    print.position.set(x, 2.15, -10.935);
    backBar.add(print);
  }
}
