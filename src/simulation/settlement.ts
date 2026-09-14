import { spawnTemporaryPortals } from './arcade';
import { isClearBallSpot, snookered, type BallClearancePolicy } from './table-geometry';
import {
  BLACK_SPOT,
  groupOf,
  isBreakShot,
  newRack,
  other,
  seededRandom,
  TABLE,
  type GameState,
  type Group,
  type ShotResult,
  type StatusEffect,
  type TableEvent,
} from './types';

export interface SettlementContext {
  legalBefore: readonly number[];
  shooter?: 0 | 1;
  pendingPortal?: boolean;
}
export interface RespotTarget {
  id: number;
  x: number;
  z: number;
}
export interface SettlementOutcome {
  shooter: 0 | 1;
  foul: boolean;
  scratched: boolean;
  wardRescued: boolean;
  ownPotted: number;
  opponentPotted: number;
  /** The eight left the table and was put back on its spot. */
  respotEight: boolean;
  /** Every ball was re-racked for a new break. */
  rerack: boolean;
  winner: 0 | 1 | null;
}
export interface ShotSettlement {
  state: GameState;
  outcome: SettlementOutcome;
  respots: RespotTarget[];
  events: Omit<TableEvent, 'time'>[];
}

/** Settle one completed stroke under the English Pool Association rules of the session's rule set.
 * No input mutation, physics world, timers or callbacks. */
