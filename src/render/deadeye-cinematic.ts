import * as THREE from 'three';
import { cueBallId, TABLE, type GameState } from '../simulation/types';
import { EIGHT_BALL_TABLE, type TableSpec } from '../simulation/modes/table';

/**
 * The Deadeye super shot, filmed like an action picture: three beats over one shot.
 *
 *   1. STRIKE  a close, low dolly past the tip as it takes the ball, dropping into slow motion.
 *   2. TRAVEL  a broadside overtaking move down the table, slowly picking the pace back up.
 *   3. POT     low into the jaws of the pocket as the ball drops, then straight back to full speed.
 *
 * Like `attractTour`, this module only ever *produces poses*. It writes no camera view state, adds no
 * lights, no passes and no geometry, so whatever the game was framing is still framed the instant the
 * sequence ends and the renderer's own blend covers the hand-back.
 *
 * It never slows the simulation. `timeScale` scales the *wall-clock* seconds handed to the match, which
 * feeds an accumulator that always steps at a fixed `MATCH_STEP`: the same steps run, fewer of them per
 * frame. The trajectory is bit-for-bit the one that would have played at full speed.
 */
export interface DeadeyePose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}
export type DeadeyeBeat = 'strike' | 'travel' | 'pot';

/** Wall-clock seconds each beat holds the camera. `travel` is a ceiling: the pot ends it early. */
export const DEADEYE_BEATS = { strike: 0.9, travel: 3.1, pot: 1.3 } as const;
/** A sequence that never sees a pot gives the camera back rather than hanging on. */
const TRAVEL_GRACE = 1.4;
/** Seconds spent easing from one beat's framing into the next. Beats must flow; a cut between them is the
 * one thing that would make the whole sequence feel cheap. */
const HANDOFF = 0.42;
/** How long before the ball reaches the pocket, in seconds the VIEWER experiences, the last beat takes over.
 * A ball is removed the instant it is potted, so waiting for that would frame an empty pocket. */
const POT_LEAD = 0.75;
/** Over the cloth there is nothing above the slate but the balls, so an eye kept inside the cushions can sit
 * right down on the surface. Off the cloth the cabinet is in the way — rail caps and their brass diamonds top
 * out at 0.24 — so an eye out over the rail rises clear of it instead. The apron is how far past the cushion a
 * shot may back out; at 1.6 the eye is still nowhere near the walls, which is what keeps the room intact. */
const CLOTH_MARGIN = 0.22,
  APRON = 1.6,
  MIN_HEIGHT = 0.26,
  RAIL_CLEARANCE = 0.42,
  MAX_HEIGHT = 1.4;
/** Input that cuts to the end. Captured, so a click on a control skips before that control acts. */
const INTERRUPTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
const LISTENER = { capture: true, passive: true } as const;

const lerp = THREE.MathUtils.lerp,
  ease = (t: number) => THREE.MathUtils.smootherstep(t, 0, 1);

/** What the shot looks like this frame: where the ball of interest is, where it is going, which pocket takes it. */
interface Subject {
  /** The ball the beat is about, damped so a fast ball does not shake the camera. */
  follow: THREE.Vector3;
  /** Unit heading in the x/z plane. */
  dirX: number;
  dirZ: number;
  /** Which side of the line the camera rides: +1 or -1, whichever looks back across the table. */
  side: number;
  pocket: THREE.Vector3 | null;
}

/** The side of `dir` that faces the middle of the table, so the camera has cloth behind the subject. */
function centreSide(x: number, z: number, dirX: number, dirZ: number): number {
  const dot = -dirZ * -x + dirX * -z;
  return dot < 0 ? -1 : 1;
}
/** On or just off the slate, clear of the cabinet, below the light rig. Applied to every pose without exception. */
export function containToTable(point: THREE.Vector3, spec: TableSpec): THREE.Vector3 {
  point.x = THREE.MathUtils.clamp(point.x, -spec.halfWidth - APRON, spec.halfWidth + APRON);
  point.z = THREE.MathUtils.clamp(point.z, -spec.halfDepth - APRON, spec.halfDepth + APRON);
  const overRail =
    Math.abs(point.x) > spec.halfWidth - CLOTH_MARGIN || Math.abs(point.z) > spec.halfDepth - CLOTH_MARGIN;
  point.y = THREE.MathUtils.clamp(point.y, overRail ? RAIL_CLEARANCE : MIN_HEIGHT, MAX_HEIGHT);
  return point;
}

