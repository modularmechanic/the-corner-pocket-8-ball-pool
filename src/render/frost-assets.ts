import * as THREE from 'three';

/** Deterministic value hash: the rime crust and every track patch must look identical across reloads. */
export const frostHash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const lattice = (x: number, y: number) => frostHash(x * 37.719 + y * 91.317);
/** Tiling bilinear value noise. Wrapping the lattice keeps the crust seamless where the UVs repeat. */
function noise(x: number, y: number, period: number) {
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    fx = x - x0,
    fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx),
    sy = fy * fy * (3 - 2 * fy);
  const wrap = (n: number) => ((n % period) + period) % period;
  const a = lattice(wrap(x0), wrap(y0)),
    b = lattice(wrap(x0 + 1), wrap(y0)),
    c = lattice(wrap(x0), wrap(y0 + 1)),
    d = lattice(wrap(x0 + 1), wrap(y0 + 1));
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}
/** Sharp-ridged multi-octave noise: ice grows in creases and blades, not soft blobs. */
function rime(x: number, y: number, base: number) {
  let value = 0,
    amplitude = 1,
    total = 0;
  for (let octave = 0; octave < 3; octave++) {
    const period = base << octave;
    value += (1 - Math.abs(noise(x * period, y * period, period) * 2 - 1)) ** 2 * amplitude;
    total += amplitude;
    amplitude *= 0.5;
  }
  return value / total;
}

/** A lumpy ice crust rather than a sphere. The displacement is keyed on the quantised vertex position so
 * the duplicated corners of this non-indexed polyhedron agree and the shell stays watertight. */
export function rimeCrustGeometry(radius: number) {
  const geometry = new THREE.IcosahedronGeometry(radius, 5),
    position = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      y = position.getY(i),
      z = position.getZ(i);
    const key =
      (Math.round(x * 2600) * 73856093) ^ (Math.round(y * 2600) * 19349663) ^ (Math.round(z * 2600) * 83492791);
    // A granular skin with the odd thick wad of rime, so the silhouette is crunchy rather than a clean circle.
    const lump = frostHash(key % 262144),
      swell = 1 + (lump - 0.4) * 0.09 + (lump > 0.93 ? 0.06 : 0);
    position.setXYZ(i, x * swell, y * swell, z * swell);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Crystal blades on a Fibonacci sphere, thinned into patches so the rime looks grown rather than moulded.
 * Baked once into instance matrices: the crust group is moved and rolled whole, nothing is recomputed. */
export function seedRimeSpikes(mesh: THREE.InstancedMesh, radius: number, dummy: THREE.Object3D) {
  const up = new THREE.Vector3(0, 1, 0),
    direction = new THREE.Vector3();
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < mesh.count; i++) {
    const y = 1 - (i / (mesh.count - 1)) * 2,
      ring = Math.sqrt(Math.max(0, 1 - y * y)),
      theta = golden * i;
    direction.set(Math.cos(theta) * ring, y, Math.sin(theta) * ring).normalize();
    // A low-frequency patch mask: some faces of the ball are thickly crusted, others nearly bare.
    const patch = frostHash(
      Math.round(direction.x * 2) * 31 + Math.round(direction.y * 2) * 57 + Math.round(direction.z * 2) * 91,
    );
    const length = (0.25 + frostHash(i * 3.3) ** 2 * 1.35) * (0.35 + patch),
      girth = 0.45 + frostHash(i * 7.7) * 0.75;
    dummy.position.copy(direction).multiplyScalar(radius * 0.93);
    dummy.quaternion.setFromUnitVectors(up, direction);
    dummy.rotateX((frostHash(i * 11.1) - 0.5) * 1.1);
    dummy.rotateZ((frostHash(i * 13.7) - 0.5) * 1.1);
    dummy.translateY(radius * 0.16 * length);
    dummy.scale.set(girth, length, girth);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

/** The crust's surface detail, from one ridged height field: a normal map that glints crystal-by-crystal
 * under the table lamp, and a roughness map that mixes wet ice with dry, matte hoar. Raw pixels, so this
 * also builds headless. */
export function frostSurfaceMaps(size = 128) {
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) height[y * size + x] = rime(x / size, y / size, 8);
  const normal = new Uint8Array(size * size * 4),
    rough = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Central differences, steep enough that every crystal edge catches a highlight.
      const dx = (at(x - 1, y) - at(x + 1, y)) * 2.4,
        dz = (at(x, y - 1) - at(x, y + 1)) * 2.4;
      const length = Math.hypot(dx, dz, 1);
      normal[i] = ((dx / length) * 0.5 + 0.5) * 255;
      normal[i + 1] = ((dz / length) * 0.5 + 0.5) * 255;
      normal[i + 2] = (1 / length) * 0.5 * 255 + 128;
      normal[i + 3] = 255;
      // Ridges are wet and glassy, the flats between them are dry hoar frost.
      rough[i] = rough[i + 1] = rough[i + 2] = (0.82 - at(x, y) * 0.58) * 255;
      rough[i + 3] = 255;
    }
  return {
    normal: dataTexture(normal, size, THREE.NoColorSpace),
    roughness: dataTexture(rough, size, THREE.NoColorSpace),
  };
}

/** A frost patch: crystal spokes plus speckle, for the ice left on the cloth. */
export function frostPatchTexture(size = 64) {
  const data = new Uint8Array(size * size * 4),
    half = size / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - half) / half,
        dy = (y + 0.5 - half) / half;
      const r = Math.hypot(dx, dy),
        angle = Math.atan2(dy, dx);
      // Faint radial structure under a lot of crystal noise: a smear of rime, not a cut-out snowflake.
      const spokes = 0.74 + 0.26 * Math.abs(Math.cos(angle * 2.5 + r * 3.1));
      const crystals = 0.12 + 0.88 * rime(x / size, y / size, 12) ** 0.8;
      const value = Math.max(0, 1 - r) ** 1.5 * spokes * crystals;
      const i = (y * size + x) * 4;
      data[i] = 226 + value * 29;
      data[i + 1] = 246 + value * 9;
      data[i + 2] = 255;
      data[i + 3] = Math.min(255, value * 420);
    }
  return dataTexture(data, size, THREE.SRGBColorSpace);
}

function dataTexture(data: Uint8Array, size: number, colorSpace: THREE.ColorSpace) {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = colorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
