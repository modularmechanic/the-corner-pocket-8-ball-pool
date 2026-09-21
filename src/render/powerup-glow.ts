import * as THREE from 'three';
import {
  TABLE,
  type PlayerBuffs,
  type Pickup,
  type PowerUp,
  type StatusEffect,
  type TableEvent,
} from '../simulation/types';
import { effectDefinition, STATUS_IDS } from '../presentation/effects';
import { canvasTexture } from './materials';
import { enableTableShadows } from './table-model';
import { nextFree, pool, type Pooled } from './effect-pools';
import { buildPowerIcon, powerCharacter, type PowerCharacter } from './powerup-icons';

/** Debuffs. A moment that lands one reads the opposite way round from a buff: inward, downward, stained. */
const PUNISHING = new Set<StatusEffect>(['frozen', 'jammed', 'sticky']);
const MOMENT_SLOTS = 4;
const MOTE_CAPACITY = 72;
const FUSE_SEGMENTS = 64;
/** Blinking starts this long before a pickup's `expiresAt`. */
const FUSE_WARNING = 3.5;
const ANGRY = new THREE.Color('#e50f27');
const WHITE = new THREE.Color('#ffffff');
const SCRATCH = new THREE.Color();

interface PickupVisual {
  power: PowerUp;
  character: PowerCharacter;
  group: THREE.Group;
  icon: THREE.Group;
  body: THREE.MeshPhysicalMaterial;
  aura: THREE.Sprite;
  halo: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  fuse: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  shell?: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  span: number;
}
interface Moment extends Pooled {
  bad: boolean;
  /** How wide this moment plays: 1 for a buff on the spot, wider for a curse sent out. */
  spread: number;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  shaft: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  stain: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
}
interface Mote extends Pooled {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: THREE.Color;
}

const glowTexture = () =>
  canvasTexture(128, 128, (ctx) => {
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, '#ffffffff');
    gradient.addColorStop(0.22, '#ffffffc4');
    gradient.addColorStop(0.55, '#ffffff45');
    gradient.addColorStop(1, '#ffffff00');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  });

const additive = (color: THREE.ColorRepresentation, opacity: number) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
/** Deterministic, allocation-free jitter: a flame's unsteadiness without a random number generator. */
const wobble = (clock: number, seed: number) => Math.sin(clock * 37.1 + seed) * Math.sin(clock * 13.7 + seed * 2.3);

/**
 * Everything a player reads about a power: the pickups glowing on the cloth in their own character, the
 * moment a buff or debuff lands, and the halo that says one is still running. Emissive only — the room is
 * already light-bound, so the bloom pass does the glowing.
 */
export class PowerupGlow {
  private group = new THREE.Group();
  private visuals = new Map<number, PickupVisual>();
  /** The live pickup groups, for whoever budgets shadows over them. */
  readonly pickups: ReadonlyMap<number, { readonly group: THREE.Group }> = this.visuals;
  private seen = new Set<number>();
  private texture: THREE.Texture;
  private moments: Moment[] = [];
  private nextMoment = 0;
  /** Shared between the moment slots, and swapped per moment: a gift is round, a blow is angular.
   * All four are sized against a pickup, not the room. */
  private shapes = {
    smoothRing: new THREE.RingGeometry(0.15, 0.19, 64),
    jaggedRing: new THREE.RingGeometry(0.13, 0.215, 9),
    column: new THREE.CylinderGeometry(0.06, 0.11, 1, 20, 1, true),
    spike: new THREE.ConeGeometry(0.15, 1, 5, 1, true),
    stain: new THREE.CircleGeometry(0.22, 32),
  };
  private motes = pool<Mote>(MOTE_CAPACITY, () => ({
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    color: new THREE.Color(),
  }));
  private nextMote = 0;
  private moteCloud: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private motePositions = new THREE.BufferAttribute(new Float32Array(MOTE_CAPACITY * 3), 3).setUsage(
    THREE.DynamicDrawUsage,
  );
  private moteColors = new THREE.BufferAttribute(new Float32Array(MOTE_CAPACITY * 3), 3).setUsage(
    THREE.DynamicDrawUsage,
  );
  private orbits = new Map<StatusEffect, THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>>();
  private orbitHalo: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;

