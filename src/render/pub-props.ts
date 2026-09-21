import * as THREE from 'three';
import { pubWallTileTexture } from './pub-interior-textures';
import { useWood } from './pub-wood';

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
let tileSource: THREE.Texture | undefined;
const wallTiles = () => {
  if (!tileSource) {
    tileSource = pubWallTileTexture();
    tileSource.repeat.set(3, 2);
  }
  return tileSource;
};
/** Material quirks of the bar's authored models, applied once per file. */
export const preparePubModel = (path: string) => (source: THREE.Object3D) =>
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
      // Every authored wooden surface takes the same oak plate as the walls and the joinery.
      if (/walnut|oak|timber|wood/i.test(material.name) && !material.map) {
        useWood(material, 'walnut', 1.2, 1.2);
        material.color.set('#c9ad8e');
      }
      if (path === PUB_PROPS.wallPanel && material.name === 'Warm plaster') {
        // Glazed burgundy metro, not plaster: a pub's wainscot is tiled, and flat cream read as board.
        useWood(material, 'tiles', 2.4, 1.2);
        material.color.set('#ffffff');
        material.roughness = 0.22;
        material.metalness = 0.02;
      }
    }
  });
