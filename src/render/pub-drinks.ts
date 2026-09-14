import * as THREE from 'three';
import { canvasTexture } from './materials';
import { PUB_LAYOUT, pubFrontZ, pubSideX } from './pub-layout';
import { disposePubObject, instancePubModel, type PubPlacement } from './pub-models';
import type { PropInstaller } from './asset-installer';

export const PUB_DRINK_ASSETS = {
  bottles: ['bottle-copperfin', 'bottle-northstar', 'bottle-juniper', 'bottle-redharbor', 'bottle-orchard'],
  glasses: ['drink-martini', 'drink-citrus', 'drink-whisky', 'drink-redwine', 'drink-cola'],
} as const;
/** Prop paths relative to public/: shelf-sized bottle meshes, counter hero bottles and glassware. */
export const PUB_DRINK_PROPS = {
  shelfBottles: PUB_DRINK_ASSETS.bottles.map((name) => `models/pub/${name}-lod.glb`),
  counterBottles: PUB_DRINK_ASSETS.bottles.map((name) => `models/pub/${name}.glb`),
  glasses: PUB_DRINK_ASSETS.glasses.map((name) => `models/pub/${name}.glb`),
};

export interface PubDrinksLayout {
  shelfParent?: THREE.Group;
  shelfLevels: readonly number[];
  shelfZ: number;
  counterY: number;
  counterZ: number;
  tables: readonly { x: number; y: number; z: number }[];
}

/** These dimensions are surface heights, not model centers. Props retain their native proportions. */
export const PUB_DRINK_LAYOUT: Omit<PubDrinksLayout, 'shelfParent'> = {
  shelfLevels: [-0.895, 0.505, 1.905],
  shelfZ: PUB_LAYOUT.bar.backZ - 0.32,
  counterY: PUB_LAYOUT.bar.counterY,
  counterZ: PUB_LAYOUT.bar.counterZ,
  tables: [
    { x: pubSideX(10.55), y: -1.18, z: -3.25 },
    { x: pubSideX(10.55), y: -1.18, z: 3 },
    { x: pubSideX(-10.65), y: -1.18, z: 3.2 },
    { x: pubSideX(-10.65), y: -1.18, z: pubFrontZ(7.15) },
    { x: pubSideX(9.7), y: -1.18, z: pubFrontZ(7.25) },
    { x: -5.25, y: -1.18, z: pubFrontZ(8.35) },
    { x: 5.25, y: -1.18, z: pubFrontZ(8.35) },
  ],
};

/** Back-row bottles are staggered behind gaps in the original front shelf row. */
function shelfPositions(row: number): number[] {
  const front = Array.from(
    { length: 24 },
    (_, i) => -7.6 + Math.floor(i / 4) * 2.8 + (i % 4) * 0.32 + ((row + (i % 4)) % 3) * 0.04,
  );
  const positions: number[] = [];
  for (let i = 1; i < front.length; i++) {
    const gap = front[i] - front[i - 1],
      count = gap > 0.6 ? 3 : 1;
    for (let j = 1; j <= count; j++) positions.push(front[i - 1] + (gap * j) / (count + 1));
  }
  return positions;
}

