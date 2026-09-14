import * as THREE from 'three';
import { seededRandom, TABLE } from '../simulation/types';

/** Existing CC0 Wood Table 001 scans (Dimitrios Savva / Rico Cilliers, Poly Haven).
 * Cloth is baked in Blender via MCP. Remaining original surface fallbacks are
 * seeded artwork. Albedo is sRGB; normals and roughness stay linear. */
export const TABLE_SURFACE_SOURCES = {
  walnut: '/wood-color.jpg, /wood-normal.jpg, /wood-roughness.jpg — Wood Table 001 / Poly Haven / CC0',
  cloth: 'Blender MCP fine wool baize — 2K albedo, 1K tangent normal and packed height/roughness bake; art/blender/fine-baize.blend',
  leather: 'Original fine pebbled leather grain',
  brass: 'Original directional machining, oxidation and handling marks',
  cue: 'Original longitudinal maple and dark spliced hardwood grain',
} as const;

type RGB = [number, number, number];
interface SurfaceSample { color: RGB; height: number; roughness: number; bump?: number }
interface SurfaceMaps { map: THREE.DataTexture; normalMap: THREE.DataTexture; roughnessMap: THREE.DataTexture }
const tau = Math.PI * 2;
function maps(width: number, height: number, sample: (x: number, y: number) => SurfaceSample, repeatX: number, repeatY: number, anisotropy: number): SurfaceMaps {
  const albedo = new Uint8Array(width * height * 4), normal = new Uint8Array(width * height * 4), rough = new Uint8Array(width * height * 2), heights = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x, offset = index * 4, value = sample(x, y);
    for (let channel = 0; channel < 3; channel++) albedo[offset + channel] = value.color[channel];
    // Three samples roughness from green. RG8 preserves that value without
    // allocating unused blue/alpha channels for every material's scalar map.
    rough[index * 2] = Math.round((value.bump ?? 1) * 255); rough[index * 2 + 1] = Math.round(value.roughness * 255);
    albedo[offset + 3] = 255; heights[index] = value.height;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    const dx = heights[y * width + (x + 1) % width] - heights[y * width + (x + width - 1) % width];
    const dy = heights[((y + 1) % height) * width + x] - heights[((y + height - 1) % height) * width + x];
    const length = Math.hypot(dx, dy, 1);
    normal[offset] = Math.round((-dx / length * .5 + .5) * 255);
    normal[offset + 1] = Math.round((-dy / length * .5 + .5) * 255);
    normal[offset + 2] = Math.round((1 / length * .5 + .5) * 255); normal[offset + 3] = 255;
  }
  const texture = (data: Uint8Array, color = false, format: THREE.PixelFormat = THREE.RGBAFormat) => {
    const result = new THREE.DataTexture(data, width, height, format);
    result.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    result.wrapS = result.wrapT = THREE.RepeatWrapping; result.repeat.set(repeatX, repeatY);
    result.magFilter = THREE.LinearFilter; result.minFilter = THREE.LinearMipmapLinearFilter;
    result.generateMipmaps = true; result.anisotropy = anisotropy; result.needsUpdate = true;
    return result;
  };
  return { map: texture(albedo, true), normalMap: texture(normal), roughnessMap: texture(rough, false, THREE.RGFormat) };
}

