import { cushionGaps, EIGHT_BALL_TABLE, tableOf, type PlacementZone, type TableSpec } from './modes/table';
import {
  cueBallId,
  legalTargets,
  optionalPlacement,
  POCKETS,
  TABLE,
  type ArcadeState,
  type Ball,
  type GameState,
  type HazardKind,
} from './types';

export interface Point {
  x: number;
  z: number;
}
interface Rectangle extends Point {
  width: number;
  depth: number;
}
export const RAIL_RESTITUTION = 0.83;
/** Cushion thickness, shared by every table. */
const RAIL_THICKNESS = 0.13;
/** Cushions for one table: two end rails and four side rails, leaving the six pocket mouths open. */
export function railsOf(spec: TableSpec) {
  const { corner, sideInset, middle } = cushionGaps(spec.pocketRadius);
  const inner = spec.halfWidth - sideInset;
  return [-1, 1].flatMap((sign) => [
    {
      x: sign * (spec.halfWidth + RAIL_THICKNESS),
      z: 0,
      halfWidth: RAIL_THICKNESS,
      halfDepth: spec.halfDepth - corner,
      y: 0.13,
      halfHeight: 0.3,
      restitution: RAIL_RESTITUTION,
    },
    ...[-1, 1].map((side) => ({
      // Rounded, like pocketsFor, so the derived pool rails are bit-for-bit the hand-written ones they replace.
      x: Math.round(((side * (middle + inner)) / 2) * 1e9) / 1e9,
      z: sign * (spec.halfDepth + RAIL_THICKNESS),
      halfWidth: (inner - middle) / 2,
      halfDepth: RAIL_THICKNESS,
      y: 0.13,
      halfHeight: 0.3,
      restitution: RAIL_RESTITUTION,
    })),
  ]);
}
/** Pocket jaws: the rounded cushion noses either side of each mouth. */
export function nosesOf(spec: TableSpec) {
  const { middle, jawInset, jawRadius } = cushionGaps(spec.pocketRadius);
  const outer = spec.halfWidth - jawInset;
  return [-1, 1].flatMap((side) =>
    [-outer, -middle, middle, outer].map((x) => ({
      x,
      z: side * (spec.halfDepth + (Math.abs(x) > middle ? 0.06 : 0.02)),
      radius: jawRadius,
      y: 0.13,
      restitution: 0.8,
    })),
  );
}
const railCache = new Map<TableSpec, { rails: ReturnType<typeof railsOf>; noses: ReturnType<typeof nosesOf> }>();
function cushionsOf(spec: TableSpec) {
  let entry = railCache.get(spec);
  if (!entry) railCache.set(spec, (entry = { rails: railsOf(spec), noses: nosesOf(spec) }));
  return entry;
}
export const TABLE_RAILS = cushionsOf(EIGHT_BALL_TABLE).rails;
export const TABLE_NOSES = cushionsOf(EIGHT_BALL_TABLE).noses;
export const ROLLING_RESISTANCE = { constant: 0.42, linear: 0.12 } as const;
export const STICKY_DRAG = 2.4;
export const AIR_DRAG = 0.015;
export function surfaceDrag(kind: HazardKind): number {
  return kind === 'water' ? 2.5 : kind === 'slime' ? 4.5 : 1;
}
export function surfaceDragAt(arcade: ArcadeState | undefined, point: Point): number {
  return (arcade?.hazards ?? []).reduce(
    (drag, hazard) => (distance(point, hazard) < hazard.radius ? Math.max(drag, surfaceDrag(hazard.kind)) : drag),
    1,
  );
}
export function rollingDeceleration(speed: number, multiplier = 1): number {
  return (ROLLING_RESISTANCE.constant + speed * ROLLING_RESISTANCE.linear) * multiplier;
}
function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
export function circleBoxDistance(point: Point, box: Rectangle): number {
  return Math.hypot(
    Math.max(0, Math.abs(point.x - box.x) - box.width / 2),
    Math.max(0, Math.abs(point.z - box.z) - box.depth / 2),
  );
}
export function obstructionAt(arcade: ArcadeState | undefined, x: number, z: number, radius: number): boolean {
  return !!arcade?.obstacles.some((o) => o.hp > 0 && circleBoxDistance({ x, z }, o) < radius);
}

