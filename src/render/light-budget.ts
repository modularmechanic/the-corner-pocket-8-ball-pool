import * as THREE from 'three';
import type { RenderBudget, RenderQuality } from './performance';
import { applyBakedLighting } from './baked-lighting';
import { useBoundedLighting } from './lighting-shader';

type Practical = THREE.PointLight | THREE.RectAreaLight;
interface Source {
  light: Practical;
  layers: number;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  available: boolean;
  score: number;
}
interface Slot {
  light: Practical;
  source: Source | null;
  target: Source | null;
  fade: number;
}

export function practicalLightLimits(
  quality: RenderQuality,
  tier: RenderBudget['tier'],
): Readonly<{ points: number; areas: number }> {
  if (quality === 'ultra') return { points: 12, areas: 4 };
  if (quality === 'veryHigh') return { points: 6, areas: 2 };
  if (quality === 'high') return { points: 4, areas: 2 };
  if (quality === 'performance' || tier === 'minimum' || tier === 'light') return { points: 2, areas: 1 };
  if (tier === 'fast') return { points: 3, areas: 1 };
  return { points: 4, areas: 2 };
}

/** Re-emit nearby practicals from a bounded set of shader lights. Authored lights
 * retain their animation and visibility; their layer masks are reserved by this
 * controller until disposal, and temporarily restored for full-room reflections.
 * Table spotlights and emissive fixture meshes are independent of this pool. */
