import * as THREE from 'three';
import { PUB_LAYOUT } from './pub-layout';
import { EIGHT_BALL_TABLE, type TableSpec } from '../simulation/modes/table';

/** Where the attract camera should be this frame. Positions are world space; `fov` is vertical degrees. */
export interface AttractPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

/**
 * How a shot's horizontal coordinates are read, so a shot survives the room growing or the table changing
 * size. `left`/`right`/`back`/`front` measure inward from that wall, which is exactly how the props on it
 * are placed; `table` measures in half-table widths and depths; `centre` is plain world space.
 */
type XSpace = 'left' | 'right' | 'centre' | 'table';
type ZSpace = 'back' | 'front' | 'centre' | 'table';
type Space = readonly [XSpace, ZSpace];
/** [x, y, z]. Only y is always world space: the floor and ceiling do not move when the room widens. */
type Triple = readonly [number, number, number];

/**
 * One composed shot. A shot either dollies in a straight line (`from` to `to`) or sweeps an arc around a
 * point, and always eases in and out over its whole length, so no move starts or stops abruptly. The aim
 * point travels from `look` to `lookTo` on the same ease.
 */
interface Shot {
  name: string;
  /** What the shot is there to sell, for the report and for anyone re-composing it. */
  subject: string;
  seconds: number;
  fov: number;
  /** Space for the camera path. */
  at: Space;
  /** Space for the aim point. Defaults to the table, which is the room's centre. */
  aim?: Space;
  from?: Triple;
  to?: Triple;
  /** Yaws follow the engine convention, atan2(x, z): 0 looks down +z. The radius is in half-table widths. */
  arc?: { radius: number; height: number; from: number; to: number };
  look: Triple;
  lookTo?: Triple;
}

const DEG = Math.PI / 180;
/** No shot may come closer than this to a wall, the floor or the ceiling. */
const CLEARANCE = 0.9;

/**
 * The tour: a wide of the room, the bar, the hearth, the sports screens, the slot cabinets and jukebox,
 * then the table from a low rake, a slow orbit and a crane out under the pendant lights.
 */
export const ATTRACT_SHOTS: readonly Shot[] = [
  {
    name: 'room',
    subject: 'establishing wide across the snug to the bar',
    seconds: 8,
    fov: 52,
    at: ['left', 'front'],
    aim: ['centre', 'back'],
    from: [4.92, 2.9, 4.1],
    to: [7.72, 2.3, 7.5],
    look: [-1, -0.6, 9.96],
    lookTo: [0.6, -0.5, 7.46],
  },
  {
    name: 'bar',
    subject: 'the back bar, its neon strips and the hand pumps',
    seconds: 7,
    fov: 44,
    at: ['centre', 'back'],
    aim: ['centre', 'back'],
    from: [-7.2, -0.55, 9.56],
    to: [3.6, -0.35, 9.06],
    look: [-5.2, -0.1, 4.56],
    lookTo: [5.6, 0.1, 4.36],
  },
  {
    name: 'hearth',
    subject: 'the stone fireplace and its firelight',
    seconds: 6.5,
    fov: 42,
    at: ['right', 'front'],
    aim: ['right', 'front'],
    from: [10.72, -1.15, 8.3],
    to: [7.92, -0.55, 5.6],
    look: [5.82, -0.9, 1.1],
    lookTo: [5.82, 0.4, 1.1],
  },
  {
    name: 'screens',
    subject: 'the sports televisions and the photo gallery on the right wall',
    seconds: 7,
    fov: 46,
    at: ['right', 'centre'],
    aim: ['right', 'centre'],
    from: [7.72, 0.5, 4.6],
    to: [7.22, 0.9, -3.4],
    look: [1.72, 1.1, 2.6],
    lookTo: [1.72, 1.9, -8.2],
  },
  {
    name: 'arcade',
    subject: 'the slot cabinets and the jukebox on the left wall',
    seconds: 6.5,
    fov: 46,
    at: ['left', 'centre'],
    aim: ['left', 'centre'],
    from: [6.72, -0.7, 8.4],
    to: [6.22, -0.3, 0.6],
    look: [1.52, -0.4, 7.2],
    lookTo: [1.22, -0.6, -1.8],
  },
  {
    name: 'rake',
    subject: 'the lit cloth from cushion height',
    seconds: 6.5,
    fov: 38,
    at: ['table', 'table'],
    aim: ['table', 'table'],
    from: [-1.649, 0.42, -1.509],
    to: [-1.333, 0.62, -1.088],
    look: [0.561, 0.05, 0.386],
    lookTo: [0.246, 0.05, 0.211],
  },
  {
    name: 'orbit',
    subject: 'a slow arc around the whole table under the light rig',
    seconds: 10,
    fov: 44,
    at: ['table', 'table'],
    aim: ['table', 'table'],
    arc: { radius: 1.965, height: 2.2, from: 128 * DEG, to: 52 * DEG },
    look: [0, -0.3, 0],
  },
  {
    name: 'hero',
    subject: 'a crane back from the table to the room',
    seconds: 7.5,
    fov: 47,
    at: ['centre', 'front'],
    aim: ['table', 'table'],
    from: [0.4, 1.4, 6.1],
    to: [-0.4, 3.4, 1.5],
    look: [0, 0.1, -0.21],
    lookTo: [0, 0.9, -1.474],
  },
];

