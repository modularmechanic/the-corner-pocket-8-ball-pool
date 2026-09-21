import * as THREE from 'three';
import type { PubPlacement } from './pub-models';
import { PUB_LAYOUT, pubBackZ, pubFrontZ, pubSideX } from './pub-layout';
import type { PropInstaller } from './asset-installer';
import { dressWall, WALL_EXTENT, WALL_OBSTACLES } from './pub-wall-art';

const FLOOR = -3.6;
/** Prop paths relative to public/. */
export const PUB_DRESSING_PROPS = {
  hearth: 'models/pub/hearth-fireplace.glb',
  handpump: 'models/pub/ale-handpump.glb',
  divider: 'models/pub/snug-divider.glb',
  casks: 'models/pub/cask-stack.glb',
  memorabilia: {
    frame: 'models/pub/memorabilia-frame.glb',
    darts: 'models/pub/memorabilia-darts.glb',
    stout: 'models/pub/memorabilia-stout.glb',
  },
} as const;
/** Human-scale snug furnishings stay outside the pool table's cueing aisle. */
const original = {
  hearth: [{ x: 9, y: FLOOR, z: 11.4, rotation: Math.PI, height: 9.15 }],
  rightGallery: [
    { x: 14.54, y: 1.57, z: -3.8, rotation: -Math.PI / 2, height: 1.52 },
    { x: 14.54, y: 0.82, z: -1.37, rotation: -Math.PI / 2, height: 1.58 },
    { x: 14.54, y: 0.48, z: 3.2, rotation: -Math.PI / 2, height: 2.28 },
  ],
  dividers: [
    { x: 10.55, y: FLOOR, z: -0.05, rotation: 0, height: 3.3 },
    { x: -10.55, y: FLOOR, z: -0.05, rotation: 0, height: 3.3 },
  ],
  casks: [{ x: -12.25, y: FLOOR, z: -7.3, rotation: 0.1, height: 3.15 }],
  handpumps: [
    { x: -2.6, y: 0.325, z: -8.2, height: 1.3 },
    { x: 2.6, y: 0.325, z: -8.2, height: 1.3 },
  ],
} satisfies Record<string, PubPlacement[]>;

const DARTBOARD = { x: pubSideX(-4.82), width: 2.34 * 1.33 };
const SCREEN = { z: 10.45, y: 2.1, height: 2.3 };
const TELEVISIONS = [
  { z: -7.98, y: 2.1, height: 2.3 },
  { z: 8.85, y: 2.1, height: 2.3 },
];

/** Every wall, dressed around whatever is already on it. Courses are stacked from the bottom up, and
 * each one also avoids the courses already hung, so the walls carry as many pictures as they hold
 * without a single overlap. */
export const WALL_COURSES = {
  entrance: dressWall(
    WALL_EXTENT.entrance,
    WALL_OBSTACLES.entrance(DARTBOARD.x, DARTBOARD.width),
    [
      { centre: 1.7, height: 1.4, gap: 0.7 },
      { centre: 3.9, height: 1.3, gap: 0.7 },
    ],
    (piece, course) => ({
      kind: piece.kind,
      width: piece.width,
      x: piece.along,
      y: course.centre - course.height / 2,
      z: 11.57,
      rotation: Math.PI,
      height: course.height,
    }),
  ),
  left: dressWall(
    WALL_EXTENT.side,
    WALL_OBSTACLES.left(SCREEN.z, SCREEN.y + SCREEN.height / 2, SCREEN.height),
    [
      { centre: 1.45, height: 1.05, gap: 0.55 },
      { centre: 2.9, height: 1.05, gap: 0.55 },
      { centre: 5.05, height: 1.0, gap: 0.55 },
    ],
    (piece, course) => ({
      kind: piece.kind,
      width: piece.width,
      x: -14.54,
      y: course.centre - course.height / 2,
      z: piece.along,
      rotation: Math.PI / 2,
      height: course.height,
    }),
  ),
  right: dressWall(
    WALL_EXTENT.side,
    WALL_OBSTACLES.right(TELEVISIONS),
    [
      { centre: 1.45, height: 1.05, gap: 0.55 },
      { centre: 2.9, height: 1.05, gap: 0.55 },
      { centre: 5.05, height: 1.0, gap: 0.55 },
    ],
    (piece, course) => ({
      kind: piece.kind,
      width: piece.width,
      x: 14.54,
      y: course.centre - course.height / 2,
      z: piece.along,
      rotation: -Math.PI / 2,
      height: course.height,
    }),
  ),
  barWall: dressWall(
    WALL_EXTENT.barWall,
    WALL_OBSTACLES.barWall(),
    [{ centre: 4.9, height: 1.15, gap: 0.65 }],
    (piece, course) => ({
      kind: piece.kind,
      width: piece.width,
      x: piece.along,
      y: course.centre - course.height / 2,
      z: PUB_LAYOUT.bounds.back + 0.22,
      rotation: 0,
      height: course.height,
    }),
  ),
  // The chimney breast's face is at z 16.53 (its bounding box reaches 15.12, but that is the mantel
  // shelf sticking out below). Hung just clear of the brick, above the mantel.
  chimney: dressWall(WALL_EXTENT.chimney, [], [{ centre: 3.9, height: 1.5, gap: 0.5 }], (piece, course) => ({
    kind: piece.kind,
    width: piece.width,
    x: piece.along,
    y: course.centre - course.height / 2,
    z: 16.42,
    rotation: Math.PI,
    height: course.height,
  })),
};