/** Distances along a unit direction during which a point lies inside a circle. */
export function circleInterval(
  a: Point,
  dx: number,
  dz: number,
  length: number,
  center: Point,
  radius: number,
): [number, number] | null {
  const x = center.x - a.x,
    z = center.z - a.z,
    along = x * dx + z * dz;
  const perpendicular = Math.max(0, x * x + z * z - along * along);
  if (perpendicular >= radius * radius) return null;
  const half = Math.sqrt(radius * radius - perpendicular);
  const start = Math.max(0, along - half),
    end = Math.min(length, along + half);
  return end > start ? [start, end] : null;
}
function circleRay(a: Point, dx: number, dz: number, center: Point, radius: number): number {
  if (distance(a, center) < radius - 1e-9) return 0;
  return circleInterval(a, dx, dz, Infinity, center, radius)?.[0] ?? Infinity;
}
function boxRay(a: Point, dx: number, dz: number, box: Rectangle): number {
  let near = 0,
    far = Infinity;
  for (const [origin, dir, low, high] of [
    [a.x, dx, box.x - box.width / 2, box.x + box.width / 2],
    [a.z, dz, box.z - box.depth / 2, box.z + box.depth / 2],
  ]) {
    if (Math.abs(dir) < 1e-9) {
      if (origin < low || origin > high) return Infinity;
    } else {
      const left = (low - origin) / dir,
        right = (high - origin) / dir;
      near = Math.max(near, Math.min(left, right));
      far = Math.min(far, Math.max(left, right));
    }
  }
  return far >= near && far > 1e-9 ? near : Infinity;
}
/** Sweeping a sphere beside a cuboid has rounded corners, not a larger square box. */
export function roundedBoxRay(a: Point, dx: number, dz: number, box: Rectangle, radius: number): number {
  let nearest = Math.min(
    boxRay(a, dx, dz, { ...box, width: box.width + radius * 2 }),
    boxRay(a, dx, dz, { ...box, depth: box.depth + radius * 2 }),
  );
  for (const x of [-1, 1])
    for (const z of [-1, 1])
      nearest = Math.min(
        nearest,
        circleRay(a, dx, dz, { x: box.x + (x * box.width) / 2, z: box.z + (z * box.depth) / 2 }, radius),
      );
  return nearest;
}
export function obstacleRay(
  arcade: ArcadeState | undefined,
  x: number,
  z: number,
  dx: number,
  dz: number,
  radius: number,
): number {
  let nearest = Infinity;
  for (const obstacle of arcade?.obstacles ?? [])
    if (obstacle.hp > 0) nearest = Math.min(nearest, roundedBoxRay({ x, z }, dx, dz, obstacle, radius));
  return nearest;
}

export interface TableContact extends Point {
  kind: 'ball' | 'rail' | 'obstacle' | 'portal' | 'pocket' | 'edge';
  distance: number;
  /** Ball, obstacle, or hazard ID; rail/pocket array index for those kinds. */
  id: number;
}
/** Grounded-ball contact query shared by guides and AI. Portals end the local path.
 * Pocket circles occupy real gaps between the rail segments. Flying balls use
 * their sphere cross-section at the grounded moving ball's height. */
/** A snooker line ignores straight cushions, and jaws and pocket mouths farther than this from the cue ball (EPA: a
 * cushion never snookers, a jaw only when it is close to the cue ball). Two ball diameters. */
