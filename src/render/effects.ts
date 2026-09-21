import * as THREE from 'three';
import { effectDefinition } from '../presentation/effects';
import type { Ball, TableEvent } from '../simulation/types';
import { instanced, nextFree, pool, type Debris, type Ripple, type Spark } from './effect-pools';
import { createFireMesh, createIceMesh, createTrailParticles, updateTrailParticles } from './effect-trails';
import {
  createArc,
  createFlash,
  createRibbon,
  updateArc,
  updateFlash,
  updateRibbon,
  type Arc,
  type Flash,
  type Ribbon,
} from './effect-flourishes';
/** Cosmetic only: none of these transient objects participate in the simulation. */
export class TableEffects {
  private group = new THREE.Group();
  private sparks = pool<Spark>(120, () => ({
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    color: new THREE.Color(),
  }));
  private debris = pool<Debris>(70, () => ({
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    rotation: new THREE.Euler(),
    spin: new THREE.Vector3(),
    scale: new THREE.Vector3(),
    color: new THREE.Color(),
    steel: false,
  }));
  private ripples = pool<Ripple>(16, () => ({ x: 0, z: 0, color: new THREE.Color(), size: 0 }));
  private sparkMesh = instanced(
    'effect-sparks',
    new THREE.SphereGeometry(0.012, 5, 4),
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
    120,
  );
  private debrisMeshes = [0.1, 0.6].map((metalness, steel) =>
    instanced(
      steel ? 'effect-debris-steel' : 'effect-debris',
      new THREE.BoxGeometry(0.075, 0.04, 0.045),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.65,
        metalness,
        transparent: true,
        depthWrite: false,
      }),
      70,
    ),
  );
  private rippleMesh = instanced(
    'effect-ripples',
    new THREE.RingGeometry(0.94, 1, 64),
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
    16,
  );
  private trails = createTrailParticles();
  private nextTrail = 0;
  private trailClock = 0;
  private fire = createFireMesh();
  private ice = createIceMesh();
  private flashes: Flash[] = [];
  private arcs: Arc[] = [];
  private ribbons: Ribbon[] = [];
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  constructor(scene: THREE.Scene) {
    this.group.add(this.sparkMesh, ...this.debrisMeshes, this.rippleMesh);
    scene.add(this.group);
    this.fire.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ice.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fire.frustumCulled = false;
    this.ice.frustumCulled = false;
    this.fire.count = 0;
    this.ice.count = 0;
    this.group.add(this.fire, this.ice);
    for (let i = 0; i < 3; i++) this.flashes.push(createFlash(this.group));
    for (let i = 0; i < 4; i++) {
      this.arcs.push(createArc(this.group));
      this.ribbons.push(createRibbon(this.group));
    }
  }

  emit(event: TableEvent, material: 'wood' | 'steel' | 'hex' = 'wood') {
    if (event.kind === 'chalk') {
      this.burst(event.x, event.z, '#94c2da', 8, 0.08);
      return;
    }
    if (event.kind === 'spawn') {
      this.ripple(event.x, event.z, '#d8eddb', 0.5, 0.42);
      this.burst(event.x, event.z, '#e8dfbc', 5, 0.25);
      return;
    }
    if (event.kind === 'expire') {
      this.ripple(event.x, event.z, '#7f968d', 0.32, 0.23);
      return;
    }
    if (event.kind === 'hazard') {
      const color =
        event.hazard === 'electric'
          ? '#a2ebff'
          : event.hazard === 'slime'
            ? '#d0e480'
            : event.hazard === 'portal'
              ? '#bbd6ff'
              : event.hazard === 'ramp'
                ? '#eac185'
                : '#b4d5df';
      this.ripple(event.x, event.z, color, event.hazard === 'portal' ? 0.9 : 0.45, 0.38);
      if (event.hazard === 'portal' && event.fromX !== undefined && event.fromZ !== undefined)
        this.ripple(event.fromX, event.fromZ, color, 0.9, 0.38);
      if (event.hazard === 'electric' || event.hazard === 'portal') {
        this.burst(event.x, event.z, color, 12, 0.75);
        this.flash(event.x, event.z, color, 8, 0.19);
      }
      if (event.hazard === 'electric') this.lightning(event.x, event.z);
      if (event.hazard === 'portal') {
        this.portalRibbon(event.x, event.z);
        if (event.fromX !== undefined && event.fromZ !== undefined) this.portalRibbon(event.fromX, event.fromZ);
      }
    } else if (event.kind === 'power' || event.kind === 'pickup' || event.kind === 'status') {
      const effect = event.status || event.power;
      const color = effectDefinition(effect || 'overdrive').color;
      this.ripple(event.x, event.z, color, event.kind === 'pickup' ? 0.85 : 1.2, 0.75);
      this.burst(event.x, event.z, color, event.kind === 'pickup' ? 22 : 14, 0.5);
      if (event.kind === 'pickup') this.flash(event.x, event.z, color, 7, 0.2);
      if (effect === 'portal') this.portalRibbon(event.x, event.z);
      if (effect === 'frost' || effect === 'frozen')
        for (let i = 0; i < 14; i++) this.emitTrail(event.x, 0.22, event.z, Math.cos(i) * 0.7, Math.sin(i) * 0.7, true);
    } else if (event.kind === 'obstacle') {
      const color = material === 'hex' ? '#c6a3ff' : material === 'steel' ? '#c5e1ed' : '#efb167';
      this.burst(event.x, event.z, color, event.destroyed ? 40 : 8, 0.7 + event.strength * 1.15);
      this.ripple(event.x, event.z, color, event.destroyed ? 1.85 : 0.5, event.destroyed ? 0.62 : 0.28);
      if (event.destroyed) {
        this.fragments(event.x, event.z, material);
        this.flash(event.x, event.z, color, 16, 0.2);
        this.ripple(event.x, event.z, '#ffecc4', 1.25, 0.38);
      }
    } else if (event.kind === 'pocket' && event.ball !== 0) {
      this.ripple(event.x, event.z, '#d6b96e', 0.65, 0.45);
    }
  }

  private flash(x: number, z: number, color: string, strength: number, life: number) {
    const flash = this.flashes.reduce((oldest, item) =>
      item.age / item.life > oldest.age / oldest.life ? item : oldest,
    );
    flash.age = 0;
    flash.life = life;
    flash.strength = strength;
    flash.light.position.set(x, 0.5, z);
    flash.light.color.set(color);
    flash.mesh.position.set(x, 0.25, z);
    flash.mesh.material.color.set(color).multiplyScalar(1.8);
    flash.mesh.visible = true;
  }
  private lightning(x: number, z: number) {
    const arc = this.arcs.find((item) => item.age >= item.life) || this.arcs[0];
    arc.age = 0;
    arc.life = 0.26;
    arc.x = x;
    arc.z = z;
    arc.line.visible = true;
  }
  private portalRibbon(x: number, z: number) {
    const ribbon = this.ribbons.find((item) => item.age >= item.life) || this.ribbons[0];
    ribbon.age = 0;
    ribbon.life = 0.65;
    ribbon.x = x;
    ribbon.z = z;
    ribbon.mesh.visible = true;
  }
  private emitTrail(x: number, y: number, z: number, vx: number, vz: number, ice: boolean) {
    const particle = this.trails[this.nextTrail++ % this.trails.length];
    particle.position.set(x, y, z);
    particle.velocity.set(vx, 0.25 + Math.random() * (ice ? 0.55 : 1.1), vz);
    particle.age = 0;
    particle.life = ice ? 0.4 + Math.random() * 0.2 : 0.18 + Math.random() * 0.18;
    particle.ice = ice;
  }
  updateTrail(ball: Ball, overdrive: boolean, frozen: boolean, dt: number) {
    if (ball.pocketed || (!overdrive && !frozen) || Math.hypot(ball.vx, ball.vz) < 0.5) {
      this.trailClock = 0;
      return;
    }
    this.trailClock += dt * (frozen ? 30 : 50);
    let emitted = 0;
    while (this.trailClock >= 1 && emitted++ < 3) {
      this.trailClock--;
      const side = (this.nextTrail % 2 ? 1 : -1) * 0.06;
      this.emitTrail(
        ball.x + side,
        0.18 + (ball.elevation || 0),
        ball.z - side,
        -ball.vx * 0.045 + side,
        -ball.vz * 0.045 - side,
        frozen,
      );
    }
  }

  private burst(x: number, z: number, color: string, count: number, speed: number) {
    for (let i = 0, slot = 0; i < count && (slot = nextFree(this.sparks, slot)) < this.sparks.length; i++) {
      const spark = this.sparks[slot],
        angle = Math.random() * Math.PI * 2;
      spark.position.set(x, 0.22, z);
      spark.color.set(color);
      spark.velocity.set(Math.cos(angle) * speed, 0.4 + Math.random() * 1.2, Math.sin(angle) * speed);
      spark.age = 0;
      spark.life = 0.22 + Math.random() * 0.35;
    }
  }

  private fragments(x: number, z: number, material: 'wood' | 'steel' | 'hex') {
    const color = material === 'hex' ? '#80609d' : material === 'steel' ? '#778991' : '#ac7847';
    for (let i = 0, slot = 0; i < 14 && (slot = nextFree(this.debris, slot)) < this.debris.length; i++) {
      const piece = this.debris[slot],
        angle = Math.random() * Math.PI * 2,
        speed = 0.7 + Math.random() * 1.5;
      piece.scale.set(0.5 + Math.random() * 1.5, 0.5 + Math.random(), 0.5 + Math.random() * 1.5);
      piece.position.set(x, 0.22, z);
      piece.rotation.set(0, 0, 0);
      piece.color.set(color);
      piece.steel = material === 'steel';
      piece.velocity.set(Math.cos(angle) * speed, 1 + Math.random() * 1.8, Math.sin(angle) * speed);
      piece.spin.set(Math.random() * 7, Math.random() * 5, Math.random() * 7);
      piece.age = 0;
      piece.life = 0.7 + Math.random() * 0.45;
    }
  }

  private ripple(x: number, z: number, color: string, size: number, life: number) {
    const ripple = this.ripples[nextFree(this.ripples, 0)];
    if (!ripple) return;
    ripple.x = x;
    ripple.z = z;
    ripple.color.set(color);
    ripple.size = size;
    ripple.age = 0;
    ripple.life = life;
  }

  private write(mesh: THREE.InstancedMesh, index: number, color: THREE.Color, alpha: number) {
    mesh.setMatrixAt(index, this.dummy.matrix);
    mesh.geometry.getAttribute('color').setXYZW(index, color.r, color.g, color.b, alpha);
  }
  /** Empty pools skip their draw; live pools upload only the instances written this frame. */
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

  update(dt: number) {
    updateTrailParticles(this.trails, this.fire, this.ice, this.dummy, this.color, dt);
    for (const flash of this.flashes) updateFlash(flash, dt);
    for (const arc of this.arcs) updateArc(arc, dt);
    for (const ribbon of this.ribbons) updateRibbon(ribbon, dt);
    let sparkCount = 0;
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.setScalar(1);
    for (const s of this.sparks) {
      if (s.age >= s.life) continue;
      s.age += dt;
      if (s.age >= s.life) continue;
      s.velocity.y -= dt * 4;
      s.position.addScaledVector(s.velocity, dt);
      s.position.y = Math.max(0.02, s.position.y);
      this.dummy.position.copy(s.position);
      this.dummy.updateMatrix();
      this.write(this.sparkMesh, sparkCount++, s.color, (1 - s.age / s.life) * 0.9);
    }
    this.commit(this.sparkMesh, sparkCount);
    const debrisCounts = [0, 0];
    for (const d of this.debris) {
      if (d.age >= d.life) continue;
      d.age += dt;
      if (d.age >= d.life) continue;
      d.velocity.y -= dt * 7;
      d.position.addScaledVector(d.velocity, dt);
      if (d.position.y < 0.025) {
        d.position.y = 0.025;
        d.velocity.y = Math.abs(d.velocity.y) * 0.22;
        d.velocity.x *= 0.92;
        d.velocity.z *= 0.92;
      }
      d.rotation.x += d.spin.x * dt;
      d.rotation.y += d.spin.y * dt;
      d.rotation.z += d.spin.z * dt;
      this.dummy.position.copy(d.position);
      this.dummy.rotation.copy(d.rotation);
      this.dummy.scale.copy(d.scale);
      this.dummy.updateMatrix();
      const kind = +d.steel;
      this.write(this.debrisMeshes[kind], debrisCounts[kind]++, d.color, Math.min(1, (d.life - d.age) * 4));
    }
    this.debrisMeshes.forEach((mesh, kind) => this.commit(mesh, debrisCounts[kind]));
    let rippleCount = 0;
    this.dummy.rotation.set(-Math.PI / 2, 0, 0);
    for (const r of this.ripples) {
      if (r.age >= r.life) continue;
      r.age += dt;
      if (r.age >= r.life) continue;
      const progress = r.age / r.life;
      this.dummy.position.set(r.x, 0.025, r.z);
      this.dummy.scale.setScalar(0.15 + progress * r.size);
      this.dummy.updateMatrix();
      this.write(this.rippleMesh, rippleCount++, r.color, 0.4 * (1 - progress) ** 2);
    }
    this.commit(this.rippleMesh, rippleCount);
  }

  clear() {
    for (const items of [this.sparks, this.debris, this.ripples]) for (const item of items) item.age = item.life;
    for (const mesh of [this.sparkMesh, ...this.debrisMeshes, this.rippleMesh]) this.commit(mesh, 0);
    for (const particle of this.trails) particle.age = particle.life;
    this.fire.count = 0;
    this.ice.count = 0;
    this.trailClock = 0;
    for (const flash of this.flashes) {
      flash.age = 1;
      flash.life = 0;
      flash.light.intensity = 0;
      flash.mesh.visible = false;
    }
    for (const arc of this.arcs) {
      arc.age = 1;
      arc.life = 0;
      arc.line.visible = false;
    }
    for (const ribbon of this.ribbons) {
      ribbon.age = 1;
      ribbon.life = 0;
      ribbon.mesh.visible = false;
    }
  }

  dispose() {
    this.clear();
    for (const mesh of [this.sparkMesh, ...this.debrisMeshes, this.rippleMesh]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
    }
    this.fire.geometry.dispose();
    this.fire.material.dispose();
    this.ice.geometry.dispose();
    this.ice.material.dispose();
    for (const flash of this.flashes) {
      flash.mesh.geometry.dispose();
      flash.mesh.material.dispose();
    }
    for (const arc of this.arcs) {
      arc.line.geometry.dispose();
      arc.line.material.dispose();
    }
    for (const ribbon of this.ribbons) {
      ribbon.mesh.geometry.dispose();
      ribbon.mesh.material.dispose();
    }
    this.group.removeFromParent();
  }
}
