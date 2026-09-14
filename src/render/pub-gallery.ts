import * as THREE from 'three';
import { PUB_DRESSING } from './pub-dressing';
import { instancePubModel } from './pub-models';
import { batchPubStatic } from './pub-batching';
import { canvasTexture } from './materials';
import { deinterleaveGeometry } from 'three/addons/utils/BufferGeometryUtils.js';
import { PUB_LAYOUT } from './pub-layout';
import { PROP_ANISOTROPY, type PropInstaller } from './asset-installer';

export const POOL_DECADE_GALLERIES = [
  {
    decade: '1980s',
    wall: 'front',
    centre: -5.15,
    bottom: 3.3,
    size: 1.02,
    rowStep: 1.45,
    years: [1982, 1985, 1987, 1989],
  },
  {
    decade: '1990s',
    wall: 'front',
    centre: 5.66,
    bottom: 0.08,
    size: 0.89,
    rowStep: 1.19,
    years: [1991, 1994, 1996, 1999],
  },
  {
    decade: '2000s',
    wall: 'front',
    centre: 5.66,
    bottom: 2.54,
    size: 0.89,
    rowStep: 1.19,
    years: [2001, 2004, 2007, 2009],
  },
  {
    decade: '2010s',
    wall: 'right',
    centre: 3.75,
    bottom: 3.13,
    size: 1.02,
    rowStep: 1.33,
    years: [2011, 2014, 2017, 2019],
  },
  {
    decade: '2020s',
    wall: 'right',
    centre: -2.75,
    bottom: 3.31,
    size: 1.02,
    rowStep: 1.33,
    years: [2020, 2022, 2024, 2026],
  },
] as const;
/** Prop paths relative to public/. The atlases are requested once the photo frame arrives. */
export const PUB_GALLERY_PROPS = {
  frame: 'models/pub/pub-photo-frame.glb',
  teamAtlas: 'textures/pub/gallery-atlas.webp',
  eventsAtlas: 'textures/pub/pool-events-atlas.webp',
  decadeAtlases: POOL_DECADE_GALLERIES.map((era) => `textures/pub/pool-${era.decade}-atlas.webp`),
};

/** Normalized UV window for a top-to-bottom, left-to-right 2×2 photo atlas.
 * The tiny inset prevents mipmap bleed from the neighbouring photograph. */
export function poolPhotoRegion(index: number) {
  const cell = Math.max(0, Math.min(3, Math.trunc(index)));
  return { x: (cell % 2) * 0.5 + 0.003, y: Math.floor(cell / 2) * 0.5 + 0.003, width: 0.494, height: 0.494 };
}

/** Material UV binding on the imported Blender print plane, never new geometry. */
export function applyPoolPhotoRegion(imported: THREE.BufferGeometry, index: number) {
  const geometry = imported.clone();
  deinterleaveGeometry(geometry);
  const region = poolPhotoRegion(index),
    uv = geometry.getAttribute('uv');
  let minU = Infinity,
    maxU = -Infinity,
    minV = Infinity,
    maxV = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    minU = Math.min(minU, uv.getX(i));
    maxU = Math.max(maxU, uv.getX(i));
    minV = Math.min(minV, uv.getY(i));
    maxV = Math.max(maxV, uv.getY(i));
  }
  for (let i = 0; i < uv.count; i++)
    uv.setXY(
      i,
      region.x + ((uv.getX(i) - minU) / Math.max(0.0001, maxU - minU)) * region.width,
      region.y + ((uv.getY(i) - minV) / Math.max(0.0001, maxV - minV)) * region.height,
    );
  return geometry;
}

