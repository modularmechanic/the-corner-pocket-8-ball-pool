import * as THREE from 'three';

/** One-shot accents that own a single object each, rather than riding a particle pool. */
export interface Flash {
  light: THREE.PointLight;
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  age: number;
  life: number;
  strength: number;
}
export interface Arc {
  line: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  age: number;
  life: number;
  radius: number;
  x: number;
  z: number;
}
export interface Ribbon {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  age: number;
  life: number;
  x: number;
  z: number;
}

export function createFlash(group: THREE.Group): Flash {
  const light = new THREE.PointLight('#ffb76a', 0, 3.3, 2),
    mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 12, 8),
      new THREE.MeshBasicMaterial({
        color: '#ffe8c1',
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
  light.userData.performanceFlash = true;
  mesh.visible = false;
  group.add(light, mesh);
  return { light, mesh, age: 1, life: 0, strength: 0 };
}

export function createArc(group: THREE.Group): Arc {
  const arcGeometry = new THREE.BufferGeometry();
  arcGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(56 * 3), 3).setUsage(THREE.DynamicDrawUsage),
  );
  const line = new THREE.LineSegments(
    arcGeometry,
    new THREE.LineBasicMaterial({
      color: '#aeeaff',
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  line.visible = false;
  line.frustumCulled = false;
  group.add(line);
  return { line, age: 1, life: 0, radius: 0.7, x: 0, z: 0 };
}

export function createRibbon(group: THREE.Group): Ribbon {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(49 * 6), 3));
  const indices = [];
  for (let j = 0; j < 48; j++) indices.push(j * 2, j * 2 + 1, j * 2 + 2, j * 2 + 1, j * 2 + 3, j * 2 + 2);
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: '#caa9ff',
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  mesh.visible = false;
  mesh.frustumCulled = false;
  group.add(mesh);
  return { mesh, age: 1, life: 0, x: 0, z: 0 };
}

export function updateFlash(flash: Flash, dt: number) {
  flash.age += dt;
  const progress = Math.min(1, flash.age / flash.life);
  flash.light.intensity = flash.strength * (1 - progress) ** 2;
  flash.mesh.material.opacity = (1 - progress) * 0.75;
  flash.mesh.scale.setScalar(0.6 + progress * 2.2);
  flash.mesh.visible = progress < 1;
}

export function updateArc(arc: Arc, dt: number) {
  arc.age += dt;
  if (arc.age >= arc.life) {
    arc.line.visible = false;
    return;
  }
  const positions = arc.line.geometry.getAttribute('position') as THREE.BufferAttribute;
  let vertex = 0;
  for (let branch = 0; branch < 4; branch++) {
    const angle = (branch * Math.PI) / 2 + 0.35;
    let px = arc.x,
      py = 0.22,
      pz = arc.z;
    for (let segment = 1; segment <= 6; segment++) {
      const distance = (segment / 6) * arc.radius,
        bend = Math.sin(segment * 9.2 + branch * 3 + Math.floor(arc.age * 60)) * 0.055;
      const nx = arc.x + Math.cos(angle) * distance - Math.sin(angle) * bend,
        ny = 0.16 + Math.abs(bend) * 2,
        nz = arc.z + Math.sin(angle) * distance + Math.cos(angle) * bend;
      positions.setXYZ(vertex++, px, py, pz);
      positions.setXYZ(vertex++, nx, ny, nz);
      if (segment === 3) {
        positions.setXYZ(vertex++, nx, ny, nz);
        positions.setXYZ(vertex++, nx + Math.cos(angle + 0.7) * 0.22, 0.23, nz + Math.sin(angle + 0.7) * 0.22);
      }
      px = nx;
      py = ny;
      pz = nz;
    }
  }
  positions.needsUpdate = true;
  arc.line.material.opacity = (1 - arc.age / arc.life) * (0.6 + Math.sin(arc.age * 100) * 0.25);
}

export function updateRibbon(ribbon: Ribbon, dt: number) {
  ribbon.age += dt;
  if (ribbon.age >= ribbon.life) {
    ribbon.mesh.visible = false;
    return;
  }
  const progress = ribbon.age / ribbon.life,
    positions = ribbon.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i <= 48; i++) {
    const u = i / 48,
      angle = u * Math.PI * 4.5 + progress * 9,
      radius = 0.11 + u * 0.28 + progress * 0.12,
      width = 0.013 * (1 - u * 0.55);
    for (let side = 0; side < 2; side++) {
      const r = radius + (side ? width : -width);
      positions.setXYZ(
        i * 2 + side,
        ribbon.x + Math.cos(angle) * r,
        0.04 + u * 0.73 * (1 - progress * 0.35),
        ribbon.z + Math.sin(angle) * r,
      );
    }
  }
  positions.needsUpdate = true;
  ribbon.mesh.material.opacity = Math.sin((Math.min(1, progress * 2) * Math.PI) / 2) * (1 - progress) * 0.85;
}
