import * as THREE from 'three';
import { seededRandom, TABLE, type GameModeId } from '../simulation/types';
import { PROP_ANISOTROPY, type PropInstaller } from './asset-installer';
import { clothLook, clothSampler, clothTexels, type ClothLook } from './cloth';
import type { RenderBudget } from './performance';

/** Existing CC0 Wood Table 001 scans (Dimitrios Savva / Rico Cilliers, Poly Haven).
 * Cloth is baked in Blender via MCP. Remaining original surface fallbacks are
 * seeded artwork. Albedo is sRGB; normals and roughness stay linear. */
export const TABLE_SURFACE_SOURCES = {
  walnut: 'wood-color.jpg, wood-normal.jpg, wood-roughness.jpg — Wood Table 001 / Poly Haven / CC0',
  cloth:
    'Eight-ball: Blender MCP fine wool baize — 2K albedo, 1K tangent normal and packed height/roughness bake; art/blender/fine-baize.blend. Snooker, billiards and zombie: seeded woven baize generated at the render budget’s size; see ./cloth.',
  leather: 'Original fine pebbled leather grain',
  brass: 'Original directional machining, oxidation and handling marks',
  cue: 'Original longitudinal maple and dark spliced hardwood grain',
} as const;

/** Prop paths relative to public/. */
export const BAIZE_MAPS = [
  ['color', 'textures/table/baize-color.png'],
  ['normal', 'textures/table/baize-normal.png'],
  ['surface', 'textures/table/baize-surface.png'],
] as const;
export const WOOD_SCAN_MAPS = [
  ['map', 'wood-color.jpg'],
  ['normalMap', 'wood-normal.jpg'],
  ['roughnessMap', 'wood-roughness.jpg'],
] as const;
export type WoodScanSlot = (typeof WOOD_SCAN_MAPS)[number][0];

/** The table and the pub bar share one parse and upload of each scan, so both request it
 * with this identical preparation. `bind` must clone a scan before changing its transform. */
export function requestWoodScan(
  installer: PropInstaller,
  bind: (slot: WoodScanSlot, scan: THREE.Texture) => void,
  placeholders?: Record<WoodScanSlot, THREE.Texture>,
) {
  for (const [slot, path] of WOOD_SCAN_MAPS)
    installer.texture(path, {
      placeholder: placeholders?.[slot],
      prepare: (scan) => {
        scan.wrapS = scan.wrapT = THREE.RepeatWrapping;
        if (slot === 'map') scan.colorSpace = THREE.SRGBColorSpace;
      },
      use: (scan) => bind(slot, scan),
    });
}

type RGB = [number, number, number];
interface SurfaceSample {
  color: RGB;
  height: number;
  roughness: number;
  bump?: number;
}
interface SurfaceMaps {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
}
const tau = Math.PI * 2;
function maps(
  width: number,
  height: number,
  sample: (x: number, y: number) => SurfaceSample,
  repeatX: number,
  repeatY: number,
): SurfaceMaps {
  const albedo = new Uint8Array(width * height * 4),
    normal = new Uint8Array(width * height * 4),
    rough = new Uint8Array(width * height * 2),
    heights = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const index = y * width + x,
        offset = index * 4,
        value = sample(x, y);
      for (let channel = 0; channel < 3; channel++) albedo[offset + channel] = value.color[channel];
      // Three samples roughness from green. RG8 preserves that value without
      // allocating unused blue/alpha channels for every material's scalar map.
      rough[index * 2] = Math.round((value.bump ?? 1) * 255);
      rough[index * 2 + 1] = Math.round(value.roughness * 255);
      albedo[offset + 3] = 255;
      heights[index] = value.height;
    }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const dx = heights[y * width + ((x + 1) % width)] - heights[y * width + ((x + width - 1) % width)];
      const dy = heights[((y + 1) % height) * width + x] - heights[((y + height - 1) % height) * width + x];
      const length = Math.hypot(dx, dy, 1);
      normal[offset] = Math.round(((-dx / length) * 0.5 + 0.5) * 255);
      normal[offset + 1] = Math.round(((-dy / length) * 0.5 + 0.5) * 255);
      normal[offset + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255);
      normal[offset + 3] = 255;
    }
  const texture = (data: Uint8Array, color = false, format: THREE.PixelFormat = THREE.RGBAFormat) => {
    const result = new THREE.DataTexture(data, width, height, format);
    result.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    result.wrapS = result.wrapT = THREE.RepeatWrapping;
    result.repeat.set(repeatX, repeatY);
    result.magFilter = THREE.LinearFilter;
    result.minFilter = THREE.LinearMipmapLinearFilter;
    result.generateMipmaps = true;
    result.anisotropy = PROP_ANISOTROPY;
    result.needsUpdate = true;
    return result;
  };
  return {
    map: texture(albedo, true),
    normalMap: texture(normal),
    roughnessMap: texture(rough, false, THREE.RGFormat),
  };
}