export const PUB_DRESSING = {
  hearth: original.hearth.map((p) => ({ ...p, x: pubSideX(p.x), z: pubFrontZ(p.z) })),
  // The house team photographs, authored. buildPubGallery instances these by index.
  gallery: [
    { x: -12.15, y: 3.08, z: 11.57, rotation: Math.PI, height: 2.32 },
    { x: -8.65, y: 3.44, z: 11.57, rotation: Math.PI, height: 1.88 },
    { x: -6.27, y: 3.6, z: 11.57, rotation: Math.PI, height: 1.46 },
    { x: -12.1, y: -0.36, z: 11.57, rotation: Math.PI, height: 2.51 },
    { x: -8.58, y: 0.09, z: 11.57, rotation: Math.PI, height: 2.2 },
  ].map((p) => ({ ...p, x: pubSideX(p.x), z: pubFrontZ(p.z) })),
  // The course this module hangs around them, installed separately.
  entranceExtra: WALL_COURSES.entrance.map((p) => ({ ...p, z: pubFrontZ(p.z) })),
  rightGallery: original.rightGallery.map((p, i) => ({
    ...p,
    x: pubSideX(p.x),
    z: p.z + (i < 2 ? -2.6 : 3.2) * (PUB_LAYOUT.expansion - 1),
  })),
  dividers: original.dividers.map((p) => ({ ...p, x: pubSideX(p.x), z: p.z })),
  leftGallery: WALL_COURSES.left.map((p) => ({ ...p, x: pubSideX(p.x) })),
  rightGalleryExtra: WALL_COURSES.right.map((p) => ({ ...p, x: pubSideX(p.x) })),
  casks: original.casks.map((p) => ({ ...p, x: pubSideX(p.x), z: pubBackZ(p.z) })),
  handpumps: original.handpumps.map((p) => ({ ...p, z: pubBackZ(p.z) })),
  backWall: WALL_COURSES.barWall,
  chimney: WALL_COURSES.chimney,
};

