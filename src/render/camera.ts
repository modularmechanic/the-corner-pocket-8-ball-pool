import * as THREE from 'three';
import { TABLE } from '../simulation/types';
import { EIGHT_BALL_TABLE, type TableSpec } from '../simulation/modes/table';
import { PUB_LAYOUT } from './pub-layout';

export interface OrbitAngles {
  yaw: number;
  pitch: number;
}
const DEG = Math.PI / 180;
/** How close the eye may come to a wall before it would clip through and reveal the outside of the box. */
const ROOM_MARGIN = 0.7;
/** The furthest the eye may travel back along `forward` from `target` and still be inside the room.
 *
 * Framing is analytic: it asks for whatever distance fits the table in view, and a 12-foot slate asks for
 * enough that the eye ends up through a wall, showing the room's exterior and the void behind it. The room
 * is the hard limit, so the framing distance is capped by it rather than the other way round. A table that
 * cannot fit the view from inside the room is cropped, which is the lesser fault by far. */
export function maxDistanceInsideRoom(target: THREE.Vector3, forward: THREE.Vector3): number {
  const { bounds, floor } = PUB_LAYOUT;
  // Only the walls and the floor confine the eye. Rising above the ceiling is deliberate and handled:
  // `pubCutaway` lifts the roof once the camera clears it, so a high orbit looks down into the room
  // rather than at the outside of a box. Clamping vertically would fight that and, on a portrait
  // viewport, no amount of lens widening can fit the table from under a ten-unit ceiling.
  const axes: readonly (readonly [number, number, number])[] = [
    [forward.x, bounds.left + ROOM_MARGIN - target.x, bounds.right - ROOM_MARGIN - target.x],
    [forward.y, floor + ROOM_MARGIN - target.y, Infinity],
    [forward.z, bounds.back + ROOM_MARGIN - target.z, bounds.front - ROOM_MARGIN - target.z],
  ];
  let limit = Infinity;
  for (const [direction, low, high] of axes) {
    // A ray parallel to a pair of walls never meets them.
    if (Math.abs(direction) < 1e-6) continue;
    const reach = direction > 0 ? high / direction : low / direction;
    if (Number.isFinite(reach)) limit = Math.min(limit, reach);
  }
  // Never collapse onto the target: a degenerate distance is worse than a cropped table.
  return Number.isFinite(limit) ? Math.max(1.2, limit) : Infinity;
}
/** The cabinet reaches beyond the playing surface; the legs stand inside it. Both overhangs scale with the slate,
 * exactly as the drawn cabinet does, so a 12-foot table is framed whole instead of cropped to a pub table. */
function boundsOf(spec: TableSpec): THREE.Vector3[] {
  const sx = spec.halfWidth / TABLE.halfWidth,
    sz = spec.halfDepth / TABLE.halfDepth;
  const points: THREE.Vector3[] = [];
  for (const x of [-1, 1])
    for (const z of [-1, 1])
      for (const y of [-1.45, 0.55])
        points.push(new THREE.Vector3(x * (spec.halfWidth + 0.85 * sx), y, z * (spec.halfDepth + 0.83 * sz)));
  for (const x of [-1, 1])
    for (const z of [-1, 1]) points.push(new THREE.Vector3(x * (spec.halfWidth - 0.5 * sx), -3.6, z * spec.halfDepth));
  return points;
}
const boundsCache = new Map<TableSpec, THREE.Vector3[]>();
function framingBounds(spec: TableSpec): THREE.Vector3[] {
  let points = boundsCache.get(spec);
  if (!points) boundsCache.set(spec, (points = boundsOf(spec)));
  return points;
}

