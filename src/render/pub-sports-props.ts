import * as THREE from 'three';
import { PUB_LAYOUT, pubFrontZ, pubSideX } from './pub-layout';
import type { PropInstaller } from './asset-installer';
import type { PubPlacement } from './pub-models';
import {
  barStoolTexture,
  beerBottleTexture,
  brushedSteelTexture,
  coasterBoardTexture,
  dartboardFaceTexture,
  poolTableTexture,
  tableTopTexture,
  wallScreenTexture,
} from './pub-sports-textures';

const FLOOR = PUB_LAYOUT.floor;
const BOUNDS = PUB_LAYOUT.bounds;
const COUNTER_Y = PUB_LAYOUT.bar.counterY;
const COUNTER_Z = PUB_LAYOUT.bar.counterZ;
/** Sports-bar fittings generated from reference photos. Paths are relative to public/. */
export const PUB_SPORTS_PROPS = {
  dartboard: 'models/pub/sports-dartboard.glb',
  taps: 'models/pub/beer-tap-tower.glb',
  trophy: 'models/pub/sports-trophy.glb',
  stool: 'models/pub/oak-bar-stool.glb',
  roundTable: 'models/pub/oak-table-round.glb',
  longTable: 'models/pub/oak-table-long.glb',
  poolTable: 'models/pub/snug-pool-table.glb',
  bottle: 'models/pub/house-beer-bottle.glb',
  keg: 'models/pub/beer-keg.glb',
  coasters: 'models/pub/beer-coasters.glb',
  ashtray: 'models/pub/pub-ashtray.glb',
  screen: 'models/pub/wall-screen.glb',
} as const;

/** Roughly four units to the metre, matching the handpumps and the hearth.
 * The dartboard sits at regulation centre height; the cellar stack stands off the end of the bar. */
/** Filled in by the room build, which owns where these stand: the counter's taps, the stools at the
 * bar and the machines, the booth tables and the loose tables. The generated models are installed
 * here so they get their projected UVs and materials. */
export const PUB_SPORTS_TAP_PLACEMENTS: PubPlacement[] = [];
export const PUB_SPORTS_STOOL_PLACEMENTS: PubPlacement[] = [];
export const PUB_SPORTS_BOOTH_TABLES: PubPlacement[] = [];
export const PUB_SPORTS_LOOSE_TABLES: PubPlacement[] = [];

export const PUB_SPORTS_PLACEMENTS = {
  dartboard: [{ x: pubSideX(-4.82), y: 0.48, z: pubFrontZ(11.5), rotation: Math.PI, height: 2.34 }],
  taps: PUB_SPORTS_TAP_PLACEMENTS,
  stool: PUB_SPORTS_STOOL_PLACEMENTS,
  longTable: PUB_SPORTS_BOOTH_TABLES,
  roundTable: PUB_SPORTS_LOOSE_TABLES,
  // The snug's second table, on the clear floor at the front of the room.
  poolTable: [{ x: -12.5, y: FLOOR, z: 12.6, rotation: Math.PI / 2, height: 3.1 }],
  bottle: [{ x: -1.0, y: COUNTER_Y, z: COUNTER_Z - 0.55, rotation: 0.5, height: 0.98 }],
  trophy: [{ x: -7.4, y: COUNTER_Y, z: COUNTER_Z - 0.55, rotation: 0.4, height: 1.25 }],
  // Draught stock: four kegs stood against the bar's end, two more stacked on top of them.
  keg: [
    { x: BOUNDS.left + 2.2, y: FLOOR, z: -6.6, rotation: -0.35, height: 2.34 },
    { x: BOUNDS.left + 4.1, y: FLOOR, z: -6.6, rotation: 0.6, height: 2.34 },
    { x: BOUNDS.left + 2.2, y: FLOOR, z: -4.7, rotation: 1.9, height: 2.34 },
    { x: BOUNDS.left + 4.1, y: FLOOR, z: -4.7, rotation: 2.7, height: 2.34 },
    { x: BOUNDS.left + 2.2, y: FLOOR + 2.34, z: -6.6, rotation: 1.2, height: 2.34 },
    { x: BOUNDS.left + 4.1, y: FLOOR + 2.34, z: -6.6, rotation: 2.2, height: 2.34 },
  ],
  coasters: [{ x: -1.0, y: COUNTER_Y, z: COUNTER_Z + 0.5, rotation: 0.2, height: 0.2 }],
  ashtray: [{ x: -1.93, y: COUNTER_Y, z: COUNTER_Z + 0.5, rotation: -0.5, height: 0.22 }],
  // Past the club display run, which ends at z 8.3 and would otherwise stand in front of it.
  screen: [{ x: BOUNDS.left + 0.25, y: 2.1, z: 10.45, rotation: Math.PI / 2, height: 2.3 }],
} satisfies Record<string, PubPlacement[]>;

