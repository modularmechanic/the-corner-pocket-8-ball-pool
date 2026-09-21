import * as THREE from 'three';

interface Batch {
  mesh: THREE.InstancedMesh;
  matrices: Float32Array;
  colors: Float32Array | null;
  bounds: THREE.Sphere[];
  selected: Int32Array;
  world: THREE.Matrix4;
  valid: boolean;
  castsShadow: boolean;
  layers: number;
}

/** Compacts static instance buffers before Three uploads them. One material still takes one draw,
 * but only instances needed by the view or its shadow maps reach the GPU. Original aggregate
 * bounds stay intact so previously hidden instances can return. Reflection captures restore the
 * complete room. Uses public Three APIs, without GL readbacks or per-instance frame allocations. */
export class InstanceVisibility {
  private batches: Batch[] = [];
  private revision = -1;
  private frusta: THREE.Frustum[] = [];
  private projections: THREE.Matrix4[] = [];
  private layerMasks: number[] = [];
  private projection = new THREE.Matrix4();
  private instance = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  private dirty = true;

  constructor(private root: THREE.Object3D) {}

  private discover(revision: number): void {
    if (revision === this.revision) return;
    this.restore();
    this.batches = [];
    this.root.traverse((object) => {
      if (!(object instanceof THREE.InstancedMesh) || !object.userData.staticInstances || object.morphTexture) return;
      const matrices = new Float32Array(object.instanceMatrix.array);
      if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere();
      const bounds = Array.from({ length: object.count }, (_, index) => {
        this.instance.fromArray(matrices, index * 16);
        return object.geometry.boundingSphere!.clone().applyMatrix4(this.instance);
      });
      object.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      object.instanceColor?.setUsage(THREE.DynamicDrawUsage);
      this.batches.push({
        mesh: object,
        matrices,
        colors: object.instanceColor ? new Float32Array(object.instanceColor.array) : null,
        bounds,
        selected: Int32Array.from(bounds, (_, index) => index),
        world: new THREE.Matrix4(),
        valid: false,
        castsShadow: object.castShadow,
        layers: object.layers.mask,
      });
    });
    this.revision = revision;
  }

  update(camera: THREE.Camera, shadowCameras: readonly THREE.Camera[], revision: number): void {
    this.discover(revision);
    const count = 1 + shadowCameras.length;
    let changed = this.dirty || this.frusta.length !== count;
    this.frusta.length = count;
    for (let index = 0; index < count; index++) {
      const view = index === 0 ? camera : shadowCameras[index - 1];
      this.projection.multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse);
      const previous = this.projections[index] ?? (this.projections[index] = new THREE.Matrix4());
      if (!this.frusta[index] || !previous.equals(this.projection) || this.layerMasks[index] !== view.layers.mask) {
        this.layerMasks[index] = view.layers.mask;
        previous.copy(this.projection);
        (this.frusta[index] ??= new THREE.Frustum()).setFromProjectionMatrix(this.projection);
        changed = true;
      }
    }
    this.root.updateWorldMatrix(true, true);
    for (const batch of this.batches) {
      const { mesh, bounds, selected, matrices, colors } = batch;
      if (
        !changed &&
        batch.valid &&
        batch.world.equals(mesh.matrixWorld) &&
        batch.castsShadow === mesh.castShadow &&
        batch.layers === mesh.layers.mask
      )
        continue;
      batch.castsShadow = mesh.castShadow;
      batch.layers = mesh.layers.mask;
      batch.world.copy(mesh.matrixWorld);
      batch.valid = true;
      let visible = 0,
        upload = false;
      for (let index = 0; index < bounds.length; index++) {
        this.sphere.copy(bounds[index]).applyMatrix4(mesh.matrixWorld);
        let needed = this.frusta[0].intersectsSphere(this.sphere);
        if (mesh.castShadow)
          for (let shadow = 1; !needed && shadow < count; shadow++)
            needed =
              mesh.layers.test(shadowCameras[shadow - 1].layers) && this.frusta[shadow].intersectsSphere(this.sphere);
        if (!needed) continue;
        if (selected[visible] !== index) {
          for (let n = 0; n < 16; n++) mesh.instanceMatrix.array[visible * 16 + n] = matrices[index * 16 + n];
          if (colors && mesh.instanceColor)
            for (let n = 0; n < 3; n++) mesh.instanceColor.array[visible * 3 + n] = colors[index * 3 + n];
          selected[visible] = index;
          upload = true;
        }
        visible++;
      }
      mesh.count = visible;
      if (upload) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    this.dirty = false;
  }

  /** Restore before environment captures or rediscovery after an asset swap. */
  restore(): void {
    for (const batch of this.batches) {
      const { mesh, matrices, colors, bounds, selected } = batch;
      let upload = false;
      for (let index = 0; index < selected.length; index++) {
        if (selected[index] !== index) upload = true;
        selected[index] = index;
      }
      if (upload) {
        mesh.instanceMatrix.array.set(matrices);
        mesh.instanceMatrix.needsUpdate = true;
        if (colors && mesh.instanceColor) {
          mesh.instanceColor.array.set(colors);
          mesh.instanceColor.needsUpdate = true;
        }
      }
      mesh.count = bounds.length;
      batch.valid = false;
    }
    this.dirty = true;
  }

  diagnostics() {
    let total = 0,
      submitted = 0;
    for (const { mesh, bounds } of this.batches) {
      total += bounds.length;
      submitted += mesh.count;
    }
    return { totalInstances: total, submittedInstances: submitted, culledInstances: total - submitted };
  }
}