/**
 * How fast the world plays during the sequence. It breathes rather than crawls: it drops hard on the
 * strike, recovers through the travel so the shot is building rather than dragging, snaps down again as
 * the ball reaches the pocket and is fully back to 1 before the camera is handed over.
 */
export function deadeyeTimeScale(beat: DeadeyeBeat, progress: number): number {
  const t = THREE.MathUtils.clamp(progress, 0, 1);
  // The drop has to land ON the contact, not a beat after it: the tip meets the ball in the first frames.
  if (beat === 'strike') return lerp(1, 0.16, ease(Math.min(1, t / 0.12)));
  if (beat === 'travel') return lerp(0.16, 0.42, ease(t));
  if (t < 0.2) return lerp(0.42, 0.12, ease(t / 0.2));
  if (t < 0.62) return 0.12;
  return lerp(0.12, 1, ease((t - 0.62) / 0.38));
}

const perp = { x: 0, z: 0 };
/** Every camera move in the sequence, as a pure function of the beat, its progress and the subject. */
function composeBeat(beat: DeadeyeBeat, progress: number, subject: Subject, spec: TableSpec, out: DeadeyePose): void {
  const t = ease(THREE.MathUtils.clamp(progress, 0, 1)),
    follow = subject.follow,
    ballY = spec.radius;
  let dirX = subject.dirX,
    dirZ = subject.dirZ,
    side = subject.side;
  if (beat === 'pot' && subject.pocket) {
    // The last stretch is composed on the line into the pocket, not the line the ball was struck along,
    // so a cut shot finishes looking down the ball's real path into the jaws.
    const dx = subject.pocket.x - follow.x,
      dz = subject.pocket.z - follow.z,
      length = Math.hypot(dx, dz);
    if (length > 1e-4) {
      dirX = dx / length;
      dirZ = dz / length;
    }
    side = centreSide(subject.pocket.x, subject.pocket.z, dirX, dirZ);
  }
  perp.x = -dirZ * side;
  perp.z = dirX * side;
  if (beat === 'strike') {
    // Close and low on the impact, sliding from just behind the tip to just past the ball. A held stare
    // at a static ball reads as a freeze; the dolly keeps the frame alive while the world slows down.
    const along = lerp(-0.75, 0.05, t),
      lateral = lerp(1.25, 1, t);
    out.position.set(
      follow.x + dirX * along + perp.x * lateral,
      lerp(0.3, 0.42, t),
      follow.z + dirZ * along + perp.z * lateral,
    );
    // The aim leads the ball, but only as far as the lens can hold it: at this distance a longer lead walks
    // the ball straight off the edge of frame, which is what an empty sweep of cloth looks like.
    const lead = lerp(0.06, 0.34, t);
    out.target.set(follow.x + dirX * lead, ballY, follow.z + dirZ * lead);
    out.fov = lerp(46, 39, t);
  } else if (beat === 'travel') {
    // An overtaking move: the camera starts trailing the ball, draws level and ends ahead of it, dropping
    // toward the cloth the whole way. The aim leads the ball, which is what makes it read as a chase.
    const behind = lerp(1.45, -0.35, t),
      lateral = lerp(1.6, 0.95, t);
    out.position.set(
      follow.x - dirX * behind + perp.x * lateral,
      lerp(0.98, 0.52, t),
      follow.z - dirZ * behind + perp.z * lateral,
    );
    const chase = lerp(0.42, 0.25, t);
    out.target.set(follow.x + dirX * chase, ballY, follow.z + dirZ * chase);
    out.fov = lerp(40, 33, t);
  } else {
    // Into the jaws. The eye sits on the slate, short of the pocket and off the ball's line, and sinks to
    // cloth height as the aim follows the ball down out of sight.
    const anchor = subject.pocket ?? follow,
      back = lerp(1.75, 0.95, t),
      lateral = lerp(0.88, 0.44, t);
    out.position.set(
      anchor.x - dirX * back + perp.x * lateral,
      lerp(0.64, 0.34, t),
      anchor.z - dirZ * back + perp.z * lateral,
    );
    out.target.set(anchor.x, lerp(ballY, -0.2, t), anchor.z);
    out.fov = lerp(36, 43, t);
  }
  containToTable(out.position, spec);
}