export function settleShot(input: GameState, result: ShotResult, context: SettlementContext): ShotSettlement {
  const state = structuredClone(input),
    shot = structuredClone(result);
  delete state.simulation;
  const shooter = context.shooter ?? state.turn,
    arcade = state.arcade,
    old = state.rules === 'old';
  const respots: RespotTarget[] = [],
    events: Omit<TableEvent, 'time'>[] = [];
  const offTable = shot.offTable ?? [],
    isBreak = isBreakShot(state),
    free = state.freeShot;
  // The physical result is authoritative even for a rule-only caller.
  for (const id of [...shot.potted, ...offTable])
    if (state.balls[id]) {
      Object.assign(state.balls[id], { pocketed: true, vx: 0, vz: 0, vy: 0, airborne: false });
    }
  const respot = (id: number, points: Iterable<{ x: number; z: number }>, policy: BallClearancePolicy): boolean => {
    for (const point of points)
      if (isClearBallSpot(state, point, id, policy)) {
        Object.assign(state.balls[id], point, { pocketed: false, vx: 0, vz: 0, vy: 0, elevation: 0, airborne: false });
        respots.push({ id, ...point });
        return true;
      }
    return false;
  };
  let wardRescued = false;
  if (arcade?.activeShot.ward && shot.potted.includes(0) && !shot.potted.includes(8) && offTable.length === 0) {
    wardRescued = respot(0, wardSpots(), 'ward-respot');
    if (wardRescued) shot.potted = shot.potted.filter((id) => id !== 0);
  }
  const scratched = shot.potted.includes(0) || offTable.includes(0);
  const group = state.groups[shooter],
    objectPots = shot.potted.filter((id) => groupOf(id));
  // A black potted on any break re-racks for the same breaker; nothing else on that shot counts.
  const eightBreak = isBreak && shot.potted.includes(8);
  const obstacleHit = !!arcade && !!shot.obstacleContact;
  // The break is exempt from the first-contact and cushion requirements.
  const wrongContact = !isBreak && shot.firstContact !== null && !context.legalBefore.includes(shot.firstContact);
  const noContact = shot.firstContact === null && !obstacleHit;
  // Old Rules need only contact; New Rules also need a pot or a ball to a cushion after contact.
  const noRail = !old && !isBreak && !shot.railAfterContact && shot.potted.length === 0 && !obstacleHit;
  const illegalBreak =
    isBreak && !shot.potted.some((id) => id !== 0) && shot.breakRails.length < (old ? 2 : 4) && !obstacleHit;
  // An Old Rules free shot makes every pot legal. A New Rules free ball makes the first ball hit count as the
  // shooter's own for that shot (a simplification of nominating one ball after a foul snooker).
  const nominatedBall = free && !old ? shot.firstContact : null;
  const own = (id: number, mine = group) => !mine || groupOf(id) === mine || (free && old) || id === nominatedBall;
  const opponentPot = objectPots.some((id) => !own(id));
  const foul =
    !eightBreak &&
    (offTable.length > 0 || scratched || noContact || wrongContact || noRail || illegalBreak || opponentPot);
  const eightPotted = !isBreak && shot.potted.includes(8);
  const onEight = free
    ? !!group && !input.balls.some((ball) => groupOf(ball.id) === group && !ball.pocketed)
    : context.legalBefore.length === 1 && context.legalBefore[0] === 8;
  const allowance = state.shotsLeft;
  state.shotCount++;
  state.lastPotted = shot.potted.filter((id) => id !== 0);
  state.foul = foul;
  state.turn = shooter;
  state.shotsLeft = 0;
  state.freeShot = false;
  state.rebreak = false;
  // Groups: the first legal pot decides (Old Rules count the break). Balls of both groups, or any New Rules break
  // pot, let the shooter choose; a New Rules nomination of a group not potted needs a pot of it on the next shot.
  let choosing = false;
  if (!foul && !eightBreak && !eightPotted && !group) {
    const potted = new Set(objectPots.map(groupOf));
    const decide = (chosen: Group) => {
      state.groups[shooter] = chosen;
      state.groups[other(shooter)] = chosen === 'solids' ? 'stripes' : 'solids';
    };
    if (state.nominated && potted.has(state.nominated)) decide(state.nominated);
    else if (potted.size === 2 || (potted.size === 1 && isBreak && !old)) choosing = true;
    else if (potted.size === 1) decide([...potted][0]!);
  }
  state.nominated = null;
  let ownPotted = 0,
    opponentPotted = 0;
  if (!eightBreak)
    for (const id of objectPots)
      if (own(id, state.groups[shooter])) ownPotted++;
      else opponentPotted++;
  // An off-table black is a foul, not a loss: it goes back on its rack position, then any object balls follow it.
  const respotEight = offTable.includes(8);
  if (!eightBreak)
    for (const id of [...offTable].sort((a, b) => (a === 8 ? -1 : b === 8 ? 1 : a - b)))
      if (id > 0 && !respot(id, blackSpots(), id === 8 ? 'eight-respot' : 'object-respot'))
        respot(id, objectSpots(), 'object-respot');
  const rerack = eightBreak || (foul && illegalBreak);
  if (eightPotted) {
    const legalEight = onEight && !foul;
    state.winner = legalEight ? shooter : other(shooter);
    state.phase = 'over';
    state.message = legalEight
      ? 'Eight ball down. Beautifully played.'
      : scratched
        ? 'The eight and the cue ball went down. Rack lost.'
        : !onEight
          ? 'The eight went down too early. Rack lost.'
          : 'The eight went down on a foul. Rack lost.';
  } else if (rerack) {
    respots.length = 0;
    for (const ball of newRack(`${state.seed}:rack:${state.shotCount}`)) {
      Object.assign(state.balls[ball.id], {
        x: ball.x,
        z: ball.z,
        pocketed: false,
        vx: 0,
        vz: 0,
        vy: 0,
        elevation: 0,
        airborne: false,
      });
      respots.push({ id: ball.id, x: ball.x, z: ball.z });
    }
    state.groups = [null, null];
    state.lastPotted = [];
    state.rebreak = true;
    state.phase = 'ready';
    if (eightBreak) {
      state.shotsLeft = allowance;
      state.message = 'Eight on the break. Re-racked: break again.';
    } else {
      state.turn = other(shooter);
      state.shotsLeft = 2;
      state.message = 'Foul break. Re-racked: the other side breaks with two visits.';
    }
  } else if (foul) {
    // New Rules: a cue ball lost on a fair break only passes the turn.
    const turnOnly = !old && isBreak && scratched && offTable.every((id) => id === 0);
    state.turn = other(shooter);
    state.shotsLeft = turnOnly ? 0 : 2;
    // A lost cue ball must be placed in the kitchen. Otherwise Old Rules offer a free shot and optional kitchen
    // placement; New Rules offer both only when the incoming player is foul snookered. The EPA poster is silent on a
    // snooker after an in-off, so a lost cue ball never earns a free ball here, even if every kitchen spot is snookered.
    state.freeShot = old ? true : !scratched && snookered(state, state.turn);
    state.phase = scratched || state.freeShot ? 'ball-in-hand' : 'ready';
    const reason = offTable.length
      ? 'Ball left the table'
      : scratched
        ? 'Cue ball potted'
        : noContact
          ? 'No ball hit'
          : wrongContact
            ? 'Wrong ball hit first'
            : illegalBreak
              ? 'Foul break'
              : opponentPot
                ? 'Opponent’s ball potted'
                : 'No cushion after contact';
    state.message = `${reason}. ${turnOnly ? 'Over to the other side.' : 'Two visits to the other side.'}`;
  } else {
    // Two visits: a pot continues the current visit, a miss on the first visit starts the second.
    if (ownPotted > 0) state.shotsLeft = allowance;
    else if (allowance === 2) state.shotsLeft = 1;
    else state.turn = other(shooter);
    state.phase = choosing ? 'choose-group' : 'ready';
    state.message =
      ownPotted > 0
        ? `${ownPotted + opponentPotted === 1 ? 'Nice pot' : 'Beautiful shot'}. Keep the table.`
        : allowance === 2
          ? 'No pot. Your second visit.'
          : 'Over to the other side. Make it count.';
  }
  // A black on the break re-racks for the same breaker, so the partners do not rotate.
  if (state.format === 'doubles' && !eightBreak) state.teamOrder[shooter] = other(state.teamOrder[shooter]);
  if (arcade) {
    const lostCue = scratched && !eightBreak;
    arcade.combo = foul ? 0 : ownPotted;
    if (!foul)
      arcade.scores[shooter] +=
        ownPotted * 100 + (25 * ownPotted * (ownPotted - 1)) / 2 + (state.winner === shooter ? 500 : 0);
    const previous = arcade.potStreak[shooter];
    // A rescued scratch is a successful ward use, not a comeback-streak scratch.
    arcade.scratchStreak[shooter] = lostCue ? arcade.scratchStreak[shooter] + 1 : 0;
    arcade.potStreak[shooter] = !foul && !lostCue && ownPotted > 0 ? previous + ownPotted : 0;
    const award = (choices: StatusEffect[], reason: NonNullable<TableEvent['reason']>) => {
      const random = seededRandom(state.seed + ':' + state.shotCount + ':' + shooter + ':' + reason);
      const status = choices[Math.floor(random() * choices.length)];
      arcade.buffs[shooter][status] = 1;
      const cue = state.balls[0];
      events.push({ kind: 'status', status, reason, x: cue.x, z: cue.z, strength: 0.8 });
    };
    if (state.winner === null) {
      if (arcade.scratchStreak[shooter] >= 2) award(['overdrive', 'ward', 'focus'], 'scratch-streak');
      // Arcade debuff on top of the foul for potting an opponent's ball alongside your own.
      if (ownPotted > 0 && opponentPotted > 0) award(['frozen', 'jammed', 'sticky'], 'mixed-pot');
      if (previous <= 4 && arcade.potStreak[shooter] > 4) award(['frozen', 'jammed', 'sticky'], 'pot-streak');
    }
    const created = context.pendingPortal && state.winner === null && spawnTemporaryPortals(state);
    if (!created && arcade.portalTurns > 0) arcade.portalTurns--;
    if (arcade.portalTurns === 0 || state.winner !== null) {
      arcade.hazards = arcade.hazards.filter((h) => h.kind !== 'portal');
      arcade.portalTurns = 0;
    }
  }
  return {
    state,
    respots,
    events,
    outcome: {
      shooter,
      foul,
      scratched,
      wardRescued,
      ownPotted,
      opponentPotted,
      respotEight,
      rerack,
      winner: state.winner,
    },
  };
}

