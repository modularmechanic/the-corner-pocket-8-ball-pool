import * as THREE from 'three';
import { cueBallId, seededRandom, TABLE, type GameState } from '../simulation/types';
import { instanced, nextFree, pool, type Pooled } from './effect-pools';
import {
  commitInstances,
  flameTexture,
  flatQuad,
  radialTexture,
  scorchTextures,
  writeInstance,
} from './overdrive-fire-sprites';

/** The simulation's scorch record. Every field is read defensively: the arcade state may not carry
 * `burns` at all, in which case the marks are seeded from the cue ball's own path instead. */
export interface BurnMark {
  id: number;
  x: number;
  z: number;
  radius: number;
  heat: number;
}

/** Live scorch decals. 96 is the cap: a long overdrive shot lays more than that, and the oldest
 * fade out rather than the newest being dropped, so the damage always reads as recent history. */
const MARK_CAPACITY = 96;
/** Marks allowed to stand at full strength. The 24 slots above it are the fade-out runway, so the
 * oldest scorch always dissolves instead of popping when the cap is reached. */
const MARK_SOFT_CAP = 72;
const FLAME_CAPACITY = 192;
/** Table units between self-seeded marks. Wide enough that a full-table shot fits inside the cap. */
const MARK_SPACING = 0.26;
/** Seconds a self-seeded mark takes to cool from glowing to cold char. The simulation's own `heat`
 * overrides this whenever it is supplied. */
const COOL_SECONDS = 7;
const CHAR_Y = 0.0045;
const EMBER_Y = 0.006;

interface Mark {
  id: number;
  x: number;
  z: number;
  radius: number;
  /** Rotation of the decal about the table's vertical. Randomised for a simulation-supplied burn,
   * and set from the direction of travel for a self-seeded one, so the scar lies along the path. */
  yaw: number;
  /** Length along `yaw` as a multiple of the width: a rolling ball drags its burn out. */
  stretch: number;
  heat: number;
  /** Seconds since the mark was laid: the char darkens in over the first fraction of a second. */
  age: number;
  /** Counts up once the mark is retired; the decal fades out over FADE_SECONDS. */
  fade: number;
  seen: boolean;
  used: boolean;
}
const FADE_SECONDS = 0.8;

interface Flame extends Pooled {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  size: number;
  roll: number;
  spin: number;
  smoke: boolean;
}

/**
 * Everything visible about the `overdrive` power-up: the cue ball alight, the scorch marks it
 * burns into the cloth, and the ignition when the buff lands.
 *
 * Self-contained and read-only with respect to game state. Six draw calls at the absolute peak
 * (two decal layers, flame, smoke, the glow shell and the ignition ring); two or zero when nothing
 * is burning. No lights are added — the room is already light-bound, so the fire is emissive and
 * additive and leans on the existing bloom pass instead.
 */