/** Requests Blender-authored fixtures, each with a complete placeholder, under room-owned GPU disposal. */
export function buildPubDressing(
  room: THREE.Group,
  installer: PropInstaller,
  walls: { front: THREE.Group; right: THREE.Group; back: THREE.Group; left: THREE.Group },
) {
  const assets = new THREE.Group();
  assets.name = 'pub-blender-dressing';
  room.add(assets);
  const wallAssets = new THREE.Group();
  wallAssets.name = 'pub-snug-wall-dressing';
  walls.front.add(wallAssets);
  const rightWallAssets = new THREE.Group();
  rightWallAssets.name = 'pub-brick-gallery';
  walls.right.add(rightWallAssets);
  const backWallAssets = new THREE.Group();
  backWallAssets.name = 'pub-back-wall-gallery';
  walls.back.add(backWallAssets);
  const leftWallAssets = new THREE.Group();
  leftWallAssets.name = 'pub-left-wall-gallery';
  walls.left.add(leftWallAssets);
  const stone = new THREE.MeshStandardMaterial({ color: '#8a7460', roughness: 0.92 });
  const wood = new THREE.MeshStandardMaterial({ color: '#3f261b', roughness: 0.49 });
  const brass = new THREE.MeshStandardMaterial({ color: '#a18450', metalness: 0.76, roughness: 0.37 });
  const iron = new THREE.MeshStandardMaterial({ color: '#171816', metalness: 0.35, roughness: 0.68 });
  const meshBox = (
    parent: THREE.Group,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const positioned = (name: string, placement: PubPlacement, parent: THREE.Group) => {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(placement.x, placement.y, placement.z);
    group.rotation.y = placement.rotation || 0;
    parent.add(group);
    return group;
  };
  const hearth = positioned('hearth-fallback', PUB_DRESSING.hearth[0], wallAssets);
  meshBox(hearth, 8.2, 0.21, 1.75, stone, 0, 0.105, 0.36);
  meshBox(hearth, 1.13, 4.7, 1.33, stone, -3.47, 2.52, 0.3);
  meshBox(hearth, 1.13, 4.7, 1.33, stone, 3.47, 2.52, 0.3);
  meshBox(hearth, 8.2, 4.04, 0.92, stone, 0, 7.13, 0);
  meshBox(hearth, 8.5, 0.34, 1.75, wood, 0, 5.03, 0.4);
  meshBox(hearth, 5.7, 4.45, 0.08, iron, 0, 2.48, -0.22);
  const coalMaterial = new THREE.MeshStandardMaterial({
    color: '#632915',
    emissive: '#d85318',
    emissiveIntensity: 0.85,
    roughness: 1,
  });
  for (let i = 0; i < 7; i++) {
    const log = meshBox(hearth, 0.72, 0.23, 0.55, coalMaterial, -2.07 + i * 0.68, 0.5, 0.67);
    log.rotation.y = ((i % 2) - 0.5) * 0.45;
  }
  const dividerFallback = new THREE.Group();
  assets.add(dividerFallback);
  for (const placement of PUB_DRESSING.dividers) {
    const group = positioned('divider-fallback', placement, dividerFallback);
    meshBox(group, 4.31, 1.8, 0.29, wood, 0, 0.9, 0);
    meshBox(group, 4.45, 0.15, 0.41, wood, 0, 3.22, 0);
    for (const x of [-2.1, 0, 2.1]) meshBox(group, 0.12, 3.15, 0.35, wood, x, 1.58, 0);
    const glass = new THREE.MeshPhysicalMaterial({
      color: '#ac9e73',
      transparent: true,
      opacity: 0.22,
      roughness: 0.3,
      metalness: 0,
      depthWrite: false,
    });
    meshBox(group, 4.06, 1.14, 0.035, glass, 0, 2.48, 0);
  }
  const galleryVariants = [
    { path: PUB_DRESSING_PROPS.memorabilia.frame, front: [] as PubPlacement[], right: [PUB_DRESSING.rightGallery[1]] },
    { path: PUB_DRESSING_PROPS.memorabilia.darts, front: [] as PubPlacement[], right: [PUB_DRESSING.rightGallery[2]] },
    {
      path: PUB_DRESSING_PROPS.memorabilia.stout,
      front: [PUB_DRESSING.gallery[2]],
      right: [PUB_DRESSING.rightGallery[0]],
    },
  ].map((variant) => {
    const frontFallback = new THREE.Group(),
      rightFallback = new THREE.Group();
    wallAssets.add(frontFallback);
    rightWallAssets.add(rightFallback);
    for (const [placements, parent] of [
      [variant.front, frontFallback],
      [variant.right, rightFallback],
    ] as const)
      for (const placement of placements) {
        const group = positioned('gallery-fallback', placement, parent),
          h = placement.height!,
          w = (h * 0.9) / 0.7;
        meshBox(group, w, h, 0.15, wood, 0, h / 2, 0);
        meshBox(group, w - 0.17, h - 0.17, 0.022, brass, 0, h / 2, 0.091);
        meshBox(
          group,
          w - 0.3,
          h - 0.3,
          0.018,
          new THREE.MeshStandardMaterial({ color: '#a09277', roughness: 0.98 }),
          0,
          h / 2,
          0.108,
        );
      }
    return { ...variant, frontFallback, rightFallback };
  });
  const pumpFallback = new THREE.Group();
  assets.add(pumpFallback);
  for (const placement of PUB_DRESSING.handpumps) {
    const group = positioned('ale-handpump-fallback', placement, pumpFallback);
    meshBox(group, 0.6, 0.13, 0.65, wood, 0, 0.065, 0);
    meshBox(group, 0.18, 0.75, 0.2, brass, 0, 0.49, 0);
    meshBox(group, 0.105, 0.51, 0.12, wood, 0, 1.04, -0.055);
    meshBox(group, 0.22, 0.3, 0.08, brass, 0, 0.76, 0.2);
    const spout = meshBox(group, 0.055, 0.055, 0.35, brass, 0, 0.66, 0.22);
    spout.rotation.x = 0.13;
  }
  const caskFallback = positioned('casks-fallback', PUB_DRESSING.casks[0], assets);
  for (const [x, y] of [
    [-0.86, 1.01],
    [0.86, 1.01],
    [0, 2.28],
  ]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.65, 16), wood);
    barrel.rotation.z = Math.PI / 2;
    barrel.position.set(x, y, 0);
    barrel.castShadow = true;
    caskFallback.add(barrel);
    for (const dx of [-0.66, 0.66]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.61, 0.027, 6, 24), iron);
      hoop.rotation.y = Math.PI / 2;
      hoop.position.set(x + dx, y, 0);
      caskFallback.add(hoop);
    }
  }
  const install = (path: string, placements: PubPlacement[], parent: THREE.Group, placeholder: THREE.Object3D) => {
    if (placements.length) installer.model(path, { parent, placements, placeholder });
  };
  install(PUB_DRESSING_PROPS.hearth, PUB_DRESSING.hearth, wallAssets, hearth);
  for (const variant of galleryVariants) {
    install(variant.path, variant.front, wallAssets, variant.frontFallback);
    install(variant.path, variant.right, rightWallAssets, variant.rightFallback);
  }
  // Each hung piece carries the model it was laid out as, so the course installs exactly what it
  // was measured for rather than cycling models by index and hoping the widths match.
  const MODEL_OF = {
    frame: PUB_DRESSING_PROPS.memorabilia.frame,
    stout: PUB_DRESSING_PROPS.memorabilia.stout,
    darts: PUB_DRESSING_PROPS.memorabilia.darts,
  } as const;
  const hangCourseModels = (
    course: readonly (PubPlacement & { kind: keyof typeof MODEL_OF })[],
    parent: THREE.Group,
  ) => {
    for (const kind of Object.keys(MODEL_OF) as (keyof typeof MODEL_OF)[]) {
      const placements = course.filter((p) => p.kind === kind);
      if (placements.length) installer.model(MODEL_OF[kind], { parent, placements });
    }
  };
  hangCourseModels(PUB_DRESSING.leftGallery, leftWallAssets);
  hangCourseModels(PUB_DRESSING.backWall, backWallAssets);
  hangCourseModels(PUB_DRESSING.chimney, wallAssets);
  hangCourseModels(PUB_DRESSING.rightGalleryExtra, rightWallAssets);
  hangCourseModels(PUB_DRESSING.entranceExtra, wallAssets);
  install(PUB_DRESSING_PROPS.handpump, PUB_DRESSING.handpumps, assets, pumpFallback);
  install(PUB_DRESSING_PROPS.divider, PUB_DRESSING.dividers, assets, dividerFallback);
  install(PUB_DRESSING_PROPS.casks, PUB_DRESSING.casks, assets, caskFallback);
  // Local firelight lights the snug; it never floods the felt or requires another shadow pass.
  const hearthLight = new THREE.PointLight('#ffad68', 9, 5, 2);
  hearthLight.position.set(PUB_DRESSING.hearth[0].x, -0.32, PUB_DRESSING.hearth[0].z - 1.5);
  room.add(hearthLight);
  return {
    update(time: number) {
      hearthLight.intensity = 9 + Math.sin(time * 3.1) * 0.55 + Math.sin(time * 7.3) * 0.24;
    },
  };
}