  constructor(
    private scene: THREE.Scene,
    texture: () => THREE.Texture = glowTexture,
  ) {
    this.texture = texture();
    this.scene.add(this.group);
    for (let i = 0; i < MOMENT_SLOTS; i++) this.moments.push(this.buildMoment());

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', this.motePositions);
    geometry.setAttribute('color', this.moteColors);
    geometry.setDrawRange(0, 0);
    this.moteCloud = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.03,
        map: this.texture,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.moteCloud.frustumCulled = false;
    this.moteCloud.visible = false;
    this.group.add(this.moteCloud);

    for (const id of STATUS_IDS) {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.034, 10, 8), additive(effectDefinition(id).color, 0.95));
      orb.visible = false;
      this.group.add(orb);
      this.orbits.set(id, orb);
    }
    this.orbitHalo = new THREE.Mesh(new THREE.RingGeometry(0.29, 0.37, 48), additive('#ffffff', 0.5));
    this.orbitHalo.rotation.x = -Math.PI / 2;
    this.orbitHalo.visible = false;
    this.group.add(this.orbitHalo);
  }

  /** Drives the pickups, the live apply moments and the active-buff halo. `buffs` is the shooter's row and
   * `cue` its cue ball; either may be absent, in which case the halo simply stays away. */
  update(
    pickups: readonly Pickup[] | undefined,
    buffs: Readonly<Partial<PlayerBuffs>> | undefined,
    cue: { x: number; z: number } | null | undefined,
    clock: number,
    dt: number,
  ) {
    this.syncPickups(pickups || [], clock);
    for (const pickup of pickups || []) this.animatePickup(this.visuals.get(pickup.id)!, pickup, clock);
    this.animateMoments(dt);
    this.animateMotes(dt);
    this.animateOrbits(buffs, cue, clock);
  }

  /** The apply moment. A pickup is a gift, a punishing status is a blow, and frost is both at once:
   * the taker's reward plus the curse it sends across the table. */
  emit(event: TableEvent) {
    if (event.kind !== 'power' && event.kind !== 'pickup' && event.kind !== 'status') return;
    const status = event.status;
    if (status) {
      this.moment(event.x, event.z, effectDefinition(status).color, PUNISHING.has(status), 1);
      return;
    }
    const power = event.power;
    this.moment(event.x, event.z, effectDefinition(power || 'focus').color, false, 1);
    if (power === 'frost') this.moment(event.x, event.z, effectDefinition('frozen').color, true, 1.7);
  }

  clear() {
    for (const moment of this.moments) {
      moment.age = 1;
      moment.life = 0;
      moment.ring.visible = moment.shaft.visible = moment.stain.visible = false;
    }
    for (const mote of this.motes) {
      mote.age = 1;
      mote.life = 0;
    }
    this.moteCloud.visible = false;
  }

  dispose() {
    for (const visual of this.visuals.values()) disposeTree(visual.group);
    this.visuals.clear();
    disposeTree(this.group);
    for (const geometry of Object.values(this.shapes)) geometry.dispose();
    this.texture.dispose();
  }

  private syncPickups(pickups: readonly Pickup[], clock: number) {
    const seen = this.seen;
    seen.clear();
    for (const pickup of pickups) {
      seen.add(pickup.id);
      const visual = this.visuals.get(pickup.id);
      const power = pickup.power || 'focus';
      if (visual && visual.power === power) continue;
      if (visual) disposeTree(visual.group);
      this.visuals.set(pickup.id, this.buildPickup(pickup, power, clock));
    }
    if (this.visuals.size > seen.size)
      for (const [id, visual] of this.visuals)
        if (!seen.has(id)) {
          disposeTree(visual.group);
          this.visuals.delete(id);
        }
  }

  private buildPickup(pickup: Pickup, power: PowerUp, clock: number): PickupVisual {
    const character = powerCharacter(power);
    const color = character.color;
    const radius = pickup.radius || 0.2;
    const group = new THREE.Group();
    group.position.set(pickup.x, 0, pickup.z);
    this.scene.add(group);

    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.71, radius * 0.79, 0.04, 40),
      new THREE.MeshStandardMaterial({ color: '#4c554a', metalness: 0.8, roughness: 0.3 }),
    );
    plinth.position.y = 0.02;
    plinth.castShadow = true;
    group.add(plinth);

    const body = new THREE.MeshPhysicalMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.1,
      metalness: 0.32,
      roughness: 0.2,
      clearcoat: 0.8,
    });
    const icon = buildPowerIcon(power, body);
    icon.position.y = 0.17;
    group.add(icon);

    // The glow itself: a camera-facing gradient, not a light. Bloom does the rest.
    const aura = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.texture,
        color,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    aura.position.y = 0.17;
    aura.scale.setScalar(radius * 3.1 * character.aura);
    group.add(aura);

    const halo = new THREE.Mesh(new THREE.RingGeometry(radius * 0.93, radius, 64), additive(color, 0.7));
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.025;
    group.add(halo);

    // Drains anticlockwise as the pickup's welcome runs out: an indexed ring, shortened by its draw range.
    const fuse = new THREE.Mesh(
      new THREE.RingGeometry(radius * 1.03, radius * 1.16, FUSE_SEGMENTS),
      additive(color, 0.85),
    );
    fuse.rotation.x = -Math.PI / 2;
    fuse.position.y = 0.024;
    fuse.visible = false;
    group.add(fuse);

    let shell: PickupVisual['shell'];
    if (character.shell) {
      shell = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.82, 20, 14), additive(color, 0.1));
      shell.position.y = 0.17;
      group.add(shell);
    }
    enableTableShadows(group);
    const expiry = typeof pickup.expiresAt === 'number' ? pickup.expiresAt : NaN;
    return {
      power,
      character,
      group,
      icon,
      body,
      aura,
      halo,
      fuse,
      shell,
      span: Math.max(1, expiry - clock),
    };
  }

  private animatePickup(visual: PickupVisual, pickup: Pickup, clock: number) {
    const character = visual.character;
    const seed = pickup.id * 0.7;
    visual.group.visible = pickup.available !== false;
    if (!visual.group.visible) return;
    visual.group.position.set(pickup.x, 0, pickup.z);

    const spin = clock * character.spin + seed;
    visual.icon.rotation.y = character.snap ? Math.round(spin * 1.27) / 1.27 : spin;
    const bob = Math.sin(clock * character.bob + seed);
    visual.icon.position.y = 0.17 + bob * character.lift;

    const beat = 0.5 + 0.5 * Math.sin(clock * character.pulse + seed);
    const flicker = character.flicker ? wobble(clock, seed) * character.flicker : 0;
    const life = Math.max(0, 0.35 + beat * character.depth + flicker);
    visual.body.emissiveIntensity = 0.55 + life * 0.85;
    visual.aura.material.opacity = 0.34 + life * 0.34;
    const breath = 1 + (beat - 0.5) * (0.1 + character.depth * 0.16);
    visual.aura.scale.setScalar((pickup.radius || 0.2) * 3.1 * character.aura * breath);
    if (character.swirl) visual.aura.material.rotation = clock * character.swirl;
    visual.halo.material.opacity = 0.42 + beat * 0.34;
    visual.halo.position.y = 0.025 + bob * 0.004;
    if (visual.shell) visual.shell.scale.setScalar(1 + (beat - 0.5) * 0.14);

    // Running out of time: the fuse drains, then the whole pickup blinks harder the closer it gets.
    const remaining = typeof pickup.expiresAt === 'number' ? pickup.expiresAt - clock : NaN;
    if (!Number.isFinite(remaining)) {
      visual.fuse.visible = false;
      visual.group.scale.setScalar(1);
      return;
    }
    const left = Math.max(0, Math.min(1, remaining / visual.span));
    visual.fuse.visible = true;
    visual.fuse.geometry.setDrawRange(0, Math.ceil(left * FUSE_SEGMENTS) * 6);
    if (remaining < FUSE_WARNING) {
      const urgency = 1 - remaining / FUSE_WARNING;
      const blink = Math.sin(clock * (7 + urgency * 26)) > -0.15 ? 1 : 0.12;
      visual.aura.material.opacity *= blink;
      visual.halo.material.opacity *= blink;
      visual.fuse.material.opacity = 0.85 * blink;
      visual.body.emissiveIntensity *= 0.35 + 0.65 * blink;
      visual.group.scale.setScalar(1 - urgency * 0.14);
    } else {
      visual.fuse.material.opacity = 0.7;
      visual.group.scale.setScalar(1);
    }
  }

  private buildMoment(): Moment {
    const ring = new THREE.Mesh(this.shapes.smoothRing, additive('#ffffff', 1));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    const shaft = new THREE.Mesh(this.shapes.column, additive('#ffffff', 0.5));
    const stain = new THREE.Mesh(
      this.shapes.stain,
      new THREE.MeshBasicMaterial({ color: '#12000a', transparent: true, opacity: 0, depthWrite: false }),
    );
    stain.rotation.x = -Math.PI / 2;
    stain.position.y = 0.014;
    for (const mesh of [ring, shaft, stain]) {
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    return { age: 1, life: 0, bad: false, spread: 1, ring, shaft, stain };
  }

  private moment(x: number, z: number, color: string, bad: boolean, spread: number) {
    this.nextMoment = (this.nextMoment + 1) % this.moments.length;
    const slot = this.moments[this.nextMoment];
    slot.age = 0;
    slot.life = bad ? 0.66 : 0.52;
    slot.bad = bad;
    slot.spread = spread;
    // A buff keeps its own colour, lifted towards white. A debuff is dragged to an angry red whatever
    // effect landed it, so the two never read alike even in a single frame.
    SCRATCH.set(color).lerp(bad ? ANGRY : WHITE, bad ? 0.86 : 0.3);
    // Smooth and round for a gift; angular and spiked for a blow.
    slot.ring.geometry = bad ? this.shapes.jaggedRing : this.shapes.smoothRing;
    slot.shaft.geometry = bad ? this.shapes.spike : this.shapes.column;
    slot.shaft.rotation.x = bad ? Math.PI : 0;
    for (const mesh of [slot.ring, slot.shaft]) {
      mesh.material.color.copy(SCRATCH);
      mesh.visible = true;
      mesh.position.set(x, mesh === slot.ring ? 0.02 : 0, z);
    }
    slot.stain.position.set(x, 0.014, z);
    slot.stain.visible = bad;
    slot.stain.scale.setScalar(spread);
    slot.shaft.scale.set(spread, 1, spread);
    for (let i = 0; i < (bad ? 16 : 14); i++) this.mote(x, z, SCRATCH, bad, spread);
  }

  private mote(x: number, z: number, color: THREE.Color, bad: boolean, spread: number) {
    this.nextMote = nextFree(this.motes, this.nextMote);
    if (this.nextMote >= this.motes.length) this.nextMote = 0;
    const mote = this.motes[this.nextMote++];
    const angle = Math.random() * Math.PI * 2;
    const reach = (0.08 + Math.random() * 0.24) * spread;
    mote.age = 0;
    mote.life = 0.45 + Math.random() * 0.3;
    mote.color.copy(color);
    if (bad) {
      // Driven down onto the player from above, and inwards.
      mote.position.set(
        x + Math.cos(angle) * reach * 2.2,
        0.3 + Math.random() * 0.25,
        z + Math.sin(angle) * reach * 2.2,
      );
      mote.velocity.set(-Math.cos(angle) * reach * 1.6, -1.1 - Math.random() * 0.6, -Math.sin(angle) * reach * 1.6);
    } else {
      mote.position.set(x + Math.cos(angle) * reach, 0.05, z + Math.sin(angle) * reach);
      mote.velocity.set(Math.cos(angle) * 0.25, 0.62 + Math.random() * 0.5, Math.sin(angle) * 0.25);
    }
  }

  private animateMoments(dt: number) {
    for (const slot of this.moments) {
      if (slot.age >= slot.life) {
        if (slot.ring.visible) slot.ring.visible = slot.shaft.visible = slot.stain.visible = false;
        continue;
      }
      slot.age += dt;
      const progress = Math.min(1, slot.age / slot.life);
      const fade = 1 - progress;
      if (slot.bad) {
        // Everything closes in and comes down: the blow arrives on top of you.
        const slam = progress * progress;
        const scale = (2.9 - slam * 2.45) * slot.spread;
        slot.ring.scale.set(scale, scale, 1);
        slot.ring.material.opacity = (0.3 + slam * 0.6) * (progress > 0.85 ? fade / 0.15 : 1);
        slot.shaft.scale.y = Math.max(0.05, 0.85 - slam * 0.8);
        slot.shaft.position.y = slot.shaft.scale.y * 0.5;
        slot.shaft.material.opacity = 0.52 * (1 - slam * 0.8);
        slot.stain.material.opacity = 0.62 * (progress < 0.25 ? progress / 0.25 : fade / 0.75);
      } else {
        // Everything opens out and lifts: the gift arrives under you and rises.
        const ease = 1 - fade * fade;
        const scale = (0.5 + ease * 2.8) * slot.spread;
        slot.ring.scale.set(scale, scale, 1);
        slot.ring.material.opacity = fade;
        slot.shaft.scale.y = 0.12 + ease * 0.62;
        slot.shaft.position.y = slot.shaft.scale.y * 0.5;
        slot.shaft.material.opacity = 0.6 * fade;
      }
    }
  }

  private animateMotes(dt: number) {
    const positions = this.motePositions.array as Float32Array;
    const colors = this.moteColors.array as Float32Array;
    let live = 0;
    for (const mote of this.motes) {
      if (mote.age >= mote.life) continue;
      mote.age += dt;
      if (mote.age >= mote.life) continue;
      mote.velocity.y -= dt * 1.6;
      mote.position.addScaledVector(mote.velocity, dt);
      const fade = 1 - mote.age / mote.life;
      positions[live * 3] = mote.position.x;
      positions[live * 3 + 1] = mote.position.y;
      positions[live * 3 + 2] = mote.position.z;
      colors[live * 3] = mote.color.r * fade;
      colors[live * 3 + 1] = mote.color.g * fade;
      colors[live * 3 + 2] = mote.color.b * fade;
      live++;
    }
    this.moteCloud.visible = live > 0;
    this.moteCloud.geometry.setDrawRange(0, live);
    this.motePositions.needsUpdate = true;
    this.moteColors.needsUpdate = true;
  }

  /** The standing answer to "what is on me?": one orb a buff, circling the cue ball. Buffs swing with the
   * clock and hold their ring; debuffs run backwards and will not sit still. */
  private animateOrbits(
    buffs: Readonly<Partial<PlayerBuffs>> | undefined,
    cue: { x: number; z: number } | null | undefined,
    clock: number,
  ) {
    let count = 0;
    let punished = false;
    if (buffs && cue) for (const id of STATUS_IDS) if ((buffs[id] || 0) > 0) count++;
    if (!count || !cue) {
      for (const orb of this.orbits.values()) orb.visible = false;
      this.orbitHalo.visible = false;
      return;
    }
    let index = 0;
    for (const id of STATUS_IDS) {
      const orb = this.orbits.get(id)!;
      orb.visible = (buffs?.[id] || 0) > 0;
      if (!orb.visible) continue;
      const bad = PUNISHING.has(id);
      punished = punished || bad;
      const angle = (index++ / count) * Math.PI * 2 + clock * (bad ? -2.2 : 1.3);
      const radius = 0.31 + (bad ? Math.sin(clock * 19 + index) * 0.035 : 0);
      orb.position.set(cue.x + Math.cos(angle) * radius, TABLE.radius + 0.07, cue.z + Math.sin(angle) * radius);
      const beat = bad ? (Math.sin(clock * 11 + index) > 0 ? 1.35 : 0.75) : 1 + Math.sin(clock * 3.4 + index) * 0.18;
      orb.scale.setScalar(beat);
    }
    this.orbitHalo.visible = true;
    this.orbitHalo.position.set(cue.x, 0.03, cue.z);
    this.orbitHalo.rotation.z = clock * (punished ? -1.1 : 0.7);
    this.orbitHalo.material.color.set(punished ? '#ff6a86' : '#ffe9b0');
    this.orbitHalo.material.opacity = 0.3 + 0.2 * Math.sin(clock * (punished ? 9 : 3));
  }
}

function disposeTree(root: THREE.Object3D) {
  root.removeFromParent();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line)
      mesh.geometry.dispose();
    const material = (object as THREE.Mesh | THREE.Sprite).material;
    if (material) for (const item of Array.isArray(material) ? material : [material]) item.dispose();
  });
}