/** The letterbox and vignette. Pure decoration, owned here, so no pass or effect module is touched. */
class CinemaOverlay {
  private root: HTMLDivElement | null = null;
  private bars: HTMLDivElement[] = [];
  private build(): HTMLDivElement | null {
    if (this.root || typeof document === 'undefined') return this.root;
    const root = document.createElement('div');
    root.className = 'deadeye-cinema';
    root.setAttribute('aria-hidden', 'true');
    root.style.cssText =
      'position:fixed;inset:0;z-index:9;pointer-events:none;opacity:0;' +
      'background:radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 38%, rgba(0,0,0,0.62) 100%);';
    for (const edge of ['top', 'bottom']) {
      const bar = document.createElement('div');
      bar.style.cssText = `position:absolute;left:0;right:0;${edge}:0;height:0;background:#000;`;
      root.appendChild(bar);
      this.bars.push(bar);
    }
    document.body.appendChild(root);
    return (this.root = root);
  }
  /** `amount` is 0 (nothing) to 1 (full letterbox). */
  set(amount: number): void {
    const level = THREE.MathUtils.clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
    const root = level > 0.001 ? this.build() : this.root;
    if (!root) return;
    root.style.opacity = level.toFixed(3);
    const height = `${(level * 7.5).toFixed(2)}vh`;
    for (const bar of this.bars) bar.style.height = height;
  }
}

/** Fields the simulation may or may not expose. Everything here is read defensively. */
type DeadeyeState = Pick<GameState, 'phase' | 'balls' | 'shotCount' | 'seed'> & {
  arcade?: GameState['arcade'];
  lastShot?: GameState['lastShot'];
};

/** True only when the shot now in flight was struck by a player who held deadeye. */
export function deadeyeArmed(state: DeadeyeState | null | undefined): boolean {
  return state?.arcade?.activeShot?.focus === true;
}

class DeadeyeCinematic {
  private beat: DeadeyeBeat | null = null;
  private elapsed = 0;
  /** Set once a pot is seen, so the travel beat knows to hand over. */
  private potted: { id: number; point: THREE.Vector3 } | null = null;
  private spec: TableSpec = EIGHT_BALL_TABLE;
  private readonly subject: Subject = {
    follow: new THREE.Vector3(),
    dirX: 1,
    dirZ: 0,
    side: 1,
    pocket: null,
  };
  private readonly pose: DeadeyePose = {
    position: new THREE.Vector3(),
    target: new THREE.Vector3(),
    fov: 40,
  };
  private readonly overlay = new CinemaOverlay();
  /** The framing the previous beat ended on, eased out of rather than cut away from. */
  private handoff: { position: THREE.Vector3; target: THREE.Vector3; fov: number; age: number } | null = null;
  private readonly seen = new Set<number>();
  /** Everything standing on the cloth, as (x, z, radius) triples, so the eye can be pushed clear of anything
   * it would otherwise end up inside: the balls, and in an arcade rack the pickups and obstacles too. */
  private readonly lie: number[] = [];
  private rolling = false;
  private cue = -1;
  private readonly interrupt = () => this.skip();
  /** Raised when the sequence ends, so the renderer can ease back to the game camera. */
  onStop?: () => void;