export const JAW_SNOOKER_RANGE = TABLE.radius * 4;
export function firstTableBoundary(state: GameState, origin: Point, angle: number, snookerLine = false): TableContact {
  const spec = tableOf(state),
    { rails, noses } = cushionsOf(spec);
  const dx = Math.cos(angle),
    dz = Math.sin(angle);
  let nearest: TableContact = { kind: 'edge', id: -1, distance: Infinity, x: origin.x, z: origin.z };
  const accept = (kind: TableContact['kind'], id: number, length: number) => {
    if (length < nearest.distance)
      nearest = { kind, id, distance: length, x: origin.x + dx * length, z: origin.z + dz * length };
  };
  const jaw = (kind: TableContact['kind'], id: number, length: number) => {
    if (!snookerLine || length <= JAW_SNOOKER_RANGE) accept(kind, id, length);
  };
  if (!snookerLine)
    for (const [id, rail] of rails.entries())
      accept(
        'rail',
        id,
        roundedBoxRay(origin, dx, dz, { ...rail, width: rail.halfWidth * 2, depth: rail.halfDepth * 2 }, spec.radius),
      );
  for (const [id, nose] of noses.entries()) {
    const radius = Math.sqrt((spec.radius + nose.radius) ** 2 - (spec.radius - nose.y) ** 2);
    jaw('rail', rails.length + id, circleRay(origin, dx, dz, nose, radius));
  }
  for (const obstacle of state.arcade?.obstacles ?? [])
    if (obstacle.hp > 0) accept('obstacle', obstacle.id, roundedBoxRay(origin, dx, dz, obstacle, spec.radius));
  for (const hazard of state.arcade?.hazards ?? [])
    if (hazard.kind === 'portal') accept('portal', hazard.id, circleRay(origin, dx, dz, hazard, hazard.radius));
  for (const [id, pocket] of spec.pockets.entries())
    jaw('pocket', id, circleRay(origin, dx, dz, pocket, spec.pocketRadius));
  // A grazing path may miss both a jaw and the pocket. Bound the preview at the
  // outer table, without inventing a cushion across that opening.
  if (!Number.isFinite(nearest.distance)) {
    const x = Math.abs(dx) > 1e-9 ? (Math.sign(dx) * (spec.halfWidth + 0.4) - origin.x) / dx : Infinity;
    const z = Math.abs(dz) > 1e-9 ? (Math.sign(dz) * (spec.halfDepth + 0.45) - origin.z) / dz : Infinity;
    accept('edge', -1, Math.max(0, Math.min(x, z)));
  }
  return nearest;
}
export function firstTableContact(
  state: GameState,
  origin: Point,
  angle: number,
  ignoreBall = 0,
  snookerLine = false,
): TableContact {
  const radius = tableOf(state).radius;
  const dx = Math.cos(angle),
    dz = Math.sin(angle);
  let nearest = firstTableBoundary(state, origin, angle, snookerLine);
  for (const ball of state.balls) {
    if (ball.id === ignoreBall || ball.pocketed || (ball.elevation ?? 0) >= radius * 2) continue;
    const length = circleRay(origin, dx, dz, ball, Math.sqrt((radius * 2) ** 2 - (ball.elevation ?? 0) ** 2));
    if (length < nearest.distance)
      nearest = { kind: 'ball', id: ball.id, distance: length, x: origin.x + dx * length, z: origin.z + dz * length };
  }
  return nearest;
}
/** Boundary-only route test; ball-to-ball spacing is a separate tactical margin. */
export function segmentClearOfTable(state: GameState, a: Point, b: Point): boolean {
  const length = distance(a, b);
  if (length < 1e-8) return true;
  const contact = firstTableBoundary(state, a, Math.atan2(b.z - a.z, b.x - a.x));
  return (
    contact.distance >= length - 0.002 ||
    (contact.kind === 'pocket' && distance(b, tableOf(state).pockets[contact.id]) < tableOf(state).pocketRadius)
  );
}

/** Policy differences are intentional: AI prefers calm felt; manual placement
 * permits terrain; a portal exit must clear its hardware; ward rescue must not
 * immediately trigger another hazard or pocket. All distances are center gaps. */
export type BallClearancePolicy =
  'placement' | 'ai-placement' | 'ai-fallback' | 'object-respot' | 'eight-respot' | 'ward-respot' | 'portal-exit';
/** `pocketGap` is measured out from the mouth, so a tighter pocket keeps the same margin of felt around it. */
const BALL_CLEARANCE = {
  placement: { edge: 0.03, pocketGap: 0.1, block: 0.02, ball: 0.02, hazard: 'none', hazardGap: 0 },
  'ai-placement': { edge: 0.03, pocketGap: 0.14, block: 0.025, ball: 0.035, hazard: 'all', hazardGap: 0.08 },
  'ai-fallback': { edge: 0.03, pocketGap: 0.14, block: 0.025, ball: 0.035, hazard: 'active', hazardGap: 0.04 },
  'object-respot': { edge: 0.05, pocketGap: 0.15, block: 0.03, ball: 0.025, hazard: 'none', hazardGap: 0 },
  'eight-respot': { edge: 0.03, pocketGap: 0.1, block: 0.02, ball: TABLE.radius * 0.1, hazard: 'none', hazardGap: 0 },
  'ward-respot': { edge: 0.05, pocketGap: 0.15, block: 0.03, ball: TABLE.radius * 0.1, hazard: 'all', hazardGap: 0.04 },
  'portal-exit': { edge: 0.04, pocketGap: 0.18, block: 0.04, ball: 0.05, hazard: 'none', hazardGap: 0 },
} as const;
/** The head string crosses the break spot; the kitchen lies behind it, towards the head rail. */
export const HEAD_STRING_X = EIGHT_BALL_TABLE.placement.headStringX;
/** Inside the mode's placement zone: behind the head string, and inside the D as well when the mode has one. */
function inZone(zone: PlacementZone, point: Point): boolean {
  return (
    point.x <= zone.headStringX + 1e-9 &&
    (zone.dRadius === undefined || Math.hypot(point.x - zone.headStringX, point.z) <= zone.dRadius + 1e-9)
  );
}
/** Ball in hand is always placed in the kitchen (the baulk area) under both rule sets.
 * A kitchen with no clear spot opens the whole table for a lost cue ball rather than leaving the turn unplayable.
 * ponytail: "no clear spot" is judged on a 0.1 grid, so a narrower free sliver still counts as full. */
