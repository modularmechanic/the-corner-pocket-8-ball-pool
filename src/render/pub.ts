import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { canvasTexture, woodTexture } from './materials';
import { buildPubInterior, updateBilliardFixture } from './pub-interior';
import { buildPubDressing } from './pub-dressing';
import { buildPubGallery } from './pub-gallery';
import { buildPubDrinks } from './pub-drinks';
import { buildPubEntertainment } from './pub-entertainment';
import { PUB_LAYOUT, pubBackZ, pubFrontZ, pubSideX } from './pub-layout';
import { disposePubObject, type PubPlacement } from './pub-models';
import { batchPubStatic, pubBatchDiagnostics } from './pub-batching';
import { buildPubClubDecor } from './pub-club-decor';
import type { PropInstaller } from './asset-installer';
import { requestWoodScan } from './table-surfaces';

const FLOOR = -3.6;
/** Prop paths relative to public/. The wood scans are shared with the table (WOOD_SCAN_MAPS). */
export const PUB_PROPS = {
  lamp: 'models/pub/heritage-lamp.glb',
  jukebox: 'models/pub/heritage-jukebox.glb',
  wallPanel: 'models/pub/wall-panel.glb',
  bench: 'models/pub/booth-bench.glb',
  table: 'models/pub/oak-pub-table.glb',
  chair: 'models/pub/pub-chair.glb',
  pint: 'models/pub/pub-pint.glb',
  taps: 'models/pub/brass-beer-taps.glb',
  stool: 'models/stool/metal_stool_01.gltf',
  bottles: [
    'models/pub/liquor-amber-lod.glb',
    'models/pub/liquor-green-lod.glb',
    'models/pub/liquor-square-lod.glb',
    'models/pub/liquor-decanter-lod.glb',
  ],
  stone: [
    ['map', 'textures/pub/stone-color.webp'],
    ['normalMap', 'textures/pub/stone-normal.webp'],
    ['roughnessMap', 'textures/pub/stone-roughness.webp'],
  ],
} as const;
/** Material quirks of the bar's authored models, applied once per file. */
const preparePubModel = (path: string) => (source: THREE.Object3D) =>
  source.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (path === PUB_PROPS.jukebox) {
      const softenGlass = (material: THREE.Material) => {
        if (!material.name.startsWith('Optical glass')) return material;
        const glass = new THREE.MeshPhysicalMaterial({
          name: material.name,
          color: '#c4d4c8',
          transparent: true,
          opacity: 0.035,
          roughness: 0.14,
          metalness: 0,
          clearcoat: 0,
          specularIntensity: 0.08,
          ior: 1.15,
          depthWrite: false,
          side: THREE.FrontSide,
        });
        material.dispose();
        return glass;
      };
      object.material = Array.isArray(object.material)
        ? object.material.map(softenGlass)
        : softenGlass(object.material);
    }
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      if (path !== PUB_PROPS.jukebox && material.name.startsWith('Optical glass')) {
        material.opacity = 0.07;
        material.roughness = 0.03;
        material.metalness = 0;
        material.depthWrite = false;
      }
      if (path === PUB_PROPS.jukebox && material.name === 'Black enamel') {
        material.roughness = 0.58;
        material.metalness = 0.06;
        material.envMapIntensity = 0.35;
      }
      if (path === PUB_PROPS.wallPanel && material.name === 'Warm plaster') {
        material.color.set('#d8be86');
        material.roughness = 0.98;
      }
    }
  });
