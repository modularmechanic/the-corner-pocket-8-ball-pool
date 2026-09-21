import * as THREE from 'three';

/** The room's scanned surfaces: its wood, and the glazed tile on the wainscot panels.
 *
 * Textures arrive through the prop installer, not a loader of our own: that is what lets the
 * headless tests stub them, and it keeps every surface on one request per file. A material can ask
 * for wood before the file has arrived, so requests made early are held and filled on arrival. */
export type WoodGrain = 'oak' | 'walnut' | 'tiles';

export const PUB_WOOD_MAPS: Readonly<Record<WoodGrain, string>> = {
  oak: 'textures/pub/wall-oak-color.webp',
  walnut: 'textures/pub/walnut-color.webp',
  tiles: 'textures/pub/wall-tiles-color.webp',
};

interface Pending {
  material: THREE.MeshStandardMaterial;
  slot: 'map' | 'bumpMap';
  repeatX: number;
  repeatY: number;
}

const arrived: Partial<Record<WoodGrain, THREE.Texture>> = {};
const waiting: Record<WoodGrain, Pending[]> = { oak: [], walnut: [], tiles: [] };

function fill(grain: WoodGrain, pending: Pending) {
  const source = arrived[grain];
  if (!source) return;
  const texture = source.clone();
  texture.needsUpdate = true;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(pending.repeatX, pending.repeatY);
  pending.material[pending.slot] = texture;
  pending.material.needsUpdate = true;
}

/** Put a grain on a material at its own repeat, now or as soon as the file lands. */
export function useWood(
  material: THREE.MeshStandardMaterial,
  grain: WoodGrain,
  repeatX = 1,
  repeatY = 1,
  slot: 'map' | 'bumpMap' = 'map',
) {
  const pending: Pending = { material, slot, repeatX, repeatY };
  if (arrived[grain]) fill(grain, pending);
  else waiting[grain].push(pending);
}

/** Called once per grain by the room build, with the texture the installer parsed. */
export function provideWood(grain: WoodGrain, texture: THREE.Texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  arrived[grain] = texture;
  for (const pending of waiting[grain].splice(0)) fill(grain, pending);
}
