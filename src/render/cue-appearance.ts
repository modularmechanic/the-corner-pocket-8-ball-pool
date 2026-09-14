import * as THREE from 'three';
import { type CueDefinition, DEFAULT_CUE } from '../simulation/cues';
import { seededRandom } from '../simulation/types';
import type { TableSurfaces } from './table-surfaces';

/** One active pair of materials; small grain maps are created only when equipped. */
export class CueAppearance {
  readonly shaft: THREE.MeshPhysicalMaterial;
  readonly butt: THREE.MeshPhysicalMaterial;
  private maps = new Map<string, THREE.DataTexture>();
  private current = '';
  constructor(surfaces: TableSurfaces) {
    this.shaft = surfaces.cueMaple.clone();
    this.butt = surfaces.cueButt.clone();
  }
  equip(cue: CueDefinition) {
    if (this.current === cue.id) return false;
    this.current = cue.id;
    let map = this.maps.get(cue.id);
    if (!map) {
      const width = 256,
        height = 512,
        data = new Uint8Array(width * height * 4),
        random = seededRandom(cue.id);
      const base = new THREE.Color(cue.color).convertLinearToSRGB();
      const frequency = cue.wood === 'Ash' ? 12 : cue.wood === 'Maple' ? 24 : cue.wood === 'Ebony' ? 32 : 17;
      const bend = cue.wood === 'Walnut' ? 0.34 : cue.wood === 'Rosewood' ? 0.23 : 0.08;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const u = x / width,
            v = y / height,
            wave = Math.sin((u * frequency + Math.sin(v * Math.PI * 2) * bend) * Math.PI * 2);
          const pore = Math.pow(Math.max(0, wave), cue.wood === 'Ash' ? 5 : 12);
          const fine = Math.sin((u * 81 + Math.sin(v * Math.PI * 4) * 0.11) * Math.PI * 2);
          const value = 1 - pore * 0.27 + fine * 0.018 + (random() - 0.5) * 0.025,
            index = (y * width + x) * 4;
          data[index] = Math.min(255, base.r * 255 * value);
          data[index + 1] = Math.min(255, base.g * 255 * value);
          data[index + 2] = Math.min(255, base.b * 255 * value);
          data[index + 3] = 255;
        }
      map = new THREE.DataTexture(data, width, height);
      map.colorSpace = THREE.SRGBColorSpace;
      map.generateMipmaps = true;
      map.minFilter = THREE.LinearMipmapLinearFilter;
      map.magFilter = THREE.LinearFilter;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.anisotropy = 4;
      map.needsUpdate = true;
      this.maps.set(cue.id, map);
    }
    this.shaft.map = map;
    this.shaft.color.set('#ffffff');
    this.shaft.name = `${cue.wood} ${cue.weightOz} oz shaft`;
    this.butt.color.set(cue.accent);
    this.butt.name = `${cue.name} spliced butt`;
    this.shaft.clearcoat = cue.id === DEFAULT_CUE ? 0.2 : 0.35;
    return true;
  }
  dispose() {
    this.shaft.dispose();
    this.butt.dispose();
    for (const map of this.maps.values()) map.dispose();
  }
}