function useBaizeBump(material: THREE.MeshPhysicalMaterial) {
  // Three's built-in normal chunk selects normal OR bump. Apply its standard
  // height perturbation after the micro-normal so both maps actually contribute.
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
#if defined( USE_BUMPMAP ) && defined( USE_NORMALMAP_TANGENTSPACE )
  normal = perturbNormalArb( -vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,
    );
  };
  material.customProgramCacheKey = () => 'blender-baize-normal-and-height-v2';
}

export function createTableSurfaces(installer: PropInstaller) {
  const materials = new Set<THREE.Material>();
  const own = <T extends THREE.Material>(material: T): T => {
    materials.add(material);
    return material;
  };
  // A matte solid color is the placeholder while the Blender maps load. The old chunky
  // startup-generated nap is intentionally gone, including from the placeholder.
  const cloth = own(
    new THREE.MeshPhysicalMaterial({
      color: '#285f32',
      bumpScale: TABLE.radius * 0.00035,
      normalScale: new THREE.Vector2(0.3, 0.3),
      roughness: 1,
      metalness: 0,
      sheen: 0.12,
      sheenColor: '#77916a',
      sheenRoughness: 1,
      specularIntensity: 0.16,
      envMapIntensity: 0.13,
    }),
  );
  cloth.name = 'Blender fine tournament baize';
  useBaizeBump(cloth);
  const cushion = own(cloth.clone());
  useBaizeBump(cushion);
  cushion.name = 'Cloth-covered cushion rubber';
  cushion.normalScale.set(0.24, 0.24);
  cushion.bumpScale *= 0.8;
  cushion.sheen = 0.1;
  // Eight-ball keeps the Blender bake and nothing below ever touches it for that mode. The other
  // modes swap in cloth generated at the size the render budget asks for; one set is kept at a time.
  const bakedBaize: Partial<Record<(typeof BAIZE_MAPS)[number][0], THREE.Texture>> = {};
  let clothMode: GameModeId = 'eight-ball',
    clothSize = 0,
    generated: SurfaceMaps | null = null;
  const bakedBump = TABLE.radius * 0.00035;
  const applyLook = (look: ClothLook) => {
    for (const [material, tuning] of [
      [cloth, look.cloth],
      [cushion, look.cushion],
    ] as const) {
      material.sheen = tuning.sheen;
      material.sheenColor.set(tuning.sheenColor);
      material.normalScale.set(tuning.normal, tuning.normal);
      material.bumpScale = bakedBump * tuning.bump;
    }
  };
  const applyBaked = () => {
    for (const material of [cloth, cushion]) {
      material.map = bakedBaize.color ?? null;
      material.normalMap = bakedBaize.normal ?? null;
      material.bumpMap = bakedBaize.surface ?? null;
      material.roughnessMap = bakedBaize.surface ?? null;
      // The matte placeholder colour stands in until the albedo bake actually lands.
      material.color.set(bakedBaize.color ? (material === cloth ? '#ffffff' : '#e8eddf') : '#285f32');
      material.needsUpdate = true;
    }
  };
  for (const [kind, path] of BAIZE_MAPS)
    installer.texture(path, {
      prepare: (texture) => {
        texture.name = `Blender baize ${kind}`;
        texture.colorSpace = kind === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(6, 3);
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.generateMipmaps = true;
      },
      use: (texture) => {
        bakedBaize[kind] = texture;
        if (clothMode === 'eight-ball') applyBaked();
      },
    });

  let random = seededRandom('corner-pocket-grain-v2');
  const timber = maps(
    512,
    512,
    (x, y) => {
      const wave = Math.sin(((x / 512) * 17 + Math.sin((y * tau) / 512) * 0.3) * tau);
      const pores = Math.sin(((x / 512) * 91 + Math.sin((y * tau) / 512) * 0.6) * tau),
        noise = random() - 0.5;
      const value = wave * 6 + pores * 3 + noise * 4;
      return {
        color: [99 + value, 57 + value * 0.6, 29 + value * 0.35],
        height: wave * 0.045 + pores * 0.025,
        roughness: 0.62 + noise * 0.1 + wave * 0.035,
      };
    },
    2,
    1,
  );
  for (const texture of Object.values(timber)) {
    texture.center.set(0.5, 0.5);
    texture.rotation = Math.PI / 2;
  }
  const walnut = own(
    new THREE.MeshPhysicalMaterial({
      ...timber,
      color: '#e2c79f',
      normalScale: new THREE.Vector2(0.19, 0.19),
      roughness: 0.74,
      clearcoat: 0.34,
      clearcoatRoughness: 0.28,
      specularIntensity: 0.6,
      envMapIntensity: 0.52,
    }),
  );
  const sideWood = own(walnut.clone());
  sideWood.color.set('#bc936c');
  sideWood.clearcoat = 0.2;
  sideWood.roughness = 0.82;
  const darkWood = own(walnut.clone());
  darkWood.color.set('#6b4b33');
  darkWood.clearcoat = 0.18;
  darkWood.roughness = 0.83;
  // The seeded grain is the placeholder; the scan's clone keeps the table's own rotated transform.
  requestWoodScan(
    installer,
    (slot, scan) => {
      const texture = scan.clone();
      texture.repeat.set(2, 1);
      texture.center.set(0.5, 0.5);
      texture.rotation = Math.PI / 2;
      for (const material of [walnut, sideWood, darkWood]) {
        material[slot] = texture;
        material.needsUpdate = true;
      }
    },
    timber,
  );

  random = seededRandom('corner-pocket-brass-v2');
  const metal = maps(
    512,
    512,
    (x, y) => {
      const scratch = Math.sin((y * tau) / 2) * 0.035 + Math.sin((y * tau) / 7.11111111) * 0.04;
      const patina = Math.sin((x * tau) / 128) * Math.sin((y * tau) / 256),
        noise = random() - 0.5;
      const value = noise * 7 + scratch * 36 + patina * 6;
      return {
        color: [187 + value, 151 + value * 0.85, 84 + value * 0.5],
        height: scratch * 0.16 + noise * 0.025,
        roughness: 0.39 + noise * 0.08 + patina * 0.07,
      };
    },
    2,
    1,
  );
  const brass = own(
    new THREE.MeshPhysicalMaterial({
      ...metal,
      normalScale: new THREE.Vector2(0.21, 0.21),
      metalness: 0.87,
      roughness: 1,
      clearcoat: 0.08,
      clearcoatRoughness: 0.38,
      envMapIntensity: 0.7,
    }),
  );
  brass.name = 'Handled brass — brushed and oxidized';
  random = seededRandom('corner-pocket-leather-v2');
  const hide = maps(
    512,
    512,
    (x, y) => {
      const grain = Math.sin(((x + Math.sin((y * tau) / 16) * 2) * tau) / 8) * Math.sin((y * tau) / 8),
        noise = random() - 0.5;
      const value = grain * 3 + noise * 3;
      return {
        color: [47 + value, 35 + value * 0.75, 24 + value * 0.6],
        height: grain * 0.19 + noise * 0.06,
        roughness: 0.78 + noise * 0.1 + grain * 0.04,
      };
    },
    2,
    1,
  );
  const leather = own(
    new THREE.MeshPhysicalMaterial({
      ...hide,
      normalScale: new THREE.Vector2(0.38, 0.38),
      roughness: 1,
      sheen: 0.06,
      sheenColor: '#8b7254',
      sheenRoughness: 1,
      side: THREE.DoubleSide,
      envMapIntensity: 0.25,
    }),
  );
  const rubber = own(
    new THREE.MeshStandardMaterial({
      ...hide,
      color: '#404936',
      normalScale: new THREE.Vector2(0.1, 0.1),
      roughness: 0.98,
      metalness: 0,
      envMapIntensity: 0.12,
    }),
  );

  random = seededRandom('corner-pocket-maple-shaft-v2');
  const maple = maps(
    512,
    1024,
    (x, y) => {
      const u = x / 512,
        v = y / 1024;
      const bend = Math.sin(v * tau) * 0.085 + Math.sin(v * tau * 2) * 0.025;
      const growth = Math.sin((u * 11 + bend) * tau),
        fine = Math.sin((u * 43 + bend * 2) * tau);
      const grain = Math.pow(Math.max(0, growth), 9),
        noise = random() - 0.5;
      const value = grain * 25 + fine * 3.8 + noise * 3;
      return {
        color: [217 - value, 181 - value * 0.85, 126 - value * 0.6],
        height: grain * 0.04 + fine * 0.012,
        roughness: 0.55 + grain * 0.04 + noise * 0.04,
      };
    },
    1,
    1,
  );
  const cueMaple = own(
    new THREE.MeshPhysicalMaterial({
      ...maple,
      normalScale: new THREE.Vector2(0.09, 0.09),
      roughness: 0.64,
      clearcoat: 0.25,
      clearcoatRoughness: 0.27,
      specularIntensity: 0.45,
      envMapIntensity: 0.65,
    }),
  );
  random = seededRandom('corner-pocket-butt-v2');
  const butt = maps(
    512,
    512,
    (x, y) => {
      const u = x / 512,
        v = y / 512,
        grain = Math.sin((u * 29 + Math.sin(v * tau) * 0.16) * tau);
      // Four maple splice points taper into the dark wood near the shaft joint.
      const phase = Math.abs(((u * 4 + 0.5) % 1) - 0.5),
        splice = phase < Math.max(0, (v - 0.38) * 0.28);
      const noise = random() - 0.5,
        value = grain * 3 + noise * 3;
      return {
        color: splice ? [185 + value, 137 + value, 77 + value] : [51 + value, 30 + value * 0.7, 20 + value * 0.5],
        height: grain * 0.015,
        roughness: 0.55 + noise * 0.04,
      };
    },
    1,
    1,
  );
  const cueButt = own(
    new THREE.MeshPhysicalMaterial({
      ...butt,
      normalScale: new THREE.Vector2(0.12, 0.12),
      roughness: 0.64,
      clearcoat: 0.48,
      clearcoatRoughness: 0.2,
      envMapIntensity: 0.75,
    }),
  );
  const cueFerrule = own(
    new THREE.MeshPhysicalMaterial({ color: '#e9e4cc', roughness: 0.39, clearcoat: 0.12, clearcoatRoughness: 0.35 }),
  );
  const cueTip = own(
    new THREE.MeshStandardMaterial({
      color: '#447684',
      normalMap: hide.normalMap,
      normalScale: new THREE.Vector2(0.22, 0.22),
      roughness: 0.99,
      envMapIntensity: 0.12,
    }),
  );
  const pocketVoid = own(new THREE.MeshBasicMaterial({ color: '#030403', side: THREE.DoubleSide }));
  return {
    cloth,
    cushion,
    walnut,
    sideWood,
    darkWood,
    brass,
    leather,
    rubber,
    cueMaple,
    cueButt,
    cueFerrule,
    cueTip,
    pocketVoid,
    /** Give the bed and cushions the cloth this mode plays on, at the resolution this budget and
     * display can actually show. A no-op when neither changed, so the caller may ask every frame;
     * a tier change regenerates, and eight-ball always returns to the untouched Blender bake. */
    setCloth(mode: GameModeId, budget: RenderBudget, viewportPixels: number, deviceDpr: number): void {
      const texels = mode === 'eight-ball' ? 0 : clothTexels(budget, viewportPixels, deviceDpr);
      if (mode === clothMode && texels === clothSize) return;
      clothMode = mode;
      clothSize = texels;
      // The outgoing set is bound to the materials right up to here, so it is freed exactly once.
      if (generated) for (const texture of Object.values(generated)) texture.dispose();
      generated = null;
      applyLook(clothLook(mode));
      if (mode === 'eight-ball') return applyBaked();
      generated = maps(texels, texels, clothSampler(mode, texels), 6, 3);
      for (const material of [cloth, cushion]) {
        material.map = generated.map;
        material.normalMap = generated.normalMap;
        // Height in R and roughness in G, one upload, exactly as the Blender surface bake packs it.
        material.bumpMap = generated.roughnessMap;
        material.roughnessMap = generated.roughnessMap;
        material.color.set(material === cloth ? '#ffffff' : '#e8eddf');
        material.needsUpdate = true;
      }
    },
    /** Maps are collected from the owned materials, so a swapped-out placeholder is never freed twice. */
    dispose() {
      const textures = new Set<THREE.Texture>();
      for (const material of materials)
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      for (const texture of textures) texture.dispose();
      for (const material of materials) material.dispose();
      materials.clear();
    },
  };
}
export type TableSurfaces = ReturnType<typeof createTableSurfaces>;
