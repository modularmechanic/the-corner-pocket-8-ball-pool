import { BURN_DRAG, FROST_CUE_DRAG, FROST_RADIUS, FROST_SLIDE } from './arcade';
import { equippedCue } from './cues';
import { modeOf, tableOf } from './modes';
import {
  circleInterval,
  firstPlacementSpot,
  firstTableBoundary,
  firstTableContact,
  HEAD_STRING_X,
  inPlacementZone,
  isClearBallSpot,
  kitchenPlacement,
  RAIL_RESTITUTION,
  ROLLING_RESISTANCE,
  segmentClearOfTable,
  STICKY_DRAG,
  surfaceDrag,
  type Point,
} from './table-geometry';
import {
  TABLE,
  POCKETS,
  cueBallId,
  groupOf,
  isBreakShot,
  legalTargets,
  type Ball,
  type Difficulty,
  type GameState,
  type Group,
  type Shot,
} from './types';

interface Path {
  distance: number;
  portal: boolean;
  risk: number;
  runs: { distance: number; drag: number; boost: number }[];
}
interface Candidate {
  angle: number;
  speed: number;
  score: number;
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
/** Legal first-contact balls the AI aims at, as the mode being played defines them — snooker's reds and colours,
 * a billiards object ball, eight-ball's group. Asking `legalTargets` from types directly would aim every mode at a
 * group and an eight that only eight-ball has. */
function aiTargets(state: GameState): Ball[] {
  const targets = modeOf(state).legalTargets(state);
  // Eight-ball only: a free shot or free ball never goes for the black too early. No other mode has a ball 8
  // that means anything (in snooker it is an ordinary red), so the filter stays where it belongs.
  if ((state.mode ?? 'eight-ball') !== 'eight-ball') return targets;
  const onEight = legalTargets({ ...state, freeShot: false }).every((ball) => ball.id === 8);
  return onEight ? targets : targets.filter((ball) => ball.id !== 8);
}

export function segmentClear(
  a: Point,
  b: Point,
  balls: Ball[],
  exclude: number[],
  clearance = TABLE.radius * 2.06,
): boolean {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    len = dx * dx + dz * dz;
  return !balls.some((ball) => {
    if (ball.pocketed || exclude.includes(ball.id)) return false;
    const t = clamp(((ball.x - a.x) * dx + (ball.z - a.z) * dz) / (len || 1), 0, 1);
    return Math.hypot(ball.x - a.x - t * dx, ball.z - a.z - t * dz) < clearance;
  });
}
function pathAlong(state: GameState, a: Point, b: Point): Path {
  const distance = Math.hypot(b.x - a.x, b.z - a.z);
  if (distance < 1e-8) return { distance: 0, portal: false, risk: 0, runs: [] };
  const dx = (b.x - a.x) / distance,
    dz = (b.z - a.z) / distance;
  const crossings: { start: number; end: number; drag: number; boost: number }[] = [];
  let portal = false,
    risk = 0;
  for (const hazard of state.arcade?.hazards || []) {
    const hit = circleInterval(a, dx, dz, distance, hazard, hazard.radius);
    if (!hit) continue;
    if (hazard.kind === 'portal') portal = true;
    if (hazard.kind === 'smoke') risk += 1.5;
    const drag = surfaceDrag(hazard.kind);
    // A ramp is a wedge the ball has to climb now, not a speed pad: it costs a little energy at
    // best and turns a slow ball back at worst. This straight-line model cannot express a
    // rebound, so the least wrong thing it can say about a ramp is nothing.
    const boost = hazard.kind === 'electric' ? 1.18 : 1;
    crossings.push({ start: hit[0], end: hit[1], drag, boost });
    risk += (drag - 1) * (hit[1] - hit[0]) * 0.12;
  }
  // Scorched and iced cloth is terrain too: a burn drags like water, ice lets the ball run on.
  for (const mark of state.arcade?.burns ?? []) {
    const hit = circleInterval(a, dx, dz, distance, mark, mark.radius);
    if (!hit) continue;
    const drag = 1 + mark.heat * (BURN_DRAG - 1);
    crossings.push({ start: hit[0], end: hit[1], drag, boost: 1 });
    risk += (drag - 1) * (hit[1] - hit[0]) * 0.12;
  }
  for (const mark of state.arcade?.frost ?? []) {
    const hit = circleInterval(a, dx, dz, distance, mark, FROST_RADIUS);
    if (hit) crossings.push({ start: hit[0], end: hit[1], drag: 1 - mark.life * FROST_SLIDE, boost: 1 });
  }
  const marks = [...new Set([0, distance, ...crossings.flatMap((h) => [h.start, h.end])])].sort((a, b) => a - b);
  const runs: Path['runs'] = [];
  for (let i = 1; i < marks.length; i++) {
    const start = marks[i - 1],
      end = marks[i],
      middle = (start + end) / 2;
    let drag = 1,
      slide = 1,
      boost = 1;
    for (const crossing of crossings) {
      if (middle >= crossing.start && middle <= crossing.end)
        if (crossing.drag < 1) slide = Math.min(slide, crossing.drag);
        else drag = Math.max(drag, crossing.drag);
      if (Math.abs(crossing.start - start) < 1e-8) boost *= crossing.boost;
    }
    drag *= slide;
    runs.push({ distance: end - start, drag, boost });
  }
  return { distance, portal, risk, runs };
}
// Integral of dv/dt = -.42 - .12v expressed as travel distance. Reversing
// each short surface segment keeps the estimate consistent with actual drag.
function stoppingDistance(speed: number) {
  const { constant, linear } = ROLLING_RESISTANCE;
  return speed / linear - (constant / (linear * linear)) * Math.log1p((linear * speed) / constant);
}
function speedForDistance(distance: number, arrival: number): number {
  const target = stoppingDistance(arrival) + distance;
  let low = arrival,
    high = Math.max(
      arrival + 1,
      Math.sqrt(arrival * arrival + 2 * (ROLLING_RESISTANCE.constant + ROLLING_RESISTANCE.linear * 32) * distance),
    );
  high = Math.max(high, arrival + distance * ROLLING_RESISTANCE.linear + 1);
  for (let i = 0; i < 18; i++) {
    const speed = (low + high) / 2;
    if (stoppingDistance(speed) < target) low = speed;
    else high = speed;
  }
  return (low + high) / 2;
}
function requiredSpeed(path: Path, arrival: number, cueDrag = 1): number {
  let speed = arrival;
  for (let i = path.runs.length - 1; i >= 0; i--) {
    const run = path.runs[i];
    speed = speedForDistance(run.distance * run.drag * cueDrag, speed);
    if (run.boost > 1 && speed > 23) return Infinity;
    speed /= run.boost;
  }
  return speed;
}
/** Extra cloth drag the striker's own cue ball carries this shot: a Heavy cue, a frozen (and so heavy) one, or both. */
function cueDragOf(state: GameState): number {
  const buffs = state.arcade?.buffs[state.turn];
  return (buffs?.sticky ? STICKY_DRAG : 1) * (buffs?.frozen ? FROST_CUE_DRAG : 1);
}
function cueScale(state: GameState) {
  const buffs = state.arcade?.buffs[state.turn];
  return equippedCue(state).power * (buffs?.overdrive ? 1.3 : 1) * (buffs?.frozen ? 0.65 : 1);
}
function powerForSpeed(state: GameState, speed: number) {
  return clamp((speed / cueScale(state) - 1.4) / 15, 0.05, 1);
}
function pickupBonus(state: GameState, a: Point, b: Point): number {
  const distance = Math.hypot(b.x - a.x, b.z - a.z);
  if (!distance) return 0;
  // Prefer public pickup positions without predicting future random spawns.
  const count = (state.arcade?.pickups || []).filter(
    (p) =>
      p.available &&
      circleInterval(a, (b.x - a.x) / distance, (b.z - a.z) / distance, distance, p, p.radius + TABLE.radius),
  ).length;
  return Math.min(2, count) * 1.3;
}
function potCandidates(state: GameState): Candidate[] {
  const cue = state.balls[cueBallId(state)],
    cueDrag = cueDragOf(state);
  // The slate the mode is played on. Aiming at the pub table's pockets on a 12-foot snooker table would miss
  // every one of them, and the cushion bounds below would reject nearly every ghost position as off the felt.
  const spec = tableOf(state);
  const candidates: Candidate[] = [],
    maximum = 16.4 * cueScale(state);
  // A raised ward turns the black away from every pocket, so aiming to pot it is a wasted stroke: the AI plays
  // a legal safety off it instead and comes back for it once the shield is spent.
  const shielded = !!state.arcade?.buffs[state.turn].ward && (state.mode ?? 'eight-ball') === 'eight-ball';
  for (const target of aiTargets(state)) {
    if (shielded && target.id === 8) continue;
    for (const pocket of spec.pockets) {
      const distance = Math.hypot(pocket.x - target.x, pocket.z - target.z);
      if (distance < 1e-5) continue;
      const nx = (pocket.x - target.x) / distance,
        nz = (pocket.z - target.z) / distance;
      const ghost = { x: target.x - nx * spec.radius * 2.01, z: target.z - nz * spec.radius * 2.01 };
      const cueDistance = Math.hypot(ghost.x - cue.x, ghost.z - cue.z);
      if (cueDistance < 0.02) continue;
      const dot = (nx * (ghost.x - cue.x) + nz * (ghost.z - cue.z)) / cueDistance;
      if (
        dot < 0.26 ||
        Math.abs(ghost.x) > spec.halfWidth - spec.radius ||
        Math.abs(ghost.z) > spec.halfDepth - spec.radius
      )
        continue;
      if (
        !segmentClearOfTable(state, cue, ghost) ||
        !segmentClearOfTable(state, target, pocket) ||
        !segmentClear(cue, ghost, state.balls, [cue.id, target.id]) ||
        !segmentClear(target, pocket, state.balls, [cue.id, target.id])
      )
        continue;
      const first = pathAlong(state, cue, ghost),
        second = pathAlong(state, target, pocket);
      if (first.portal || second.portal) continue;
      const speed = requiredSpeed(first, requiredSpeed(second, 0.75) / (0.98 * dot), cueDrag);
      if (!Number.isFinite(speed) || speed > maximum) continue;
      candidates.push({
        angle: Math.atan2(ghost.z - cue.z, ghost.x - cue.x),
        speed,
        score:
          30 +
          dot * 8 -
          distance * 0.5 -
          cueDistance * 0.35 -
          speed * 0.12 -
          first.risk -
          second.risk +
          pickupBonus(state, cue, ghost) +
          pickupBonus(state, target, pocket),
      });
    }
  }
  return candidates;
}
/** The perfect stroke Deadeye spends itself on: dead straight, plain ball, exactly the pace that sinks the ball the
 * player is pointing at. Null when nothing is on, so the charge is not thrown away on an impossible table. */
export function deadeyeShot(state: GameState, aim: number): Shot | null {
  const options = potCandidates(state);
  if (!options.length) return null;
  const off = (candidate: Candidate) =>
    Math.abs(Math.atan2(Math.sin(candidate.angle - aim), Math.cos(candidate.angle - aim)));
  // The ball being aimed at wins; only a table with nothing anywhere near the aim falls back to the best pot on it.
  const aimed = options.filter((candidate) => off(candidate) < 0.5);
  const best = (aimed.length ? aimed : options).reduce((a, b) => (b.score > a.score ? b : a));
  // A shade more pace than the bare minimum: the pot has to drop, not die in the jaws.
  return {
    angle: best.angle,
    power: powerForSpeed(state, Math.min(16.4 * cueScale(state), best.speed * 1.12)),
    elevation: 0,
    tipX: 0,
    tipY: 0,
  };
}
function safetyCandidates(state: GameState): Candidate[] {
  const cue = state.balls[cueBallId(state)],
    legal = new Set(aiTargets(state).map((b) => b.id)),
    cueDrag = cueDragOf(state);
  const maximum = 16.4 * cueScale(state),
    candidates: Candidate[] = [];
  const addRay = (angle: number, score: number, pickupDistance?: number) => {
    const contact = firstTableContact(state, cue, angle);
    const target = contact.kind === 'ball' ? state.balls.find((ball) => ball.id === contact.id) : undefined;
    if (contact.kind !== 'obstacle' && (!target || !legal.has(target.id))) return;
    if (pickupDistance !== undefined && contact.distance < pickupDistance + 0.04) return;
    const dx = Math.cos(angle),
      dz = Math.sin(angle);
    const endpoint = { x: cue.x + dx * contact.distance, z: cue.z + dz * contact.distance };
    const path = pathAlong(state, cue, endpoint);
    if (path.portal || requiredSpeed(path, 0.65, cueDrag) > maximum) return;
    let arrival = 4.0;
    if (target) {
      const afterContact = firstTableBoundary(state, target, angle),
        afterDistance = afterContact.distance;
      const after = pathAlong(state, target, { x: target.x + dx * afterDistance, z: target.z + dz * afterDistance });
      if (afterContact.kind === 'portal') score -= 4;
      const normalDot = clamp(
        ((target.x - endpoint.x) * dx + (target.z - endpoint.z) * dz) / (TABLE.radius * 2),
        0.25,
        1,
      );
      arrival = Math.min(11, requiredSpeed(after, 1) / (0.98 * normalDot));
    }
    const speed = Math.min(maximum, requiredSpeed(path, arrival, cueDrag));
    if (Number.isFinite(speed))
      candidates.push({
        angle,
        speed,
        score: score - path.distance * 0.6 - speed * 0.16 - path.risk + pickupBonus(state, cue, endpoint),
      });
  };
  for (const target of aiTargets(state)) addRay(Math.atan2(target.z - cue.z, target.x - cue.x), 12);
  for (const block of state.arcade?.obstacles || [])
    if (block.hp > 0) addRay(Math.atan2(block.z - cue.z, block.x - cue.x), 10 + (block.hp === 1 ? 1 : 0));
  for (const pickup of state.arcade?.pickups || [])
    if (pickup.available)
      addRay(Math.atan2(pickup.z - cue.z, pickup.x - cue.x), 14, Math.hypot(pickup.x - cue.x, pickup.z - cue.z));
  // A bounded angular scan can see exposed edges when an object's center is blocked.
  if (!candidates.length) for (let i = 0; i < 48; i++) addRay((i * Math.PI) / 24, 1);
  return candidates;
}
function bankCandidates(state: GameState): Candidate[] {
  const cue = state.balls[cueBallId(state)],
    spec = tableOf(state),
    candidates: Candidate[] = [],
    cueDrag = cueDragOf(state);
  for (const target of aiTargets(state))
    for (const [axis, side] of [
      ['x', -1],
      ['x', 1],
      ['z', -1],
      ['z', 1],
    ] as const) {
      const rail = side * (axis === 'x' ? spec.halfWidth - spec.radius : spec.halfDepth - spec.radius);
      const reflected = { ...target, [axis]: rail * 2 - target[axis] },
        denominator = reflected[axis] - cue[axis];
      if (Math.abs(denominator) < 1e-5) continue;
      const fraction = (rail - cue[axis]) / denominator;
      if (fraction <= 0 || fraction >= 1) continue;
      const bounce = { x: cue.x + (reflected.x - cue.x) * fraction, z: cue.z + (reflected.z - cue.z) * fraction };
      if (spec.pockets.some((p) => Math.hypot(bounce.x - p.x, bounce.z - p.z) < 0.6)) continue;
      if (
        !segmentClear(cue, bounce, state.balls, [cue.id]) ||
        !segmentClear(bounce, target, state.balls, [cue.id, target.id]) ||
        !segmentClearOfTable(state, cue, bounce) ||
        !segmentClearOfTable(state, bounce, target)
      )
        continue;
      const first = pathAlong(state, cue, bounce),
        second = pathAlong(state, bounce, target);
      if (first.portal || second.portal) continue;
      const speed = requiredSpeed(first, requiredSpeed(second, 5, cueDrag) / RAIL_RESTITUTION, cueDrag);
      if (speed <= 16.4 * cueScale(state))
        candidates.push({
          angle: Math.atan2(bounce.z - cue.z, bounce.x - cue.x),
          speed,
          score: -(first.distance + second.distance),
        });
    }
  return candidates;
}
export function chooseShot(state: GameState, difficulty: Difficulty, random = Math.random): Shot {
  const cue = state.balls[cueBallId(state)];
  if (isBreakShot(state)) {
    const apex = state.balls.find((b) => b.id === 1 && !b.pocketed) || { x: 2.55, z: 0 };
    const angle =
      Math.atan2(apex.z - cue.z, apex.x - cue.x) + (random() - 0.5) * (difficulty === 'expert' ? 0.006 : 0.025);
    const route = pathAlong(state, cue, apex);
    const speed = requiredSpeed(route, difficulty === 'casual' ? 9 : 12, cueDragOf(state));
    return { angle, power: powerForSpeed(state, speed) };
  }
  let options = potCandidates(state);
  if (!options.length) options = safetyCandidates(state);
  if (!options.length) options = bankCandidates(state);
  options.sort((a, b) => b.score - a.score);
  const choices =
    difficulty === 'casual'
      ? Math.min(4, options.length)
      : difficulty === 'regular'
        ? Math.min(2, options.length)
        : Math.min(1, options.length);
  const selected = options[choices > 1 ? Math.floor(clamp(random(), 0, 0.999999) * choices) : 0];
  // Completely snookered states can have no modeled legal route; still make a
  // finite shot toward a legal target rather than getting stuck in the turn.
  const fallback = aiTargets(state)[0];
  const shot = selected || {
    angle: fallback ? Math.atan2(fallback.z - cue.z, fallback.x - cue.x) : 0,
    speed: 7,
    score: 0,
  };
  // Deadeye is armed: take the pot it guarantees rather than a stroke of its own with a hand tremor on it.
  if (state.arcade?.buffs[state.turn].focus) {
    const perfect = deadeyeShot(state, shot.angle);
    if (perfect) return perfect;
  }
  const error = difficulty === 'casual' ? 0.065 : difficulty === 'regular' ? 0.018 : 0.0025;
  return {
    angle: shot.angle + (random() - 0.5) * error * 2,
    power: clamp(
      powerForSpeed(state, shot.speed) *
        (1 + (random() - 0.5) * (difficulty === 'casual' ? 0.32 : difficulty === 'regular' ? 0.08 : 0.02)),
      0.05,
      1,
    ),
  };
}
/** Optional placement keeps the lie while it offers a pot; otherwise (no makeable pot, or snookered) it moves to the
 * kitchen. ponytail: "no pot from here" stands in for a safety evaluation of the lie. */
export function choosePlacement(state: GameState): Point {
  const cue = state.balls[cueBallId(state)];
  if (!cue.pocketed && potCandidates(state).length) return { x: cue.x, z: cue.z };
  const targets = aiTargets(state),
    candidates: { point: Point; score: number }[] = [],
    kitchen = kitchenPlacement(state);
  // The scan grid is written in pub-table numbers and stretched to whatever slate the mode uses; on the pub table
  // both scales are exactly 1, so every coordinate below is the number it always was. A fixed pool-sized grid would
  // never reach snooker's D, which sits outside it, and the AI would fall through to the first spot it could find.
  const spec = tableOf(state),
    sx = spec.halfWidth / TABLE.halfWidth,
    sz = spec.halfDepth / TABLE.halfDepth;
  for (let x = -4.9 * sx; x < 5 * sx; x += 0.65 * sx)
    for (let z = -2.2 * sz; z < 2.3 * sz; z += 0.65 * sz) {
      const point = { x, z };
      if (!inPlacementZone(state, point, kitchen) || !isClearBallSpot(state, point, cue.id, 'ai-placement')) continue;
      let score = -Math.abs(x) * 0.02;
      for (const target of targets) {
        if (
          !segmentClear(point, target, state.balls, [cue.id, target.id]) ||
          !segmentClearOfTable(state, point, target)
        )
          continue;
        const path = pathAlong(state, point, target);
        if (!path.portal) score = Math.max(score, 20 - path.distance - path.risk);
      }
      candidates.push({ point, score });
    }
  candidates.sort((a, b) => b.score - a.score);
  let best = candidates[0]?.point,
    bestScore = -Infinity;
  // Detailed pot geometry is evaluated at only six promising places, not at
  // every grid square. No simulation, reward prediction, or recursive search.
  for (const candidate of candidates.slice(0, 6)) {
    const copy = {
      ...state,
      balls: state.balls.map((ball) =>
        ball.id === 0 ? { ...ball, ...candidate.point, vx: 0, vz: 0, pocketed: false } : ball,
      ),
    };
    const pots = potCandidates(copy);
    const score = pots.length ? Math.max(...pots.map((p) => p.score)) : candidate.score;
    if (score > bestScore) {
      bestScore = score;
      best = candidate.point;
    }
  }
  if (best) return best;
  // Crowded custom states may cover every coarse-grid square. A finite finer
  // scan still prioritizes legal felt and avoids portals and acceleration pads.
  for (let x = -5.3 * sx; x <= 5.3 * sx; x += 0.25 * sx)
    for (let z = -2.5 * sz; z <= 2.5 * sz; z += 0.25 * sz) {
      if (inPlacementZone(state, { x, z }, kitchen) && isClearBallSpot(state, { x, z }, cue.id, 'ai-fallback'))
        return { x, z };
    }
  // Hazards may cover every calm spot: accept any spot a human could use. An optional placement always has its lie;
  // a lost cue ball may use the whole table when the kitchen has no spot, and fifteen balls cannot cover it all.
  const spot = firstPlacementSpot(state, true);
  if (spot || !cue.pocketed) return spot ?? { x: cue.x, z: cue.z };
  return firstPlacementSpot(state, false) ?? { x: HEAD_STRING_X, z: 0 };
}
/** Picks the group with fewer balls left on the table, then the one lying closer to the pockets. */
export function chooseGroup(state: GameState): Group {
  const cost = (group: Group) =>
    state.balls
      .filter((ball) => !ball.pocketed && groupOf(ball.id) === group)
      .reduce((sum, ball) => sum + 10 + Math.min(...POCKETS.map((p) => Math.hypot(p.x - ball.x, p.z - ball.z))), 0);
  return cost('stripes') < cost('solids') ? 'stripes' : 'solids';
}
