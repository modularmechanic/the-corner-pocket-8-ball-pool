import * as THREE from 'three';
import { instanced, nextFree, pool, type Pooled } from './effect-pools';
import { TABLE, cueBallId, type GameState } from '../simulation/types';
import { frostHash, frostPatchTexture, frostSurfaceMaps, rimeCrustGeometry, seedRimeSpikes } from './frost-assets';

/** The simulation's evaporating ice trail. Declared here rather than imported so this module compiles
 * whether or not `ArcadeState.frost` has landed yet, and tolerates a state snapshot that predates it. */
export interface FrostTrack {
  id: number;
  x: number;
  z: number;
  life: number;
}
interface Wisp extends Pooled {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
}
interface Shard extends Wisp {
  spin: THREE.Vector3;
  rotation: THREE.Euler;
}
interface Ring extends Pooled {
  x: number;
  z: number;
  reach: number;
}
export const FROST_TRACK_CAPACITY = 24;
const WISP_CAPACITY = 24,
  SHARD_CAPACITY = 20,
  SPIKE_COUNT = 44;
const ICE = new THREE.Color('#bfeeff'),
  RIME = new THREE.Color('#e6f8ff');
const clamp01 = (n: number) => (n > 1 ? 1 : n > 0 ? n : 0);

/** Every visible part of the frost buff: the rime crust that encases a frozen cue ball, the ice tracks it
 * leaves on the cloth as they evaporate, and the cold snap when the buff lands. Self-contained — it reads
 * the state and owns its own objects, and never touches the ball meshes, so "unfrozen" is just hiding. */
export class FrostVisuals {
  private group = new THREE.Group();
  private crust = new THREE.Group();
  private shell: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  private spikes: THREE.InstancedMesh;
  private patch = frostPatchTexture();
  private surface = frostSurfaceMaps();

  private trackMesh: THREE.InstancedMesh;
  private wispMesh: THREE.InstancedMesh;
  private shardMesh: THREE.InstancedMesh;
  private ringMesh: THREE.InstancedMesh;
  private wisps = pool<Wisp>(WISP_CAPACITY, () => ({ position: new THREE.Vector3(), velocity: new THREE.Vector3() }));
  private shards = pool<Shard>(SHARD_CAPACITY, () => ({
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    spin: new THREE.Vector3(),
    rotation: new THREE.Euler(),
  }));
  private rings = pool<Ring>(2, () => ({ x: 0, z: 0, reach: 1 }));
  /** Last seen `life` per track id, so a track crossing a threshold can puff vapour exactly once. */
  private trackLife = new Map<number, number>();
  private wasFrozen: [number, number] = [0, 0];
  private crustScale = 0;
  /** Counts down from 1 after the buff lands, flaring the crust white for the cold snap. */
  private flash = 0;
  private previous = new THREE.Vector3();
  private rolling = false;
  private clock = 0;
  private dummy = new THREE.Object3D();
  private axis = new THREE.Vector3();