/** The shooter's group choice. A potted group is decided at once; a New Rules nomination of a group not potted
 * waits for the next shot. Returns the state changes, or null when no choice is due or the group is invalid. */
export function groupChoice(
  state: GameState,
  group: unknown,
): Pick<GameState, 'groups' | 'nominated' | 'phase' | 'message'> | null {
  if (state.phase !== 'choose-group' || (group !== 'solids' && group !== 'stripes')) return null;
  const potted = state.lastPotted.some((id) => groupOf(id) === group),
    groups: GameState['groups'] = [null, null];
  groups[state.turn] = group;
  groups[other(state.turn)] = group === 'solids' ? 'stripes' : 'solids';
  return potted
    ? { groups, nominated: null, phase: 'ready', message: `You are on ${group}.` }
    : { groups: [null, null], nominated: group, phase: 'ready', message: `Pot one of the ${group} to claim them.` };
}

function* wardSpots() {
  for (let x = -2.85; x < 5.2; x += 0.4) for (let z = -2.3; z < 2.4; z += 0.4) yield { x, z };
}
/** The black's rack position, then the nearest clear point along the table's long axis. EPA spotting works along
 * that line; at equal distance the side toward the foot cushion is tried first. */
function* blackSpots() {
  yield BLACK_SPOT;
  for (let step = 1; step < 32; step++)
    for (const side of [1, -1]) yield { x: BLACK_SPOT.x + side * step * TABLE.radius * 2.2, z: 0 };
}
function* objectSpots() {
  for (let ring = 0; ring < 28; ring++)
    for (let i = 0; i < Math.max(1, ring * 8); i++) {
      const angle = (i / Math.max(1, ring * 8)) * Math.PI * 2;
      yield { x: 2.55 + Math.cos(angle) * ring * 0.38, z: Math.sin(angle) * ring * 0.38 };
    }
}
