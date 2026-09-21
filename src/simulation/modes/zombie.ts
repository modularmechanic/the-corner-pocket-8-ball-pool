import { RAIL_RESTITUTION, rollingDeceleration } from '../table-geometry';
import { seededRandom, type Ball, type Obstacle } from '../types';
import { EIGHT_BALL_TABLE, type TableSpec } from './table';

/** Arcade zombie horde, played on the pub table with one cue ball and no object balls, no pockets and no turns.
 *
 * The horde walks up the table towards the player's rail. The player fires the cue ball into it; a body takes a hit
 * and the cue ball caroms off it rather than stopping, so one good line can chain several kills. When the ball comes
 * to rest it is put back on its spot in front of the player's rail and the next shot is on. Let a body reach that
 * spot and the run is over.
 *
 * Determinism: this mode never reads a clock. A shot is a whole number of `ZOMBIE_DT` steps, and every random draw
 * comes from `seededRandom` keyed by seed and wave number, so the RNG carries no state across calls and the same
 * seed replays the same horde step for step. Everything here is a pure function over explicit state — no rendering,
 * no physics world, no callbacks.
 */

/** Fixed simulation step. Wall-clock time never enters this mode. */
export const ZOMBIE_DT = 1 / 120;
/** Cue-ball speed at full power. Low enough that one step can never carry the ball through a body. */
export const MAX_SHOT_SPEED = 17;
/** Below this the ball is at rest and the shot settles. */
export const STILL_SPEED = 0.05;
/** Hard cap on a shot, so a ball that somehow keeps rolling still settles at a fixed step count. */
export const MAX_SHOT_TICKS = 1800;

const T = EIGHT_BALL_TABLE;
/** Where the cue ball sits before every shot, just off the player's rail. */
export const CUE_HOME = { x: -T.halfWidth + 0.9, z: 0 };
/** Placeholder body: the arcade crate obstacle, so the existing arena visuals can draw the horde with no new art.
 * Collision treats it as a disc of `width / 2`; the box is only a render shape. */
const BODY = { width: 0.34, depth: 0.34 } as const;
export const zombieRadius = (zombie: { width: number }): number => zombie.width / 2;
/** Spawn line at the far end, and the grid the horde forms up on. */
const SPAWN_X = T.halfWidth - 0.6,
  ROW_GAP = 0.7,
  COLUMNS = 5,
  LANE = (2 * T.halfDepth - 0.5) / COLUMNS,
  MAX_HORDE = 15;
/** First kill of a shot scores this, the second twice it, the third three times: the combo is the shot's kill count. */
export const KILL_SCORE = 100;
export const WAVE_BONUS = 250;
/** Speed the cue ball keeps when it caroms off a body. */
const CAROM_RESTITUTION = 0.72;

/** A walker. Structurally an arcade `Obstacle` plus its walking speed, so `state.zombies` can be handed straight to
 * anything that already draws obstacles. */
export interface Zombie extends Obstacle {
  /** Table units per second, towards the player's rail (-x). */
  speed: number;
}

export type ZombieEventKind = 'hit' | 'kill' | 'cushion' | 'wave' | 'breach';
export interface ZombieEvent {
  kind: ZombieEventKind;
  x: number;
  z: number;
  /** Impact speed for a hit/kill/cushion, so presentation can size the effect. */
  strength: number;
  zombie?: number;
  /** Kills so far in this shot, on a `kill`. */
  combo?: number;
  points?: number;
  wave?: number;
}

export interface ZombieShot {
  /** Radians; 0 fires up the table towards the horde. */
  angle: number;
  /** 0..1 of `MAX_SHOT_SPEED`. */
  power: number;
}

export interface ZombieState {
  mode: 'zombie';
  seed: string;
  wave: number;
  /** Fixed steps simulated since the run began, and since the current shot was fired. */
  tick: number;
  shotTicks: number;
  phase: 'aim' | 'rolling' | 'over';
  cue: Ball;
  zombies: Zombie[];
  /** Ids never repeat across waves, so a renderer can key visuals by id. */
  nextId: number;
  kills: number;
  score: number;
  shots: number;
  /** Kills in the shot in progress, and the best any single shot has managed. */
  combo: number;
  bestCombo: number;
  lastShot: ZombieShot | null;
  /** Events raised by the most recent step only; `resolveShot` accumulates them across a whole shot. */
  events: ZombieEvent[];
  message: string;
}

/** Wave `n` puts more bodies on the table, walking faster and taking more hits, until each curve caps out. */
export const hordeSize = (wave: number): number => Math.min(MAX_HORDE, 4 + wave);
export const hordeSpeed = (wave: number): number => Math.min(1.2, 0.35 + 0.05 * (wave - 1));
export const hordeHp = (wave: number): number => Math.min(4, 1 + Math.floor((wave - 1) / 3));

/** The wave formed up on the spawn grid, jittered by the seeded generator. Grid spacing exceeds the body plus the
 * jitter on both axes, so a wave can never spawn overlapping itself however the draws land. */