/** These props are marching-cubes output: position only, no UVs at all. Projected coordinates are
 * what lets them take an ordinary map, so each prop is unwrapped by the shape it actually is. */
function projectUvs(geometry: THREE.BufferGeometry, mode: 'planar' | 'cylindrical' | 'top', repeat = 1) {
  const position = geometry.attributes.position;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const size = box.getSize(new THREE.Vector3());
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      y = position.getY(i),
      z = position.getZ(i);
    if (mode === 'top') {
      // Flat, printed things (a coaster stack, a table top) show their face from above.
      uv[i * 2] = ((x - box.min.x) / (size.x || 1)) * repeat;
      uv[i * 2 + 1] = ((z - box.min.z) / (size.z || 1)) * repeat;
      continue;
    }
    uv[i * 2] =
      mode === 'planar'
        ? ((x - box.min.x) / (size.x || 1)) * repeat
        : ((Math.atan2(z, x) / (Math.PI * 2) + 0.5) % 1) * repeat;
    uv[i * 2 + 1] = ((y - box.min.y) / (size.y || 1)) * repeat;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** One material per prop, applied to the shared parsed source before it is instanced. */
function paint(object: THREE.Object3D, material: THREE.Material, mode: 'planar' | 'cylindrical' | 'top', repeat = 1) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    projectUvs(child.geometry, mode, repeat);
    child.material = material;
    child.castShadow = true;
    child.receiveShadow = true;
  });
}

type Unwrap = { mode: 'planar' | 'cylindrical' | 'top'; repeat: number };
/** How each prop is unwrapped: upright round props wrap around, flat ones project front-on or plan-on. */
const UNWRAP = {
  dartboard: { mode: 'planar', repeat: 1 },
  keg: { mode: 'cylindrical', repeat: 2 },
  taps: { mode: 'cylindrical', repeat: 1 },
  stool: { mode: 'cylindrical', repeat: 1 },
  roundTable: { mode: 'top', repeat: 1 },
  longTable: { mode: 'top', repeat: 1 },
  poolTable: { mode: 'top', repeat: 1 },
  bottle: { mode: 'cylindrical', repeat: 1 },
  trophy: { mode: 'cylindrical', repeat: 1 },
  coasters: { mode: 'top', repeat: 1 },
  ashtray: { mode: 'cylindrical', repeat: 1 },
  screen: { mode: 'planar', repeat: 1 },
} satisfies Record<keyof typeof PUB_SPORTS_PROPS, Unwrap>;

/** Materials plus the per-prop preparation the installer runs on each shared source.
 * Exported whole so an asset viewer shows exactly what the room shows. */
