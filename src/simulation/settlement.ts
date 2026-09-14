import { spawnTemporaryPortals } from './arcade';
import { isClearBallSpot, type BallClearancePolicy } from './table-geometry';
import {
  groupOf,
  other,
  seededRandom,
  TABLE,
  type GameState,
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
  respotEight: boolean;
  winner: 0 | 1 | null;
}
export interface ShotSettlement {
  state: GameState;
  outcome: SettlementOutcome;
  respots: RespotTarget[];
  events: Omit<TableEvent, 'time'>[];
}

/** Settle one completed stroke. No input mutation, physics world, timers or callbacks. */
export function settleShot(input: GameState, result: ShotResult, context: SettlementContext): ShotSettlement {
  const state = structuredClone(input),
    shot = structuredClone(result);
  delete state.simulation;
  const shooter = context.shooter ?? state.turn,
    arcade = state.arcade;
  const respots: RespotTarget[] = [],
    events: Omit<TableEvent, 'time'>[] = [];
  const offTable = shot.offTable ?? [],
    isBreak = state.shotCount === 0;
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
  const wrongContact = shot.firstContact !== null && !context.legalBefore.includes(shot.firstContact);
  const obstacleHit = !!arcade && !!shot.obstacleContact;
  const noContact = shot.firstContact === null && !obstacleHit;
  const noRail = !shot.railAfterContact && shot.potted.length === 0 && !obstacleHit;
  const illegalBreak = isBreak && !shot.potted.some((id) => id !== 0) && shot.breakRails.length < 4 && !obstacleHit;
  const foul = offTable.length > 0 || scratched || noContact || wrongContact || noRail || illegalBreak;
  const eightDown = shot.potted.includes(8) || offTable.includes(8),
    respotEight = isBreak && eightDown;
  state.shotCount++;
  state.lastPotted = shot.potted.filter((id) => id !== 0);
  state.foul = foul;
  state.turn = shooter;
  if (eightDown && !isBreak) {
    const legalEight = context.legalBefore.length === 1 && context.legalBefore[0] === 8 && !foul;
    state.winner = legalEight ? shooter : other(shooter);
    state.phase = 'over';
    state.message = offTable.includes(8)
      ? 'The eight left the table. Rack lost.'
      : legalEight
        ? 'Eight ball down. Beautifully played.'
        : scratched
          ? 'The eight and the cue ball went down. Rack lost.'
          : 'The eight went down too early. Rack lost.';
  } else {
    if (!isBreak && !state.groups[shooter] && !foul) {
      const first = shot.potted.find((id) => groupOf(id));
      if (first !== undefined) {
        state.groups[shooter] = groupOf(first);
        state.groups[other(shooter)] = groupOf(first) === 'solids' ? 'stripes' : 'solids';
      }
    }
  }
  // One count feeds turn retention, score, combo and streak outcomes.
  const group = state.groups[shooter];
  let ownPotted = 0,
    opponentPotted = 0;
  for (const id of shot.potted)
    if (id > 0 && id !== 8) {
      if (!group || groupOf(id) === group) ownPotted++;
      else opponentPotted++;
    }
  // Old Rules allowance: a foul hands over two shots (one visit if the fouler held two),
  // a legal miss on the first spends the second, and any legal pot cancels it.
  const oldRules = state.rules === 'old',
    allowance = state.shotsLeft;
  state.shotsLeft = 0;
  if (state.phase !== 'over') {
    let next = foul ? 'Ball in hand.' : 'Keep playing.';
    if (foul) {
      state.turn = other(shooter);
      if (oldRules) state.shotsLeft = allowance > 0 ? 0 : 2;
      // Old Rules: only a scratched or off-table cue ball is placed, and only in the kitchen.
      state.phase = !oldRules || scratched ? 'ball-in-hand' : 'ready';
      if (oldRules)
        next = `${state.shotsLeft ? 'Two shots' : 'One visit'}${scratched ? ' — place the cue ball behind the head string.' : ' from where the cue ball lies.'}`;
      const reason = offTable.length
        ? 'Ball left the table'
        : scratched
          ? 'Cue ball scratched'
          : shot.firstContact === null
            ? 'No ball hit'
            : wrongContact
              ? 'Wrong ball hit first'
              : illegalBreak
                ? 'Break needs four balls to a rail'
                : 'No rail after contact';
      state.message = `${reason}. ${oldRules ? next : 'Ball in hand — click the felt to place.'}`;
    } else {
      const secondShot = ownPotted === 0 && allowance === 2;
      if (ownPotted === 0 && !secondShot) {
        state.turn = other(shooter);
        next = 'Over to the other side.';
      }
      if (secondShot) state.shotsLeft = 1;
      state.phase = 'ready';
      state.message =
        ownPotted > 0
          ? `${ownPotted + opponentPotted === 1 ? 'Nice pot' : 'Beautiful shot'}. Keep the table.`
          : secondShot
            ? 'No pot. Take your second shot.'
            : 'Over to the other side. Make it count.';
    }
    if (respotEight) state.message = 'Eight on the break — respotted. ' + next;
  }
  if (state.format === 'doubles') state.teamOrder[shooter] = other(state.teamOrder[shooter]);
  if (arcade) {
    arcade.combo = foul ? 0 : ownPotted;
    if (!foul)
      arcade.scores[shooter] +=
        ownPotted * 100 + (25 * ownPotted * (ownPotted - 1)) / 2 + (state.winner === shooter ? 500 : 0);
    const previous = arcade.potStreak[shooter];
    // A rescued scratch is a successful ward use, not a comeback-streak scratch.
    arcade.scratchStreak[shooter] = scratched ? arcade.scratchStreak[shooter] + 1 : 0;
    arcade.potStreak[shooter] = !foul && !scratched && ownPotted > 0 ? previous + ownPotted : 0;
    const award = (choices: StatusEffect[], reason: NonNullable<TableEvent['reason']>) => {
      const random = seededRandom(state.seed + ':' + state.shotCount + ':' + shooter + ':' + reason);
      const status = choices[Math.floor(random() * choices.length)];
      arcade.buffs[shooter][status] = 1;
      const cue = state.balls[0];
      events.push({ kind: 'status', status, reason, x: cue.x, z: cue.z, strength: 0.8 });
    };
    if (state.winner === null) {
      if (arcade.scratchStreak[shooter] >= 2) award(['overdrive', 'ward', 'focus'], 'scratch-streak');
      if (ownPotted > 0 && opponentPotted > 0) award(['frozen', 'jammed', 'sticky'], 'mixed-pot');
      if (previous <= 4 && arcade.potStreak[shooter] > 4) award(['frozen', 'jammed', 'sticky'], 'pot-streak');
    }
  }
  if (respotEight && !respot(8, eightSpots(), 'eight-respot')) respot(8, objectSpots(), 'object-respot');
  for (const id of offTable) if (id > 0 && id !== 8) respot(id, objectSpots(), 'object-respot');
  if (arcade) {
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
    outcome: { shooter, foul, scratched, wardRescued, ownPotted, opponentPotted, respotEight, winner: state.winner },
  };
}

function* wardSpots() {
  for (let x = -2.85; x < 5.2; x += 0.4) for (let z = -2.3; z < 2.4; z += 0.4) yield { x, z };
}
function* eightSpots() {
  for (let x = 2.55; x > -5.3; x -= TABLE.radius * 2.1) yield { x, z: 0 };
}
function* objectSpots() {
  for (let ring = 0; ring < 28; ring++)
    for (let i = 0; i < Math.max(1, ring * 8); i++) {
      const angle = (i / Math.max(1, ring * 8)) * Math.PI * 2;
      yield { x: 2.55 + Math.cos(angle) * ring * 0.38, z: Math.sin(angle) * ring * 0.38 };
    }
}