/** Input that must kill the loop at once. Captured so a click on a menu control interrupts before it acts. */
const INTERRUPTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
const LISTENER = { capture: true, passive: true } as const;
const LOOP_SECONDS = ATTRACT_SHOTS.reduce((total, shot) => total + shot.seconds, 0);

function resolveX(value: number, space: XSpace, spec: TableSpec): number {
  const bounds = PUB_LAYOUT.bounds;
  if (space === 'left') return bounds.left + value;
  if (space === 'right') return bounds.right - value;
  if (space === 'table') return value * spec.halfWidth;
  return value;
}
function resolveZ(value: number, space: ZSpace, spec: TableSpec): number {
  const bounds = PUB_LAYOUT.bounds;
  if (space === 'back') return bounds.back + value;
  if (space === 'front') return bounds.front - value;
  if (space === 'table') return value * spec.halfDepth;
  return value;
}
/** The room is the hard limit: no pose may leave it, however the shot was composed or the table resized. */
function clampToRoom(point: THREE.Vector3): THREE.Vector3 {
  const b = PUB_LAYOUT.bounds;
  point.x = THREE.MathUtils.clamp(point.x, b.left + CLEARANCE, b.right - CLEARANCE);
  point.z = THREE.MathUtils.clamp(point.z, b.back + CLEARANCE, b.front - CLEARANCE);
  point.y = THREE.MathUtils.clamp(point.y, PUB_LAYOUT.floor + CLEARANCE * 0.5, b.ceiling - CLEARANCE * 0.5);
  return point;
}

function blankPose(): AttractPose {
  return { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 47 };
}

/** Which shot is on screen at `time` seconds into the loop, and how far through it. */
export function attractShotAt(time: number): { shot: Shot; progress: number } {
  let remaining = THREE.MathUtils.euclideanModulo(Number.isFinite(time) ? time : 0, LOOP_SECONDS);
  for (const shot of ATTRACT_SHOTS) {
    if (remaining < shot.seconds) return { shot, progress: remaining / shot.seconds };
    remaining -= shot.seconds;
  }
  return { shot: ATTRACT_SHOTS[ATTRACT_SHOTS.length - 1], progress: 1 };
}

/** The pose at `time` seconds into the loop. Pure, so the framing can be checked without a renderer. */
export function attractPoseAt(
  time: number,
  spec: TableSpec = EIGHT_BALL_TABLE,
  out: AttractPose = blankPose(),
): AttractPose {
  const { shot, progress } = attractShotAt(time),
    t = THREE.MathUtils.smootherstep(progress, 0, 1);
  const [xSpace, zSpace] = shot.at;
  if (shot.arc) {
    const yaw = THREE.MathUtils.lerp(shot.arc.from, shot.arc.to, t),
      radius = shot.arc.radius * spec.halfWidth;
    out.position.set(Math.sin(yaw) * radius, shot.arc.height, Math.cos(yaw) * radius);
  } else {
    const from = shot.from!,
      to = shot.to ?? from;
    out.position.set(
      resolveX(THREE.MathUtils.lerp(from[0], to[0], t), xSpace, spec),
      THREE.MathUtils.lerp(from[1], to[1], t),
      resolveZ(THREE.MathUtils.lerp(from[2], to[2], t), zSpace, spec),
    );
  }
  const [aimX, aimZ] = shot.aim ?? (['table', 'table'] as const),
    look = shot.look,
    lookTo = shot.lookTo ?? look;
  out.target.set(
    resolveX(THREE.MathUtils.lerp(look[0], lookTo[0], t), aimX, spec),
    THREE.MathUtils.lerp(look[1], lookTo[1], t),
    resolveZ(THREE.MathUtils.lerp(look[2], lookTo[2], t), aimZ, spec),
  );
  clampToRoom(out.position);
  clampToRoom(out.target);
  out.fov = shot.fov;
  return out;
}

/**
 * The arcade attract loop: a cinematic tour of the pub that plays behind an idle menu and ends the instant
 * anyone touches the machine. It only produces camera poses — it adds no lights, no passes and no geometry.
 */
class AttractTour {
  private active = false;
  private time = 0;
  private readonly pose = blankPose();
  private readonly interrupt = () => this.stop();
  /** Called whenever the tour ends, so the renderer can ease back to the game camera. */
  onStop?: () => void;

  get running(): boolean {
    return this.active;
  }
  /** Seconds into the current loop, for stepping the tour by hand. */
  get elapsed(): number {
    return this.time;
  }
  get loopSeconds(): number {
    return LOOP_SECONDS;
  }

  /** Starts the loop. Returns false, and does nothing, when the viewer asked for reduced motion. */
  start(seconds = 0): boolean {
    if (this.active) return true;
    if (typeof window === 'undefined') return false;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
    this.active = true;
    this.time = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    for (const type of INTERRUPTS) window.addEventListener(type, this.interrupt, LISTENER);
    return true;
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    for (const type of INTERRUPTS) window.removeEventListener(type, this.interrupt, LISTENER);
    this.onStop?.();
  }

  /** Advances the loop and returns this frame's pose, or null when the tour is not running. */
  sample(dt: number, spec: TableSpec = EIGHT_BALL_TABLE): AttractPose | null {
    if (!this.active) return null;
    this.time += Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    return attractPoseAt(this.time, spec, this.pose);
  }
  /** Jumps to a point in the loop without restarting it. */
  seek(seconds: number): void {
    if (Number.isFinite(seconds)) this.time = Math.max(0, seconds);
  }
}

/** One tour per page: the renderer reads it every frame, the menu starts and stops it. */
export const attractTour = new AttractTour();