  get running(): boolean {
    return this.beat !== null;
  }
  get currentBeat(): DeadeyeBeat | null {
    return this.beat;
  }
  /** Multiply the wall-clock seconds handed to the match by this. Always 1 when nothing is playing. */
  get timeScale(): number {
    if (!this.beat) return 1;
    return deadeyeTimeScale(this.beat, this.progress);
  }
  private get progress(): number {
    if (this.beat === 'travel') {
      // The travel beat is open-ended: it runs until the pot, and its ceiling only decides the framing.
      return Math.min(1, this.elapsed / DEADEYE_BEATS.travel);
    }
    return Math.min(1, this.elapsed / DEADEYE_BEATS[this.beat ?? 'strike']);
  }

  /**
   * Called every frame with the live state. Arms itself the moment a deadeye shot starts rolling, notices
   * the pot, and stands down at the end of the shot. This is the ONLY way the sequence starts: an ordinary
   * shot never sets `arcade.activeShot.focus`, so an ordinary shot can never reach the camera.
   */
  sync(state: DeadeyeState | null | undefined): void {
    if (!state || !Array.isArray(state.balls)) {
      this.rolling = false;
      return this.stop();
    }
    const rolling = state.phase === 'rolling';
    if (rolling && !this.rolling) this.start(state);
    this.rolling = rolling;
    if (!this.beat) return;
    // The pot beat owns its own ending: cutting it because the table happened to settle would be exactly
    // the abrupt cut this sequence exists to avoid. Every earlier beat stands down with the shot.
    if (!rolling && this.beat !== 'pot') return this.stop();
    if (rolling) this.track(state);
  }

  /** Arms the sequence directly. Returns false when the shot is not a deadeye shot. */
  start(state: DeadeyeState): boolean {
    if (this.beat) return true;
    if (!deadeyeArmed(state)) return false;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
    const cue = state.balls[cueBallId(state as GameState)];
    if (!cue || cue.pocketed) return false;
    this.cue = cue.id;
    this.beat = 'strike';
    this.elapsed = 0;
    this.potted = null;
    this.seen.clear();
    for (const ball of state.balls) if (ball?.pocketed) this.seen.add(ball.id);
    this.subject.follow.set(cue.x, TABLE.radius, cue.z);
    this.subject.pocket = null;
    this.headingFrom(cue.vx, cue.vz, state.lastShot?.angle);
    this.subject.side = centreSide(cue.x, cue.z, this.subject.dirX, this.subject.dirZ);
    if (typeof window !== 'undefined')
      for (const type of INTERRUPTS) window.addEventListener(type, this.interrupt, LISTENER);
    return true;
  }

  private headingFrom(vx: number, vz: number, fallback?: number): void {
    const speed = Math.hypot(vx || 0, vz || 0);
    if (speed > 0.05) {
      this.subject.dirX = vx / speed;
      this.subject.dirZ = vz / speed;
    } else if (Number.isFinite(fallback)) {
      this.subject.dirX = Math.cos(fallback!);
      this.subject.dirZ = Math.sin(fallback!);
    }
  }

