import type { RespotTarget, SettlementContext, ShotSettlement } from '../settlement';
import {
  cueBallId,
  other,
  type Ball,
  type GameModeId,
  type GameOptions,
  type GameState,
  type ShotResult,
  type TableEvent,
} from '../types';
import { BLACK, BLUE, BROWN, PINK, SNOOKER_SPOTS, YELLOW } from './snooker';
import { SNOOKER_TABLE, type TablePoint, type TableSpec } from './table';

/** Rulings below cite the WPBSA Official Rules of the Games of Snooker and English Billiards, English Billiards
 * part: Section 2 is the definitions, Section 3 the game. English Billiards is played on the same 12-foot table as
 * snooker (Section 1 Rule 1), so this mode reuses SNOOKER_TABLE and the snooker spot positions unchanged. */

/** Ball ids. Index is id, as every other mode assumes. Each side owns a cue ball and the other side's cue ball is an
 * object ball for them (Section 3 Rule 1(a)): plain White for player 0, Yellow (spot white) for player 1. */
export const WHITE = 0,
  RED = 1,
  YELLOW_BALL = 2;
/** The striker's own cue ball. Player 0 plays White, player 1 plays Yellow. The engine asks the same question of
 * every mode through `cueBallId`, so this is that one branch seen from inside the mode rather than a second copy. */
export const cueBallOf = (player: 0 | 1): number => cueBallId({ mode: 'billiards', turn: player });
/** Section 3 Rule 4(a),(b): the Red scores three, either cue ball two, whether potted or gone in-off. */
export const valueOf = (id: number): number => (id === RED ? 3 : id === WHITE || id === YELLOW_BALL ? 2 : 0);

/** Section 3 Rule 16(c): every foul costs two, and never more than two in one stroke. */
export const FOUL_PENALTY = 2;
/** Section 3 Rule 10: consecutive cannons not in conjunction with a hazard are limited to seventy-five. */
export const CANNON_LIMIT = 75;
/** Section 3 Rule 11: consecutive hazard strokes not in conjunction with a cannon are limited to fifteen. */
export const HAZARD_LIMIT = 15;
/** Section 3 Rule 1(f)(ii): the winner is the first to the stipulated number of points. A timed game (1(f)(i)) needs
 * a clock, which a deterministic rules layer has no business owning, so only the points target is offered here. */
export const DEFAULT_TARGET = 100;

const T = SNOOKER_TABLE;
/** The three spots English Billiards uses, which are the snooker black, pink and blue spots (Section 1 Rule 2). */
export const BILLIARD_SPOT = SNOOKER_SPOTS[BLACK],
  PYRAMID_SPOT = SNOOKER_SPOTS[PINK],
  CENTRE_SPOT = SNOOKER_SPOTS[BLUE];
/** Section 3 Rule 11(c) puts a cue ball still off the table after the fifteenth hazard on the middle of the
 * Baulk-line, or the right-hand corner of the "D" viewed from the Baulk end — the snooker brown and yellow spots.
 * Yellow is the right-hand corner looking up the table from baulk, which snooker.ts places at positive z. */
const HAZARD_LIMIT_SPOTS: TablePoint[] = [SNOOKER_SPOTS[BROWN], SNOOKER_SPOTS[YELLOW]];

/** English Billiards bookkeeping. GameState has no slot for it and types.ts belongs to another lane, so the running
 * counts the consecutive-stroke rules need live here and BilliardsState carries them alongside GameState. */
export interface BilliardsBook {
  scores: [number, number];
  /** Points that end the game (Section 3 Rule 5(d): reaching or passing it finishes). */
  target: number;
  /** Cannons made in a row in this break with no hazard in the stroke (Section 3 Rule 10). */
  cannonRun: number;
  /** Hazard strokes made in a row in this break with no cannon in the stroke (Section 3 Rule 11). */
  hazardRun: number;
  /** Pots of the Red in a row in this break with nothing else scored, which drive the spotting cycle (Rule 9(b),(c)). */
  redPotRun: number;
}
export type BilliardsState = GameState & { billiards: BilliardsBook };
/** ShotResult reports only the ball struck first, but a cannon is defined by contact with *both* object balls
 * (Section 2 Rule 11), so the caller must report every object ball the cue ball touched. Absent, only the first
 * contact is known and no cannon can be scored. */
export type BilliardsShotResult = ShotResult & { contacts?: readonly number[] };

/** The seam's GameModeSpec types `id` as GameModeId, which does not yet include 'billiards'. This local shape is
 * the same contract with the literal id; the integration step that widens GameModeId can drop it. */
export interface BilliardsModeSpec {
  id: 'billiards';
  label: string;
  table: TableSpec;
  initialState(seed: string, options?: GameOptions): BilliardsState;
  rack(seed?: string): Ball[];
  legalTargets(state: GameState, player?: 0 | 1): Ball[];
  settle(state: GameState, result: BilliardsShotResult, context: SettlementContext): ShotSettlement;
}