function addPoolClubGallery(
  walls: { front: THREE.Group; right: THREE.Group; back: THREE.Group },
  installer: PropInstaller,
  source: THREE.Object3D,
) {
  const sections = { front: new THREE.Group(), right: new THREE.Group(), back: new THREE.Group() };
  for (const [name, section] of Object.entries(sections)) {
    section.name = `pub-pool-history-${name}`;
    walls[name as keyof typeof sections].add(section);
  }
  const isPrint = (material: THREE.Material) => material.name.replace(/\.\d+$/, '') === 'Gallery artwork';
  let printAspect = 1;
  // Measured through the node transforms, which carry a quantized mesh's scale.
  source.updateMatrixWorld(true);
  source.traverse((object) => {
    if (object instanceof THREE.Mesh && !Array.isArray(object.material) && isPrint(object.material)) {
      const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
      printAspect = size.x / Math.max(0.001, size.y);
    }
  });
  const place = (
    print: THREE.Material,
    placement: { x: number; y: number; z: number; height: number; rotation?: number },
    section: THREE.Group,
    aspect: number,
    index?: number,
  ) => {
    const variant = source.clone(true);
    variant.scale.x *= aspect / printAspect;
    variant.traverse((object) => {
      if (object instanceof THREE.Mesh && !Array.isArray(object.material) && isPrint(object.material))
        object.material = print;
    });
    const framed = instancePubModel(variant, [placement]);
    section.add(framed);
    // The frame stays instanced from its original Blender mesh. Only its print
    // plane gets per-photo UVs, then the four planes merge into one atlas draw.
    if (index !== undefined)
      for (const object of [...framed.children])
        if (object instanceof THREE.InstancedMesh && object.material === print) {
          const mesh = new THREE.Mesh(applyPoolPhotoRegion(object.geometry, index), print),
            matrix = new THREE.Matrix4();
          object.getMatrixAt(0, matrix);
          mesh.matrix.copy(matrix);
          mesh.matrixAutoUpdate = false;
          mesh.receiveShadow = true;
          framed.add(mesh);
          object.removeFromParent();
          object.dispose();
        }
  };
  for (const [eraIndex, era] of POOL_DECADE_GALLERIES.entries()) {
    const texture = canvasTexture(1024, 1024, (ctx) => {
      ctx.fillStyle = '#ddd1b3';
      ctx.fillRect(0, 0, 1024, 1024);
    });
    texture.flipY = false;
    texture.anisotropy = PROP_ANISOTROPY;
    const canvas = texture.image as HTMLCanvasElement,
      ctx = canvas.getContext('2d')!;
    // The blank card is the placeholder; the atlas is drawn in with its captions, then freed.
    installer.texture(PUB_GALLERY_PROPS.decadeAtlases[eraIndex], {
      use: (loaded) => {
        const image = loaded.image as HTMLImageElement,
          cell = image.width / 2;
        for (let index = 0; index < 4; index++) {
          const x = (index % 2) * 512,
            y = Math.floor(index / 2) * 512;
          ctx.drawImage(
            image,
            (index % 2) * cell + 2,
            Math.floor(index / 2) * cell + 2,
            cell - 4,
            cell - 4,
            x + 30,
            y + 12,
            452,
            452,
          );
          ctx.fillStyle = '#4b4130';
          ctx.textAlign = 'center';
          ctx.font = '22px Georgia';
          ctx.fillText(`${era.years[index]}  ·  THE CORNER POCKET`, x + 256, y + 493);
        }
        texture.needsUpdate = true;
        loaded.dispose();
      },
    });
    const print = new THREE.MeshStandardMaterial({
      name: `Pool club photographs ${era.decade}`,
      map: texture,
      roughness: 0.76,
      metalness: 0,
      envMapIntensity: 0.12,
    });
    for (let index = 0; index < 4; index++) {
      const horizontal = era.centre + (index % 2 ? 1 : -1) * 0.68,
        y = era.bottom + Math.floor(index / 2) * era.rowStep;
      const placement =
        era.wall === 'front'
          ? { x: horizontal, y, z: PUB_LAYOUT.bounds.front - 0.23, rotation: Math.PI, height: era.size + 0.14 }
          : { x: PUB_LAYOUT.bounds.right - 0.23, y, z: horizontal, rotation: -Math.PI / 2, height: era.size + 0.14 };
      place(print, placement, sections[era.wall], 1, index);
    }
  }
  // Keep the original six photographs in one Blender-framed club-album collage.
  const albumPrint = new THREE.MeshStandardMaterial({
    name: 'Pool champions club album',
    roughness: 0.76,
    envMapIntensity: 0.12,
  });
  installer.texture(PUB_GALLERY_PROPS.eventsAtlas, {
    prepare: (atlas) => {
      atlas.colorSpace = THREE.SRGBColorSpace;
      atlas.flipY = false;
    },
    use: (atlas) => {
      albumPrint.map = atlas;
      albumPrint.needsUpdate = true;
    },
  });
  place(albumPrint, { x: 12.3, y: 3.62, z: PUB_LAYOUT.bounds.back + 0.29, height: 2.2 }, sections.back, 1.5);
  for (const section of Object.values(sections)) batchPubStatic(section, 'subtree');
}

/** Original fictional team photographs and a painting, printed inside carved Blender frames. */
export function buildPubGallery(
  room: THREE.Group,
  installer: PropInstaller,
  walls: { front: THREE.Group; right: THREE.Group; back: THREE.Group },
) {
  const gallery = new THREE.Group();
  gallery.name = 'pub-team-photographs';
  walls.front.add(gallery);
  const entries = [
    { placement: PUB_DRESSING.gallery[0], tile: [0, 0], name: 'Village football club' },
    { placement: PUB_DRESSING.gallery[1], tile: [1, 0], name: 'Local darts society' },
    { placement: PUB_DRESSING.gallery[3], tile: [0, 1], name: 'Rugby clubhouse team' },
    { placement: PUB_DRESSING.gallery[4], tile: [1, 1], name: 'The village pub at dusk' },
  ];
  installer.model(PUB_GALLERY_PROPS.frame, {
    use: (frame) => {
      addPoolClubGallery(walls, installer, frame);
      const unused = new Set<THREE.Material>(),
        prints: THREE.MeshStandardMaterial[] = [];
      for (const entry of entries) {
        const variant = frame.clone(true);
        const print = new THREE.MeshStandardMaterial({
          name: entry.name,
          color: '#ffffff',
          roughness: 0.9,
          metalness: 0,
          envMapIntensity: 0.1,
        });
        prints.push(print);
        variant.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const replace = (material: THREE.Material) => {
            if (material.name.replace(/\.\d+$/, '') === 'Gallery artwork') {
              unused.add(material);
              return print;
            }
            return material;
          };
          object.material = Array.isArray(object.material) ? object.material.map(replace) : replace(object.material);
        });
        const framed = instancePubModel(variant, [entry.placement]);
        framed.name = entry.name;
        gallery.add(framed);
      }
      batchPubStatic(gallery, 'subtree');
      // The exported atlas is replaced by one shared runtime source with four UV windows.
      for (const material of unused) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
        material.dispose();
      }
      // Each print shows one tile of the shared atlas upload through its own clone's UV window.
      installer.texture(PUB_GALLERY_PROPS.teamAtlas, {
        prepare: (atlas) => {
          atlas.colorSpace = THREE.SRGBColorSpace;
          atlas.flipY = false;
        },
        use: (atlas) =>
          entries.forEach((entry, index) => {
            const texture = atlas.clone();
            texture.repeat.set(0.48, 0.48);
            texture.offset.set(entry.tile[0] * 0.5 + 0.01, entry.tile[1] * 0.5 + 0.01);
            prints[index].map = texture;
            prints[index].needsUpdate = true;
          }),
      });
    },
  });
}
