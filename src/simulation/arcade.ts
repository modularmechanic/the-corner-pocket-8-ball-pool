import { MAX_LEVEL, normalizeLevel } from './level-policy';
import {
  newRack,
  seededRandom,
  type ArcadeState,
  type FrostMark,
  type ScorchMark,
  type ArenaLayout,
  type Obstacle,
  type PlayerBuffs,
  type PowerUp,
  type Hazard,
  type GameState,
  type Pickup,
  TABLE,
} from './types';
import {
  isClearLayoutBlock,
  isClearLayoutHazard,
  isClearLayoutPickup,
  isClearPickupSpawn,
  isClearPortalSpawn,
} from './table-geometry';
export const LAYOUTS: Record<
  ArenaLayout,
  { name: string; blocks: [number, number, number, number, number, Obstacle['material']][] }
> = {
  crossfire: {
    name: 'Crossfire',
    blocks: [
      [-0.4, -1.15, 0.32, 1.12, 2, 'wood'],
      [0.65, -1.65, 1, 0.28, 1, 'wood'],
      [0.65, 1.65, 1, 0.28, 1, 'wood'],
      [-3.6, -1.9, 0.72, 0.3, 1, 'wood'],
      [-3.6, 1.9, 0.72, 0.3, 1, 'wood'],
      [4.8, -1.65, 0.3, 0.72, 3, 'steel'],
      [4.8, 1.65, 0.3, 0.72, 3, 'steel'],
    ],
  },
  fortress: {
    name: 'Fortress',
    blocks: [
      [0.75, -0.95, 0.28, 0.95, 3, 'steel'],
      [0.75, 0.95, 0.28, 0.95, 3, 'steel'],
      [2.05, -1.85, 1.15, 0.3, 2, 'wood'],
      [2.05, 1.85, 1.15, 0.3, 2, 'wood'],
      [4.1, -1.85, 1.1, 0.3, 4, 'steel'],
      [4.1, 1.85, 1.1, 0.3, 4, 'steel'],
      [-2.7, -2.2, 1.05, 0.26, 1, 'wood'],
      [-2.7, 2.2, 1.05, 0.26, 1, 'wood'],
    ],
  },
  gauntlet: {
    name: 'Hex Gauntlet',
    blocks: [
      [-1.1, -1.1, 0.35, 1, 2, 'hex'],
      [0.25, 1.1, 0.35, 1, 2, 'hex'],
      [1.5, -1.15, 0.32, 0.9, 3, 'steel'],
      [-3.8, 1.75, 0.85, 0.3, 1, 'wood'],
      [3.35, -2.05, 0.95, 0.32, 2, 'hex'],
      [3.35, 2.05, 0.95, 0.32, 2, 'hex'],
      [4.85, 0, 0.28, 1.2, 4, 'steel'],
    ],
  },
  // Open water down the middle and a slime pocket in the corner; fewer, lighter blocks so the drag terrain itself
  // is the obstacle.
  riptide: {
    name: 'Riptide',
    blocks: [
      [-2.6, -2.0, 0.9, 0.3, 1, 'wood'],
      [-2.6, 2.0, 0.9, 0.3, 1, 'wood'],
      [2.2, -1.3, 0.32, 1.0, 2, 'steel'],
      [2.2, 1.3, 0.32, 1.0, 2, 'steel'],
      [4.6, 0, 0.3, 1.3, 3, 'steel'],
    ],
  },
  // A steel chokepoint maze: electric pads guard both approaches to the middle lane, with a ramp as the one clean
  // bypass.
  livewire: {
    name: 'Live Wire',
    blocks: [
      [1.0, -1.0, 0.3, 1.0, 3, 'steel'],
      [1.0, 1.0, 0.3, 1.0, 3, 'steel'],
      [-1.3, 0, 0.3, 0.9, 2, 'steel'],
      [3.6, -1.9, 0.9, 0.3, 2, 'wood'],
      [3.6, 1.9, 0.9, 0.3, 2, 'wood'],
      [-4.3, -1.3, 0.3, 0.9, 4, 'steel'],
      [-4.3, 1.3, 0.3, 0.9, 4, 'steel'],
    ],
  },
  // A hex block maze veiled by two smoke clouds in opposite corners, with a single electric pad guarding the
  // centre.
  blackout: {
    name: 'Blackout',
    blocks: [
      [-0.8, -1.3, 0.35, 0.95, 2, 'hex'],
      [-0.8, 1.3, 0.35, 0.95, 2, 'hex'],
      [1.8, 0, 0.3, 1.1, 3, 'hex'],
      [-3.4, 0, 0.3, 0.9, 2, 'wood'],
      [4.4, -1.7, 0.9, 0.3, 3, 'steel'],
      [4.4, 1.7, 0.9, 0.3, 3, 'steel'],
    ],
  },
};
export const HAZARDS: Record<ArenaLayout, Omit<Hazard, 'id'>[]> = {
  crossfire: [
    { kind: 'ramp', x: -1.2, z: 1.15, radius: 0.58, angle: 0 },
    { kind: 'water', x: 2, z: -1.65, radius: 0.65 },
    { kind: 'smoke', x: -4.4, z: -1.2, radius: 0.5 },
  ],
  fortress: [
    { kind: 'electric', x: -1.1, z: -1.45, radius: 0.55 },
    { kind: 'electric', x: 4.7, z: 0.85, radius: 0.45 },
    { kind: 'water', x: -3.9, z: 1.05, radius: 0.75 },
    { kind: 'smoke', x: 1.9, z: 1.15, radius: 0.55 },
    { kind: 'ramp', x: -0.6, z: 1.25, radius: 0.52, angle: 0 },
  ],
  gauntlet: [
    { kind: 'slime', x: -2.9, z: 1.5, radius: 0.65 },
    { kind: 'smoke', x: 2.6, z: -1.15, radius: 0.6 },
    { kind: 'electric', x: 0.1, z: -1.45, radius: 0.45 },
  ],
  riptide: [
    { kind: 'water', x: -1.0, z: 0, radius: 0.7 },
    { kind: 'slime', x: 1.4, z: -1.8, radius: 0.6 },
    { kind: 'ramp', x: -3.9, z: 1.4, radius: 0.55, angle: 0 },
  ],
  livewire: [
    { kind: 'electric', x: 0, z: -1.5, radius: 0.5 },
    { kind: 'electric', x: 0, z: 1.5, radius: 0.5 },
    { kind: 'ramp', x: -2.5, z: 0, radius: 0.5, angle: 0 },
  ],
  blackout: [
    { kind: 'smoke', x: -2.0, z: -1.6, radius: 0.6 },
    { kind: 'smoke', x: 2.6, z: 1.6, radius: 0.6 },
    { kind: 'electric', x: 0, z: 0, radius: 0.45 },
  ],
};
export function createArcade(layout: ArenaLayout = 'crossfire', seed = 'house', level = 1): ArcadeState {
  level = normalizeLevel(level);
  const random = seededRandom(seed + ':arena:' + layout + ':' + level),
    balls = newRack(seed),
    mirror = random() < 0.5 ? -1 : 1;
  const buffs = (): PlayerBuffs => ({ overdrive: 0, frozen: 0, ward: 0, focus: 0, jammed: 0, sticky: 0 });
  const state: ArcadeState = {
    layout,
    level,
    portalTurns: 0,
    clock: 0,
    obstacles: [],
    hazards: [],
    pickups: [],
    scores: [0, 0],
    combo: 0,
    buffs: [buffs(), buffs()],
    destroyed: [0, 0],
    scratchStreak: [0, 0],
    potStreak: [0, 0],
    activeShot: { overdrive: false, frozen: false, ward: false, focus: false, sticky: false },
  };
  // Keep a guaranteed corridor from the cue ball to the rack. Every generated
  // object is also checked against the initial balls and all existing props.
  function position(baseX: number, baseZ: number, valid: (x: number, z: number) => boolean) {
    for (let attempt = 0; attempt < 600; attempt++) {
      const x = attempt < 36 ? baseX + (random() - 0.5) * 1.15 : (random() - 0.5) * 10.4;
      const z = attempt < 36 ? baseZ * mirror + (random() - 0.5) * 0.75 : (random() - 0.5) * 4.8;
      if (valid(x, z)) return { x, z };
    }
    throw new Error('Could not generate a clear table layout.');
  }
  for (const [baseX, baseZ, width, depth, baseHp, baseMaterial] of LAYOUTS[layout].blocks.slice(0, level)) {
    const material = level <= 2 ? 'wood' : baseMaterial;
    const hp = level === 1 ? 1 : Math.min(level, baseHp + (level === MAX_LEVEL ? 1 : 0));
    const p = position(baseX, baseZ, (x, z) => isClearLayoutBlock(state, balls, { x, z, width, depth }));
    state.obstacles.push({ id: state.obstacles.length, ...p, width, depth, hp, maxHp: hp, material });
  }
  for (const hazard of HAZARDS[layout].slice(0, Math.min(3, level - 1))) {
    const p = position(hazard.x, hazard.z, (x, z) =>
      isClearLayoutHazard(state, balls, { x, z, radius: hazard.radius }),
    );
    state.hazards.push({
      ...hazard,
      ...p,
      id: state.hazards.length,
      angle: hazard.kind === 'ramp' ? (random() - 0.5) * 0.7 : hazard.angle,
    });
  }
  for (let id = 0; id < 2; id++) {
    const radius = 0.16,
      p = position((id % 2 ? 1 : -1) * 2, (id < 2 ? 1 : -1) * 1.2, (x, z) =>
        isClearLayoutPickup(state, balls, { x, z }, radius),
      );
    state.pickups.push(makePickup(seed, id, p.x, p.z, 0));
  }
  return state;
}
export function makePickup(seed: string, id: number, x: number, z: number, clock: number): Pickup {
  const random = seededRandom(seed + ':pickup:' + id);
  const choices: PowerUp[] = ['overdrive', 'frost', 'ward', 'focus', 'portal'];
  return {
    id,
    x,
    z,
    radius: 0.16,
    available: true,
    power: choices[Math.floor(random() * choices.length)],
    expiresAt: clock + 12 + random() * 8,
  };
}
export function pickupPosition(state: GameState, random: () => number): { x: number; z: number } | undefined {
  const a = state.arcade;
  if (!a) return;
  for (let attempt = 0; attempt < 300; attempt++) {
    const x = (random() - 0.5) * 10.1,
      z = (random() - 0.5) * 4.5;
    if (!isClearPickupSpawn(state, { x, z })) continue;
    return { x, z };
  }
}
/** Create the collected portal reward only after the acquisition shot settles. */
export function spawnTemporaryPortals(state: GameState): boolean {
  const arena = state.arcade;
  if (!arena || state.winner !== null) return false;
  const terrain = arena.hazards.filter((h) => h.kind !== 'portal');
  const random = seededRandom(state.seed + ':portals:' + state.shotCount),
    radius = 0.34;
  const points: { x: number; z: number }[] = [];
  const clear = (x: number, z: number) => isClearPortalSpawn(state, { x, z }, radius, points);
  for (const side of [-1, 1]) {
    let point: { x: number; z: number } | undefined;
    for (let attempt = 0; attempt < 400; attempt++) {
      const x = side * (1 + random() * 3.6),
        z = (random() - 0.5) * 4.1;
      if (clear(x, z)) {
        point = { x, z };
        break;
      }
    }
    if (!point)
      for (let x = -4.7; x < 4.8 && !point; x += 0.3)
        for (let z = -2.1; z < 2.2; z += 0.3)
          if (clear(x, z)) {
            point = { x, z };
            break;
          }
    if (!point) return false;
    points.push(point);
  }
  const firstId = Math.max(-1, ...arena.hazards.map((h) => h.id)) + 1;
  arena.hazards = [
    ...terrain,
    { id: firstId, kind: 'portal', ...points[0], radius, link: firstId + 1 },
    { id: firstId + 1, kind: 'portal', ...points[1], radius, link: firstId },
  ];
  arena.portalTurns = 2;
  return true;
}