export function clampOrbit({ yaw, pitch }: OrbitAngles): OrbitAngles {
  yaw = THREE.MathUtils.euclideanModulo(yaw + Math.PI, Math.PI * 2) - Math.PI;
  // The rear and side walls require a higher sightline; the open front permits side inspection.
  const wallFacing = Math.max(-Math.cos(yaw), Math.abs(Math.sin(yaw)));
  const minimum = (22 + 24 * THREE.MathUtils.smoothstep(wallFacing, 0.35, 0.9)) * DEG;
  return { yaw, pitch: THREE.MathUtils.clamp(pitch, minimum, 78 * DEG) };
}
export function orbitFromDirection(direction: THREE.Vector3): OrbitAngles {
  return clampOrbit({
    yaw: Math.atan2(direction.x, direction.z),
    pitch: Math.atan2(direction.y, Math.hypot(direction.x, direction.z)),
  });
}
export function advanceOrbit(angles: OrbitAngles, dx: number, dy: number): OrbitAngles {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { ...angles };
  return clampOrbit({ yaw: angles.yaw - dx * 0.005, pitch: angles.pitch + dy * 0.004 });
}
export function orbitDirection({ yaw, pitch }: OrbitAngles): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
}
/** Analytic framing keeps the full table visible without iterative projection or render-target work. */
export function fitTableCamera(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  direction: THREE.Vector3,
  aspect: number,
  spec: TableSpec = EIGHT_BALL_TABLE,
): number {
  camera.aspect = aspect;
  camera.up.set(0, 1, 0);
  const forward = direction.clone().normalize(),
    right = new THREE.Vector3().crossVectors(camera.up, forward).normalize(),
    up = new THREE.Vector3().crossVectors(forward, right);
  const tanV = Math.tan((camera.fov * DEG) / 2),
    tanH = tanV * aspect;
  let distance = 8;
  for (const corner of framingBounds(spec)) {
    const offset = corner.clone().sub(target),
      x = offset.dot(right),
      y = offset.dot(up);
    const depth = Math.max(Math.abs(x) / (0.92 * tanH), Math.abs(y) / ((y >= 0 ? 0.8 : 0.86) * tanV));
    distance = Math.max(distance, offset.dot(forward) + depth);
  }
  distance += 0.025;
  // The room is a hard limit: backing out through a wall or the roof shows the outside of the box and the
  // void behind it. When the room binds before the framing does, widen the lens instead of cropping the
  // table — a slightly wider view is a far smaller fault than a cue ball off-screen, and on a narrow
  // portrait viewport the distance that fits the table is always outside the walls.
  const reachable = maxDistanceInsideRoom(target, forward);
  if (distance > reachable) {
    let widest = tanV;
    for (const corner of framingBounds(spec)) {
      const offset = corner.clone().sub(target),
        x = offset.dot(right),
        y = offset.dot(up),
        along = reachable - offset.dot(forward);
      if (along <= 0.05) continue;
      widest = Math.max(widest, Math.abs(y) / ((y >= 0 ? 0.8 : 0.86) * along), Math.abs(x) / (0.92 * aspect * along));
    }
    // Past roughly 100 degrees the distortion is worse than the crop, so stop widening and accept it.
    const limit = Math.tan((100 * DEG) / 2);
    camera.fov = (2 * Math.atan(Math.min(widest, limit))) / DEG;
    distance = reachable;
  }
  camera.far = Math.max(100, distance + 55);
  camera.position.copy(target).addScaledVector(forward, distance);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return distance;
}

export function tableFramingBounds(spec: TableSpec = EIGHT_BALL_TABLE): THREE.Vector3[] {
  return framingBounds(spec).map((point) => point.clone());
}

/** Half extents the overhead views frame: the cabinet, on the mode's own slate. */
export function overheadExtent(spec: TableSpec = EIGHT_BALL_TABLE): { long: number; short: number } {
  return { long: 6.6 * (spec.halfWidth / TABLE.halfWidth), short: 3.72 * (spec.halfDepth / TABLE.halfDepth) };
}

