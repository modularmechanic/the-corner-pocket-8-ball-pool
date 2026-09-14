import * as THREE from 'three';

export const BUFF_TRAIL_CAPACITY = 12;
const MIN_SPACING = 0.025;

/** The cue ball's glowing overdrive/frost streak: a fixed buffer of recent positions. */
export class BuffTrail {
  readonly line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private positions = new THREE.BufferAttribute(new Float32Array(BUFF_TRAIL_CAPACITY * 3), 3).setUsage(
    THREE.DynamicDrawUsage,
  );
  private count = 0;
  constructor() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', this.positions);
    geometry.setDrawRange(0, 0);
    this.line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color: '#ffbc63',
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    // Its bounds move every frame; a dozen vertices cost less than recomputing them.
    this.line.frustumCulled = false;
    this.line.visible = false;
  }
  push(x: number, y: number, z: number) {
    const array = this.positions.array as Float32Array,
      last = (this.count - 1) * 3;
    if (this.count && Math.hypot(x - array[last], y - array[last + 1], z - array[last + 2]) <= MIN_SPACING) return;
    if (this.count === BUFF_TRAIL_CAPACITY) {
      array.copyWithin(0, 3);
      this.count--;
    }
    this.positions.setXYZ(this.count++, x, y, z);
    this.positions.needsUpdate = true;
    this.line.geometry.setDrawRange(0, this.count);
    this.line.visible = this.count > 1;
  }
  clear() {
    this.count = 0;
    this.line.geometry.setDrawRange(0, 0);
    this.line.visible = false;
  }
}