// --- Cloth marks ---------------------------------------------------------------------
// Overdrive burns the cloth and frost ices it. Both live on `ArcadeState` so they travel with a
// snapshot and replay exactly, both decay on the same fixed clock the pickups use, and both are
// capped so a long rack cannot grow them without limit.
/** Marks kept per kind. The oldest is dropped when a new one would exceed this. */
export const MARK_LIMIT = 24;
/** Metres the cue ball must travel before it lays down the next mark. */
export const MARK_SPACING = 0.34;
export const BURN_RADIUS = 0.26;
/** Seconds a fresh scorch takes to cool to nothing. Longer than a visit: the table carries the damage. */
export const BURN_COOLING = 42;
/** Rolling drag multiplier at the centre of the freshest scorch. */
export const BURN_DRAG = 1.75;
export const FROST_RADIUS = 0.24;
/** Seconds fresh ice takes to evaporate. */
export const FROST_MELT = 11;
/** Fresh ice is slippery: it takes this fraction off the drag of a ball crossing it. */
export const FROST_SLIDE = 0.3;
/** How much heavier a frozen cue ball is on the cloth. */
export const FROST_CUE_DRAG = 1.9;
/** A frozen cue ball comes off cushions and object balls dead (an ordinary ball is 0.96). */
export const FROST_RESTITUTION = 0.45;
/** Pockets a ward may turn one shot's balls away from before the shield is spent. Without the cap a
 * shielded ball could sit in a pocket mouth bouncing out forever and the shot would never settle. */
