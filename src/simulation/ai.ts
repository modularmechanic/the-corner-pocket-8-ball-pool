import { equippedCue } from './cues';
import { circleInterval, firstPlacementSpot, firstTableBoundary, firstTableContact, HEAD_STRING_X, inPlacementZone, isClearBallSpot, kitchenPlacement, RAIL_RESTITUTION, ROLLING_RESISTANCE, segmentClearOfTable, STICKY_DRAG, surfaceDrag, type Point } from './table-geometry';
import { TABLE, POCKETS, legalTargets, type Ball, type Difficulty, type GameState, type Shot } from './types';

interface Path { distance: number; portal: boolean; risk: number; runs: { distance: number; drag: number; boost: number }[] }
interface Candidate { angle: number; speed: number; score: number }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function segmentClear(a: Point, b: Point, balls: Ball[], exclude: number[], clearance = TABLE.radius * 2.06): boolean {
  const dx = b.x - a.x, dz = b.z - a.z, len = dx * dx + dz * dz;
  return !balls.some(ball => {
    if (ball.pocketed || exclude.includes(ball.id)) return false;
    const t = clamp(((ball.x - a.x) * dx + (ball.z - a.z) * dz) / (len || 1), 0, 1);
    return Math.hypot(ball.x - a.x - t * dx, ball.z - a.z - t * dz) < clearance;
  });
}
function pathAlong(state: GameState, a: Point, b: Point): Path {
  const distance = Math.hypot(b.x - a.x, b.z - a.z);
  if (distance < 1e-8) return { distance: 0, portal: false, risk: 0, runs: [] };
  const dx = (b.x - a.x) / distance, dz = (b.z - a.z) / distance;
  const crossings: { start: number; end: number; drag: number; boost: number }[] = [];
  let portal = false, risk = 0;
  for (const hazard of state.arcade?.hazards || []) {
    const hit = circleInterval(a, dx, dz, distance, hazard, hazard.radius);
    if (!hit) continue;
    if (hazard.kind === 'portal') portal = true;
    if (hazard.kind === 'smoke') risk += 1.5;
    const drag = surfaceDrag(hazard.kind);
    const aligned = dx * Math.cos(hazard.angle || 0) + dz * Math.sin(hazard.angle || 0) >= .25;
    const boost = hazard.kind === 'electric' ? 1.18 : hazard.kind === 'ramp' && aligned ? 1.14 : 1;
    crossings.push({ start: hit[0], end: hit[1], drag, boost });
    risk += (drag - 1) * (hit[1] - hit[0]) * .12;
  }
  const marks = [...new Set([0, distance, ...crossings.flatMap(h => [h.start, h.end])])].sort((a, b) => a - b);
  const runs: Path['runs'] = [];
  for (let i = 1; i < marks.length; i++) {
    const start = marks[i - 1], end = marks[i], middle = (start + end) / 2;
    let drag = 1, boost = 1;
    for (const crossing of crossings) {
      if (middle >= crossing.start && middle <= crossing.end) drag = Math.max(drag, crossing.drag);
      if (Math.abs(crossing.start - start) < 1e-8) boost *= crossing.boost;
    }
    runs.push({ distance: end - start, drag, boost });
  }
  return { distance, portal, risk, runs };
}
// Integral of dv/dt = -.42 - .12v expressed as travel distance. Reversing
// each short surface segment keeps the estimate consistent with actual drag.
function stoppingDistance(speed: number) { const { constant, linear } = ROLLING_RESISTANCE; return speed / linear - constant / (linear * linear) * Math.log1p(linear * speed / constant); }
function speedForDistance(distance: number, arrival: number): number {
  const target = stoppingDistance(arrival) + distance;
  let low = arrival, high = Math.max(arrival + 1, Math.sqrt(arrival * arrival + 2 * (ROLLING_RESISTANCE.constant + ROLLING_RESISTANCE.linear * 32) * distance));
  high = Math.max(high, arrival + distance * ROLLING_RESISTANCE.linear + 1);
  for (let i = 0; i < 18; i++) { const speed = (low + high) / 2; if (stoppingDistance(speed) < target) low = speed; else high = speed; }
  return (low + high) / 2;
}
function requiredSpeed(path: Path, arrival: number, sticky = false): number {
  let speed = arrival;
  for (let i = path.runs.length - 1; i >= 0; i--) {
    const run = path.runs[i];
    speed = speedForDistance(run.distance * run.drag * (sticky ? STICKY_DRAG : 1), speed);
    if (run.boost > 1 && speed > 23) return Infinity;
    speed /= run.boost;
  }
  return speed;
}
function cueScale(state: GameState) {
  const buffs = state.arcade?.buffs[state.turn];
  return equippedCue(state).power * (buffs?.overdrive ? 1.3 : 1) * (buffs?.frozen ? .65 : 1);
}
function powerForSpeed(state: GameState, speed: number) { return clamp((speed / cueScale(state) - 1.4) / 15, .05, 1); }
function pickupBonus(state: GameState, a: Point, b: Point): number {
  const distance = Math.hypot(b.x - a.x, b.z - a.z);
  if (!distance) return 0;
  // Prefer public pickup positions without predicting future random spawns.
  const count = (state.arcade?.pickups || []).filter(p => p.available && circleInterval(a, (b.x - a.x) / distance, (b.z - a.z) / distance, distance, p, p.radius + TABLE.radius)).length;
  return Math.min(2, count) * 1.3;
}
function potCandidates(state: GameState): Candidate[] {
  const cue = state.balls[0], sticky = !!state.arcade?.buffs[state.turn].sticky;
  const candidates: Candidate[] = [], maximum = 16.4 * cueScale(state);
  for (const target of legalTargets(state)) for (const pocket of POCKETS) {
    const distance = Math.hypot(pocket.x - target.x, pocket.z - target.z);
    if (distance < 1e-5) continue;
    const nx = (pocket.x - target.x) / distance, nz = (pocket.z - target.z) / distance;
    const ghost = { x: target.x - nx * TABLE.radius * 2.01, z: target.z - nz * TABLE.radius * 2.01 };
    const cueDistance = Math.hypot(ghost.x - cue.x, ghost.z - cue.z);
    if (cueDistance < .02) continue;
    const dot = (nx * (ghost.x - cue.x) + nz * (ghost.z - cue.z)) / cueDistance;
    if (dot < .26 || Math.abs(ghost.x) > TABLE.halfWidth - TABLE.radius || Math.abs(ghost.z) > TABLE.halfDepth - TABLE.radius) continue;
    if (!segmentClearOfTable(state, cue, ghost) || !segmentClearOfTable(state, target, pocket) || !segmentClear(cue, ghost, state.balls, [0, target.id]) || !segmentClear(target, pocket, state.balls, [0, target.id])) continue;
    const first = pathAlong(state, cue, ghost), second = pathAlong(state, target, pocket);
    if (first.portal || second.portal) continue;
    const speed = requiredSpeed(first, requiredSpeed(second, .75) / (.98 * dot), sticky);
    if (!Number.isFinite(speed) || speed > maximum) continue;
    candidates.push({ angle: Math.atan2(ghost.z - cue.z, ghost.x - cue.x), speed, score: 30 + dot * 8 - distance * .5 - cueDistance * .35 - speed * .12 - first.risk - second.risk + pickupBonus(state, cue, ghost) + pickupBonus(state, target, pocket) });
  }
  return candidates;
}
function safetyCandidates(state: GameState): Candidate[] {
  const cue = state.balls[0], legal = new Set(legalTargets(state).map(b => b.id)), sticky = !!state.arcade?.buffs[state.turn].sticky;
  const maximum = 16.4 * cueScale(state), candidates: Candidate[] = [];
  const addRay = (angle: number, score: number, pickupDistance?: number) => {
    const contact = firstTableContact(state, cue, angle);
    const target = contact.kind === 'ball' ? state.balls.find(ball => ball.id === contact.id) : undefined;
    if (contact.kind !== 'obstacle' && (!target || !legal.has(target.id))) return;
    if (pickupDistance !== undefined && contact.distance < pickupDistance + .04) return;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const endpoint = { x: cue.x + dx * contact.distance, z: cue.z + dz * contact.distance };
    const path = pathAlong(state, cue, endpoint);
    if (path.portal || requiredSpeed(path, .65, sticky) > maximum) return;
    let arrival = 4.0;
    if (target) {
      const afterContact = firstTableBoundary(state, target, angle), afterDistance = afterContact.distance;
      const after = pathAlong(state, target, { x: target.x + dx * afterDistance, z: target.z + dz * afterDistance });
      if (afterContact.kind === 'portal') score -= 4;
      const normalDot = clamp(((target.x - endpoint.x) * dx + (target.z - endpoint.z) * dz) / (TABLE.radius * 2), .25, 1);
      arrival = Math.min(11, requiredSpeed(after, 1) / (.98 * normalDot));
    }
    const speed = Math.min(maximum, requiredSpeed(path, arrival, sticky));
    if (Number.isFinite(speed)) candidates.push({ angle, speed, score: score - path.distance * .6 - speed * .16 - path.risk + pickupBonus(state, cue, endpoint) });
  };
  for (const target of legalTargets(state)) addRay(Math.atan2(target.z - cue.z, target.x - cue.x), 12);
  for (const block of state.arcade?.obstacles || []) if (block.hp > 0) addRay(Math.atan2(block.z - cue.z, block.x - cue.x), 10 + (block.hp === 1 ? 1 : 0));
  for (const pickup of state.arcade?.pickups || []) if (pickup.available) addRay(Math.atan2(pickup.z - cue.z, pickup.x - cue.x), 14, Math.hypot(pickup.x - cue.x, pickup.z - cue.z));
  // A bounded angular scan can see exposed edges when an object's center is blocked.
  if (!candidates.length) for (let i = 0; i < 48; i++) addRay(i * Math.PI / 24, 1);
  return candidates;
}
function bankCandidates(state: GameState): Candidate[] {
  const cue = state.balls[0], candidates: Candidate[] = [], sticky = !!state.arcade?.buffs[state.turn].sticky;
  for (const target of legalTargets(state)) for (const [axis, side] of [['x', -1], ['x', 1], ['z', -1], ['z', 1]] as const) {
    const rail = side * (axis === 'x' ? TABLE.halfWidth - TABLE.radius : TABLE.halfDepth - TABLE.radius);
    const reflected = { ...target, [axis]: rail * 2 - target[axis] }, denominator = reflected[axis] - cue[axis];
    if (Math.abs(denominator) < 1e-5) continue;
    const fraction = (rail - cue[axis]) / denominator;
    if (fraction <= 0 || fraction >= 1) continue;
    const bounce = { x: cue.x + (reflected.x - cue.x) * fraction, z: cue.z + (reflected.z - cue.z) * fraction };
    if (POCKETS.some(p => Math.hypot(bounce.x - p.x, bounce.z - p.z) < .6)) continue;
    if (!segmentClear(cue, bounce, state.balls, [0]) || !segmentClear(bounce, target, state.balls, [0, target.id]) || !segmentClearOfTable(state, cue, bounce) || !segmentClearOfTable(state, bounce, target)) continue;
    const first = pathAlong(state, cue, bounce), second = pathAlong(state, bounce, target);
    if (first.portal || second.portal) continue;
    const speed = requiredSpeed(first, requiredSpeed(second, 5, sticky) / RAIL_RESTITUTION, sticky);
    if (speed <= 16.4 * cueScale(state)) candidates.push({ angle: Math.atan2(bounce.z - cue.z, bounce.x - cue.x), speed, score: -(first.distance + second.distance) });
  }
  return candidates;
}
export function chooseShot(state: GameState, difficulty: Difficulty, random = Math.random): Shot {
  const cue = state.balls[0];
  if (state.shotCount === 0) {
    const apex = state.balls.find(b => b.id === 1 && !b.pocketed) || { x: 2.55, z: 0 };
    const angle = Math.atan2(apex.z - cue.z, apex.x - cue.x) + (random() - .5) * (difficulty === 'expert' ? .006 : .025);
    const route = pathAlong(state, cue, apex);
    const speed = requiredSpeed(route, difficulty === 'casual' ? 9 : 12, !!state.arcade?.buffs[state.turn].sticky);
    return { angle, power: powerForSpeed(state, speed) };
  }
  let options = potCandidates(state);
  if (!options.length) options = safetyCandidates(state);
  if (!options.length) options = bankCandidates(state);
  options.sort((a, b) => b.score - a.score);
  const choices = difficulty === 'casual' ? Math.min(4, options.length) : difficulty === 'regular' ? Math.min(2, options.length) : Math.min(1, options.length);
  const selected = options[choices > 1 ? Math.floor(clamp(random(), 0, .999999) * choices) : 0];
  // Completely snookered states can have no modeled legal route; still make a
  // finite shot toward a legal target rather than getting stuck in the turn.
  const fallback = legalTargets(state)[0];
  const shot = selected || { angle: fallback ? Math.atan2(fallback.z - cue.z, fallback.x - cue.x) : 0, speed: 7, score: 0 };
  const focus = state.arcade?.buffs[state.turn].focus ? .6 : 1;
  const error = (difficulty === 'casual' ? .065 : difficulty === 'regular' ? .018 : .0025) * focus;
  return { angle: shot.angle + (random() - .5) * error * 2, power: clamp(powerForSpeed(state, shot.speed) * (1 + (random() - .5) * (difficulty === 'casual' ? .32 : difficulty === 'regular' ? .08 : .02)), .05, 1) };
}
export function choosePlacement(state: GameState): Point {
  const targets = legalTargets(state), candidates: { point: Point; score: number }[] = [], kitchen = kitchenPlacement(state);
  for (let x = -4.9; x < 5; x += .65) for (let z = -2.2; z < 2.3; z += .65) {
    const point = { x, z };
    if (!inPlacementZone(state, point, kitchen) || !isClearBallSpot(state, point, 0, 'ai-placement')) continue;
    let score = -Math.abs(x) * .02;
    for (const target of targets) {
      if (!segmentClear(point, target, state.balls, [0, target.id]) || !segmentClearOfTable(state, point, target)) continue;
      const path = pathAlong(state, point, target);
      if (!path.portal) score = Math.max(score, 20 - path.distance - path.risk);
    }
    candidates.push({ point, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  let best = candidates[0]?.point, bestScore = -Infinity;
  // Detailed pot geometry is evaluated at only six promising places, not at
  // every grid square. No simulation, reward prediction, or recursive search.
  for (const candidate of candidates.slice(0, 6)) {
    const copy = { ...state, balls: state.balls.map(ball => ball.id === 0 ? { ...ball, ...candidate.point, vx: 0, vz: 0, pocketed: false } : ball) };
    const pots = potCandidates(copy);
    const score = pots.length ? Math.max(...pots.map(p => p.score)) : candidate.score;
    if (score > bestScore) { bestScore = score; best = candidate.point; }
  }
  if (best) return best;
  // Crowded custom states may cover every coarse-grid square. A finite finer
  // scan still prioritizes legal felt and avoids portals and acceleration pads.
  for (let x = -5.3; x <= 5.3; x += .25) for (let z = -2.5; z <= 2.5; z += .25) {
    if (inPlacementZone(state, { x, z }, kitchen) && isClearBallSpot(state, { x, z }, 0, 'ai-fallback')) return { x, z };
  }
  // Hazards may cover every calm spot: accept any spot a human could use. kitchenPlacement already
  // opened the table if the kitchen has none, and fifteen balls cannot cover the whole table.
  return firstPlacementSpot(state, true) ?? firstPlacementSpot(state, false) ?? { x: HEAD_STRING_X, z: 0 };
}