export function sportsPropPrep() {
  const repeating = (texture: THREE.Texture) => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
  };
  const steel = repeating(brushedSteelTexture()),
    oakTop = repeating(tableTopTexture());

  const materials = {
    dartboard: new THREE.MeshStandardMaterial({ map: dartboardFaceTexture(), roughness: 0.74, metalness: 0 }),
    keg: new THREE.MeshStandardMaterial({ map: steel, metalness: 0.82, roughness: 0.38 }),
    taps: new THREE.MeshStandardMaterial({ map: steel, metalness: 0.9, roughness: 0.17 }),
    stool: new THREE.MeshStandardMaterial({ map: repeating(barStoolTexture()), roughness: 0.62 }),
    roundTable: new THREE.MeshStandardMaterial({ map: oakTop, roughness: 0.5 }),
    longTable: new THREE.MeshStandardMaterial({ map: oakTop, roughness: 0.5 }),
    poolTable: new THREE.MeshStandardMaterial({ map: repeating(poolTableTexture()), roughness: 0.78 }),
    bottle: new THREE.MeshPhysicalMaterial({ map: repeating(beerBottleTexture()), roughness: 0.16, clearcoat: 0.7 }),
    trophy: new THREE.MeshStandardMaterial({ color: '#d8ae4c', metalness: 0.94, roughness: 0.22 }),
    coasters: new THREE.MeshStandardMaterial({ map: repeating(coasterBoardTexture()), roughness: 0.94 }),
    // Pressed black glass: almost no roughness, so the counter lights catch the rim.
    ashtray: new THREE.MeshPhysicalMaterial({
      color: '#2b3034',
      roughness: 0.06,
      metalness: 0,
      clearcoat: 0.9,
      clearcoatRoughness: 0.06,
    }),
    // An unpowered panel: dark, smooth, and only ever showing the room back at itself.
    screen: new THREE.MeshPhysicalMaterial({
      map: wallScreenTexture(),
      roughness: 0.14,
      metalness: 0.2,
      clearcoat: 0.6,
    }),
  };
  return {
    materials,
    prepare: (key: keyof typeof PUB_SPORTS_PROPS) => (source: THREE.Object3D) =>
      paint(source, materials[key], UNWRAP[key].mode, UNWRAP[key].repeat),
  };
}

/** Warm practicals for the corners the room's own lamps never reached: over the darts wall, over the
 * cellar stack at the end of the bar, and soft fills on the snug table and the second cabinet. */
function addPracticals(room: THREE.Group) {
  const board = PUB_SPORTS_PLACEMENTS.dartboard[0],
    kegs = PUB_SPORTS_PLACEMENTS.keg;
  const lights: THREE.PointLight[] = [];
  const lamp = (color: string, intensity: number, distance: number, x: number, y: number, z: number) => {
    const light = new THREE.PointLight(color, intensity, distance, 2);
    light.position.set(x, y, z);
    room.add(light);
    lights.push(light);
  };
  lamp('#ffd9a0', 13, 8, board.x, board.y + 2.4, board.z - 1.15);
  // The stack sits in the old cellar corner: a hanging bulb above it and a low bounce off the floor.
  lamp('#ffcb8c', 30, 14, kegs[0].x + 0.9, FLOOR + 6.4, kegs[0].z + 0.9);
  lamp('#ffb774', 12, 8.5, kegs[3].x, FLOOR + 1.5, kegs[3].z + 1.4);
  lamp('#ffd2a2', 14, 11, -12, FLOOR + 5.6, 8);
  lamp('#ffd2a2', 11, 9.5, -12.8, FLOOR + 5.2, 2.5);
  return lights;
}

/** Generated sports-bar fittings: the darts wall, counter service, the cellar stack by the bar,
 * snug seating and a second cabinet. Each prop owns its material; the room disposes them with it. */
export function buildPubSportsProps(
  room: THREE.Group,
  installer: PropInstaller,
  walls: { front: THREE.Group; right: THREE.Group; left: THREE.Group },
) {
  const assets = new THREE.Group();
  assets.name = 'pub-sports-props';
  room.add(assets);
  const wallAssets = new THREE.Group();
  wallAssets.name = 'pub-sports-wall-props';
  walls.front.add(wallAssets);
  // The screen hangs on the left wall, so it hides with that wall on a camera cutaway.
  const leftWallAssets = new THREE.Group();
  leftWallAssets.name = 'pub-sports-left-wall-props';
  walls.left.add(leftWallAssets);
  const { materials, prepare } = sportsPropPrep();

  const parentOf = (key: keyof typeof PUB_SPORTS_PROPS) =>
    key === 'dartboard' ? wallAssets : key === 'screen' ? leftWallAssets : assets;
  for (const key of Object.keys(PUB_SPORTS_PROPS) as (keyof typeof PUB_SPORTS_PROPS)[])
    installer.model(PUB_SPORTS_PROPS[key], {
      parent: parentOf(key),
      placements: PUB_SPORTS_PLACEMENTS[key],
      prepare: prepare(key),
    });

  return { materials, lights: addPracticals(room) };
}