function useBaizeBump(material: THREE.MeshPhysicalMaterial) {
  // Three's built-in normal chunk selects normal OR bump. Apply its standard
  // height perturbation after the micro-normal so both maps actually contribute.
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#if defined( USE_BUMPMAP ) && defined( USE_NORMALMAP_TANGENTSPACE )
  normal = perturbNormalArb( -vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`);
  };
  material.customProgramCacheKey = () => 'blender-baize-normal-and-height-v2';
}

export function createTableSurfaces(renderer: THREE.WebGLRenderer) {
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const textures = new Set<THREE.Texture>(), materials = new Set<THREE.Material>();
  let disposed = false;
  const own = <T extends THREE.Material>(material: T): T => { materials.add(material); return material; };
  const ownMaps = (value: SurfaceMaps) => { Object.values(value).forEach(texture => textures.add(texture)); return value; };
  const loader = new THREE.TextureLoader();
  // A matte solid color is used while the Blender maps load. The old chunky
  // startup-generated nap is intentionally gone, including from the fallback.
  const cloth = own(new THREE.MeshPhysicalMaterial({ color: '#285f32', bumpScale: TABLE.radius * .00035,
    normalScale: new THREE.Vector2(.3, .3), roughness: 1, metalness: 0, sheen: .12, sheenColor: '#77916a', sheenRoughness: 1, specularIntensity: .16, envMapIntensity: .13 }));
  cloth.name = 'Blender fine tournament baize'; useBaizeBump(cloth);
  const cushion = own(cloth.clone()); useBaizeBump(cushion);
  cushion.name = 'Cloth-covered cushion rubber'; cushion.normalScale.set(.24, .24); cushion.bumpScale *= .8; cushion.sheen = .1;
  for (const [kind, file] of [['color', '/textures/table/baize-color.png'], ['normal', '/textures/table/baize-normal.png'], ['surface', '/textures/table/baize-surface.png']] as const) {
    const texture = loader.load(file, loaded => {
      if (disposed) { loaded.dispose(); return; }
      for (const material of [cloth, cushion]) {
        if (kind === 'color') { material.map = loaded; material.color.set(material === cloth ? '#ffffff' : '#e8eddf'); }
        else if (kind === 'normal') material.normalMap = loaded;
        else { material.bumpMap = loaded; material.roughnessMap = loaded; }
        material.needsUpdate = true;
      }
    }, undefined, () => { /* The matte cloth remains playable if a local map cannot load. */ });
    texture.name = `Blender baize ${kind}`;
    texture.colorSpace = kind === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(6, 3);
    texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true; texture.anisotropy = anisotropy; textures.add(texture);
  }

  let random = seededRandom('corner-pocket-grain-v2');
  const timber = ownMaps(maps(512, 512, (x, y) => {
    const wave = Math.sin((x / 512 * 17 + Math.sin(y * tau / 512) * .3) * tau);
    const pores = Math.sin((x / 512 * 91 + Math.sin(y * tau / 512) * .6) * tau), noise = random() - .5;
    const value = wave * 6 + pores * 3 + noise * 4;
    return { color: [99 + value, 57 + value * .6, 29 + value * .35], height: wave * .045 + pores * .025, roughness: .62 + noise * .1 + wave * .035 };
  }, 2, 1, anisotropy));
  for (const texture of Object.values(timber)) { texture.center.set(.5, .5); texture.rotation = Math.PI / 2; }
  const walnut = own(new THREE.MeshPhysicalMaterial({ ...timber, color: '#e2c79f', normalScale: new THREE.Vector2(.19, .19), roughness: .74, clearcoat: .34, clearcoatRoughness: .28, specularIntensity: .6, envMapIntensity: .52 }));
  const sideWood = own(walnut.clone()); sideWood.color.set('#bc936c'); sideWood.clearcoat = .2; sideWood.roughness = .82;
  const darkWood = own(walnut.clone()); darkWood.color.set('#6b4b33'); darkWood.clearcoat = .18; darkWood.roughness = .83;
  for (const [key, file] of [['map', '/wood-color.jpg'], ['normalMap', '/wood-normal.jpg'], ['roughnessMap', '/wood-roughness.jpg']] as const) {
    const texture = loader.load(file, loaded => {
      if (disposed) { loaded.dispose(); return; }
      for (const material of [walnut, sideWood, darkWood]) { material[key] = loaded; material.needsUpdate = true; }
      const fallback = timber[key]; textures.delete(fallback); fallback.dispose();
    }, undefined, () => { /* Keep the original grain fallback if a scan cannot load. */ });
    texture.colorSpace = key === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(2, 1); texture.center.set(.5, .5); texture.rotation = Math.PI / 2; texture.anisotropy = anisotropy; textures.add(texture);
  }

  random = seededRandom('corner-pocket-brass-v2');
  const metal = ownMaps(maps(512, 512, (x, y) => {
    const scratch = Math.sin(y * tau / 2) * .035 + Math.sin(y * tau / 7.11111111) * .04;
    const patina = Math.sin(x * tau / 128) * Math.sin(y * tau / 256), noise = random() - .5;
    const value = noise * 7 + scratch * 36 + patina * 6;
    return { color: [187 + value, 151 + value * .85, 84 + value * .5], height: scratch * .16 + noise * .025, roughness: .39 + noise * .08 + patina * .07 };
  }, 2, 1, anisotropy));
  const brass = own(new THREE.MeshPhysicalMaterial({ ...metal, normalScale: new THREE.Vector2(.21, .21), metalness: .87, roughness: 1, clearcoat: .08, clearcoatRoughness: .38, envMapIntensity: .7 }));
  brass.name = 'Handled brass — brushed and oxidized';
  random = seededRandom('corner-pocket-leather-v2');
  const hide = ownMaps(maps(512, 512, (x, y) => {
    const grain = Math.sin((x + Math.sin(y * tau / 16) * 2) * tau / 8) * Math.sin(y * tau / 8), noise = random() - .5;
    const value = grain * 3 + noise * 3;
    return { color: [47 + value, 35 + value * .75, 24 + value * .6], height: grain * .19 + noise * .06, roughness: .78 + noise * .1 + grain * .04 };
  }, 2, 1, anisotropy));
  const leather = own(new THREE.MeshPhysicalMaterial({ ...hide, normalScale: new THREE.Vector2(.38, .38), roughness: 1, sheen: .06, sheenColor: '#8b7254', sheenRoughness: 1, side: THREE.DoubleSide, envMapIntensity: .25 }));
  const rubber = own(new THREE.MeshStandardMaterial({ ...hide, color: '#404936', normalScale: new THREE.Vector2(.1, .1), roughness: .98, metalness: 0, envMapIntensity: .12 }));

  random = seededRandom('corner-pocket-maple-shaft-v2');
  const maple = ownMaps(maps(512, 1024, (x, y) => {
    const u = x / 512, v = y / 1024;
    const bend = Math.sin(v * tau) * .085 + Math.sin(v * tau * 2) * .025;
    const growth = Math.sin((u * 11 + bend) * tau), fine = Math.sin((u * 43 + bend * 2) * tau);
    const grain = Math.pow(Math.max(0, growth), 9), noise = random() - .5;
    const value = grain * 25 + fine * 3.8 + noise * 3;
    return { color: [217 - value, 181 - value * .85, 126 - value * .6], height: grain * .04 + fine * .012, roughness: .55 + grain * .04 + noise * .04 };
  }, 1, 1, anisotropy));
  const cueMaple = own(new THREE.MeshPhysicalMaterial({ ...maple, normalScale: new THREE.Vector2(.09, .09), roughness: .64, clearcoat: .25, clearcoatRoughness: .27, specularIntensity: .45, envMapIntensity: .65 }));
  random = seededRandom('corner-pocket-butt-v2');
  const butt = ownMaps(maps(512, 512, (x, y) => {
    const u = x / 512, v = y / 512, grain = Math.sin((u * 29 + Math.sin(v * tau) * .16) * tau);
    // Four maple splice points taper into the dark wood near the shaft joint.
    const phase = Math.abs(((u * 4 + .5) % 1) - .5), splice = phase < Math.max(0, (v - .38) * .28);
    const noise = random() - .5, value = grain * 3 + noise * 3;
    return { color: splice ? [185 + value, 137 + value, 77 + value] : [51 + value, 30 + value * .7, 20 + value * .5], height: grain * .015, roughness: .55 + noise * .04 };
  }, 1, 1, anisotropy));
  const cueButt = own(new THREE.MeshPhysicalMaterial({ ...butt, normalScale: new THREE.Vector2(.12, .12), roughness: .64, clearcoat: .48, clearcoatRoughness: .2, envMapIntensity: .75 }));
  const cueFerrule = own(new THREE.MeshPhysicalMaterial({ color: '#e9e4cc', roughness: .39, clearcoat: .12, clearcoatRoughness: .35 }));
  const cueTip = own(new THREE.MeshStandardMaterial({ color: '#447684', normalMap: hide.normalMap, normalScale: new THREE.Vector2(.22, .22), roughness: .99, envMapIntensity: .12 }));
  const pocketVoid = own(new THREE.MeshBasicMaterial({ color: '#030403', side: THREE.DoubleSide }));
  return { cloth, cushion, walnut, sideWood, darkWood, brass, leather, rubber, cueMaple, cueButt, cueFerrule, cueTip, pocketVoid,
    dispose() { if (disposed) return; disposed = true; for (const texture of textures) texture.dispose(); for (const material of materials) material.dispose(); },
  };
}
export type TableSurfaces = ReturnType<typeof createTableSurfaces>;