  /** Reads the ball of interest out of the live state: no simulation field beyond positions is required. */
  private track(state: DeadeyeState): void {
    const balls = state.balls;
    this.lie.length = 0;
    for (const ball of balls) if (ball && !ball.pocketed) this.lie.push(ball.x, ball.z, this.spec.radius);
    const arcade = state.arcade;
    for (const pickup of arcade?.pickups ?? [])
      // A pickup's collision radius is far smaller than the crystal drawn on it, so the eye is kept the
      // width of the prop away rather than the width of its trigger.
      if (pickup?.available) this.lie.push(pickup.x, pickup.z, Math.max(0.62, (pickup.radius || 0) + 0.35));
    for (const obstacle of arcade?.obstacles ?? [])
      if (obstacle) this.lie.push(obstacle.x, obstacle.z, Math.hypot(obstacle.width, obstacle.depth) / 2);
    // A ball that has just gone down, other than the cue ball, is the pot the sequence is building to.
    if (!this.potted)
      for (const ball of balls) {
        if (!ball || !ball.pocketed) continue;
        if (this.seen.has(ball.id)) continue;
        this.seen.add(ball.id);
        if (ball.id === this.cue) continue;
        this.potted = { id: ball.id, point: new THREE.Vector3(ball.x, TABLE.radius, ball.z) };
        break;
      }
    // The strike beat belongs to the cue ball: it is about the tip taking the white. Only once the shot is
    // travelling does the camera hand over to whichever object ball is moving fastest — which on a deadeye
    // shot is the one on its way down. The simulation is free to name the target itself later; nothing here
    // needs it to.
    if (!this.potted) {
      let best: (typeof balls)[number] | null = null,
        bestSpeed = 0.12;
      if (this.beat !== 'strike')
        for (const ball of balls) {
          if (!ball || ball.pocketed || ball.id === this.cue) continue;
          const speed = Math.hypot(ball.vx || 0, ball.vz || 0);
          if (speed > bestSpeed) {
            bestSpeed = speed;
            best = ball;
          }
        }
      const lead = best ?? balls[this.cue];
      if (lead && !lead.pocketed) {
        this.subject.follow.set(lead.x, TABLE.radius, lead.z);
        this.headingFrom(lead.vx, lead.vz);
        this.subject.side = centreSide(lead.x, lead.z, this.subject.dirX, this.subject.dirZ);
      }
      // The last beat has to be in place BEFORE the ball arrives: a potted ball is gone from the table, so
      // a sequence that waited for the pot would cut to an empty pocket. Hand over on the ball's own arrival
      // time, measured in the seconds the viewer will actually experience. Only an object ball earns it —
      // a cue ball running at a pocket is an in-off, the opposite of the shot this is here to celebrate.
      if (this.beat === 'travel' && best) {
        const pocket = this.arrivingPocket(best);
        if (pocket) {
          this.subject.follow.set(best.x, this.spec.radius, best.z);
          this.subject.pocket = pocket;
          this.enter('pot');
        }
      }
      return;
    }
    if (this.beat !== 'pot') {
      this.subject.follow.copy(this.potted.point);
      this.subject.pocket = nearestPocket(this.potted.point, this.spec);
      this.enter('pot');
    }
  }

  /** The pocket this ball is about to reach, or null while it is still too far out to commit to. */
  private arrivingPocket(ball: { x: number; z: number; vx: number; vz: number }): THREE.Vector3 | null {
    const speed = Math.hypot(ball.vx || 0, ball.vz || 0);
    if (speed < 0.4) return null;
    const scale = Math.max(0.1, this.timeScale);
    for (const pocket of this.spec.pockets) {
      const dx = pocket.x - ball.x,
        dz = pocket.z - ball.z,
        distance = Math.hypot(dx, dz);
      // Only a pocket the ball is actually running at, on a line it is close to holding.
      if ((ball.vx * dx + ball.vz * dz) / (speed * (distance || 1)) < 0.94) continue;
      if ((distance - this.spec.pocketRadius) / speed / scale > POT_LEAD) continue;
      return new THREE.Vector3(pocket.x, 0, pocket.z);
    }
    return null;
  }

  /** A close, low camera will occasionally be composed exactly where a ball is sitting. Slide the eye out
   * to the surface of that ball rather than through it: the aim point does not move, so the shot is the
   * same shot, just outside the object instead of inside it. */
  private clearBalls(spec: TableSpec): void {
    const eye = this.pose.position;
    for (let i = 0; i < this.lie.length; i += 3) {
      const x = this.lie[i],
        z = this.lie[i + 1],
        clearance = this.lie[i + 2] + 0.075;
      // Horizontal only: the eye is already held above the cloth, and a prop's footprint is what it can be
      // swallowed by. Rising over a ball instead would lose the low sightline the whole sequence is built on.
      const dx = eye.x - x,
        dz = eye.z - z,
        distance = Math.hypot(dx, dz);
      if (distance >= clearance) continue;
      if (distance < 1e-4) {
        eye.z = z + clearance;
        continue;
      }
      const push = clearance / distance;
      eye.set(x + dx * push, eye.y, z + dz * push);
    }
  }