export function spawnWave(seed: string, wave: number, firstId = 0): Zombie[] {
  const random = seededRandom(`${seed}:horde:${wave}`);
  const count = hordeSize(wave),
    hp = hordeHp(wave),
    speed = hordeSpeed(wave);
  const zombies: Zombie[] = [];
  for (let index = 0; index < count; index++) {
    const row = Math.floor(index / COLUMNS),
      column = index % COLUMNS;
    const jitterX = (random() - 0.5) * 0.24,
      jitterZ = (random() - 0.5) * 0.36;
    zombies.push({
      id: firstId + index,
      x: SPAWN_X - row * ROW_GAP + jitterX,
      z: (column - (COLUMNS - 1) / 2) * LANE + jitterZ,
      ...BODY,
      hp,
      maxHp: hp,
      material: hp >= 3 ? 'steel' : hp === 2 ? 'hex' : 'wood',
      speed,
    });
  }
  return zombies;
}

/** The cue ball on its spot. There are no object balls, so this is the whole rack. The seed is unused but kept in
 * the signature so the mode racks like every other one. */
export function zombieRack(_seed?: string): Ball[] {
  return [{ id: 0, ...CUE_HOME, vx: 0, vz: 0, pocketed: false }];
}

export function initialZombieState(seed: string): ZombieState {
  const zombies = spawnWave(seed, 1);
  return {
    mode: 'zombie',
    seed,
    wave: 1,
    tick: 0,
    shotTicks: 0,
    phase: 'aim',
    cue: zombieRack(seed)[0],
    zombies,
    nextId: zombies.length,
    kills: 0,
    score: 0,
    shots: 0,
    combo: 0,
    bestCombo: 0,
    lastShot: null,
    events: [],
    message: 'Wave 1 is coming. Fire.',
  };
}

/** A body that has walked far enough to touch the cue ball's spot has reached the player's rail. */
export const breached = (zombie: Zombie): boolean => zombie.x - zombieRadius(zombie) <= CUE_HOME.x + T.radius;

/** Put the cue ball in motion. Ignored unless the run is waiting for a shot, and a shot with no pace on it is not a
 * shot: power is clamped and non-finite input is rejected rather than poisoning the state with NaN. */
export function fire(input: ZombieState, shot: ZombieShot): ZombieState {
  if (input.phase !== 'aim') return input;
  const power = Number.isFinite(shot.power) ? Math.min(1, Math.max(0, shot.power)) : 0;
  const angle = Number.isFinite(shot.angle) ? shot.angle : 0;
  const speed = MAX_SHOT_SPEED * power;
  if (speed <= STILL_SPEED) return input;
  const state = structuredClone(input);
  state.cue.vx = Math.cos(angle) * speed;
  state.cue.vz = Math.sin(angle) * speed;
  state.phase = 'rolling';
  state.shotTicks = 0;
  state.shots++;
  state.combo = 0;
  state.lastShot = { angle, power };
  state.events = [];
  state.message = 'Rolling.';
  return state;
}

function cushions(state: ZombieState): void {
  const cue = state.cue,
    limitX = T.halfWidth - T.radius,
    limitZ = T.halfDepth - T.radius;
  // No pockets in this mode: the cushions run unbroken, so the ball always comes back.
  if (cue.x < -limitX && cue.vx < 0) bounceX(state, -limitX);
  else if (cue.x > limitX && cue.vx > 0) bounceX(state, limitX);
  if (cue.z < -limitZ && cue.vz < 0) bounceZ(state, -limitZ);
  else if (cue.z > limitZ && cue.vz > 0) bounceZ(state, limitZ);
}
function bounceX(state: ZombieState, edge: number): void {
  const cue = state.cue;
  state.events.push({ kind: 'cushion', x: edge, z: cue.z, strength: Math.abs(cue.vx) });
  cue.x = edge;
  cue.vx = -cue.vx * RAIL_RESTITUTION;
}
function bounceZ(state: ZombieState, edge: number): void {
  const cue = state.cue;
  state.events.push({ kind: 'cushion', x: cue.x, z: edge, strength: Math.abs(cue.vz) });
  cue.z = edge;
  cue.vz = -cue.vz * RAIL_RESTITUTION;
}

/** Carom the cue ball off a body and take a hit point off it. The ball keeps going: it is reflected about the
 * contact normal and lifted clear of the body, never stopped dead. */
