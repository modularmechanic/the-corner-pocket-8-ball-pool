import * as THREE from 'three';

/** A filtered reflection of the actual enclosed pub, shared by the polished balls.
 * Capture only after static assets change; never render six extra views per frame. */
export class RoomReflections {
  private cube: THREE.WebGLCubeRenderTarget;
  private camera: THREE.CubeCamera;
  private pmrem: THREE.PMREMGenerator;
  private filtered?: THREE.WebGLRenderTarget;
  private observed = '';
  private captured = '';
  private checkTime = 0;
  private stableTime = 0;
  private cooldown = 0;
  private disposed = false;
  private resolution = 128;
  private objects: THREE.Object3D[] = [];
  private consumers = new Set<THREE.MeshStandardMaterial>();
  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene,
    private staticObjects: () => THREE.Object3D[], private enclose: (capture: () => void) => void) {
    this.cube = new THREE.WebGLCubeRenderTarget(this.resolution, {
      type: renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType,
      generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    this.camera = new THREE.CubeCamera(.06, 95, this.cube);
    this.camera.position.set(0, .42, 0);
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }
  add(material: THREE.MeshStandardMaterial): void {
    this.consumers.add(material);
    if (this.filtered) { material.envMap = this.filtered.texture; material.needsUpdate = true; }
  }
  invalidate(): void { this.captured = ''; this.checkTime = 0; this.cooldown = 0; }
  setResolution(size:128|256):void {
    if(size===this.resolution)return;
    this.resolution=size;this.cube.setSize(size,size);this.invalidate();
  }
  private fingerprint(objects: THREE.Object3D[]): string {
    let count = 0, shape = 0, loaded = 0;
    const textures = new Set<THREE.Texture>();
    for (const root of objects) root.traverse(object => {
      count++;
      if (!(object instanceof THREE.Mesh)) return;
      shape += object.geometry.id;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const property of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap'] as const) {
          const texture = (material as THREE.MeshStandardMaterial)[property];
          if (texture) textures.add(texture);
        }
      }
    });
    for (const texture of textures) if (texture.image?.width) loaded += texture.image.width + texture.image.height;
    return `${count}:${shape}:${textures.size}:${loaded}`;
  }
  update(dt: number, idle: boolean): boolean {
    if (this.disposed) return false;
    this.checkTime -= dt; this.cooldown -= dt; this.stableTime += dt;
    if (this.checkTime <= 0) {
      this.checkTime = 2;
      this.objects=this.staticObjects();
      const signature = this.fingerprint(this.objects);
      if (signature !== this.observed) { this.observed = signature; this.stableTime = 0; }
    }
    // Wait for two asset checks to agree so several concurrent GLB/texture loads
    // cause one six-view capture, rather than repeated startup stalls.
    if (!idle || this.cooldown > 0 || this.stableTime < 2.1 || this.captured === this.observed) return false;
    this.capture(this.objects); this.captured = this.observed; this.cooldown = 8;return true;
  }
  private capture(objects: THREE.Object3D[]): void {
    const renderer = this.renderer, target = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    const automaticShadows = renderer.shadowMap.autoUpdate, shadowUpdate = renderer.shadowMap.needsUpdate;
    const allowed = new Set(objects), hidden: Array<[THREE.Object3D, boolean]> = [];
    // Root lights still illuminate the room. Gameplay props, cue, balls and
    // overlays are omitted so the balls cannot reflect ghosts or themselves.
    for (const object of this.scene.children) if (!allowed.has(object) && !(object instanceof THREE.Light)) {
      hidden.push([object, object.visible]); object.visible = false;
    }
    const background = this.scene.background;
    try {
      renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
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
      this.filtered?.dispose(); this.filtered = next;
    } finally {
      for (const [object, visible] of hidden) object.visible = visible;
      this.scene.background = background;
      renderer.shadowMap.autoUpdate = automaticShadows; renderer.shadowMap.needsUpdate = shadowUpdate;
      renderer.setRenderTarget(target, face, mip);
    }
  }
  dispose(): void {
    this.disposed = true;
    for (const material of this.consumers) if (material.envMap === this.filtered?.texture) material.envMap = null;
    this.consumers.clear(); this.filtered?.dispose(); this.cube.dispose(); this.pmrem.dispose();
  }
}