  /** Moves to the next beat, remembering the framing so the move eases rather than cuts. */
  private enter(beat: DeadeyeBeat): void {
    if (this.beat === beat) return;
    if (this.beat)
      this.handoff = {
        position: this.pose.position.clone(),
        target: this.pose.target.clone(),
        fov: this.pose.fov,
        age: 0,
      };
    this.beat = beat;
    this.elapsed = 0;
  }

  /** Any input cuts straight to the end: nobody should have to sit through this twice. */
  skip(): void {
    this.stop();
  }

  stop(): void {
    if (!this.beat) return;
    this.beat = null;
    this.elapsed = 0;
    this.handoff = null;
    this.potted = null;
    this.subject.pocket = null;
    this.overlay.set(0);
    if (typeof window !== 'undefined')
      for (const type of INTERRUPTS) window.removeEventListener(type, this.interrupt, LISTENER);
    this.onStop?.();
  }

  /**
   * Advances the sequence by one real frame and returns the pose, or null when nothing is playing.
   * `dt` is wall-clock: the camera always moves in real time, only the world is slowed.
   */
  sample(dt: number, spec: TableSpec = EIGHT_BALL_TABLE): DeadeyePose | null {
    if (!this.beat) return null;
    this.spec = spec;
    this.elapsed += Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    if (this.beat === 'strike' && this.elapsed >= DEADEYE_BEATS.strike) {
      this.enter('travel');
    } else if (this.beat === 'travel' && this.elapsed >= DEADEYE_BEATS.travel + TRAVEL_GRACE) {
      // No pot is coming. Give the camera back rather than orbiting a dead table.
      this.stop();
      return null;
    } else if (this.beat === 'pot' && this.elapsed >= DEADEYE_BEATS.pot) {
      this.stop();
      return null;
    }
    composeBeat(this.beat, this.progress, this.subject, spec, this.pose);
    if (this.handoff) {
      this.handoff.age += Math.max(0, Math.min(0.1, dt));
      const blend = THREE.MathUtils.smootherstep(this.handoff.age, 0, HANDOFF);
      this.pose.position.lerpVectors(this.handoff.position, this.pose.position, blend);
      this.pose.target.lerpVectors(this.handoff.target, this.pose.target, blend);
      this.pose.fov = lerp(this.handoff.fov, this.pose.fov, blend);
      if (blend === 1) this.handoff = null;
    }
    // The blend and the push-out both move the eye, so the cabinet rule has the last word either way.
    this.clearBalls(spec);
    containToTable(this.pose.position, spec);
    // The treatment rides the slow motion: deepest where the world is slowest.
    this.overlay.set(THREE.MathUtils.clamp((1 - this.timeScale) * 1.15, 0, 1));
    return this.pose;
  }
}

/** The nearest pocket on the mode's own table, so a snooker or arcade slate is framed on its own jaws. */
function nearestPocket(point: THREE.Vector3, spec: TableSpec): THREE.Vector3 {
  const pockets = spec.pockets;
  let best = pockets[0],
    bestDistance = Infinity;
  for (const pocket of pockets) {
    const distance = Math.hypot(pocket.x - point.x, pocket.z - point.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = pocket;
    }
  }
  return new THREE.Vector3(best.x, 0, best.z);
}

/** One sequence per page: the renderer reads it every frame, the match's own state arms it. */
export const deadeyeCinematic = new DeadeyeCinematic();

/** Pure composition, for checking framing without a renderer. */
export function deadeyePoseAt(
  beat: DeadeyeBeat,
  progress: number,
  subject: { x: number; z: number; angle: number; pocket?: { x: number; z: number } },
  spec: TableSpec = EIGHT_BALL_TABLE,
): DeadeyePose {
  const dirX = Math.cos(subject.angle),
    dirZ = Math.sin(subject.angle);
  const resolved: Subject = {
    follow: new THREE.Vector3(subject.x, spec.radius, subject.z),
    dirX,
    dirZ,
    side: centreSide(subject.x, subject.z, dirX, dirZ),
    pocket: subject.pocket ? new THREE.Vector3(subject.pocket.x, 0, subject.pocket.z) : null,
  };
  const out: DeadeyePose = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 40 };
  composeBeat(beat, progress, resolved, spec, out);
  return out;
}
