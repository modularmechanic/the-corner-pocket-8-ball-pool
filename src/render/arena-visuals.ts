import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { ArcadeState, Hazard, Obstacle, Pickup } from '../simulation/types';
import { rampCorners, rampFrame } from '../simulation/arcade';
import { effectDefinition } from '../presentation/effects';
import { canvasTexture, woodTexture } from './materials';
import { enableTableShadows } from './table-model';
import type { PropInstaller } from './asset-installer';
import { ZombieWalkers, type Walker } from './zombie-walkers';

interface ObstacleVisual {
  source: Obstacle;
  group: THREE.Group;
  /** Everything the procedural crate draws. Hidden once a rigged body takes over. */
  crate: THREE.Group;
  body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  pips: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>[];
  cracks: THREE.LineSegments;
  flash: number;
  hp: number;
  walker?: Walker;
}
interface HazardVisual {
  source: Hazard;
  group: THREE.Group;
  spinner?: THREE.Group;
  arcs?: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  arcStep: number;
  ripples: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[];
  clouds: THREE.Sprite[];
}
interface Visual<T> {
  source: T;
  group: THREE.Group;
}

const PIP_COLORS = {
  wood: new THREE.Color('#edbf6a'),
  steel: new THREE.Color('#b3d8e3'),
  hex: new THREE.Color('#c5a3ef'),
};
const SPENT_PIP = new THREE.Color('#354044');
const ARC_VERTICES = 3 * 8 * 2;

/** A walker carries its own speed (the zombie horde); every other obstacle is bolted to the cloth.
 * Structural, so nothing here needs to know the zombie mode exists. */
const walks = (obstacle: Obstacle): boolean => typeof (obstacle as { speed?: unknown }).speed === 'number';
/** The horde walks towards the player's rail, down -x, until its first step gives a real heading.
 * The model faces +z once glTF has turned Blender's -y about, so a heading is `atan2(dx, dz)`. */
const WALK_HEADING = Math.atan2(-1, 0);

// A walker moves every step, so its position is animated rather than rebuilt; everything else is fixed art.
const sameObstacle = (a: Obstacle, b: Obstacle) =>
  walks(a) === walks(b) &&
  (walks(a) || (a.x === b.x && a.z === b.z)) &&
  a.width === b.width &&
  a.depth === b.depth &&
  a.material === b.material &&
  a.maxHp === b.maxHp;
const sameHazard = (a: Hazard, b: Hazard) =>
  a.kind === b.kind && a.x === b.x && a.z === b.z && a.radius === b.radius && a.angle === b.angle && a.link === b.link;

function disposeObstacle(visual: ObstacleVisual) {
  visual.body.material.map?.dispose();
  disposeGroup(visual.group);
}
function disposeGroup(group: THREE.Object3D) {
  group.removeFromParent();
  group.traverse((object) => {
    // Sprites share one geometry across the whole application.
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) object.geometry.dispose();
    const material = (object as THREE.Mesh).material;
    if (material) for (const item of Array.isArray(material) ? material : [material]) item.dispose();
  });
}

export interface ArenaTextures {
  wood(): THREE.Texture;
  smoke(): THREE.Texture;
}
/** Canvas-drawn when first needed, so browser only. */
export const ARENA_TEXTURES: ArenaTextures = {
  wood: woodTexture,
  smoke: () =>
    canvasTexture(128, 128, (ctx) => {
      const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 62);
      gradient.addColorStop(0, '#e7efedb0');
      gradient.addColorStop(0.4, '#d7e2e977');
      gradient.addColorStop(1, '#c4d4df00');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
    }),
};

/** Arcade obstacles, hazards and pickups, rebuilt per id only when their shape changes. */
export class ArenaVisuals {
  private obstacleVisuals = new Map<number, ObstacleVisual>();
  private hazardVisuals = new Map<number, HazardVisual>();
  readonly obstacles: ReadonlyMap<number, { readonly group: THREE.Group }> = this.obstacleVisuals;
  readonly hazards: ReadonlyMap<number, { readonly group: THREE.Group }> = this.hazardVisuals;
  private smokeTexture?: THREE.Texture;
  private seen = new Set<number>();
  /** Rigged bodies for walking obstacles. Without a prop installer the crates stand in, as they do while it loads. */
  private walkers?: ZombieWalkers;
  constructor(
    private scene: THREE.Scene,
    private textures: ArenaTextures = ARENA_TEXTURES,
    props?: PropInstaller,
  ) {
    if (props) this.walkers = new ZombieWalkers(props);
  }