/** Section 2 Rule 20: a spot is occupied if a ball cannot be placed on it without touching another ball. */
const occupied = (state: GameState, point: TablePoint, ignore: number): boolean =>
  state.balls.some(
    (ball) =>
      ball.id !== ignore && !ball.pocketed && Math.hypot(ball.x - point.x, ball.z - point.z) < T.radius * 2 - 1e-9,
  );
const freeSpot = (state: GameState, id: number, spots: readonly TablePoint[]): TablePoint =>
  spots.find((spot) => !occupied(state, spot, id)) ?? spots[spots.length - 1];

/** Section 3 Rule 2(b): the Red is placed on the Spot and the first player plays from in-hand. Both cue balls start
 * in-hand (Section 2 Rule 13(a)(i)), which this engine spells as pocketed until placed. Nothing is shuffled, so the
 * seed is unused; it stays in the signature so every mode racks the same way. */
export function billiardsRack(_seed?: string): Ball[] {
  return [
    { id: WHITE, x: T.placement.headStringX, z: 0, vx: 0, vz: 0, pocketed: true },
    { id: RED, ...BILLIARD_SPOT, vx: 0, vz: 0, pocketed: false },
    { id: YELLOW_BALL, x: T.placement.headStringX, z: 0, vx: 0, vz: 0, pocketed: true },
  ];
}

export function initialBilliardsState(seed: string, target = DEFAULT_TARGET): BilliardsState {
  return {
    // The seam's GameModeId does not list 'billiards' yet; the integration step widens it and this cast goes away.
    mode: 'billiards' as GameModeId,
    format: 'singles',
    rules: 'new',
    teamOrder: [0, 0],
    cues: ['ash-house', 'ash-house'],
    shotsLeft: 0,
    freeShot: false,
    nominated: null,
    rebreak: false,
    seed,
    balls: billiardsRack(seed),
    turn: 0,
    groups: [null, null],
    phase: 'ball-in-hand',
    shotCount: 0,
    winner: null,
    message: 'Play from the D.',
    lastPotted: [],
    foul: false,
    chalked: [false, false],
    billiards: { scores: [0, 0], target, cannonRun: 0, hazardRun: 0, redPotRun: 0 },
  };
}

/** Either object ball may be struck first (Section 3 Rule 4 scores off both), so the targets are simply the balls on
 * the table that are not the striker's own cue ball. */
export function billiardsTargets(state: GameState, player: 0 | 1 = state.turn): Ball[] {
  const cue = cueBallOf(player);
  return state.balls.filter((ball) => ball.id !== cue && !ball.pocketed);
}

/** Settle one completed stroke of English Billiards. Pure: no input mutation, physics world, timers or callbacks,
 * matching the eight-ball and snooker settlements so any of them can sit behind the same seam. */