  constructor(private scene: THREE.Scene) {
    this.shell = new THREE.Mesh(
      rimeCrustGeometry(TABLE.radius * 1.035),
      new THREE.MeshPhysicalMaterial({
        color: '#e9f6ff',
        // Self-lit enough to read as ice in a dim pub without adding a light to the scene.
        emissive: '#9fd9f4',
        emissiveIntensity: 0.22,
        roughnessMap: this.surface.roughness,
        roughness: 1,
        metalness: 0,
        normalMap: this.surface.normal,
        clearcoat: 1,
        clearcoatRoughness: 0.14,
        clearcoatNormalMap: this.surface.normal,
        envMapIntensity: 1.5,
      }),
    );
    // The icosphere's UVs run 2:1, so the crystal detail stays square on the ball.
    for (const map of [this.surface.normal, this.surface.roughness]) map.repeat.set(3, 1.5);
    this.spikes = new THREE.InstancedMesh(
      new THREE.ConeGeometry(TABLE.radius * 0.07, TABLE.radius * 0.3, 4),
      new THREE.MeshPhysicalMaterial({
        color: '#f6fdff',
        emissive: '#a8ddf5',
        emissiveIntensity: 0.3,
        roughness: 0.22,
        metalness: 0,
        clearcoat: 1,
        envMapIntensity: 1.8,
        flatShading: true,
      }),
      SPIKE_COUNT,
    );
    this.spikes.count = SPIKE_COUNT;
    seedRimeSpikes(this.spikes, TABLE.radius, this.dummy);
    for (const part of [this.shell, this.spikes]) {
      part.frustumCulled = false;
      part.castShadow = false;
      this.crust.add(part);
    }
    this.crust.visible = false;
    this.trackMesh = instanced(
      'frost-tracks',
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: this.patch,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
      }),
      FROST_TRACK_CAPACITY,
    );
    this.trackMesh.renderOrder = 1;
    this.wispMesh = instanced(
      'frost-vapour',
      new THREE.SphereGeometry(0.05, 8, 6),
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
      WISP_CAPACITY,
    );
    this.shardMesh = instanced(
      'frost-shards',
      new THREE.OctahedronGeometry(0.023, 0),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        emissive: '#cdeeff',
        emissiveIntensity: 0.35,
        roughness: 0.2,
        metalness: 0,
        transparent: true,
        depthWrite: false,
      }),
      SHARD_CAPACITY,
    );
    this.ringMesh = instanced(
      'frost-snap',
      new THREE.RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
      2,
    );
    this.group.add(this.crust, this.trackMesh, this.wispMesh, this.shardMesh, this.ringMesh);
    this.scene.add(this.group);
  }

  /** The cold snap when frost lands: two staggered shock rings on the cloth, a spray of ice chips and vapour. */
  freezeBurst(x: number, z: number) {
    this.flash = 1;
    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i];
      ring.x = x;
      ring.z = z;
      ring.reach = i ? 1.5 : 0.8;
      ring.age = i ? -0.07 : 0;
      ring.life = i ? 0.5 : 0.28;
    }
    for (let i = 0, slot = 0; i < SHARD_CAPACITY && (slot = nextFree(this.shards, slot)) < SHARD_CAPACITY; i++) {
      const shard = this.shards[slot],
        angle = Math.random() * Math.PI * 2,
        speed = 1.1 + Math.random() * 2.4;
      shard.position.set(x, TABLE.radius, z);
      shard.velocity.set(Math.cos(angle) * speed, 0.9 + Math.random() * 2.3, Math.sin(angle) * speed);
      shard.spin.set(Math.random() * 9, Math.random() * 7, Math.random() * 9);
      shard.rotation.set(0, 0, 0);
      shard.age = 0;
      shard.life = 0.55 + Math.random() * 0.4;
    }
    for (let i = 0; i < 6; i++) this.puff(x + (Math.random() - 0.5) * 0.5, z + (Math.random() - 0.5) * 0.5, 0.5);
  }

  private puff(x: number, z: number, strength: number) {
    const slot = nextFree(this.wisps, 0);
    if (slot >= WISP_CAPACITY) return;
    const wisp = this.wisps[slot];
    wisp.position.set(x, 0.03, z);
    wisp.velocity.set(
      (Math.random() - 0.5) * 0.24,
      0.2 + Math.random() * 0.28 * strength * 2,
      (Math.random() - 0.5) * 0.24,
    );
    wisp.age = 0;
    wisp.life = 0.75 + Math.random() * 0.6;
  }

  update(state: GameState, dt: number) {
    const step = Math.min(Math.max(dt || 0, 0), 0.1);
    this.clock += step;
    this.flash = Math.max(0, this.flash - step * 3.2);
    const arcade = state?.arcade as (GameState['arcade'] & { frost?: FrostTrack[] }) | undefined;
    const balls = state?.balls;
    for (const player of [0, 1] as const) {
      const now = arcade?.buffs?.[player]?.frozen ?? 0;
      if (now > 0 && this.wasFrozen[player] <= 0) {
        const ball = balls?.[cueBallId(state, player)] ?? balls?.[0];
        if (ball && !ball.pocketed) this.freezeBurst(ball.x, ball.z);
      }
      this.wasFrozen[player] = now;
    }
    this.updateCrust(state, arcade, step);
    this.updateTracks(arcade?.frost, step);
    this.updateBurst(step);
  }

  private updateCrust(state: GameState, arcade: GameState['arcade'], step: number) {
    const cue = state?.balls?.[cueBallId(state)];
    const buffed = !!arcade?.activeShot?.frozen || (arcade?.buffs?.[state?.turn ?? 0]?.frozen ?? 0) > 0;
    const frozen = buffed && !!cue && !cue.pocketed;
    // Frost slams on oversized and settles, rather than fading in politely.
    if (frozen && this.crustScale < 0.05) this.crustScale = 1.55;
    // A pocketed or absent cue ball takes its ice with it; only a buff running out thaws gradually.
    if (!cue || cue.pocketed) this.crustScale = 0;
    else this.crustScale += ((frozen ? 1 : 0) - this.crustScale) * Math.min(1, step * 13);
    this.crust.visible = this.crustScale > 0.02 && !!cue;
    if (!this.crust.visible || !cue) {
      this.rolling = false;
      return;
    }
    if (this.rolling) {
      const dx = cue.x - this.previous.x,
        dz = cue.z - this.previous.z,
        distance = Math.hypot(dx, dz);
      if (distance > 1e-7 && distance < 0.8)
        this.crust.rotateOnWorldAxis(this.axis.set(dz, 0, -dx).normalize(), distance / TABLE.radius);
    }
    this.previous.set(cue.x, 0, cue.z);
    this.rolling = true;
    this.crust.position.set(cue.x, TABLE.radius + Math.max(0, cue.elevation || 0), cue.z);
    this.crust.scale.setScalar(this.crustScale);
    this.shell.material.emissiveIntensity = 0.22 + Math.sin(this.clock * 2.3) * 0.06 + this.flash * 1.5;
  }

  private updateTracks(tracks: readonly FrostTrack[] | undefined, step: number) {
    let count = 0;
    for (const track of tracks ?? []) {
      if (count >= FROST_TRACK_CAPACITY) break;
      const life = clamp01(track?.life ?? 0);
      if (!track || life <= 0) continue;
      const previous = this.trackLife.get(track.id);
      // Vapour leaves as the ice goes, once per threshold rather than every frame.
      if (previous !== undefined && previous > 0.45 && life <= 0.45) this.puff(track.x, track.z, 0.5);
      if (previous !== undefined && previous > 0.14 && life <= 0.14) this.puff(track.x, track.z, 0.8);
      this.trackLife.set(track.id, life);
      const size = TABLE.radius * (2.1 + frostHash(track.id * 2.3) * 0.9) * (0.42 + 0.58 * life),
        squash = 0.78 + frostHash(track.id * 4.1) * 0.44;
      this.dummy.position.set(track.x, 0.015 + frostHash(track.id * 9.1) * 0.003, track.z);
      this.dummy.rotation.set(0, frostHash(track.id * 5.17) * Math.PI * 2, 0);
      this.dummy.scale.set(size * squash, 1, size / squash);
      this.dummy.updateMatrix();
      this.write(this.trackMesh, count++, RIME, Math.pow(life, 0.55) * 0.92);
    }
    this.commit(this.trackMesh, count);
    // ponytail: bounded clear instead of a per-frame sweep. Worst case a puff is skipped; upgrade to a
    // generation stamp only if the sim ever runs hundreds of concurrent tracks.
    if (this.trackLife.size > FROST_TRACK_CAPACITY * 4) this.trackLife.clear();
    this.dummy.rotation.set(0, 0, 0);
    let wispCount = 0;
    for (const wisp of this.wisps) {
      if (wisp.age >= wisp.life) continue;
      wisp.age += step;
      if (wisp.age >= wisp.life) continue;
      const progress = wisp.age / wisp.life;
      wisp.velocity.multiplyScalar(1 - step * 1.1);
      wisp.position.addScaledVector(wisp.velocity, step);
      this.dummy.position.copy(wisp.position);
      this.dummy.scale.setScalar(0.5 + progress * 1.5);
      this.dummy.updateMatrix();
      this.write(this.wispMesh, wispCount++, RIME, (1 - progress) * 0.22);
    }
    this.commit(this.wispMesh, wispCount);
  }

  private updateBurst(step: number) {
    let ringCount = 0;
    this.dummy.rotation.set(0, 0, 0);
    for (const ring of this.rings) {
      if (ring.age >= ring.life) continue;
      ring.age += step;
      if (ring.age <= 0 || ring.age >= ring.life) continue;
      const progress = ring.age / ring.life,
        radius = 0.18 + Math.pow(progress, 0.55) * ring.reach;
      this.dummy.position.set(ring.x, 0.02, ring.z);
      this.dummy.scale.set(radius, 1, radius);
      this.dummy.updateMatrix();
      this.write(this.ringMesh, ringCount++, ICE, Math.pow(1 - progress, 1.7) * 0.95);
    }
    this.commit(this.ringMesh, ringCount);
    let shardCount = 0;
    this.dummy.scale.setScalar(1);
    for (const shard of this.shards) {
      if (shard.age >= shard.life) continue;
      shard.age += step;
      if (shard.age >= shard.life) continue;
      const progress = shard.age / shard.life;
      shard.velocity.y -= step * 7.5;
      shard.position.addScaledVector(shard.velocity, step);
      shard.position.y = Math.max(0.03, shard.position.y);
      shard.rotation.set(
        shard.rotation.x + shard.spin.x * step,
        shard.rotation.y + shard.spin.y * step,
        shard.rotation.z + shard.spin.z * step,
      );
      this.dummy.position.copy(shard.position);
      this.dummy.rotation.copy(shard.rotation);
      this.dummy.scale.setScalar(0.6 + (1 - progress) * 0.8);
      this.dummy.updateMatrix();
      this.write(this.shardMesh, shardCount++, ICE, (1 - progress) * 0.95);
    }
    this.commit(this.shardMesh, shardCount);
  }

  private write(mesh: THREE.InstancedMesh, index: number, color: THREE.Color, alpha: number) {
    mesh.setMatrixAt(index, this.dummy.matrix);
    mesh.geometry.getAttribute('color').setXYZW(index, color.r, color.g, color.b, alpha);
  }
  /** Empty pools skip their draw entirely; live pools upload only the instances written this frame. */
  private commit(mesh: THREE.InstancedMesh, count: number) {
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

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      for (const item of Array.isArray(material) ? material : material ? [material] : []) item.dispose();
    });
    this.patch.dispose();
    this.surface.normal.dispose();
    this.surface.roughness.dispose();
    this.trackLife.clear();
  }
}