  /** Flashes a struck obstacle; returns its material for the impact effect. */
  strikeObstacle(id: number): { readonly material: Obstacle['material'] } | undefined {
    const visual = this.obstacleVisuals.get(id);
    if (!visual) return undefined;
    visual.flash = 1;
    return visual.source;
  }
  /** A fresh rack starts without lingering hit flashes. */
  clearFlashes() {
    for (const visual of this.obstacleVisuals.values()) visual.flash = 0;
  }

  update(arcade: Pick<ArcadeState, 'obstacles' | 'hazards' | 'pickups'> | undefined, clock: number, dt: number) {
    const obstacles = arcade?.obstacles ?? [],
      hazards = arcade?.hazards ?? [],
      pickups = arcade?.pickups ?? [];
    this.sync(
      this.obstacleVisuals,
      obstacles,
      sameObstacle,
      (obstacle) => this.buildObstacle(obstacle),
      (visual) => this.dropObstacle(visual),
    );
    this.sync(
      this.hazardVisuals,
      hazards,
      sameHazard,
      (hazard) => this.buildHazard(hazard),
      (visual) => disposeGroup(visual.group),
    );
    for (const obstacle of obstacles) {
      const visual = this.obstacleVisuals.get(obstacle.id)!;
      if (walks(obstacle)) this.walk(visual, obstacle);
      visual.group.visible = obstacle.hp > 0;
      visual.flash = Math.max(0, visual.flash - dt * 5);
      visual.body.material.emissiveIntensity = visual.flash * 0.55;
      visual.cracks.visible = obstacle.hp < obstacle.maxHp;
      if (visual.hp !== obstacle.hp) {
        visual.hp = obstacle.hp;
        for (let i = 0; i < visual.pips.length; i++)
          visual.pips[i].material.color.copy(i < obstacle.hp ? PIP_COLORS[obstacle.material] : SPENT_PIP);
      }
    }
    for (const visual of this.hazardVisuals.values()) this.animateHazard(visual, clock);
    this.walkers?.update(dt);
  }

  /** Carries a walking obstacle to its new spot, turns it along the step it just took, and gives it a rigged
   * body as soon as one is available. The crate keeps drawing until then. */
  private walk(visual: ObstacleVisual, obstacle: Obstacle) {
    const dx = obstacle.x - visual.source.x,
      dz = obstacle.z - visual.source.z;
    if (dx * dx + dz * dz > 1e-8) visual.group.rotation.y = Math.atan2(dx, dz);
    visual.source.x = obstacle.x;
    visual.source.z = obstacle.z;
    visual.group.position.set(obstacle.x, 0, obstacle.z);
    if (visual.walker || !this.walkers) return;
    const walker = this.walkers.acquire(obstacle.id);
    if (!walker) return;
    visual.walker = walker;
    visual.group.add(walker.root);
    enableTableShadows(walker.root);
    visual.crate.visible = false;
  }

  /** Releases the rigged body first: the clone shares its geometry and materials with the source model,
   * so it must leave the group before the group's own art is disposed. */
  private dropObstacle(visual: ObstacleVisual) {
    if (visual.walker) this.walkers?.release(visual.walker);
    visual.walker = undefined;
    disposeObstacle(visual);
  }

  dispose() {
    for (const visual of this.obstacleVisuals.values()) this.dropObstacle(visual);
    this.walkers?.dispose();
    for (const visual of this.hazardVisuals.values()) disposeGroup(visual.group);
    this.obstacleVisuals.clear();
    this.hazardVisuals.clear();
    this.smokeTexture?.dispose();
    this.smokeTexture = undefined;
  }

  private sync<T extends { id: number }, V extends Visual<T>>(
    visuals: Map<number, V>,
    items: readonly T[],
    same: (a: T, b: T) => boolean,
    build: (item: T) => V,
    dispose: (visual: V) => void,
  ) {
    const seen = this.seen;
    seen.clear();
    for (const item of items) {
      seen.add(item.id);
      const visual = visuals.get(item.id);
      if (visual && same(visual.source, item)) continue;
      if (visual) dispose(visual);
      const next = build(item);
      enableTableShadows(next.group);
      visuals.set(item.id, next);
    }
    if (visuals.size > seen.size)
      for (const [id, visual] of visuals)
        if (!seen.has(id)) {
          dispose(visual);
          visuals.delete(id);
        }
  }