function strike(state: ZombieState, zombie: Zombie): void {
  const cue = state.cue,
    sum = T.radius + zombieRadius(zombie);
  const speed = Math.hypot(cue.vx, cue.vz);
  let dx = cue.x - zombie.x,
    dz = cue.z - zombie.z,
    distance = Math.hypot(dx, dz);
  if (distance === 0) {
    // Dead centre: come back the way the ball arrived, or straight down the table if it arrived at rest.
    [dx, dz, distance] = speed > 0 ? [-cue.vx, -cue.vz, speed] : [-1, 0, 1];
  }
  const ux = dx / distance,
    uz = dz / distance;
  cue.x = zombie.x + ux * sum;
  cue.z = zombie.z + uz * sum;
  const along = cue.vx * ux + cue.vz * uz;
  if (along < 0) {
    cue.vx = (cue.vx - 2 * along * ux) * CAROM_RESTITUTION;
    cue.vz = (cue.vz - 2 * along * uz) * CAROM_RESTITUTION;
  }
  zombie.hp--;
  if (zombie.hp > 0) {
    state.events.push({ kind: 'hit', x: zombie.x, z: zombie.z, strength: speed, zombie: zombie.id });
    return;
  }
  state.combo++;
  state.kills++;
  const points = KILL_SCORE * state.combo;
  state.score += points;
  if (state.combo > state.bestCombo) state.bestCombo = state.combo;
  state.events.push({
    kind: 'kill',
    x: zombie.x,
    z: zombie.z,
    strength: speed,
    zombie: zombie.id,
    combo: state.combo,
    points,
  });
}

/** Rack the next wave, bank the clearance bonus and put the cue ball back on its spot. */
function settle(state: ZombieState): void {
  Object.assign(state.cue, CUE_HOME, { vx: 0, vz: 0 });
  if (state.zombies.length === 0) {
    state.score += WAVE_BONUS * state.wave;
    state.wave++;
    const next = spawnWave(state.seed, state.wave, state.nextId);
    state.zombies = next;
    state.nextId += next.length;
    state.events.push({ kind: 'wave', x: SPAWN_X, z: 0, strength: next.length, wave: state.wave });
    state.message = `Wave ${state.wave}. ${next.length} of them.`;
  } else {
    state.message = `${state.zombies.length} still standing.`;
  }
  state.phase = 'aim';
}

/** Advance the run by exactly one fixed step. A no-op unless a shot is in flight, so a caller can drive this from a
 * render loop without the horde ever moving on its own. */
export function step(input: ZombieState): ZombieState {
  if (input.phase !== 'rolling') return input;
  const state = structuredClone(input);
  state.events = [];
  state.tick++;
  state.shotTicks++;

  const cue = state.cue;
  cue.x += cue.vx * ZOMBIE_DT;
  cue.z += cue.vz * ZOMBIE_DT;
  cushions(state);
  // The horde only walks while a shot is in flight, so the whole run advances in these fixed steps and nowhere else.
  for (const zombie of state.zombies) zombie.x -= zombie.speed * ZOMBIE_DT;
  // Id order, so several bodies in contact on the same step always resolve the same way.
  for (const zombie of state.zombies)
    if (Math.hypot(cue.x - zombie.x, cue.z - zombie.z) < T.radius + zombieRadius(zombie)) strike(state, zombie);
  state.zombies = state.zombies.filter((zombie) => zombie.hp > 0);

  const speed = Math.hypot(cue.vx, cue.vz);
  const drop = rollingDeceleration(speed) * ZOMBIE_DT;
  const slowed = Math.max(0, speed - drop);
  if (speed > 0) {
    cue.vx *= slowed / speed;
    cue.vz *= slowed / speed;
  }

  const over = state.zombies.find(breached);
  if (over) {
    state.events.push({ kind: 'breach', x: over.x, z: over.z, strength: over.speed, zombie: over.id });
    state.phase = 'over';
    Object.assign(cue, { vx: 0, vz: 0 });
    state.message = `They got through on wave ${state.wave}. ${state.score} points, ${state.kills} down.`;
  } else if (slowed <= STILL_SPEED || state.shotTicks >= MAX_SHOT_TICKS) settle(state);
  return state;
}

export interface ZombieShotOutcome {
  state: ZombieState;
  /** Every event of the shot, in step order. */
  events: ZombieEvent[];
  /** Fixed steps the shot took. Purely a function of the state and the shot: no clock is involved. */
  ticks: number;
}

/** Fire and run the shot out to rest. This is the differential-fixture entry point: state in, shot in, state out. */
export function resolveShot(input: ZombieState, shot: ZombieShot): ZombieShotOutcome {
  let state = fire(input, shot);
  const events: ZombieEvent[] = [];
  let ticks = 0;
  while (state.phase === 'rolling') {
    state = step(state);
    events.push(...state.events);
    ticks++;
  }
  return { state, events, ticks };
}

/** Structurally like `GameModeSpec` where the seam fits — id, label, table, initialState, rack — and carrying its own
 * shot loop where it does not. Deliberately not typed as `GameModeSpec` and deliberately not registered in `MODES`:
 * `initialState` returns a `ZombieState` rather than a `GameState`, `legalTargets` answers with bodies rather than
 * balls, and there is no `settle(state, ShotResult, SettlementContext)` because nothing else simulates the shot —
 * `resolveShot` is both the physics and the settlement. */
export const ZOMBIE_MODE = {
  id: 'zombie' as const,
  label: 'Zombie Horde',
  table: EIGHT_BALL_TABLE as TableSpec,
  dt: ZOMBIE_DT,
  initialState: initialZombieState,
  rack: zombieRack,
  legalTargets: (state: ZombieState): Zombie[] => state.zombies,
  fire,
  step,
  resolveShot,
};