/** The table center stays at the viewport center in both screen orientations. */
export function fitOverheadCamera(
  camera: THREE.OrthographicCamera,
  aspect: number,
  spec: TableSpec = EIGHT_BALL_TABLE,
): void {
  aspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  const portrait = aspect < 1,
    extent = overheadExtent(spec);
  const horizontal = portrait ? extent.short : extent.long,
    vertical = portrait ? extent.long : extent.short;
  const halfHeight = Math.max(vertical / 0.86, horizontal / (aspect * 0.9));
  camera.left = -halfHeight * aspect;
  camera.right = halfHeight * aspect;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  // An exact vertical view needs a horizontal up vector to avoid a singular lookAt.
  camera.up.set(portrait ? 1 : 0, 0, portrait ? 0 : -1);
  camera.position.set(0, 23, 0);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

/** Canvas pixels covered by on-screen controls along each edge. */
export interface ViewportInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
/** Orthographic frustum (world units around the table center) and whether the long table axis runs up the screen. */
export interface OverheadFit {
  rotated: boolean;
  left: number;
  right: number;
  top: number;
  bottom: number;
}
/**
 * Touch overhead framing: the largest table (the same extents as the desktop overhead view) that fits the canvas area the
 * controls leave free, centered in that area. The long axis turns up the screen when that frames the table larger.
 */
export function fitOverheadView(
  width: number,
  height: number,
  insets: ViewportInsets,
  fill = 0.94,
  spec: TableSpec = EIGHT_BALL_TABLE,
): OverheadFit {
  if (!(width > 0 && height > 0)) {
    width = 16;
    height = 9;
  }
  const edge = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);
  // Controls never get more than 85% of an axis: a crowded screen shrinks both sides and keeps the table between them.
  const share = (size: number, a: number, b: number) => {
    const scale = Math.min(1, (size * 0.85) / (a + b || 1));
    return [a * scale, b * scale];
  };
  const [left, right] = share(width, edge(insets.left), edge(insets.right)),
    [top, bottom] = share(height, edge(insets.top), edge(insets.bottom));
  const freeWidth = width - left - right,
    freeHeight = height - top - bottom;
  const { long, short } = overheadExtent(spec);
  const flat = Math.min(freeWidth / (2 * long), freeHeight / (2 * short)),
    upright = Math.min(freeWidth / (2 * short), freeHeight / (2 * long));
  const rotated = upright > flat,
    scale = Math.max(flat, upright) * fill,
    centerX = left + freeWidth / 2,
    centerY = top + freeHeight / 2;
  return {
    rotated,
    left: -centerX / scale,
    right: (width - centerX) / scale,
    top: centerY / scale,
    bottom: -(height - centerY) / scale,
  };
}
export function applyOverheadFit(camera: THREE.OrthographicCamera, fit: OverheadFit): void {
  camera.left = fit.left;
  camera.right = fit.right;
  camera.top = fit.top;
  camera.bottom = fit.bottom;
  camera.up.set(fit.rotated ? 1 : 0, 0, fit.rotated ? 0 : -1);
  camera.position.set(0, 23, 0);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

type ViewCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;
export interface CameraViewSelection {
  overhead: boolean;
  inspection: boolean;
  inspectionPose?: { position: THREE.Vector3; target: THREE.Vector3 };
  orbit: OrbitAngles | null;
  target: THREE.Vector3;
}
/** A held inspection can never overwrite the view to which release returns. */
export class TemporaryCameraView {
  private saved: CameraViewSelection | null = null;
  get active(): boolean {
    return this.saved !== null;
  }
  begin(view: CameraViewSelection): void {
    if (this.saved) return;
    this.saved = {
      ...view,
      orbit: view.orbit ? { ...view.orbit } : null,
      target: view.target.clone(),
      inspectionPose: view.inspectionPose
        ? { position: view.inspectionPose.position.clone(), target: view.inspectionPose.target.clone() }
        : undefined,
    };
  }
  release(): CameraViewSelection | null {
    const result = this.saved;
    this.saved = null;
    return result;
  }
  clear(): void {
    this.saved = null;
  }
}
/** Blend view and projection together, avoiding a hard perspective/orthographic switch. */
export class CameraTransition {
  readonly camera = new THREE.PerspectiveCamera(47, 1, 0.035, 120);
  private source: {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    projection: THREE.Matrix4;
    near: number;
    far: number;
  } | null = null;
  private age = 0;
  private duration = 0.65;
  get active(): boolean {
    return this.source !== null;
  }
  begin(from: ViewCamera, duration = 0.65): void {
    from.updateMatrixWorld(true);
    this.source = {
      position: from.position.clone(),
      quaternion: from.quaternion.clone(),
      projection: from.projectionMatrix.clone(),
      near: from.near,
      far: from.far,
    };
    this.duration = Math.max(0.001, duration);
    this.age = 0;
    this.camera.position.copy(from.position);
    this.camera.quaternion.copy(from.quaternion);
    this.camera.projectionMatrix.copy(from.projectionMatrix);
    this.camera.projectionMatrixInverse.copy(from.projectionMatrixInverse);
    this.camera.updateMatrixWorld(true);
  }
  update(to: ViewCamera, dt: number): void {
    if (!this.source) return;
    this.age += Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    const t = THREE.MathUtils.smootherstep(this.age, 0, this.duration),
      from = this.source;
    this.camera.position.lerpVectors(from.position, to.position, t);
    this.camera.quaternion.copy(from.quaternion).slerp(to.quaternion, t);
    if (t === 1) this.camera.projectionMatrix.copy(to.projectionMatrix);
    else
      for (let i = 0; i < 16; i++)
        this.camera.projectionMatrix.elements[i] = THREE.MathUtils.lerp(
          from.projection.elements[i],
          to.projectionMatrix.elements[i],
          t,
        );
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.camera.near = Math.min(from.near, to.near);
    this.camera.far = Math.max(from.far, to.far);
    this.camera.updateMatrixWorld(true);
    if (t === 1) this.source = null;
  }
}

/** Ray unprojection also supports cameras whose projection is between lens types. */
export function rayFromViewport(camera: ViewCamera, x: number, y: number): THREE.Ray {
  const near = new THREE.Vector3(x, y, -1).unproject(camera),
    far = new THREE.Vector3(x, y, 1).unproject(camera);
  return new THREE.Ray(near, far.sub(near).normalize());
}
