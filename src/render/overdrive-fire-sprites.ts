import * as THREE from 'three';
import { seededRandom } from '../simulation/types';

/** Forces a sprite's alpha to zero at the quad border. Without it a blob that reaches the edge
 * leaves a faint slab of constant alpha over the whole quad, invisible on one particle and a hard
 * rectangular block once a dozen of them overlap. */
const edgeFade = (u: number, v: number) => Math.min(1, 7 * Math.min(u, 1 - u, v, 1 - v));

/** DataTexture defaults to NearestFilter, which magnifies a 64px sprite into visible hard-edged
 * blocks. Every map here is a soft gradient, so all of them want linear filtering and mipmaps. */
function softTexture(data: Uint8Array, size: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** A soft, vertically stretched blob with fbm-ish noise chewed out of its edge. Used for both the
 * flame licks (additive, hot tint) and the smoke (normal blend, dark tint); the per-instance roll
 * hides the shared silhouette. A DataTexture, not a canvas, so it also builds under node. */
export function flameTexture(): THREE.DataTexture {
  const size = 64,
    data = new Uint8Array(size * size * 4),
    random = seededRandom('overdrive-flame');
  const grid = 8,
    noise = Array.from({ length: grid * grid }, random);
  const sample = (u: number, v: number) => {
    const x = u * grid,
      y = v * grid,
      x0 = Math.floor(x),
      y0 = Math.floor(y);
    const fx = x - x0,
      fy = y - y0,
      sx = fx * fx * (3 - 2 * fx),
      sy = fy * fy * (3 - 2 * fy);
    const at = (i: number, j: number) => noise[(((j % grid) + grid) % grid) * grid + (((i % grid) + grid) % grid)];
    const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
    const bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
    return top * (1 - sy) + bottom * sy;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size,
        v = (y + 0.5) / size;
      // A lick: broad where it grips, tapering to a tongue at the top of the quad.
      const dx = (u - 0.5) / (0.44 - 0.3 * v),
        dy = (v - 0.44) / 0.42;
      const radial = Math.max(0, 1 - Math.hypot(dx, dy));
      // The tip is eaten into by noise, which is what stops a billboard reading as a puff.
      const grain = 0.4 + 0.6 * sample(u * 2, v * 2.6 - 0.35);
      const alpha = radial * radial * (grain * (1 - v * 0.45) + v * 0.3) * edgeFade(u, v);
      const index = (y * size + x) * 4;
      // White core, so a per-instance colour decides the whole tint.
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = Math.round(Math.min(1, alpha) * 255);
    }
  return softTexture(data, size);
}

/** Two halves of one scorch: `char` is the darkened, frayed hole burnt through the nap, `ember` is
 * the sparse ring and speckle of coals still alight inside it. Generated from one noise field so
 * the coals sit inside the char rather than floating over it. */
export function scorchTextures(): { char: THREE.DataTexture; ember: THREE.DataTexture } {
  const size = 128,
    char = new Uint8Array(size * size * 4),
    ember = new Uint8Array(size * size * 4);
  const random = seededRandom('overdrive-scorch');
  const grid = 12,
    noise = Array.from({ length: grid * grid }, random);
  const sample = (u: number, v: number) => {
    const x = u * grid,
      y = v * grid,
      x0 = Math.floor(x),
      y0 = Math.floor(y);
    const fx = x - x0,
      fy = y - y0,
      sx = fx * fx * (3 - 2 * fx),
      sy = fy * fy * (3 - 2 * fy);
    const at = (i: number, j: number) => noise[(((j % grid) + grid) % grid) * grid + (((i % grid) + grid) % grid)];
    const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
    const bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
    return top * (1 - sy) + bottom * sy;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size,
        v = (y + 0.5) / size;
      const radius = Math.hypot(u - 0.5, v - 0.5) * 2;
      const fringe = 0.62 + 0.28 * sample(u * 2.2, v * 2.2);
      const body = Math.max(0, 1 - radius / fringe);
      const coarse = sample(u * 3.5 + 0.4, v * 3.5 + 0.9);
      const index = (y * size + x) * 4;
      // Char: near-black in the middle, warm ash brown at the frayed edge, holes where the nap survived.
      const burn = Math.min(1, body * (0.55 + 0.75 * coarse) * 1.5);
      const rim = Math.max(0, 1 - Math.abs(radius / fringe - 0.82) * 6) * body;
      char[index] = Math.round(18 + rim * 52);
      char[index + 1] = Math.round(12 + rim * 30);
      char[index + 2] = Math.round(10 + rim * 18);
      char[index + 3] = Math.round(Math.min(1, burn) * edgeFade(u, v) * 232);
      // Embers: coals in the cracks of the char, brightest where the char is thinnest.
      const speck = Math.max(0, sample(u * 3.4 + 2.1, v * 3.4 - 1.3) - 0.46) / 0.54;
      const glow = Math.min(1, body * speck * 1.35 + rim * 0.5 * body);
      ember[index] = 255;
      ember[index + 1] = Math.round(90 + 90 * (1 - glow));
      ember[index + 2] = Math.round(20 + 40 * (1 - glow));
      ember[index + 3] = Math.round(glow * edgeFade(u, v) * 255);
    }
  return { char: softTexture(char, size), ember: softTexture(ember, size) };
}

/** A plain soft radial falloff: the firelight pooled on the cloth under the ball, and the flash
 * inside the ignition ring. Additive, so it brightens the cloth the way a real flame would without
 * a light being added to a scene that is already light-bound. */
export function radialTexture(): THREE.DataTexture {
  const size = 64,
    data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size,
        v = (y + 0.5) / size;
      const radius = Math.min(1, Math.hypot(u - 0.5, v - 0.5) * 2);
      const falloff = (1 - radius) * (1 - radius) * (1 - radius * 0.35);
      const index = (y * size + x) * 4;
      data[index] = 255;
      data[index + 1] = Math.round(150 + 60 * (1 - radius));
      data[index + 2] = Math.round(48 + 40 * (1 - radius));
      data[index + 3] = Math.round(Math.max(0, falloff) * edgeFade(u, v) * 255);
    }
  return softTexture(data, size);
}

export const flatQuad = () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

/** Writes one instance's transform and RGBA. Mirrors how `TableEffects` drives its instanced
 * pools: a single draw per kind, with the per-instance colour riding an RGBA `color` attribute. */
export function writeInstance(
  mesh: THREE.InstancedMesh,
  index: number,
  matrix: THREE.Matrix4,
  color: THREE.Color,
  alpha: number,
) {
  mesh.setMatrixAt(index, matrix);
  mesh.geometry.getAttribute('color').setXYZW(index, color.r, color.g, color.b, alpha);
}

/** Empty pools skip their draw; live pools upload only the instances written this frame. */
export function commitInstances(mesh: THREE.InstancedMesh, count: number) {
  mesh.count = count;
  mesh.visible = count > 0;
  if (!count) return;
  for (const [attribute, size] of [
    [mesh.instanceMatrix, 16],
    [mesh.geometry.getAttribute('color') as THREE.InstancedBufferAttribute, 4],
  ] as const) {
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, count * size);
    attribute.needsUpdate = true;
  }
}