export class PracticalLightBudget {
  private sources = new Map<Practical, Source>();
  private list: Source[] = [];
  private group = new THREE.Group();
  private points: Slot[] = [];
  private areas: Slot[] = [];
  private slots: Slot[] = [];
  private ambient = new THREE.AmbientLight('#eadfcf', 0.025);
  private limits = { points: 4, areas: 2 };
  private elapsed = Infinity;
  private discovery = 0;
  private revision: number | undefined;
  private flash = false;
  private frustum = new THREE.Frustum();
  private projection = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  private scale = new THREE.Vector3();
  private cameraPosition = new THREE.Vector3();
  constructor(private scene: THREE.Scene) {
    this.group.name = 'adaptive-practical-lights';
    this.group.add(this.ambient);
    scene.add(this.group);
    for (let i = 0; i < 12; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 1, 2);
      this.group.add(light);
      this.points.push({ light, source: null, target: null, fade: 0 });
    }
    for (let i = 0; i < 4; i++) {
      const light = new THREE.RectAreaLight(0xffffff, 0, 1, 1);
      this.group.add(light);
      this.areas.push({ light, source: null, target: null, fade: 0 });
    }
    this.slots = [...this.points, ...this.areas];
    this.configure('auto', 'balanced');
    this.discover();
  }
  /** Hide excess slots, not just their intensity: zero-intensity visible lights
   * still expand Three's shader loops. Counts stay fixed during camera movement. */
  configure(quality: RenderQuality, tier: RenderBudget['tier']): void {
    this.limits = practicalLightLimits(quality, tier);
    this.elapsed = Infinity;
    this.points.forEach((slot, i) => this.show(slot, i < this.limits.points));
    this.areas.forEach((slot, i) => this.show(slot, i < this.limits.areas));
    this.ambient.intensity = this.limits.points <= 2 ? 0.035 : this.limits.points <= 4 ? 0.025 : 0.015;
  }
  private show(slot: Slot, visible: boolean): void {
    slot.light.visible = visible;
    if (!visible) {
      slot.source = null;
      slot.target = null;
      slot.fade = 0;
      slot.light.intensity = 0;
    }
  }
  private discover(): void {
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh)
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          useBoundedLighting(material);
      if (
        !(object instanceof THREE.PointLight || object instanceof THREE.RectAreaLight) ||
        object.parent === this.group ||
        this.sources.has(object)
      )
        return;
      const source: Source = {
        light: object,
        layers: object.layers.mask,
        position: new THREE.Vector3(),
        rotation: new THREE.Quaternion(),
        available: false,
        score: 0,
      };
      this.sources.set(object, source);
      this.list.push(source);
      object.layers.disableAll();
    });
    applyBakedLighting(this.scene);
    this.discovery = 0;
    this.elapsed = Infinity;
  }
  /** A supplied asset revision avoids recurring full-scene scans after loading.
   * Callers without a revision retain periodic discovery for dynamically added lights. */
  update(camera: THREE.Camera, dt: number, revision?: number): void {
    this.discovery += dt;
    if (revision !== undefined ? revision !== this.revision : this.discovery >= 2) {
      this.discover();
      this.revision = revision;
    }
    this.elapsed += dt;
    camera.updateWorldMatrix(true, false);
    this.cameraPosition.setFromMatrixPosition(camera.matrixWorld);
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection);
    let flash = false;
    for (const source of this.list) {
      const light = source.light;
      light.updateWorldMatrix(true, false);
      if (light instanceof THREE.RectAreaLight)
        light.matrixWorld.decompose(source.position, source.rotation, this.scale);
      else source.position.setFromMatrixPosition(light.matrixWorld);
      let visible = light.visible && (source.layers & camera.layers.mask) !== 0;
      let root: THREE.Object3D = light;
      while (root.parent) {
        root = root.parent;
        if (!root.visible) visible = false;
      }
      source.available = visible && root === this.scene;
      // An emitter behind the camera can still illuminate visible surfaces. Cull
      // its influence volume rather than the tiny fixture itself.
      const radius =
        light instanceof THREE.PointLight ? light.distance || Infinity : Math.max(light.width, light.height) * 0.65 + 7;
      this.sphere.set(source.position, radius);
      const distanceSq = source.position.distanceToSquared(this.cameraPosition);
      const area = light instanceof THREE.RectAreaLight ? Math.sqrt(light.width * light.height) : 1;
      const transient = !!light.userData.performanceFlash && light.intensity > 0.02;
      source.score =
        source.available && light.intensity > 0.001 && this.frustum.intersectsSphere(this.sphere)
          ? ((light.intensity * area) / (3 + distanceSq)) * (transient ? 8 : 1)
          : 0;
      if (transient && source.score > 0) flash = true;
    }
    if (this.elapsed >= 0.18 || flash !== this.flash) {
      this.select(this.points, this.limits.points, false);
      this.select(this.areas, this.limits.areas, true);
      this.elapsed = 0;
      this.flash = flash;
    }
    for (const slot of this.slots) {
      if (!slot.light.visible) continue;
      if (slot.target !== slot.source) {
        if (!slot.source || slot.target?.light.userData.performanceFlash) {
          slot.source = slot.target;
          slot.fade = slot.target?.light.userData.performanceFlash ? 1 : 0;
        } else {
          slot.fade = Math.max(0, slot.fade - dt * 9);
          if (slot.fade === 0) slot.source = slot.target;
        }
      } else slot.fade = Math.min(1, slot.fade + dt * 7);
      const source = slot.source;
      if (!source) {
        slot.light.intensity = 0;
        continue;
      }
      slot.light.position.copy(source.position);
      slot.light.quaternion.copy(source.rotation);
      slot.light.color.copy(source.light.color);
      slot.light.intensity = source.available ? source.light.intensity * slot.fade : 0;
      if (slot.light instanceof THREE.PointLight && source.light instanceof THREE.PointLight) {
        slot.light.distance = source.light.distance;
        slot.light.decay = source.light.decay;
      }
      if (slot.light instanceof THREE.RectAreaLight && source.light instanceof THREE.RectAreaLight) {
        slot.light.width = source.light.width;
        slot.light.height = source.light.height;
      }
    }
  }
  private select(slots: Slot[], count: number, areas: boolean): void {
    const active = new Set(slots.slice(0, count).map((slot) => slot.target));
    const selected = this.list
      .filter((source) => source.light instanceof THREE.RectAreaLight === areas && source.score > 0)
      .sort(
        (a, b) => b.score * (active.has(b) ? 1.3 : 1) - a.score * (active.has(a) ? 1.3 : 1) || a.light.id - b.light.id,
      )
      .slice(0, count);
    const retained = new Set<Source>();
    for (const slot of slots.slice(0, count))
      if (slot.target && selected.includes(slot.target)) retained.add(slot.target);
    const available = selected.filter((source) => !retained.has(source));
    for (const slot of slots.slice(0, count))
      if (!slot.target || !retained.has(slot.target)) slot.target = available.shift() ?? null;
    for (const slot of slots.slice(count)) slot.target = null;
  }
  /** Capture every authored practical without duplicating the pool or changing
   * visibility set by animations. Restore masks and group state even on failure. */
  withFullLighting(capture: () => void): void {
    const visible = this.group.visible;
    const masks = this.list.map((source) => source.light.layers.mask);
    try {
      this.group.visible = false;
      for (const source of this.list) source.light.layers.mask = source.layers;
      capture();
    } finally {
      this.group.visible = visible;
      this.list.forEach((source, index) => (source.light.layers.mask = masks[index]));
    }
  }
  /** Actual shader slots, including those temporarily faded to zero. */
  getCounts(): Readonly<{ pointLights: number; areaLights: number }> {
    return Object.freeze({ pointLights: this.limits.points, areaLights: this.limits.areas });
  }
  dispose(): void {
    for (const source of this.list) source.light.layers.mask = source.layers;
    this.sources.clear();
    this.list = [];
    this.group.removeFromParent();
  }
}