export const WARD_DEFLECTS = 6;

/** Drag multiplier the cloth marks apply at a point: scorches slow a ball, ice lets it slide. */
export function markDrag(arcade: ArcadeState | undefined, x: number, z: number): number {
  if (!arcade?.burns?.length && !arcade?.frost?.length) return 1;
  let burn = 1,
    ice = 1;
  for (const mark of arcade.burns ?? [])
    if (Math.hypot(x - mark.x, z - mark.z) < mark.radius) burn = Math.max(burn, 1 + mark.heat * (BURN_DRAG - 1));
  for (const mark of arcade.frost ?? [])
    if (Math.hypot(x - mark.x, z - mark.z) < FROST_RADIUS) ice = Math.min(ice, 1 - mark.life * FROST_SLIDE);
  return burn * ice;
}
/** Lay a mark where the cue ball is, unless it is still on top of the last one. */
export function addMark(
  arcade: ArcadeState,
  kind: 'burns' | 'frost',
  x: number,
  z: number,
  angle?: number,
): void {
  const list = kind === 'burns' ? (arcade.burns ??= []) : (arcade.frost ??= []);
  const last: { x: number; z: number } | undefined = list[list.length - 1];
  if (last && Math.hypot(x - last.x, z - last.z) < MARK_SPACING) return;
  // One id space for both kinds, taken from the marks that exist: no counter to carry through a snapshot.
  const id = 1 + Math.max(-1, ...(arcade.burns ?? []).map((m) => m.id), ...(arcade.frost ?? []).map((m) => m.id));
  if (kind === 'burns') (list as ScorchMark[]).push({ id, x, z, radius: BURN_RADIUS, heat: 1, angle });
  else (list as FrostMark[]).push({ id, x, z, life: 1 });
  if (list.length > MARK_LIMIT) list.shift();
}
/** Cool the scorches and melt the ice by one tick of the arcade clock, dropping whatever is spent. */
export function decayMarks(arcade: ArcadeState, dt: number): void {
  if (arcade.burns?.length) {
    for (const mark of arcade.burns) mark.heat = Math.max(0, mark.heat - dt / BURN_COOLING);
    arcade.burns = arcade.burns.filter((mark) => mark.heat > 0);
  }
  if (arcade.frost?.length) {
    for (const mark of arcade.frost) mark.life = Math.max(0, mark.life - dt / FROST_MELT);
    arcade.frost = arcade.frost.filter((mark) => mark.life > 0);
  }
}
/** Keep only marks a rebuilt table can use: finite, on the felt, within their 0..1 range, within the cap. */
export function sanitizeMarks(arcade: ArcadeState): void {
  const onFelt = (m: { x: number; z: number }) =>
    Number.isFinite(m.x) &&
    Number.isFinite(m.z) &&
    Math.abs(m.x) < TABLE.halfWidth + 1 &&
    Math.abs(m.z) < TABLE.halfDepth + 1;
  const level = (value: unknown) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value as number)) : 0);
  if (arcade.burns)
    arcade.burns = arcade.burns
      .filter((m) => onFelt(m) && level(m.heat) > 0)
      .map((m) => ({ ...m, heat: level(m.heat), radius: Number.isFinite(m.radius) ? m.radius : BURN_RADIUS }))
      .slice(-MARK_LIMIT);
  if (arcade.frost)
    arcade.frost = arcade.frost
      .filter((m) => onFelt(m) && level(m.life) > 0)
      .map((m) => ({ ...m, life: level(m.life) }))
      .slice(-MARK_LIMIT);
}