  private buildHazard(hazard: Hazard): HazardVisual {
    const copper = '#bd8652';
    const group = new THREE.Group();
    group.position.set(hazard.x, 0, hazard.z);
    group.rotation.y = -(hazard.angle || 0);
    this.scene.add(group);
    const visual: HazardVisual = { source: { ...hazard }, group, ripples: [], clouds: [], arcStep: NaN };
    const radius = hazard.radius;
    const disc = (r: number, material: THREE.Material, y = 0.017) => {
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(r, 80), material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = y;
      group.add(mesh);
      return mesh;
    };
    const ring = (inner: number, outer: number, color: string, opacity = 0.8, y = 0.021) => {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(inner, outer, 96),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = y;
      group.add(mesh);
      return mesh;
    };
    if (hazard.kind === 'ramp') {
      disc(
        radius,
        new THREE.MeshStandardMaterial({
          color: '#473d28',
          transparent: true,
          opacity: 0.38,
          roughness: 0.8,
          depthWrite: false,
        }),
      );
      ring(radius - 0.015, radius, copper, 0.7);
      // The visible wedge IS the collider: the same six corners the simulation feeds to Rapier,
      // in the same frame (local +X is the ramp's facing direction). See rampCorners in arcade.ts.
      const frame = rampFrame(hazard),
        corners = rampCorners(hazard);
      const ramp = new THREE.BufferGeometry();
      ramp.setAttribute('position', new THREE.Float32BufferAttribute(corners.flat(), 3));
      // 0..3 are the base corners; 4 and 5 are the ridge ends. Four sloped faces, then the base.
      ramp.setIndex([0, 4, 1, 1, 4, 5, 3, 2, 5, 3, 5, 4, 1, 5, 2, 0, 3, 4, 0, 1, 2, 0, 2, 3]);
      ramp.computeVertexNormals();
      ramp.addGroup(0, 18, 0);
      ramp.addGroup(18, 6, 1);
      const mesh = new THREE.Mesh(ramp, [
        new THREE.MeshPhysicalMaterial({
          color: copper,
          metalness: 0.72,
          roughness: 0.32,
          clearcoat: 0.2,
          side: THREE.DoubleSide,
        }),
        new THREE.MeshStandardMaterial({ color: '#344045', metalness: 0.8, roughness: 0.43, side: THREE.DoubleSide }),
      ]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      // Kerb rails along the two climbing edges, lying on the surface rather than floating over it.
      for (const sign of [-1, 1]) {
        const edge = sign * frame.halfWidth,
          ridge = sign * frame.ridge,
          run = frame.halfLength + frame.crest;
        const rail = new THREE.Mesh(
          new THREE.BoxGeometry(Math.hypot(run, frame.height), 0.016, 0.022),
          new THREE.MeshStandardMaterial({ color: '#e2b977', metalness: 0.8, roughness: 0.24 }),
        );
        rail.position.set((-frame.halfLength + frame.crest) / 2, frame.height / 2 + 0.008, (edge + ridge) / 2);
        rail.rotation.y = Math.atan2(ridge - edge, run);
        rail.rotation.z = Math.atan2(frame.height, run);
        rail.castShadow = true;
        group.add(rail);
      }
      // Direction arrows painted 4mm proud of the climbing face.
      const chevrons: THREE.Vector3[] = [];
      const face = (u: number) => (frame.height * (u + frame.halfLength)) / (frame.halfLength + frame.crest) + 0.004,
        step = (frame.halfLength + frame.crest) / 5,
        wing = frame.halfWidth * 0.45;
      for (const index of [1, 2, 3]) {
        const u = -frame.halfLength + index * step,
          tail = u - step * 0.6;
        chevrons.push(
          new THREE.Vector3(tail, face(tail), -wing),
          new THREE.Vector3(u, face(u), 0),
          new THREE.Vector3(u, face(u), 0),
          new THREE.Vector3(tail, face(tail), wing),
        );
      }
      group.add(
        new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(chevrons),
          new THREE.LineBasicMaterial({ color: '#ffdd93' }),
        ),
      );
    } else if (hazard.kind === 'portal') {
      const color = Math.min(hazard.id, hazard.link ?? hazard.id) % 2 ? '#cb95ff' : '#7bdfeb';
      disc(
        radius * 0.89,
        new THREE.MeshPhysicalMaterial({ color: '#091a20', metalness: 0.55, roughness: 0.12, clearcoat: 1 }),
        0.023,
      );
      const well = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.84, radius * 0.78, 0.1, 64, 1, true),
        new THREE.MeshStandardMaterial({ color: '#26363e', metalness: 0.8, roughness: 0.27, side: THREE.DoubleSide }),
      );
      well.position.y = 0.075;
      group.add(well);
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 0.885, radius * 0.105, 12, 72),
        new THREE.MeshPhysicalMaterial({ color: copper, metalness: 0.85, roughness: 0.25, clearcoat: 0.25 }),
      );
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = 0.108;
      rim.castShadow = true;
      group.add(rim);
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const lug = new THREE.Mesh(
          new RoundedBoxGeometry(radius * 0.18, 0.055, radius * 0.2, 2, 0.008),
          new THREE.MeshStandardMaterial({ color: '#3a4649', metalness: 0.8, roughness: 0.33 }),
        );
        lug.position.set(Math.cos(angle) * radius * 0.885, 0.144, Math.sin(angle) * radius * 0.885);
        lug.rotation.y = Math.PI / 2 - angle;
        lug.castShadow = true;
        group.add(lug);
        const bolt = new THREE.Mesh(
          new THREE.CylinderGeometry(0.009, 0.009, 0.008, 6),
          new THREE.MeshStandardMaterial({ color: '#e8cb85', metalness: 0.9, roughness: 0.25 }),
        );
        bolt.position.set(lug.position.x, 0.175, lug.position.z);
        group.add(bolt);
      }
      ring(radius * 0.77, radius * 0.8, color, 0.85, 0.12);
      const spinner = new THREE.Group();
      group.add(spinner);
      visual.spinner = spinner;
      for (let i = 0; i < 5; i++) {
        const segment = new THREE.Mesh(
          new THREE.RingGeometry(radius * (0.34 + i * 0.08), radius * (0.35 + i * 0.08), 40, 1, i * 1.4, Math.PI * 1.3),
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.45,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
          }),
        );
        segment.rotation.x = -Math.PI / 2;
        segment.position.y = 0.024 + i * 0.001;
        spinner.add(segment);
      }
      const halo = ring(radius * 0.83, radius * 0.855, color, 0.65, 0.15);
      visual.ripples.push(halo);
    } else if (hazard.kind === 'water' || hazard.kind === 'slime') {
      const color = hazard.kind === 'water' ? '#528f9a' : '#749334';
      disc(
        radius,
        new THREE.MeshPhysicalMaterial({
          color,
          metalness: 0.15,
          roughness: hazard.kind === 'water' ? 0.07 : 0.19,
          clearcoat: 1,
          clearcoatRoughness: 0.07,
          transparent: true,
          opacity: 0.75,
          envMapIntensity: 1.3,
          depthWrite: false,
        }),
      );
      ring(radius - 0.017, radius, hazard.kind === 'water' ? '#a7d4df' : '#c3d878', 0.55);
      for (let i = 0; i < 3; i++) {
        const ripple = ring(
          radius * 0.3,
          radius * 0.3 + 0.009,
          hazard.kind === 'water' ? '#c6e5e9' : '#d2e27e',
          0.3,
          0.022 + i * 0.001,
        );
        visual.ripples.push(ripple);
      }
      if (hazard.kind === 'slime') {
        for (let i = 0; i < 6; i++) {
          const angle = i * 2.4,
            r = radius * (0.2 + (i % 3) * 0.19);
          const bubble = new THREE.Mesh(
            new THREE.SphereGeometry(0.027 + (i % 3) * 0.009, 12, 8),
            new THREE.MeshPhysicalMaterial({
              color: '#a4b952',
              roughness: 0.12,
              transparent: true,
              opacity: 0.7,
              clearcoat: 1,
            }),
          );
          bubble.position.set(Math.cos(angle) * r, 0.017, Math.sin(angle) * r);
          bubble.scale.y = 0.35;
          group.add(bubble);
        }
      }
    } else if (hazard.kind === 'electric') {
      disc(radius, new THREE.MeshStandardMaterial({ color: '#253438', metalness: 0.7, roughness: 0.4 }));
      ring(radius - 0.03, radius, copper);
      ring(radius * 0.7, radius * 0.73, '#77dbe3', 0.6);
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const contact = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035, 0.04, 0.045, 12),
          new THREE.MeshStandardMaterial({ color: copper, metalness: 0.85, roughness: 0.25 }),
        );
        contact.position.set(Math.cos(angle) * radius * 0.84, 0.039, Math.sin(angle) * radius * 0.84);
        group.add(contact);
      }
      const arcGeometry = new THREE.BufferGeometry();
      arcGeometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(ARC_VERTICES * 3), 3).setUsage(THREE.DynamicDrawUsage),
      );
      arcGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.062, 0), radius * 0.8 + 0.07);
      const arcs = new THREE.LineSegments(
        arcGeometry,
        new THREE.LineBasicMaterial({
          color: '#9feaff',
          transparent: true,
          opacity: 0.8,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      group.add(arcs);
      visual.arcs = arcs;
    } else {
      disc(
        radius,
        new THREE.MeshBasicMaterial({ color: '#becac1', transparent: true, opacity: 0.11, depthWrite: false }),
      );
      ring(radius - 0.016, radius, '#b3c0b9', 0.4);
      this.smokeTexture ||= this.textures.smoke();
      for (let i = 0; i < 5; i++) {
        const cloud = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: this.smokeTexture,
            color: '#e1e8e5',
            transparent: true,
            opacity: 0.14,
            depthWrite: false,
          }),
        );
        cloud.scale.setScalar(radius * 1.15);
        group.add(cloud);
        visual.clouds.push(cloud);
      }
    }
    return visual;
  }

  private buildObstacle(obstacle: Obstacle): ObstacleVisual {
    const group = new THREE.Group();
    group.position.set(obstacle.x, 0, obstacle.z);
    this.scene.add(group);
    const color = obstacle.material === 'steel' ? '#586975' : obstacle.material === 'hex' ? '#594664' : '#b17b42';
    const material = new THREE.MeshPhysicalMaterial({
      color,
      map: obstacle.material === 'wood' ? this.textures.wood() : null,
      emissive: obstacle.material === 'hex' ? '#ab70df' : '#edbe77',
      metalness: obstacle.material === 'steel' ? 0.8 : 0.2,
      roughness: obstacle.material === 'steel' ? 0.32 : 0.5,
      clearcoat: 0.25,
    });
    // The footprint matches the collider; decorative edges stay inside that footprint.
    const body = new THREE.Mesh(
      new RoundedBoxGeometry(obstacle.width - 0.012, 0.46, obstacle.depth - 0.012, 2, 0.012),
      material,
    );
    body.position.y = 0.23;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    for (const y of [0.065, 0.34]) {
      const band = new THREE.Mesh(
        new RoundedBoxGeometry(obstacle.width, 0.032, obstacle.depth, 2, 0.008),
        new THREE.MeshStandardMaterial({
          color: obstacle.material === 'wood' ? '#3a3e38' : obstacle.material === 'hex' ? '#ad91bd' : '#9faeb4',
          metalness: 0.78,
          roughness: 0.34,
        }),
      );
      band.position.y = y;
      band.castShadow = true;
      group.add(band);
    }
    for (const x of [-1, 1])
      for (const z of [-1, 1]) {
        const bolt = new THREE.Mesh(
          new THREE.CylinderGeometry(0.014, 0.014, 0.014, 6),
          new THREE.MeshStandardMaterial({
            color: obstacle.material === 'wood' ? '#bbaa77' : '#d4d7cb',
            metalness: 0.85,
            roughness: 0.3,
          }),
        );
        bolt.position.set(x * (obstacle.width / 2 - 0.037), 0.467, z * (obstacle.depth / 2 - 0.037));
        group.add(bolt);
      }
    const isWide = obstacle.width >= obstacle.depth,
      longSide = Math.max(obstacle.width, obstacle.depth),
      shortSide = Math.min(obstacle.width, obstacle.depth);
    if (obstacle.material === 'wood') {
      const seams: THREE.Vector3[] = [];
      for (const fraction of [-0.3, 0, 0.3]) {
        const along = longSide * fraction;
        if (isWide)
          seams.push(
            new THREE.Vector3(along, 0.462, -obstacle.depth / 2 + 0.02),
            new THREE.Vector3(along, 0.462, obstacle.depth / 2 - 0.02),
          );
        else
          seams.push(
            new THREE.Vector3(-obstacle.width / 2 + 0.02, 0.462, along),
            new THREE.Vector3(obstacle.width / 2 - 0.02, 0.462, along),
          );
      }
      group.add(
        new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(seams),
          new THREE.LineBasicMaterial({ color: '#473a26', transparent: true, opacity: 0.6 }),
        ),
      );
    }
    const panelShort = obstacle.material === 'wood' ? Math.min(0.13, shortSide - 0.09) : shortSide - 0.09;
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(isWide ? longSide - 0.09 : panelShort, 0.008, isWide ? panelShort : longSide - 0.09),
      new THREE.MeshStandardMaterial({ color: '#1f2526', metalness: 0.65, roughness: 0.48 }),
    );
    plate.position.y = 0.464;
    group.add(plate);
    const pips: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>[] = [];
    const span = longSide - 0.17,
      step = span / obstacle.maxHp,
      pipLength = Math.min(0.14, step * 0.65);
    for (let i = 0; i < obstacle.maxHp; i++) {
      const pip = new THREE.Mesh(
        new THREE.BoxGeometry(isWide ? pipLength : 0.037, 0.009, isWide ? 0.037 : pipLength),
        new THREE.MeshBasicMaterial({ color: PIP_COLORS[obstacle.material] }),
      );
      const position = (i - (obstacle.maxHp - 1) / 2) * step;
      pip.position.set(isWide ? position : 0, 0.473, isWide ? 0 : position);
      group.add(pip);
      pips.push(pip);
    }
    const crackPoints: THREE.Vector3[] = [];
    for (let i = 0; i < 3; i++) {
      const along = (i - 1) * longSide * 0.21;
      const point = (a: number, b: number) => new THREE.Vector3(isWide ? a : b, 0.478, isWide ? b : a);
      crackPoints.push(point(along - 0.04, -0.08), point(along, 0), point(along, 0), point(along + 0.065, 0.07));
    }
    const cracks = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(crackPoints),
      new THREE.LineBasicMaterial({ color: '#0c1416', transparent: true, opacity: 0.65 }),
    );
    cracks.visible = false;
    group.add(cracks);
    // A walker's crate goes in its own node so a rigged body can replace it wholesale; a bolted-down
    // obstacle keeps its flat group, since nothing ever hides its art.
    const crate = walks(obstacle) ? new THREE.Group() : group;
    if (crate !== group) {
      crate.add(...group.children);
      group.add(crate);
      group.rotation.y = WALK_HEADING;
    }
    return { source: { ...obstacle }, group, crate, body, pips, cracks, flash: 0, hp: -1 };
  }

  private animateHazard(visual: HazardVisual, clock: number) {
    const { id, kind, radius } = visual.source;
    if (visual.spinner) visual.spinner.rotation.y = clock * 0.8;
    for (let i = 0; i < visual.ripples.length; i++) {
      const ripple = visual.ripples[i];
      if (kind === 'portal') {
        ripple.material.opacity = 0.45 + Math.sin(clock * 2.8 + id) * 0.14;
        continue;
      }
      const phase = (clock * (kind === 'water' ? 0.25 : 0.11) + i / 3) % 1;
      ripple.scale.setScalar(0.3 + phase * 2.75);
      ripple.material.opacity = Math.sin(phase * Math.PI) * 0.3;
    }
    if (visual.arcs) {
      // Lightning jumps 12 times a second; the buffer is rewritten only then.
      const step = Math.floor(clock * 12);
      if (step !== visual.arcStep) {
        visual.arcStep = step;
        const position = visual.arcs.geometry.getAttribute('position') as THREE.BufferAttribute;
        let vertex = 0;
        for (let branch = 0; branch < 3; branch++) {
          const angle = (branch * Math.PI) / 3 + 0.25,
            cos = Math.cos(angle),
            sin = Math.sin(angle);
          let x = -cos * radius * 0.8,
            y = 0.062,
            z = -sin * radius * 0.8;
          for (let segment = 1; segment <= 8; segment++) {
            const distance = (segment / 4 - 1) * radius * 0.8;
            const bend = Math.sin(segment * 7.8 + step * 2.6 + branch) * 0.05;
            position.setXYZ(vertex++, x, y, z);
            x = cos * distance - sin * bend;
            y = 0.062 + Math.abs(bend) * 0.25;
            z = sin * distance + cos * bend;
            position.setXYZ(vertex++, x, y, z);
          }
        }
        position.needsUpdate = true;
      }
      visual.arcs.material.opacity = 0.5 + Math.sin(clock * 9 + id) * 0.18;
    }
    for (let i = 0; i < visual.clouds.length; i++) {
      const cloud = visual.clouds[i],
        angle = i * 2.4 + clock * 0.16;
      cloud.position.set(Math.cos(angle) * radius * 0.24, 0.14 + (i % 2) * 0.08, Math.sin(angle) * radius * 0.24);
      cloud.material.rotation = -angle * 0.3;
      cloud.material.opacity = 0.11 + Math.sin(clock * 0.6 + i) * 0.025;
    }
  }
}