export function settleBilliardsShot(
  input: GameState,
  result: BilliardsShotResult,
  context: SettlementContext,
): ShotSettlement {
  const state = structuredClone(input) as BilliardsState;
  delete state.simulation;
  const before = (input as BilliardsState).billiards,
    book = state.billiards;
  const shooter = context.shooter ?? state.turn,
    opponent = other(shooter);
  const respots: RespotTarget[] = [],
    events: Omit<TableEvent, 'time'>[] = [];
  const cue = cueBallOf(shooter),
    theirs = cueBallOf(opponent);
  const offTable = result.offTable ?? [],
    potted = result.potted;
  const down = [...new Set([...potted, ...offTable])];
  for (const id of down)
    if (state.balls[id]) Object.assign(state.balls[id], { pocketed: true, vx: 0, vz: 0, vy: 0, airborne: false });

  /** Section 2 Rule 9: an in-off is the cue ball entering a pocket after contacting an object ball, and off the ball
   * hit first when both were hit. Being forced off the table is not an in-off — it is a foul (Section 3 Rule 15(j)). */
  const first = result.firstContact;
  const contacts = new Set(result.contacts ?? (first === null ? [] : [first]));
  const cannon = contacts.has(RED) && contacts.has(theirs);
  const inOff = potted.includes(cue) && first !== null;
  const pots = down.filter((id) => id !== cue && contacts.size > 0 && potted.includes(id));

  /** A stroke's runs are counted before the limits are judged, because exceeding either is itself the foul
   * (Section 3 Rule 15(k),(l)) rather than a cap that silently ends the break. */
  const hazard = inOff || pots.length > 0;
  const cannonRun = cannon && !hazard ? before.cannonRun + 1 : 0;
  const hazardRun = hazard && !cannon ? before.hazardRun + 1 : 0;
  const foul =
    first === null || // Section 3 Rule 15(o) and Rule 17: missing every object ball costs two either way.
    offTable.length > 0 || // Section 3 Rule 15(j).
    cannonRun > CANNON_LIMIT || // Section 3 Rule 15(l).
    hazardRun > HAZARD_LIMIT; // Section 3 Rule 15(k).

  /** Section 3 Rule 4: a cannon two, a pot or in-off three off the Red and two off a cue ball, and every hazard and
   * cannon in one stroke scores (4(c),(d)). Section 3 Rule 16(b): a foul stroke scores nothing. */
  const scored = foul
    ? 0
    : (cannon ? 2 : 0) + pots.reduce((sum, id) => sum + valueOf(id), 0) + (inOff ? valueOf(first) : 0);
  if (foul) book.scores[opponent] += FOUL_PENALTY;
  else book.scores[shooter] += scored;

  /** Section 3 Rule 9(b),(c): the Red potted on its own in consecutive strokes of a break goes to the Spot twice,
   * then the Centre Spot, in sequence. Any other stroke breaks the sequence. */
  const lonePotRed = !foul && pots.length === 1 && pots[0] === RED && !cannon && !inOff;
  book.redPotRun = lonePotRed ? before.redPotRun + 1 : 0;
  book.cannonRun = foul ? 0 : cannonRun;
  book.hazardRun = foul ? 0 : hazardRun;

  const place = (id: number, spots: readonly TablePoint[]): void => {
    const point = freeSpot(state, id, spots);
    Object.assign(state.balls[id], point, { pocketed: false, vx: 0, vz: 0, vy: 0, elevation: 0, airborne: false });
    respots.push({ id, ...point });
  };
  /** Section 3 Rule 9(a): the Red pocketed or forced off goes on the Spot, then the Pyramid Spot, then the Centre
   * Spot when those are occupied. In the third stroke of a lone-pot sequence the Centre Spot leads instead (9(b)).
   * Section 3 Rule 16(c)(i) spots it after a foul too, before the next player plays from where the balls lie. */
  if (state.balls[RED].pocketed)
    place(
      RED,
      book.redPotRun % 3 === 0 && book.redPotRun > 0
        ? [CENTRE_SPOT, PYRAMID_SPOT, BILLIARD_SPOT]
        : [BILLIARD_SPOT, PYRAMID_SPOT, CENTRE_SPOT],
    );
  /** Section 2 Rule 13: a cue ball that has been pocketed or forced off stays in-hand — it is not spotted — until
   * its owner plays it from the "D". The one exception is Rule 11(c): after the fifteenth consecutive hazard the
   * non-striker's ball is brought back on the middle of the Baulk-line, or the right-hand corner of the "D". */
  if (!foul && book.hazardRun >= HAZARD_LIMIT && state.balls[theirs].pocketed) place(theirs, HAZARD_LIMIT_SPOTS);

  state.shotCount++;
  state.lastPotted = pots;
  state.foul = foul;
  /** Section 3 Rule 3(a),(b): a scoring stroke keeps the striker at the table, from in-hand after an in-off;
   * otherwise the turn passes, and the incoming player is in-hand if their own cue ball is off the table. */
  const continues = !foul && scored > 0;
  state.turn = continues ? shooter : opponent;
  state.phase = state.balls[cueBallOf(state.turn)].pocketed ? 'ball-in-hand' : 'ready';

  // Section 3 Rule 5(d): the game ends when a player first reaches or passes the required number of points.
  if (book.scores[shooter] >= book.target) state.winner = shooter;
  else if (book.scores[opponent] >= book.target) state.winner = opponent;
  if (state.winner !== null) {
    state.phase = 'over';
    state.message = `Game to ${state.winner === 0 ? 'you' : 'the other side'}, ${book.scores[0]}-${book.scores[1]}.`;
  } else if (foul) state.message = `Foul, ${FOUL_PENALTY} away.`;
  else if (scored > 0) state.message = `${scored} up. Keep going.`;
  else state.message = 'No score. Over to the other side.';

  return {
    state,
    respots,
    events,
    outcome: {
      shooter,
      foul,
      scratched: potted.includes(cue) || offTable.includes(cue),
      wardRescued: false,
      ownPotted: foul ? 0 : pots.length,
      opponentPotted: foul ? pots.length : 0,
      respotEight: false,
      rerack: false,
      winner: state.winner,
    },
  };
}

/** Section 4 Rule 1(f)(iv): a game may be conceded. Kept beside the settlement so the seam has one place to look. */
export function concedeGame(input: GameState, player: 0 | 1): BilliardsState {
  const state = structuredClone(input) as BilliardsState;
  state.winner = other(player);
  state.phase = 'over';
  state.message = `Game conceded, ${state.billiards.scores[0]}-${state.billiards.scores[1]}.`;
  return state;
}

export const BILLIARDS_MODE: BilliardsModeSpec = {
  id: 'billiards',
  label: 'English Billiards',
  table: SNOOKER_TABLE,
  initialState: (seed, options) => initialBilliardsState(seed, (options as { target?: number } | undefined)?.target),
  rack: billiardsRack,
  legalTargets: billiardsTargets,
  settle: settleBilliardsShot,
};