export function kitchenPlacement(state: GameState): boolean {
  return firstPlacementSpot(state, true) !== null;
}
/** Optional placement: the cue ball is still on the table and may be played from exactly where it lies. */
export function isCueLie(state: GameState, point: Point): boolean {
  const cue = state.balls[cueBallId(state)];
  return !cue.pocketed && point.x === cue.x && point.z === cue.z;
}
/** Foul snooker test (EPA): the player cannot hit both extreme edges of any ball they are on in a straight line. Other
 * balls, blocks and portals block, and jaws and pocket mouths within JAW_SNOOKER_RANGE of the cue ball; straight
 * cushions and balls the player is on never do, and a ball already touching the cue ball is never snookered.
 * Snooker reuses the same test for its free ball (WPBSA Section 2 Rule 16), passing its own balls on.
 * ponytail: each edge is one ray aimed just inside the extreme (6.3 / 6), so a blocker grazing the very rim is missed. */
export function snookered(
  state: GameState,
  player: 0 | 1,
  targets: readonly Ball[] = legalTargets({ ...state, freeShot: false }, player),
): boolean {
  const cue = state.balls[cueBallId(state, player)];
  if (cue.pocketed) return false;
  const radius = tableOf(state).radius;
  const reaches = (angle: number) => {
    const contact = firstTableContact(state, cue, angle, 0, true);
    return contact.kind === 'ball' && targets.some((ball) => ball.id === contact.id);
  };
  return (
    targets.length > 0 &&
    !targets.some((target) => {
      const gap = distance(cue, target);
      if (gap <= radius * 2 + 1e-3) return true;
      const centre = Math.atan2(target.z - cue.z, target.x - cue.x),
        edge = Math.asin(((radius * 2) / gap) * (6 / 6.3));
      return reaches(centre - edge) && reaches(centre + edge);
    })
  );
}
/** Behind the head string, or inside the D for a mode with one. A placement zone with no clear spot opens the whole
 * table only for a lost cue ball; an optional placement then has just its lie left. */
export function inPlacementZone(state: GameState, point: Point, kitchen = kitchenPlacement(state)): boolean {
  return inZone(tableOf(state).placement, point) || (!kitchen && state.balls[cueBallId(state)].pocketed);
}
/** What an optional placement offers: 'kitchen' when the cue ball may move behind the head string, 'lie' when the
 * kitchen has no clear spot so only playing from where it lies remains, null when placement is not optional. */
export function optionalPlacementChoice(state: GameState): 'kitchen' | 'lie' | null {
  return optionalPlacement(state) ? (kitchenPlacement(state) ? 'kitchen' : 'lie') : null;
}
/** First spot a human could place the cue ball, scanning away from the head string: into the placement zone, or across the rest of the table. */
export function firstPlacementSpot(state: GameState, kitchen: boolean): Point | null {
  const spec = tableOf(state),
    zone = spec.placement;
  const rows = Math.floor((spec.halfDepth - spec.radius - BALL_CLEARANCE.placement.edge) / 0.1);
  const columns = Math.ceil((spec.halfWidth * 2) / 0.1);
  for (let column = 0; column <= columns; column++) {
    const x = kitchen ? zone.headStringX - column * 0.1 : zone.headStringX + (column + 1) * 0.1;
    if (Math.abs(x) > spec.halfWidth) break;
    for (let row = -rows; row <= rows; row++) {
      const point = { x, z: row * 0.1 };
      if ((!kitchen || inZone(zone, point)) && isClearBallSpot(state, point, cueBallId(state), 'placement'))
        return point;
    }
  }
  return null;
}
export function isClearBallSpot(
  state: GameState,
  point: Point,
  ignoreBall: number,
  policy: BallClearancePolicy,
): boolean {
  const rule = BALL_CLEARANCE[policy],
    spec = tableOf(state);
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.z) &&
    Math.abs(point.x) <= spec.halfWidth - spec.radius - rule.edge &&
    Math.abs(point.z) <= spec.halfDepth - spec.radius - rule.edge &&
    !spec.pockets.some((pocket) => distance(point, pocket) < spec.pocketRadius + rule.pocketGap) &&
    !obstructionAt(state.arcade, point.x, point.z, spec.radius + rule.block) &&
    !state.balls.some(
      (ball) => ball.id !== ignoreBall && !ball.pocketed && distance(point, ball) < spec.radius * 2 + rule.ball,
    ) &&
    !(state.arcade?.hazards ?? []).some(
      (hazard) =>
        rule.hazard !== 'none' &&
        (rule.hazard === 'all' || ['portal', 'ramp', 'electric'].includes(hazard.kind)) &&
        distance(point, hazard) < hazard.radius + spec.radius + rule.hazardGap,
    )
  );
}

