import * as THREE from 'three';

/** Movement hysteresis changes render resolution only on transitions. The last accepted pose
 * accumulates sub-threshold motion, including slow high-refresh orbits and camera-parent motion. */
export class MotionResolution {
  private position = new THREE.Vector3();
  private quaternion = new THREE.Quaternion();
  private projection = new THREE.Matrix4();
  private currentPosition = new THREE.Vector3();
  private currentQuaternion = new THREE.Quaternion();
  private worldScale = new THREE.Vector3();
  private started = false;
  private stillFor = Infinity;
  private applied = -1;

  constructor(
    private settleMs = 450,
    private epsilon = 1e-4,
  ) {}

  get moving(): boolean {
    return this.stillFor < this.settleMs;
  }

  sample(camera: THREE.Camera, dtMs: number, motionScale: number): number {
    camera.updateWorldMatrix(true, false);
    camera.matrixWorld.decompose(this.currentPosition, this.currentQuaternion, this.worldScale);
    const moved =
      this.started &&
      (this.position.distanceToSquared(this.currentPosition) > this.epsilon * this.epsilon ||
        1 - Math.abs(this.quaternion.dot(this.currentQuaternion)) > (this.epsilon * this.epsilon) / 8 ||
        this.projection.elements.some(
          (value, i) => Math.abs(value - camera.projectionMatrix.elements[i]) > this.epsilon,
        ));
    if (moved || !this.started) {
      this.position.copy(this.currentPosition);
      this.quaternion.copy(this.currentQuaternion);
      this.projection.copy(camera.projectionMatrix);
    }
    this.started = true;
    this.stillFor = moved ? 0 : this.stillFor + (Number.isFinite(dtMs) ? Math.max(0, dtMs) : 0);
    return this.moving && Number.isFinite(motionScale) ? Math.max(0.1, Math.min(1, motionScale)) : 1;
  }

  shouldApply(scale: number): boolean {
    if (Math.abs(scale - this.applied) < 0.02) return false;
    this.applied = scale;
    return true;
  }

  invalidate(): void {
    this.applied = -1;
  }
}