export class OverdriveFire {
  private group = new THREE.Group();
  private flameMap = flameTexture();
  private scorch = scorchTextures();
  private marks: Mark[] = Array.from({ length: MARK_CAPACITY }, () => ({
    id: -1,
    x: 0,
    z: 0,
    radius: 0.2,
    yaw: 0,
    stretch: 1,
    heat: 0,
    age: 0,
    fade: 0,
    seen: false,
    used: false,
  }));
  private nextMark = 0;
  private selfMarkId = 0;
  private lastMark = new THREE.Vector2(Infinity, Infinity);
  private flames = pool<Flame>(FLAME_CAPACITY, () => ({
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    size: 0.2,
    roll: 0,
    spin: 0,
    smoke: false,
  }));
  private charMesh = instanced(
    'overdrive-char',
    flatQuad(),
    new THREE.MeshBasicMaterial({
      map: this.scorch.char,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    }),
    MARK_CAPACITY,
  );
  private emberMesh = instanced(
    'overdrive-embers',
    flatQuad(),
    new THREE.MeshBasicMaterial({
      map: this.scorch.ember,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    MARK_CAPACITY,
  );
  private flameMesh = instanced(
    'overdrive-flames',
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: this.flameMap,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
    FLAME_CAPACITY,
  );
  private smokeMesh = instanced(
    'overdrive-smoke',
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: this.flameMap,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    FLAME_CAPACITY,
  );
  private radialMap = radialTexture();
  /** A thin heat shell on the ball itself. Deliberately faint: turned up it just paints the cue
   * ball orange, and an orange ball is not a ball on fire. The licks do the work. */
  private glow = new THREE.Mesh(
    new THREE.SphereGeometry(TABLE.radius * 1.04, 16, 12),
    new THREE.MeshBasicMaterial({
      color: '#ff5a12',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  /** Firelight pooled on the cloth under the ball. */
  private pool = new THREE.Mesh(
    flatQuad(),
    new THREE.MeshBasicMaterial({
      map: this.radialMap,
      color: '#ff8324',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  private shock = new THREE.Mesh(
    new THREE.RingGeometry(0.74, 1, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: '#ffb54a',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  private shockAge = Infinity;
  private flashAge = Infinity;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  private clock = 0;
  private emitClock = 0;
  private previousBuffs: [number, number] = [0, 0];
  /** False for one frame after a reset, so a rack that starts mid-buff does not re-ignite. */
  private primed = false;
  private cameraQuaternion = new THREE.Quaternion();

  constructor(scene: THREE.Scene) {
    this.glow.name = 'overdrive-glow';
    this.pool.name = 'overdrive-firelight';
    this.pool.visible = false;
    this.pool.frustumCulled = false;
    this.pool.renderOrder = 3;
    this.shock.name = 'overdrive-shockwave';
    this.glow.visible = false;
    this.glow.frustumCulled = false;
    this.shock.visible = false;
    this.shock.frustumCulled = false;
    this.shock.position.y = 0.012;
    this.group.add(this.charMesh, this.emberMesh, this.pool, this.shock, this.smokeMesh, this.flameMesh, this.glow);
    // Decals sit on the cloth; the licks belong over everything they wrap around.
    this.charMesh.renderOrder = 1;
    this.emberMesh.renderOrder = 2;
    this.shock.renderOrder = 3;
    this.group.name = 'overdrive-fire';
    scene.add(this.group);
  }

  /** Wipes every mark and particle. Call on a rack reset so a new rack starts on clean cloth. */
  clear() {
    for (const mark of this.marks) {
      mark.used = false;
      mark.fade = 0;
      mark.id = -1;
    }
    for (const flame of this.flames) flame.age = flame.life;
    this.lastMark.set(Infinity, Infinity);
    this.shockAge = Infinity;
    this.flashAge = Infinity;
    this.shock.visible = false;
    this.glow.visible = false;
    this.pool.visible = false;
    this.nextMark = 0;
    this.previousBuffs = [0, 0];
    this.primed = false;
  }

  /**
   * @param camera used only to face the flame quads; the fire still runs without one.
   */
  update(state: GameState, dt: number, camera?: THREE.Camera) {
    const frameDt = Math.min(0.05, Math.max(0, dt));
    this.clock += frameDt;
    const arcade = state.arcade;
    const cue = state.balls[cueBallId(state)];
    // The same rule deriveTableEffects uses for `cue.overdrive`, inlined: that helper allocates a
    // pill list per call and this runs every frame.
    const lit =
      !!arcade &&
      !cue.pocketed &&
      (state.phase === 'rolling' ? !!arcade.activeShot.overdrive : !!arcade.buffs[state.turn]?.overdrive);

    if (arcade) {
      for (const team of [0, 1] as const) {
        const now = arcade.buffs[team]?.overdrive || 0;
        if (this.primed && now > this.previousBuffs[team]) this.ignite(cue.x, cue.z);
        this.previousBuffs[team] = now;
      }
      this.primed = true;
    } else {
      this.previousBuffs[0] = 0;
      this.previousBuffs[1] = 0;
      this.primed = false;
    }

    this.syncMarks(arcade, lit, cue, state.phase === 'rolling');
    this.emit(lit, cue, frameDt);
    if (camera) this.cameraQuaternion.copy(camera.quaternion);
    this.drawMarks(frameDt);
    this.drawFlames(frameDt);
    this.drawGlow(lit, cue, frameDt);
  }

  /** The hot moment the buff lands. Deliberately louder than the steady burn: a ground-hugging
   * ring of fire punched outwards, a column straight up off the ball, a smoke crown, an expanding
   * shockwave and a flash of firelight on the cloth, all inside half a second. */
  private ignite(x: number, z: number) {
    this.shockAge = 0;
    this.flashAge = 0;
    this.shock.position.set(x, 0.012, z);
    // The blast ring: low, fast and wide, so it reads along the cloth rather than as a puff.
    for (let i = 0; i < 34; i++) {
      const angle = (i / 34) * Math.PI * 2 + Math.random() * 0.3,
        speed = 2.2 + Math.random() * 2.8;
      this.spawn(
        x + Math.cos(angle) * 0.14,
        0.05 + Math.random() * 0.1,
        z + Math.sin(angle) * 0.14,
        Math.cos(angle) * speed,
        0.5 + Math.random() * 0.9,
        Math.sin(angle) * speed,
        0.26 + Math.random() * 0.22,
        0.34 + Math.random() * 0.26,
        false,
      );
    }
    // The column off the ball.
    for (let i = 0; i < 24; i++) {
      const angle = Math.random() * Math.PI * 2;
      this.spawn(
        x + Math.cos(angle) * 0.1,
        TABLE.radius * (0.4 + Math.random() * 1.4),
        z + Math.sin(angle) * 0.1,
        Math.cos(angle) * 0.5,
        2.6 + Math.random() * 3.4,
        Math.sin(angle) * 0.5,
        0.24 + Math.random() * 0.24,
        0.4 + Math.random() * 0.34,
        false,
      );
    }
    for (let i = 0; i < 14; i++) {
      const angle = Math.random() * Math.PI * 2,
        speed = 0.8 + Math.random() * 1.2;
      this.spawn(
        x + Math.cos(angle) * 0.22,
        0.24 + Math.random() * 0.3,
        z + Math.sin(angle) * 0.22,
        Math.cos(angle) * speed,
        1.1 + Math.random() * 0.9,
        Math.sin(angle) * speed,
        0.5 + Math.random() * 0.34,
        0.75 + Math.random() * 0.5,
        true,
      );
    }
    // The cloth takes the worst of it right where the power-up landed.
    const blast = this.lay(x, z, 0.5, 1);
    blast.stretch = 1;
    this.lastMark.set(x, z);
  }

  /** Mirrors the simulation's `burns` when it supplies them, and otherwise lays its own along the
   * cue ball's path so the cloth still carries the damage. */
  private syncMarks(
    arcade: GameState['arcade'],
    lit: boolean,
    cue: { x: number; z: number; vx: number; vz: number },
    rolling: boolean,
  ) {
    const burns = (arcade as { burns?: BurnMark[] } | undefined)?.burns;
    if (burns && burns.length) {
      for (const mark of this.marks) mark.seen = false;
      // The cap keeps the newest: a long shot can outrun the decal budget.
      for (let i = Math.max(0, burns.length - MARK_CAPACITY); i < burns.length; i++) {
        const burn = burns[i];
        if (!burn || !Number.isFinite(burn.x) || !Number.isFinite(burn.z)) continue;
        let slot: Mark | undefined;
        for (const mark of this.marks) if (mark.used && !mark.fade && mark.id === burn.id) slot = mark;
        if (!slot) slot = this.take(burn.id ?? this.selfMarkId++);
        slot.x = burn.x;
        slot.z = burn.z;
        slot.radius = Number.isFinite(burn.radius) && burn.radius > 0 ? burn.radius : 0.22;
        slot.stretch = 1;
        slot.heat = Number.isFinite(burn.heat) ? Math.min(1, Math.max(0, burn.heat)) : slot.heat;
        slot.seen = true;
      }
      // Anything the simulation has forgotten fades rather than popping.
      for (const mark of this.marks) if (mark.used && !mark.seen && !mark.fade) mark.fade = 1e-4;
      return;
    }
    if (!lit || !rolling) return;
    if (Math.hypot(cue.vx, cue.vz) < 0.35) return;
    if (Math.hypot(cue.x - this.lastMark.x, cue.z - this.lastMark.y) < MARK_SPACING) return;
    this.lastMark.set(cue.x, cue.z);
    // A little off the centre line, so the track is a scorched band rather than a string of beads.
    const drift = (Math.random() - 0.5) * 0.12,
      heading = Math.atan2(cue.vz, cue.vx);
    const mark = this.lay(
      cue.x - Math.sin(heading) * drift,
      cue.z + Math.cos(heading) * drift,
      0.21 + Math.random() * 0.09,
      1,
    );
    mark.yaw = -heading;
    mark.stretch = 1.45 + Math.random() * 0.5;
  }

  private take(id: number): Mark {
    let mark: Mark | undefined;
    for (let i = 0; i < MARK_CAPACITY; i++) {
      const candidate = this.marks[(this.nextMark + i) % MARK_CAPACITY];
      if (candidate.used) continue;
      this.nextMark = (this.nextMark + i + 1) % MARK_CAPACITY;
      mark = candidate;
      break;
    }
    if (!mark) {
      mark = this.marks[this.nextMark];
      this.nextMark = (this.nextMark + 1) % MARK_CAPACITY;
    }
    mark.id = id;
    mark.age = 0;
    mark.fade = 0;
    mark.used = true;
    mark.seen = true;
    this.retireOldest();
    return mark;
  }

  /** Over the soft cap, the oldest standing mark starts fading, which gives it the whole fade
   * window to disappear before its slot is needed again. Two scans of 96, only when a mark lands. */
  private retireOldest() {
    let live = 0;
    for (const mark of this.marks) if (mark.used && !mark.fade) live++;
    if (live <= MARK_SOFT_CAP) return;
    let oldest: Mark | undefined;
    for (const mark of this.marks) if (mark.used && !mark.fade && (!oldest || mark.age > oldest.age)) oldest = mark;
    if (oldest) oldest.fade = 1e-4;
  }

  private lay(x: number, z: number, radius: number, heat: number): Mark {
    const mark = this.take(this.selfMarkId++);
    mark.x = x;
    mark.z = z;
    mark.radius = radius;
    mark.heat = heat;
    mark.seen = true;
    mark.yaw = Math.random() * Math.PI * 2;
    mark.stretch = 1;
    return mark;
  }

  private spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    size: number,
    life: number,
    smoke: boolean,
  ) {
    const slot = nextFree(this.flames, 0);
    if (slot >= this.flames.length) return;
    const flame = this.flames[slot];
    flame.position.set(x, y, z);
    flame.velocity.set(vx, vy, vz);
    flame.size = size;
    flame.life = life;
    flame.age = 0;
    flame.roll = Math.random() * Math.PI * 2;
    flame.spin = (Math.random() - 0.5) * 3;
    flame.smoke = smoke;
  }

  /** Flame licks are emitted off the ball's upper hemisphere and dragged backwards as it rolls, so
   * the envelope leans and streams instead of sitting on the ball like a halo. */
  private emit(lit: boolean, cue: { x: number; z: number; vx: number; vz: number; elevation?: number }, dt: number) {
    if (!lit) {
      this.emitClock = 0;
      return;
    }
    const speed = Math.hypot(cue.vx, cue.vz);
    this.emitClock += dt * (140 + Math.min(speed, 12) * 8);
    const y = TABLE.radius + Math.max(0, cue.elevation || 0);
    let emitted = 0;
    while (this.emitClock >= 1 && emitted++ < 12) {
      this.emitClock--;
      const angle = Math.random() * Math.PI * 2,
        // Biased low: a fire is widest where it grips the thing it is burning.
        height = Math.random() ** 1.7;
      // Outside the ball's silhouette, or the near-side licks are rejected by its own depth.
      const offset = TABLE.radius * (1.32 - height * 0.5);
      const smoke = Math.random() < 0.12;
      this.spawn(
        cue.x + Math.cos(angle) * offset,
        y + (height * 1.5 - 0.75) * TABLE.radius,
        cue.z + Math.sin(angle) * offset,
        -cue.vx * 0.16 + Math.cos(angle) * 0.16,
        smoke ? 0.75 + Math.random() * 0.4 : 0.45 + Math.random() * 0.75 + height * 0.5,
        -cue.vz * 0.16 + Math.sin(angle) * 0.16,
        smoke ? 0.24 + Math.random() * 0.12 : 0.15 + Math.random() * 0.13,
        smoke ? 0.45 + Math.random() * 0.3 : 0.2 + Math.random() * 0.2,
        smoke,
      );
    }
  }

  private drawMarks(dt: number) {
    let charCount = 0,
      emberCount = 0;
    for (const mark of this.marks) {
      if (!mark.used) continue;
      mark.age += dt;
      if (mark.fade) {
        mark.fade += dt;
        if (mark.fade >= FADE_SECONDS) {
          mark.used = false;
          mark.id = -1;
          continue;
        }
      }
      // The simulation's `heat` wins when it supplies one; otherwise the mark cools on its own.
      mark.heat = Math.max(0, mark.heat - dt / COOL_SECONDS);
      const retire = mark.fade ? 1 - mark.fade / FADE_SECONDS : 1;
      // The char darkens in over a quarter second, then stays: this is the damage that persists.
      const settle = Math.min(1, mark.age / 0.25);
      this.dummy.position.set(mark.x, CHAR_Y, mark.z);
      this.dummy.rotation.set(0, mark.yaw, 0);
      const width = mark.radius * 2;
      this.dummy.scale.set(width * mark.stretch, 1, width);
      this.dummy.updateMatrix();
      this.color.setRGB(1, 1, 1);
      writeInstance(this.charMesh, charCount++, this.dummy.matrix, this.color, settle * retire * 0.94);
      if (mark.heat > 0.01) {
        const pulse = 0.72 + 0.28 * Math.sin(this.clock * 6.5 + mark.id * 1.7);
        this.dummy.position.y = EMBER_Y;
        // Slightly inside the char, so the coals never glow past the burnt edge.
        this.dummy.scale.set(width * 0.91 * mark.stretch, 1, width * 0.91);
        this.dummy.updateMatrix();
        // Cooling runs white-hot orange down to a dull red before it goes out.
        this.color.setHSL(0.015 + mark.heat * 0.055, 1, 0.3 + mark.heat * 0.25).multiplyScalar(1.5 + mark.heat);
        writeInstance(
          this.emberMesh,
          emberCount++,
          this.dummy.matrix,
          this.color,
          Math.min(1, mark.heat * 1.15) * pulse * retire,
        );
      }
    }
    commitInstances(this.charMesh, charCount);
    commitInstances(this.emberMesh, emberCount);
  }

  private drawFlames(dt: number) {
    let flameCount = 0,
      smokeCount = 0;
    for (const flame of this.flames) {
      if (flame.age >= flame.life) continue;
      flame.age += dt;
      if (flame.age >= flame.life) continue;
      const progress = flame.age / flame.life;
      // Fire accelerates upward as it thins; smoke slows and spreads.
      flame.velocity.y += dt * (flame.smoke ? -0.15 : 1.1);
      flame.velocity.x -= flame.velocity.x * dt * (flame.smoke ? 1.6 : 3.2);
      flame.velocity.z -= flame.velocity.z * dt * (flame.smoke ? 1.6 : 3.2);
      flame.position.addScaledVector(flame.velocity, dt);
      flame.position.y = Math.max(0.02, flame.position.y);
      flame.roll += flame.spin * dt;
      const scale = flame.smoke
        ? flame.size * (0.6 + progress * 1.5)
        : flame.size * (1 + progress * 0.45) * (1 - progress * 0.5);
      this.dummy.position.copy(flame.position);
      this.dummy.quaternion.copy(this.cameraQuaternion);
      this.dummy.rotateZ(flame.roll);
      // Licks stretch and narrow as they climb; smoke just swells.
      this.dummy.scale.set(
        scale * (flame.smoke ? 1 : 1 - progress * 0.32),
        scale * (flame.smoke ? 1 : 1.35 + progress * 1.15),
        scale,
      );
      this.dummy.updateMatrix();
      if (flame.smoke) {
        this.color.setRGB(0.1, 0.085, 0.08);
        writeInstance(
          this.smokeMesh,
          smokeCount++,
          this.dummy.matrix,
          this.color,
          (1 - progress) * 0.34 * Math.min(1, progress * 5),
        );
      } else {
        // A small white-hot core for the first fifth of a lick's life, then it falls away hard
        // into orange and deep red. Held bright any longer the whole fire washes out to yellow.
        const cooling = Math.min(1, progress / 0.22);
        this.color.setHSL(0.125 - progress * 0.115, 0.62 + cooling * 0.38, 0.78 - cooling * 0.28 - progress * 0.28);
        // Past 1 so the existing bloom pass picks the core up without a light being added.
        this.color.multiplyScalar(2.9 - cooling * 1.5 - progress * 0.5);
        writeInstance(this.flameMesh, flameCount++, this.dummy.matrix, this.color, Math.min(1, (1 - progress) * 1.5));
      }
    }
    commitInstances(this.flameMesh, flameCount);
    commitInstances(this.smokeMesh, smokeCount);
  }

  private drawGlow(lit: boolean, cue: { x: number; z: number; elevation?: number }, dt: number) {
    const material = this.glow.material as THREE.MeshBasicMaterial,
      poolMaterial = this.pool.material as THREE.MeshBasicMaterial;
    const flicker = 0.62 + 0.24 * Math.sin(this.clock * 21) + 0.14 * Math.sin(this.clock * 7.3);
    const ease = Math.min(1, dt * 9);
    material.opacity += ((lit ? 0.17 * flicker : 0) - material.opacity) * ease;
    poolMaterial.opacity += ((lit ? 0.52 * flicker : 0) - poolMaterial.opacity) * ease;
    // The ignition flash rides the same firelight quad rather than paying for another mesh.
    let flash = 0;
    if (this.flashAge < 0.32) {
      this.flashAge += dt;
      flash = Math.max(0, 1 - this.flashAge / 0.32) ** 1.5;
      poolMaterial.opacity = Math.max(poolMaterial.opacity, flash * 1.05);
    }
    this.glow.visible = material.opacity > 0.01;
    this.pool.visible = poolMaterial.opacity > 0.01;
    const elevation = Math.max(0, cue.elevation || 0);
    if (this.glow.visible) {
      this.glow.position.set(cue.x, TABLE.radius + elevation, cue.z);
      this.glow.scale.setScalar(1 + 0.05 * Math.sin(this.clock * 17));
    }
    if (this.pool.visible) {
      this.pool.position.set(cue.x, 0.008, cue.z);
      this.pool.scale.setScalar(1.55 + 0.12 * Math.sin(this.clock * 13) + flash * 1.35);
    }
    if (this.shockAge < 0.5) {
      this.shockAge += dt;
      const progress = Math.min(1, this.shockAge / 0.5);
      const shockMaterial = this.shock.material as THREE.MeshBasicMaterial;
      this.shock.visible = progress < 1;
      this.shock.scale.setScalar(0.35 + progress * 2.9);
      shockMaterial.opacity = (1 - progress) * (1 - progress) * 1.2;
    } else this.shock.visible = false;
  }

  dispose() {
    this.group.removeFromParent();
    for (const mesh of [
      this.charMesh,
      this.emberMesh,
      this.flameMesh,
      this.smokeMesh,
      this.glow,
      this.pool,
      this.shock,
    ]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.flameMap.dispose();
    this.radialMap.dispose();
    this.scorch.char.dispose();
    this.scorch.ember.dispose();
  }
}