// --- Ramp geometry -------------------------------------------------------------------
// A ramp is a real wedge, not a trigger zone. These few numbers are the single source of
// truth: game.ts feeds rampCorners() to a Rapier convex hull, arena-visuals.ts builds the
// visible mesh from the same corners, so what you see is exactly what the ball touches.
/** Crest height above the cloth. Just under a ball diameter, so a hop over it reads clearly. */
export const RAMP_HEIGHT = 0.15;
/** Wedge extents in the ramp's own frame: +u is the facing direction, +w across it. */
export function rampFrame(hazard: { radius: number }) {
  const halfLength = hazard.radius * 0.72,
    halfWidth = hazard.radius * 0.7;
  // The ridge sits forward of centre, so the approach face is a long shallow climb and the
  // far face a short steep drop. Every face is a slope: there is no vertical side to bounce off.
  return { halfLength, halfWidth, crest: halfLength * 0.35, ridge: halfWidth * 0.35, height: RAMP_HEIGHT };
}
/** The six hull corners in the ramp's frame as [u, y, w]: four on the cloth, two on the ridge. */
export function rampCorners(hazard: { radius: number }): [number, number, number][] {
  const f = rampFrame(hazard);
  return [
    [-f.halfLength, 0, -f.halfWidth],
    [-f.halfLength, 0, f.halfWidth],
    [f.halfLength, 0, f.halfWidth],
    [f.halfLength, 0, -f.halfWidth],
    [f.crest, f.height, -f.ridge],
    [f.crest, f.height, f.ridge],
  ];
}
/** Rotate a point out of the ramp's frame onto the table. */
export function rampToTable(hazard: Hazard, u: number, w: number): { x: number; z: number } {
  const c = Math.cos(hazard.angle || 0),
    s = Math.sin(hazard.angle || 0);
  return { x: hazard.x + u * c - w * s, z: hazard.z + u * s + w * c };
}
/**
 * Where the wedge surface sits under a table point, and how much higher than that a resting
 * ball's centre sits (1/cos of the local face angle). A convex hull's top is the lower
 * envelope of its upper faces, so the surface is simply the smallest of the four face ratios.
 */