RectAreaLightUniformsLib.init();
/** Dispose `installer` before the returned room, so no prop arrives into a disposed room. */
export function buildPub(scene: THREE.Scene, installer: PropInstaller) {
  const room = new THREE.Group();
  scene.add(room);
  const backBar = new THREE.Group(),
    backWallFittings = new THREE.Group();
  backBar.name = 'pub-rear-bar';
  backBar.position.z = PUB_LAYOUT.backShift;
  backBar.add(backWallFittings);
  room.add(backBar);
  let propsParent = room;
  const glows: THREE.MeshStandardMaterial[] = [];
  const installModel = (
    path: string,
    placements: PubPlacement[],
    placeholder: THREE.Object3D[] = [],
    parent: THREE.Group = propsParent,
  ) => installer.model(path, { parent, placements, placeholder, prepare: preparePubModel(path) });
  const walnut = new THREE.MeshStandardMaterial({
    normalScale: new THREE.Vector2(0.24, 0.24),
    color: '#b39172',
    roughness: 0.68,
  });
  const brass = new THREE.MeshStandardMaterial({ color: '#bc9556', metalness: 0.78, roughness: 0.32 });
  const blackMetal = new THREE.MeshStandardMaterial({ color: '#232b29', metalness: 0.7, roughness: 0.43 });
  const leather = new THREE.MeshPhysicalMaterial({ color: '#4e2025', roughness: 0.57, clearcoat: 0.18 });
  const box = (
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    round = 0.035,
    parent: THREE.Group = propsParent,
  ) => {
    const geometry = new RoundedBoxGeometry(w, h, d, 2, round);
    if (w > 30) {
      const uv = geometry.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * PUB_LAYOUT.expansion);
    }
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const cylinder = (
    rt: number,
    rb: number,
    h: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    parent: THREE.Group = propsParent,
  ) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 32), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const neon = (color: string, intensity = 2) => {
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: intensity,
      roughness: 0.3,
    });
    glows.push(material);
    return material;
  };
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
  const plaster = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#ddcda9';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 18000; i++) {
      ctx.fillStyle = `rgba(16,20,13,${Math.random() * 0.045})`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
  });
  const wall = new THREE.MeshStandardMaterial({ map: plaster, color: '#fff2dc', roughness: 0.98 });
  const interior = buildPubInterior(room, installer, { wood: walnut, brass, wall, metal: blackMetal });
  const billiardFixture = new THREE.Group();
  billiardFixture.name = 'billiard-light-fixture';
  room.add(billiardFixture);
  installModel(PUB_PROPS.lamp, [{ x: 0, y: 3.75, z: 0, height: 2.5 }], [], billiardFixture);
  propsParent = backBar;
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
  installModel(
    PUB_PROPS.stool,
    stoolPositions.map(({ x, z }) => ({ x, y: FLOOR, z, height: 2.99, rotation: Math.PI })),
    [fallbackStools],
    backBar,
  );
  const redSeatTexture = canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#772e31';
    ctx.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 4)
      for (let x = 0; x < 128; x += 4) {
        ctx.fillStyle = (x + y) % 8 ? '#ad62561c' : '#220f122b';
        ctx.fillRect(x, y, 2, 2);
      }
  });
  const redSeat = new THREE.MeshStandardMaterial({ map: redSeatTexture, roughness: 0.91 });
  for (const { x, z } of stoolPositions) cylinder(0.52, 0.53, 0.115, redSeat, x, FLOOR + 3.025, z);
  propsParent = room;
  // A curved, illuminated cabinet places a recognisable jukebox beside the table.
  const jukebox = new THREE.Group();
  jukebox.position.set(PUB_LAYOUT.jukebox.x - 0.1, FLOOR, PUB_LAYOUT.jukebox.z);
  jukebox.rotation.y = PUB_LAYOUT.jukebox.rotation;
  room.add(jukebox);
  const outline = new THREE.Shape();
  outline.moveTo(-1.07, 0);
  outline.lineTo(1.07, 0);
  outline.lineTo(1.07, 2.65);
  outline.absarc(0, 2.65, 1.07, 0, Math.PI, false);
  outline.lineTo(-1.07, 0);
  const shell = new THREE.Mesh(
    new THREE.ExtrudeGeometry(outline, {
      depth: 0.76,
      bevelEnabled: true,
      bevelSize: 0.06,
      bevelThickness: 0.06,
      bevelSegments: 3,
      steps: 1,
    }),
    new THREE.MeshPhysicalMaterial({ color: '#423126', map: woodTexture(), roughness: 0.32, clearcoat: 0.6 }),
  );
  shell.position.z = -0.38;
  shell.castShadow = true;
  jukebox.add(shell);
  for (let layer = 0; layer < 3; layer++) {
    const r = 1.01 - layer * 0.105,
      points = [new THREE.Vector3(-r, 0.12, 0.46), new THREE.Vector3(-r, 2.65, 0.46)];
    for (let i = 0; i <= 40; i++) {
      const angle = Math.PI - (i / 40) * Math.PI;
      points.push(new THREE.Vector3(Math.cos(angle) * r, 2.65 + Math.sin(angle) * r, 0.46));
    }
    points.push(new THREE.Vector3(r, 0.12, 0.46));
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 96, 0.026, 8, false),
      neon(['#ffc071', '#65ccbd', '#f59177'][layer], 1.7),
    );
    jukebox.add(tube);
  }
  box(
    1.52,
    1.05,
    0.06,
    new THREE.MeshStandardMaterial({ color: '#172520', roughness: 0.75 }),
    0,
    0.83,
    0.43,
    0.05,
    jukebox,
  );
  for (let x = -0.67; x <= 0.68; x += 0.135) box(0.025, 0.92, 0.045, brass, x, 0.83, 0.48, 0.009, jukebox);
  const record = cylinder(
    0.54,
    0.54,
    0.035,
    new THREE.MeshStandardMaterial({ color: '#171a16', roughness: 0.24 }),
    0,
    2.38,
    0.47,
    jukebox,
  );
  record.rotation.x = Math.PI / 2;
  const recordLabel = cylinder(
    0.15,
    0.15,
    0.04,
    new THREE.MeshStandardMaterial({ color: '#c39a59', roughness: 0.55 }),
    0,
    2.38,
    0.48,
    jukebox,
  );
  recordLabel.rotation.x = Math.PI / 2;
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(1.41, 1.35),
    new THREE.MeshPhysicalMaterial({
      color: '#bddacf',
      transparent: true,
      opacity: 0.13,
      roughness: 0.06,
      metalness: 0.3,
      depthWrite: false,
    }),
  );
  glass.position.set(0, 2.4, 0.53);
  jukebox.add(glass);
  for (let i = 0; i < 7; i++)
    box(
      0.12,
      0.095,
      0.045,
      new THREE.MeshStandardMaterial({ color: i % 2 ? '#eee0b9' : '#e5a662', roughness: 0.25 }),
      -0.51 + i * 0.17,
      1.47,
      0.53,
      0.02,
      jukebox,
    );
  const jukeboxLight = new THREE.PointLight('#eaa56a', 3, 5, 2);
  jukeboxLight.position.set(PUB_LAYOUT.jukebox.x + 0.9, -0.45, PUB_LAYOUT.jukebox.z);
  room.add(jukeboxLight);
  installModel(PUB_PROPS.jukebox, [{ ...PUB_LAYOUT.jukebox }], [jukebox]);
  // Blender-authored furniture replaces complete fallback groups after loading.
  const fallbackBenches = new THREE.Group(),
    fallbackTables = new THREE.Group(),
    fallbackPints = new THREE.Group(),
    fallbackChairs = new THREE.Group(),
    fallbackTaps = new THREE.Group();
  room.add(fallbackBenches, fallbackTables, fallbackPints, fallbackChairs, fallbackTaps);
  const benchPlacements: PubPlacement[] = [],
    tablePlacements: PubPlacement[] = [],
    pintPlacements: PubPlacement[] = [],
    chairPlacements: PubPlacement[] = [];
  const addTable = (x: number, z: number) => {
    box(2.62, 0.14, 1.48, countertop, x, FLOOR + 2.35, z, 0.11, fallbackTables);
    cylinder(0.16, 0.2, 2.18, blackMetal, x, FLOOR + 1.11, z, fallbackTables);
    cylinder(0.67, 0.67, 0.06, blackMetal, x, FLOOR + 0.04, z, fallbackTables);
    tablePlacements.push({ x, y: FLOOR, z, height: 2.42 });
  };
  const addPint = (x: number, y: number, z: number, rotation = 0) => {
    cylinder(
      0.13,
      0.09,
      0.41,
      new THREE.MeshPhysicalMaterial({ color: '#b28430', roughness: 0.13, metalness: 0.2, clearcoat: 1 }),
      x,
      y + 0.215,
      z,
      fallbackPints,
    );
    cylinder(
      0.18,
      0.18,
      0.02,
      new THREE.MeshStandardMaterial({ color: '#b49c74', roughness: 0.95 }),
      x,
      y + 0.01,
      z,
      fallbackPints,
    );
    pintPlacements.push({ x, y, z, height: 0.46, rotation });
  };
  // Opposed leather booths retain a clear aisle around the playing table.
  for (const z of [-3.25, 3.0]) {
    for (const sign of [-1, 1]) {
      box(3.05, 0.52, 0.89, leather, pubSideX(10.55), FLOOR + 1.31, z + sign * 1.37, 0.16, fallbackBenches);
      box(3.15, 1.58, 0.24, leather, pubSideX(10.55), FLOOR + 2.0, z + sign * 1.82, 0.13, fallbackBenches);
      box(3.0, 0.93, 0.67, walnut, pubSideX(10.55), FLOOR + 0.61, z + sign * 1.37, 0.035, fallbackBenches);
      for (const x of [9.4, 10.18, 10.95, 11.7]) {
        const button = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), brass);
        button.position.set(pubSideX(x), FLOOR + 2.15, z + sign * 1.675);
        fallbackBenches.add(button);
      }
      benchPlacements.push({
        x: pubSideX(10.55),
        y: FLOOR,
        z: z + sign * 1.55,
        rotation: sign < 0 ? 0 : Math.PI,
        height: 2.7,
      });
    }
    addTable(pubSideX(10.55), z);
    addPint(pubSideX(10.1), FLOOR + 2.42, z - 0.22, 0.15);
    addPint(pubSideX(10.8), FLOOR + 2.42, z + 0.31, -0.5);
    const lampShade = cylinder(
      0.32,
      0.48,
      0.4,
      new THREE.MeshStandardMaterial({ color: '#b69457', roughness: 0.7 }),
      pubSideX(11.4),
      FLOOR + 3.05,
      z,
    );
    lampShade.castShadow = false;
    cylinder(0.045, 0.11, 0.55, brass, pubSideX(11.4), FLOOR + 2.67, z);
    const light = new THREE.PointLight('#eeba77', 15, 6, 2);
    light.position.set(pubSideX(11.4), FLOOR + 3.1, z);
    room.add(light);
  }
  for (const [oldX, oldZ] of [
    [-10.65, 3.2],
    [-10.65, 7.15],
    [9.7, 7.25],
    [-5.25, 8.35],
    [5.25, 8.35],
  ]) {
    const x = Math.abs(oldX) > 8 ? pubSideX(oldX) : oldX,
      z = oldZ > 5 ? pubFrontZ(oldZ) : oldZ;
    addTable(x, z);
    addPint(x - 0.53, FLOOR + 2.42, z - 0.1, 0.35);
    addPint(x + 0.48, FLOOR + 2.42, z + 0.14, -0.8);
    for (const sign of [-1, 1]) {
      const chair = new THREE.Group();
      chair.position.set(x, FLOOR, z + sign * 1.45);
      chair.rotation.y = sign < 0 ? 0 : Math.PI;
      fallbackChairs.add(chair);
      box(1.02, 0.17, 0.94, leather, 0, 1.31, 0, 0.08, chair);
      box(1.02, 1.34, 0.15, walnut, 0, 2.01, -0.39, 0.04, chair);
      for (const cx of [-0.4, 0.4])
        for (const cz of [-0.35, 0.35]) box(0.095, 1.27, 0.095, walnut, cx, 0.635, cz, 0.018, chair);
      chairPlacements.push({ x, y: FLOOR, z: z + sign * 1.45, rotation: chair.rotation.y, height: 2.76 });
    }
  }
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
  interior.walls.back.add(glasses, stems, feet);
  propsParent = backBar;
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
  propsParent = room;
  installModel(PUB_PROPS.bench, benchPlacements, [fallbackBenches]);
  installModel(PUB_PROPS.table, tablePlacements, [fallbackTables]);
  installModel(PUB_PROPS.chair, chairPlacements, [fallbackChairs]);
  installModel(PUB_PROPS.pint, pintPlacements, [fallbackPints]);

  // Local ambient occlusion under feet grounds furniture without a room-wide shadow pass.
  const contactMap = canvasTexture(128, 128, (ctx) => {
    const gradient = ctx.createRadialGradient(64, 64, 8, 64, 64, 63);
    gradient.addColorStop(0, 'rgba(0,0,0,.65)');
    gradient.addColorStop(0.42, 'rgba(0,0,0,.38)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  });
  const contacts: Array<[number, number, number, number]> = [];
  for (const p of stoolPositions) contacts.push([p.x, pubBackZ(p.z), 1.6, 1.6]);
  for (const p of tablePlacements) contacts.push([p.x, p.z, 1.9, 1.65]);
  for (const p of benchPlacements) contacts.push([p.x, p.z, 3.4, 1.5]);
  for (const p of chairPlacements)
    for (const x of [-0.4, 0.4]) for (const z of [-0.4, 0.4]) contacts.push([p.x + x, p.z + z, 0.62, 0.62]);
  contacts.push(
    [PUB_LAYOUT.jukebox.x + 0.13, PUB_LAYOUT.jukebox.z, 1.55, 2.8],
    [pubSideX(-12.25), pubBackZ(-7.3), 4.1, 2.7],
  );
  const contactShadows = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: contactMap,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      opacity: 0.72,
    }),
    contacts.length,
  );
  const contactRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  contacts.forEach(([x, z, w, d], i) =>
    contactShadows.setMatrixAt(
      i,
      new THREE.Matrix4().compose(new THREE.Vector3(x, FLOOR + 0.012, z), contactRotation, new THREE.Vector3(w, d, 1)),
    ),
  );
  contactShadows.name = 'furniture-contact-occlusion';
  contactShadows.computeBoundingSphere();
  room.add(contactShadows);

  installModel(PUB_PROPS.taps, tapPlacements, [fallbackTaps]);
  // Full moulded panels face inward along both side walls and the rear wings.
  const panels: PubPlacement[] = [];
  for (const x of [-16.5, -13.5, -10.5, 10.5, 13.5, 16.5]) panels.push({ x, y: FLOOR, z: pubBackZ(-11.14) });
  installModel(PUB_PROPS.wallPanel, panels, [], interior.walls.back);
  for (const side of [-1, 1]) {
    const sidePanels: PubPlacement[] = [];
    for (const z of [-11.9, -8.9, -5.9, -2.9, 0.1, 3.1, 6.1, 9.1, 12.1])
      sidePanels.push({ x: pubSideX(side * 14.57), y: FLOOR, z, rotation: (-side * Math.PI) / 2, height: 2.15 });
    installModel(PUB_PROPS.wallPanel, sidePanels, [], side < 0 ? interior.walls.left : interior.walls.right);
  }
  installModel(
    PUB_PROPS.wallPanel,
    [-15, -12, -9, -6, 6, 9, 12, 15].map((x) => ({ x, y: FLOOR, z: pubFrontZ(11.7), rotation: Math.PI, height: 2.15 })),
    [],
    interior.walls.front,
  );
  propsParent = backBar;
  // Wall-mounted cue rack with full-length cues, chalk shelf and framed club prints.
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
  // Back-wall fittings follow the rear cutaway too, so a rear orbit never looks through opaque framed prints.
  for (const object of [...backBar.children])
    if (object instanceof THREE.Mesh && object.position.z < -10.2) backWallFittings.add(object);
  const dressing = buildPubDressing(room, installer, interior.walls);
  buildPubGallery(room, installer, interior.walls);
  const drinks = buildPubDrinks(room, installer, { shelfParent: interior.walls.back });
  const entertainment = buildPubEntertainment(room, installer, interior.walls);
  const clubDecor = buildPubClubDecor(interior.walls, installer);
  // Group boundaries remain intact: placeholder swaps, walls, screens and the
  // hanging fixture can still change independently. No work runs per frame.
  for (const section of [room, backBar, backWallFittings]) batchPubStatic(section);
  return {
    group: room,
    diagnostics: () => ({ ...pubBatchDiagnostics(room), clubDecor: clubDecor.diagnostics() }),
    withEnclosedRoom(capture: () => void) {
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
