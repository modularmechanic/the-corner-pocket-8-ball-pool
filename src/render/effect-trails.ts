import * as THREE from 'three';

export interface TrailParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  age: number;
  life: number;
  ice: boolean;
}

export function createTrailParticles(): TrailParticle[] {
  return Array.from({ length: 80 }, () => ({
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    age: 1,
    life: 0,
    ice: false,
  }));
}

export function createFireMesh() {
  return new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.055, 0.19, 6),
    new THREE.MeshBasicMaterial({
      color: '#fff5df',
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    80,
  );
}

export function createIceMesh() {
  return new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(0.065, 0),
    new THREE.MeshPhysicalMaterial({
      color: '#c1edff',
      metalness: 0.12,
      roughness: 0.12,
      clearcoat: 1,
      transparent: true,
      opacity: 0.85,
    }),
    80,
  );
}

export function updateTrailParticles(
  trails: readonly TrailParticle[],
  fire: THREE.InstancedMesh,
  ice: THREE.InstancedMesh,
  dummy: THREE.Object3D,
  color: THREE.Color,
  dt: number,
) {
  let fireCount = 0,
    iceCount = 0;
  for (const particle of trails) {
    if (particle.age >= particle.life) continue;
    particle.age += dt;
    if (particle.age >= particle.life) continue;
    const progress = particle.age / particle.life;
    particle.velocity.y -= dt * (particle.ice ? 4.5 : 0.4);
    particle.position.addScaledVector(particle.velocity, dt);
    particle.position.y = Math.max(0.025, particle.position.y);
    const scale = (1 - progress) * (particle.ice ? 0.85 : 1.35);
    dummy.position.copy(particle.position);
    dummy.rotation.set(particle.ice ? particle.age * 8 : 0.2, particle.age * 5, particle.ice ? particle.age * 4 : 0);
    dummy.scale.set(
      scale * (particle.ice ? 0.55 : 1),
      scale * (particle.ice ? 1.8 : 1),
      scale * (particle.ice ? 0.55 : 1),
    );
    dummy.updateMatrix();
    if (particle.ice) {
      ice.setMatrixAt(iceCount, dummy.matrix);
      color.set('#a9e3ff').multiplyScalar(0.8 + progress * 0.2);
      ice.setColorAt(iceCount++, color);
    } else {
      fire.setMatrixAt(fireCount, dummy.matrix);
      color.setHSL(0.12 - progress * 0.1, 1, 0.58 - progress * 0.25).multiplyScalar(1.9);
      fire.setColorAt(fireCount++, color);
    }
  }
  fire.count = fireCount;
  ice.count = iceCount;
  fire.instanceMatrix.needsUpdate = true;
  ice.instanceMatrix.needsUpdate = true;
  if (fire.instanceColor) fire.instanceColor.needsUpdate = true;
  if (ice.instanceColor) ice.instanceColor.needsUpdate = true;
}
