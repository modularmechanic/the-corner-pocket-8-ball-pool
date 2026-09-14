import * as THREE from 'three';
import type { PropInstaller } from './asset-installer';

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
  ) {
    this.cube = new THREE.WebGLCubeRenderTarget(this.resolution, {
      type: renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.camera = new THREE.CubeCamera(0.06, 95, this.cube);
    this.camera.position.set(0, 0.42, 0);
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