/** Each authored material is instanced across its placements, including the glassware. */
export function buildPubDrinks(room: THREE.Group, installer: PropInstaller, options: Partial<PubDrinksLayout> = {}) {
  const layout = { ...PUB_DRINK_LAYOUT, ...options };
  const tabletopAssets = new THREE.Group(),
    shelfAssets = new THREE.Group();
  tabletopAssets.name = 'pub-cocktails-and-counter-bottles';
  shelfAssets.name = 'pub-fictional-spirit-shelves';
  room.add(tabletopAssets);
  (layout.shelfParent || room).add(shelfAssets);
  let loaded = 0;
  const bottleShelf: PubPlacement[][] = PUB_DRINK_ASSETS.bottles.map(() => []);
  const bottleCounter: PubPlacement[][] = PUB_DRINK_ASSETS.bottles.map(() => []);
  const cocktails: PubPlacement[][] = PUB_DRINK_ASSETS.glasses.map(() => []);
  for (const [row, y] of layout.shelfLevels.entries())
    for (const [i, x] of shelfPositions(row).entries()) {
      bottleShelf[(i + row * 2) % 5].push({
        x,
        y,
        z: layout.shelfZ,
        height: 0.71 + ((i * 3 + row) % 5) * 0.02,
        rotation: (((i * 7 + row) % 7) - 3) * 0.045,
      });
    }
  for (const [i, x] of [-8.4, -7.85, -7.3, 3.4, 3.92, 8.45].entries()) {
    bottleCounter[i % 5].push({
      x,
      y: layout.counterY,
      z: layout.counterZ - 0.56,
      height: 0.81 + (i % 3) * 0.04,
      rotation: ((i % 3) - 1) * 0.16,
    });
  }
  const drinkHeights = [0.55, 0.57, 0.34, 0.63, 0.65];
  for (const [i, table] of layout.tables.entries())
    for (const [j, offset] of [
      [-0.9, 0.34],
      [0.9, -0.35],
    ].entries()) {
      const kind = (i * 2 + j) % 5;
      cocktails[kind].push({
        x: table.x + offset[0],
        y: table.y,
        z: table.z + offset[1],
        height: drinkHeights[kind],
        rotation: (i + j) * 0.47,
      });
    }
  for (const [kind, x] of [-8.4, -3.7, 1.85, 6.95, 8.3].entries()) {
    cocktails[kind].push({
      x,
      y: layout.counterY,
      z: layout.counterZ + 0.49,
      height: drinkHeights[kind],
      rotation: 0.2 - kind * 0.13,
    });
  }

  const bottleColors = ['#855326', '#b6c5c6', '#477343', '#935325', '#304c35'];
  const bottleLabels = ['COPPERFIN', 'NORTHSTAR', 'JUNIPER & CO', 'RED HARBOR', 'ORCHARD'];
  const bottleTypes = ['AGED RUM', 'VODKA', 'BOTANICAL GIN', 'WHISKY', 'RED RESERVE'];
  function placeholderBottle(kind: number) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0, 0),
          new THREE.Vector2(0.11, 0),
          new THREE.Vector2(0.135, 0.035),
          new THREE.Vector2(0.135, 0.5),
          new THREE.Vector2(0.07, 0.59),
          new THREE.Vector2(0.042, 0.65),
          new THREE.Vector2(0.042, 0.81),
          new THREE.Vector2(0, 0.815),
        ],
        24,
      ),
      new THREE.MeshPhysicalMaterial({ color: bottleColors[kind], roughness: 0.18, clearcoat: 0.6 }),
    );
    const labelMap = canvasTexture(512, 256, (ctx) => {
      ctx.fillStyle = kind === 1 ? '#16374b' : kind === 3 ? '#60232b' : '#dbc79d';
      ctx.fillRect(0, 0, 512, 256);
      ctx.strokeStyle = '#b89650';
      ctx.lineWidth = 6;
      ctx.strokeRect(8, 8, 496, 240);
      ctx.textAlign = 'center';
      ctx.fillStyle = kind === 1 || kind === 3 ? '#eadcc1' : '#372d21';
      ctx.font = 'bold 39px Georgia';
      ctx.fillText(bottleLabels[kind], 256, 110);
      ctx.font = '24px Georgia';
      ctx.fillText(bottleTypes[kind], 256, 166);
    });
    const paper = new THREE.Mesh(
      new THREE.CylinderGeometry(0.137, 0.137, 0.245, 24, 1, true),
      new THREE.MeshStandardMaterial({ map: labelMap, roughness: 0.78 }),
    );
    paper.position.y = 0.32;
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.047, 0.047, 0.055, 16),
      new THREE.MeshStandardMaterial({ color: kind === 1 ? '#bdc6c8' : '#b28d4d', metalness: 0.65, roughness: 0.31 }),
    );
    cap.position.y = 0.8175;
    group.add(body, paper, cap);
    return group;
  }
  function placeholderDrink(kind: number) {
    const group = new THREE.Group(),
      stemmed = kind === 0 || kind === 3;
    const glass = new THREE.MeshPhysicalMaterial({
      name: 'Drink Glass Fallback',
      color: '#e0eeeb',
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      roughness: 0.035,
      clearcoat: 0.85,
      clearcoatRoughness: 0.025,
      envMapIntensity: 0.42,
      ior: 1.45,
    });
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 0.02, 24),
      new THREE.MeshStandardMaterial({ color: '#98754a', roughness: 0.95 }),
    );
    base.position.y = 0.01;
    group.add(base);
    const radius = kind === 0 ? 0.18 : 0.115,
      bottom = stemmed ? 0.25 : 0.05,
      height = kind === 2 ? 0.23 : stemmed ? 0.26 : 0.43;
    const vessel = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, kind === 0 ? 0.015 : radius * 0.85, height, 32, 1, true),
      glass,
    );
    vessel.position.y = bottom + height / 2;
    group.add(vessel);
    const colors = ['#a2ab6b', '#eaa333', '#9a591b', '#641b2b', '#351911'];
    const liquid = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.82, kind === 0 ? 0.018 : radius * 0.78, height * 0.73, 24),
      new THREE.MeshStandardMaterial({ color: colors[kind], roughness: 0.18 }),
    );
    liquid.position.y = bottom + height * 0.365;
    group.add(liquid);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.004, 6, 32), glass);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = bottom + height;
    group.add(rim);
    if (stemmed) {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.225, 12), glass);
      stem.position.y = 0.14;
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.018, 24), glass);
      foot.position.y = 0.03;
      group.add(stem, foot);
    }
    return group;
  }
  /** Glass, ice and liquid quirks, once per file on the shared source. */
  const prepareDrink = (source: THREE.Object3D) =>
    source.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material instanceof THREE.MeshStandardMaterial) {
          if (material.name.startsWith('Drink Glass')) {
            const clear = material.name.includes('Clear');
            material.transparent = true;
            material.opacity = clear ? 0.2 : 0.24;
            material.depthWrite = false;
            material.roughness = 0.035;
            material.metalness = 0;
            // The modeled vessels already have inner walls and rims. Rendering
            // both sides of every wall doubles their haze and dulls the liquid.
            material.side = THREE.FrontSide;
            if (clear) material.color.set('#e0eeeb');
            if (material instanceof THREE.MeshPhysicalMaterial) {
              material.clearcoat = 0.85;
              material.clearcoatRoughness = 0.025;
              material.ior = 1.45;
              // Alpha keeps the visible modeled liquid intact and avoids a
              // scene-color refraction pass for every shelf glass material.
              material.transmission = 0;
            }
          } else if (material.name.startsWith('Drink Ice')) {
            material.transparent = true;
            material.opacity = 0.56;
            material.depthWrite = false;
            material.roughness = 0.12;
          } else if (material.name.startsWith('Drink Liquid')) {
            material.transparent = false;
            material.opacity = 1;
            material.depthWrite = true;
            material.roughness = 0.18;
            material.metalness = 0;
          }
          material.envMapIntensity = material.name.startsWith('Drink Glass') ? 0.42 : 0.65;
        }
      }
    });
  /** One placeholder source may stand in for both the shelf and the counter copy of a bottle;
   * the installer frees its shared resources only once no placeholder still draws them. */
  const install = (path: string, placements: PubPlacement[], parent: THREE.Group, source: THREE.Group) => {
    if (!placements.length) return;
    const placeholder = instancePubModel(source, placements);
    placeholder.name = `${path}-placeholder`;
    parent.add(placeholder);
    installer.model(path, {
      placeholder,
      prepare: prepareDrink,
      use: (drink) => {
        const model = instancePubModel(drink, placements);
        model.name = path;
        model.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          if (
            materials.every(
              (material) => material.name.startsWith('Drink Glass') || material.name.startsWith('Drink Ice'),
            )
          ) {
            object.castShadow = false;
            object.renderOrder = materials.some((material) => material.name.startsWith('Drink Glass')) ? 3 : 2;
          }
        });
        parent.add(model);
        loaded++;
      },
    });
  };
  PUB_DRINK_ASSETS.bottles.forEach((_, i) => {
    const placeholder = placeholderBottle(i);
    install(PUB_DRINK_PROPS.shelfBottles[i], bottleShelf[i], shelfAssets, placeholder);
    // Counter bottles remain the original hero meshes for close pub inspection.
    install(PUB_DRINK_PROPS.counterBottles[i], bottleCounter[i], tabletopAssets, placeholder);
  });
  PUB_DRINK_ASSETS.glasses.forEach((_, i) =>
    install(PUB_DRINK_PROPS.glasses[i], cocktails[i], tabletopAssets, placeholderDrink(i)),
  );
  return {
    update(_time: number) {
      /* Glassware and liquid remain still on their supporting surfaces. */
    },
    diagnostics: () => ({
      loadedModels: loaded,
      addedBottles: bottleShelf.flat().length + bottleCounter.flat().length,
      cocktails: cocktails.flat().length,
    }),
    dispose() {
      // Dispose the two ownership branches together so shared instanced resources
      // from a bottle model on both shelves and counter are released once.
      const release = new THREE.Group();
      release.add(shelfAssets, tabletopAssets);
      disposePubObject(release);
      release.clear();
    },
  };
}