export function rampSupportAt(hazard: Hazard, x: number, z: number): { height: number; lift: number } {
  const f = rampFrame(hazard),
    c = Math.cos(hazard.angle || 0),
    s = Math.sin(hazard.angle || 0),
    dx = x - hazard.x,
    dz = z - hazard.z,
    u = dx * c + dz * s,
    w = -dx * s + dz * c;
  if (Math.abs(u) > f.halfLength || Math.abs(w) > f.halfWidth) return { height: 0, lift: 1 };
  const faces: [number, number][] = [
    [(u + f.halfLength) / (f.halfLength + f.crest), f.height / (f.halfLength + f.crest)],
    [(f.halfLength - u) / (f.halfLength - f.crest), f.height / (f.halfLength - f.crest)],
    [(f.halfWidth + w) / (f.halfWidth - f.ridge), f.height / (f.halfWidth - f.ridge)],
    [(f.halfWidth - w) / (f.halfWidth - f.ridge), f.height / (f.halfWidth - f.ridge)],
  ];
  let best = faces[0];
  for (const face of faces) if (face[0] < best[0]) best = face;
  return { height: f.height * best[0], lift: Math.hypot(1, best[1]) };
}
/** True while any part of the ball's footprint is over a wedge, so the table is not flat here. */
export function onRamp(arcade: ArcadeState | undefined, x: number, z: number): boolean {
  return (arcade?.hazards ?? []).some((h) => h.kind === 'ramp' && rampSupportAt(h, x, z).height > 0);
}
/** Y a resting ball's centre takes at this point: the cloth, or the wedge surface beneath it. */
export function groundCentreY(arcade: ArcadeState | undefined, x: number, z: number): number {
  let y = TABLE.radius;
  for (const hazard of arcade?.hazards ?? []) {
    if (hazard.kind !== 'ramp') continue;
    const support = rampSupportAt(hazard, x, z);
    if (support.height > 0) y = Math.max(y, support.height + TABLE.radius * support.lift);
  }
  return y;
}
