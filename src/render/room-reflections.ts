import * as THREE from 'three';
import type { PropInstaller } from './asset-installer';

/** What a dim pub should catch: metal of any finish, and glass or lacquer smooth enough to
 * hold a highlight. Rough non-metals are left alone on purpose — an environment map also adds
 * ambient irradiance to them, so sweeping in plaster, tile and wood would lift the whole room
 * rather than give the bottles and the brass something to reflect. */
export function catchesRoom(material: THREE.Material | null | undefined): material is THREE.MeshStandardMaterial {
  if (!(material instanceof THREE.MeshStandardMaterial)) return false;
  if (material.metalness >= 0.5) return true;
  const physical = material as Partial<THREE.MeshPhysicalMaterial>;
  const glassy = material.transparent || (physical.transmission ?? 0) > 0 || (physical.clearcoat ?? 0) >= 0.5;
  return glassy && material.roughness <= 0.3;
}

/** A filtered reflection of the actual enclosed pub, shared by the polished balls.
 * Capture once the table is built, once more when the pub is settled (or has had long
 * enough, if a prop never answers), then only after later prop swaps; never render six
 * extra views per frame. */
export class RoomReflections {
  private cube: THREE.WebGLCubeRenderTarget;
  private camera: THREE.CubeCamera;
  private pmrem: THREE.PMREMGenerator;
  private filtered?: THREE.WebGLRenderTarget;
  /** Prop revision shown by the current capture; undefined until the first capture. */
  private captured?: number;
  private settled = false;
  private age = 0;
  private cooldown = 0;
  private disposed = false;
  private resolution = 128;
  private consumers = new Set<THREE.MeshStandardMaterial>();
  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private staticObjects: () => THREE.Object3D[],
    private enclose: (capture: () => void) => void,
    private props: Pick<PropInstaller, 'revision' | 'settled'>,
    /** Roots swept for reflective materials at every capture. Props load long after the room is
     * built, so this is how a bottle, a keg or a framed print gets an envMap: the sweep runs
     * again on the capture their arrival already triggers. */
    private reflective: () => Iterable<THREE.Object3D> = () => [],
    /** Where the probe stands. Table height suits the balls, which mostly see cloth; the room's
     * own fittings need one at standing height or they reflect nothing but baize. */
    probeHeight = 0.42,
  ) {
    this.cube = new THREE.WebGLCubeRenderTarget(this.resolution, {
      type: renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.camera = new THREE.CubeCamera(0.06, 95, this.cube);
    this.camera.position.set(0, probeHeight, 0);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    props.settled().then(() => {
      this.settled = true;
    });
  }
  add(material: THREE.MeshStandardMaterial): void {
    this.consumers.add(material);
    if (this.filtered) {
      material.envMap = this.filtered.texture;
      material.needsUpdate = true;
    }
  }
  invalidate(): void {
    this.captured = undefined;
    this.cooldown = 0;
  }
  setResolution(size: 128 | 256): void {
    if (size === this.resolution) return;
    this.resolution = size;
    this.cube.setSize(size, size);
    this.invalidate();
  }
  update(dt: number, idle: boolean): boolean {
    if (this.disposed) return false;
    this.cooldown -= dt;
    this.age += dt;
    if (!idle || this.cooldown > 0 || this.age < 2.1) return false;
    // While props are still arriving, swaps wait for the settled capture rather than
    // causing repeated six-view startup stalls. A hanging request cannot freeze them.
    const revision = this.props.revision,
      settled = this.settled || this.age >= 15;
    if (this.captured !== undefined && (!settled || this.captured === revision)) return false;
    this.capture(this.staticObjects());
    this.captured = revision;
    this.cooldown = 8;
    return true;
  }
  private capture(objects: THREE.Object3D[]): void {
    const renderer = this.renderer,
      target = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace(),
      mip = renderer.getActiveMipmapLevel();
    const automaticShadows = renderer.shadowMap.autoUpdate,
      shadowUpdate = renderer.shadowMap.needsUpdate;
    const allowed = new Set(objects),
      hidden: Array<[THREE.Object3D, boolean]> = [];
    // Root lights still illuminate the room. Gameplay props, cue, balls and
    // overlays are omitted so the balls cannot reflect ghosts or themselves.
    for (const object of this.scene.children)
      if (!allowed.has(object) && !(object instanceof THREE.Light)) {
        hidden.push([object, object.visible]);
        object.visible = false;
      }
    const background = this.scene.background;
    try {
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = false;
      this.scene.background = new THREE.Color('#100d0a');
      this.enclose(() => {
        this.scene.updateMatrixWorld(true);
        this.camera.update(renderer, this.scene);
      });
      const next = this.pmrem.fromCubemap(this.cube.texture);
      for (const root of this.reflective())
        root.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
            if (catchesRoom(material)) this.consumers.add(material);
        });
      for (const material of this.consumers) {
        const first = !material.envMap;
        material.envMap = next.texture;
        if (first) material.needsUpdate = true;
      }
      this.filtered?.dispose();
      this.filtered = next;
    } finally {
      for (const [object, visible] of hidden) object.visible = visible;
      this.scene.background = background;
      renderer.shadowMap.autoUpdate = automaticShadows;
      renderer.shadowMap.needsUpdate = shadowUpdate;
      renderer.setRenderTarget(target, face, mip);
    }
  }
  dispose(): void {
    this.disposed = true;
    for (const material of this.consumers) if (material.envMap === this.filtered?.texture) material.envMap = null;
    this.consumers.clear();
    this.filtered?.dispose();
    this.cube.dispose();
    this.pmrem.dispose();
  }
}