function breakLane(point: Point, halfWidth: number, halfDepth: number): boolean {
  return point.x + halfWidth > -3.25 && point.x - halfWidth < 3.1 && Math.abs(point.z) < halfDepth + 0.46;
}
export function isClearLayoutBlock(arcade: ArcadeState, balls: Ball[], box: Rectangle): boolean {
  return (
    Math.abs(box.x) + box.width / 2 < 5.28 &&
    Math.abs(box.z) + box.depth / 2 < 2.48 &&
    !breakLane(box, box.width / 2, box.depth / 2) &&
    !balls.some((ball) => !ball.pocketed && circleBoxDistance(ball, box) < TABLE.radius + 0.14) &&
    !arcade.obstacles.some(
      (other) =>
        other.hp > 0 &&
        Math.abs(other.x - box.x) < (other.width + box.width) / 2 + 0.18 &&
        Math.abs(other.z - box.z) < (other.depth + box.depth) / 2 + 0.18,
    )
  );
}
export function isClearLayoutHazard(arcade: ArcadeState, balls: Ball[], hazard: Point & { radius: number }): boolean {
  return (
    Math.abs(hazard.x) + hazard.radius < 5.3 &&
    Math.abs(hazard.z) + hazard.radius < 2.52 &&
    !breakLane(hazard, hazard.radius, hazard.radius) &&
    !balls.some((ball) => !ball.pocketed && distance(hazard, ball) < hazard.radius + TABLE.radius + 0.15) &&
    !obstructionAt(arcade, hazard.x, hazard.z, hazard.radius + 0.12) &&
    !arcade.hazards.some((other) => distance(hazard, other) < hazard.radius + other.radius + 0.12)
  );
}
export function isClearLayoutPickup(arcade: ArcadeState, balls: Ball[], point: Point, radius = 0.16): boolean {
  return (
    Math.abs(point.x) < 5.15 &&
    Math.abs(point.z) < 2.35 &&
    !breakLane(point, radius, radius) &&
    !balls.some((ball) => !ball.pocketed && distance(point, ball) < radius + TABLE.radius + 0.16) &&
    !obstructionAt(arcade, point.x, point.z, radius + 0.3) &&
    !arcade.hazards.some((hazard) => distance(point, hazard) < hazard.radius + radius + 0.18) &&
    !arcade.pickups.some((pickup) => distance(point, pickup) < 0.8)
  );
}
export function isClearPickupSpawn(state: GameState, point: Point): boolean {
  const arcade = state.arcade;
  return (
    !!arcade &&
    Math.abs(point.x) <= 5.05 &&
    Math.abs(point.z) <= 2.25 &&
    !breakLane(point, 0.16, 0.16) &&
    !POCKETS.some((pocket) => distance(point, pocket) < 0.65) &&
    !obstructionAt(arcade, point.x, point.z, 0.4) &&
    !state.balls.some((ball) => !ball.pocketed && distance(point, ball) < TABLE.radius + 0.36) &&
    !arcade.hazards.some((hazard) => distance(point, hazard) < hazard.radius + 0.34) &&
    !arcade.pickups.some((pickup) => pickup.available && distance(point, pickup) < 0.8)
  );
}
export function isClearPortalSpawn(state: GameState, point: Point, radius: number, newPortals: Point[]): boolean {
  const arcade = state.arcade;
  return (
    !!arcade &&
    Math.abs(point.x) + radius < 5.15 &&
    Math.abs(point.z) + radius < 2.5 &&
    !POCKETS.some((pocket) => distance(point, pocket) < radius + 0.48) &&
    !obstructionAt(arcade, point.x, point.z, radius + 0.18) &&
    !state.balls.some((ball) => !ball.pocketed && distance(point, ball) < radius + TABLE.radius + 0.16) &&
    !arcade.hazards.some(
      (hazard) => hazard.kind !== 'portal' && distance(point, hazard) < radius + hazard.radius + 0.15,
    ) &&
    !arcade.pickups.some((pickup) => pickup.available && distance(point, pickup) < radius + pickup.radius + 0.18) &&
    !newPortals.some((other) => distance(point, other) < 3)
  );
}
