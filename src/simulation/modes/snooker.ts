import type { RespotTarget, SettlementContext, ShotSettlement } from '../settlement';
import { isClearBallSpot, snookered } from '../table-geometry';
import { other, type Ball, type GameState, type ShotResult, type TableEvent } from '../types';
import { SNOOKER_TABLE, type TablePoint } from './table';

/** Rulings below cite the WPBSA Official Rules of the Games of Snooker and English Billiards (2019 revision):
 * Section 2 covers the objects and definitions, Section 3 the play and the penalties, Section 4 the frame end. */

export const RED_COUNT = 15;
export const YELLOW = 16,
  GREEN = 17,
  BROWN = 18,
  BLUE = 19,
  PINK = 20,
  BLACK = 21;
/** Ascending value order: the sequence the colours are taken in once the reds are gone (Section 3 Rule 4). */
export const COLOURS = [YELLOW, GREEN, BROWN, BLUE, PINK, BLACK] as const;
export const isRed = (id: number): boolean => id >= 1 && id <= RED_COUNT;
/** Red 1, yellow 2, green 3, brown 4, blue 5, pink 6, black 7 (Section 2 Rule 5). The cue ball is worth nothing. */
export const valueOf = (id: number): number => (isRed(id) ? 1 : id >= YELLOW && id <= BLACK ? id - 14 : 0);

const T = SNOOKER_TABLE;
const D_RADIUS = T.placement.dRadius!;
const BAULK_X = T.placement.headStringX;
/** Section 1 Rule 2: yellow and green on the two corners of the D, brown at its centre, blue at the centre of the
 * table, pink midway between the centre and the top cushion, black 324 mm out from the top cushion. Looking up the
 * table from baulk, yellow is on the right; this engine puts that at positive z. */
export const SNOOKER_SPOTS: Record<number, TablePoint> = {
  [YELLOW]: { x: BAULK_X, z: D_RADIUS },
  [GREEN]: { x: BAULK_X, z: -D_RADIUS },
  [BROWN]: { x: BAULK_X, z: 0 },
  [BLUE]: { x: 0, z: 0 },
  [PINK]: { x: T.halfWidth / 2, z: 0 },
  [BLACK]: { x: T.halfWidth - 1.859, z: 0 },
};
/** Where the cue ball starts a frame: inside the D, off to one side of the brown, the usual break position. */
export const CUE_BREAK_SPOT: TablePoint = { x: BAULK_X - D_RADIUS * 0.41, z: D_RADIUS * 0.6 };

const RACK_ROW = T.radius * Math.sqrt(3) * 1.015;
/** The fifteen reds in a tight triangle with its apex as close behind the pink as the balls allow (Section 1 Rule 2),
 * then the six colours on their spots. Reds are interchangeable, so unlike the eight-ball rack nothing is shuffled
 * and the seed is unused; it stays in the signature so every mode racks the same way. */
export function snookerRack(_seed?: string): Ball[] {
  const balls: Ball[] = [{ id: 0, ...CUE_BREAK_SPOT, vx: 0, vz: 0, pocketed: false }];
  const apex = SNOOKER_SPOTS[PINK].x + T.radius * 2.2;
  let id = 1;
  for (let row = 0; row < 5; row++)
    for (let col = 0; col <= row; col++)
      balls.push({
        id: id++,
        x: apex + row * RACK_ROW,
        z: (col - row / 2) * T.radius * 2.03,
        vx: 0,
        vz: 0,
        pocketed: false,
      });
  for (const colour of COLOURS) balls.push({ id: colour, ...SNOOKER_SPOTS[colour], vx: 0, vz: 0, pocketed: false });
  return balls;
}

export function initialSnookerState(seed: string): GameState {
  return {
    mode: 'snooker',
    format: 'singles',
    rules: 'new',
    teamOrder: [0, 0],
    cues: ['ash-house', 'ash-house'],
    shotsLeft: 0,
    freeShot: false,
    nominated: null,
    rebreak: false,
    seed,
    balls: snookerRack(seed),
    turn: 0,
    groups: [null, null],
    phase: 'ball-in-hand',
    shotCount: 0,
    winner: null,
    message: 'Break from the D.',
    lastPotted: [],
    foul: false,
    chalked: [false, false],
    snooker: { scores: [0, 0], onColour: false, freeBall: false, conceded: null, decider: false },
  };
}

/** The lowest-value colour still on the table: the ball on once every red has gone (Section 3 Rule 4). */
function nextClearanceBall(state: GameState): number | null {
  const left = state.balls.filter((b) => b.id !== 0 && !b.pocketed && !isRed(b.id)).map((b) => b.id);
  return left.length ? Math.min(...left) : null;
}
/** Balls the striker may legally strike first: a red while any red is up, then any colour, then the colours in
 * ascending order. A free ball puts every ball on (Section 2 Rule 16). */
export function snookerTargets(state: GameState, _player: 0 | 1 = state.turn): Ball[] {
  const snooker = state.snooker;
  const active = state.balls.filter((b) => !b.pocketed && b.id !== 0);
  if (!snooker || snooker.freeBall) return active;
  if (snooker.onColour) return active.filter((b) => !isRed(b.id));
  const reds = active.filter((b) => isRed(b.id));
  if (reds.length) return reds;
  const next = nextClearanceBall(state);
  return next === null ? [] : active.filter((b) => b.id === next);
}

/** Section 3 Rule 5: a potted colour goes back on its own spot; if that is occupied, on the highest value spot that
 * is free; if every spot is occupied, as near as possible to its own spot on the centre line, towards the top
 * cushion first and below its own spot only when there is no room above. */
function* colourSpots(id: number) {
  yield SNOOKER_SPOTS[id];
  for (const spot of [BLACK, PINK, BLUE, BROWN, GREEN, YELLOW]) if (spot !== id) yield SNOOKER_SPOTS[spot];
  const own = SNOOKER_SPOTS[id],
    step = T.radius * 2.2;
  yield { x: own.x, z: 0 };
  for (const direction of [1, -1])
    for (let x = own.x + direction * step; Math.abs(x) <= T.halfWidth; x += direction * step) yield { x, z: 0 };
}

/** Settle one completed stroke of snooker. Pure: no input mutation, physics world, timers or callbacks, matching
 * the eight-ball settlement so either can sit behind the same seam. */
export function settleSnookerShot(input: GameState, result: ShotResult, context: SettlementContext): ShotSettlement {
  const state = structuredClone(input);
  delete state.simulation;
  const before = input.snooker!,
    snooker = state.snooker!;
  const shooter = context.shooter ?? state.turn;
  const respots: RespotTarget[] = [],
    events: Omit<TableEvent, 'time'>[] = [];
  const offTable = result.offTable ?? [],
    potted = result.potted;

  const redsBefore = input.balls.filter((b) => isRed(b.id) && !b.pocketed).length;
  const onRed = !before.onColour && redsBefore > 0;
  /** In the clearance the ball on is a single fixed colour; otherwise the striker is on a red or on any colour. */
  const clearance = !before.onColour && redsBefore === 0 ? nextClearanceBall(input) : null;
  const first = result.firstContact;
  /** This engine has no nomination input, so the ball struck first is taken as the one nominated, both for a colour
   * after a red and for a free ball. The same shortcut the eight-ball New Rules free ball already uses. */
  const nominated = before.freeBall || before.onColour ? first : null;
  /** Section 3 Rule 12: the penalty is four, or the value of the ball on when that is higher. With no nomination to
   * read, an unidentified colour falls back to the minimum rather than guessing a value. */
  const onValue = onRed
    ? 1
    : clearance !== null
      ? valueOf(clearance)
      : nominated !== null && !isRed(nominated)
        ? valueOf(nominated)
        : 4;

  for (const id of [...potted, ...offTable])
    if (state.balls[id]) Object.assign(state.balls[id], { pocketed: true, vx: 0, vz: 0, vy: 0, airborne: false });

  const scratched = potted.includes(0) || offTable.includes(0);
  const objectPots = potted.filter((id) => id !== 0);
  const wrongFirst = first === null || !context.legalBefore.includes(first);
  /** A red stroke may pot any number of reds; a colour stroke may pot only the one colour that is on. */
  const allowed = (id: number): boolean =>
    before.freeBall
      ? id === nominated || (onRed && isRed(id))
      : onRed
        ? isRed(id)
        : clearance !== null
          ? id === clearance
          : nominated !== null && id === nominated && !isRed(id);
  const illegalPots = objectPots.filter((id) => !allowed(id));
  const foul = wrongFirst || scratched || offTable.length > 0 || illegalPots.length > 0;
  const penalty = foul
    ? Math.max(
        4,
        onValue,
        first !== null && wrongFirst ? valueOf(first) : 0,
        ...illegalPots.map(valueOf),
        ...offTable.map(valueOf),
      )
    : 0;
  /** Section 2 Rule 16: a potted free ball scores the value of the ball on, not its own. */
  const scored = foul
    ? 0
    : objectPots.reduce((sum, id) => sum + (before.freeBall && id === nominated ? onValue : valueOf(id)), 0);
  if (foul) snooker.scores[other(shooter)] += penalty;
  else snooker.scores[shooter] += scored;

  /** Reds never come back (Section 3 Rule 12). A colour comes back unless it was the clearance ball on and went
   * down legally: that is the one case where a colour stays off the table. */
  const staysDown = (id: number) => isRed(id) || (!foul && clearance !== null && id === clearance);
  const returning = [...new Set([...objectPots, ...offTable])]
    .filter((id) => id !== 0 && !staysDown(id))
    .sort((a, b) => b - a);
  const respot = (id: number, points: Iterable<TablePoint>): void => {
    for (const point of points)
      if (isClearBallSpot(state, point, id, 'object-respot')) {
        Object.assign(state.balls[id], point, { pocketed: false, vx: 0, vz: 0, vy: 0, elevation: 0, airborne: false });
        respots.push({ id, ...point });
        return;
      }
  };
  for (const id of returning) respot(id, colourSpots(id));

  state.shotCount++;
  state.lastPotted = objectPots;
  state.foul = foul;
  const continues = !foul && scored > 0;
  state.turn = continues ? shooter : other(shooter);
  snooker.onColour = continues && onRed;
  snooker.freeBall = false;
  state.phase = scratched ? 'ball-in-hand' : 'ready';

  const cleared = state.balls.every((b) => b.id === 0 || b.pocketed);
  if (before.decider && (foul || scored > 0)) {
    // Section 4 Rule 4: on the respotted black the first score or foul ends the frame.
    state.winner = foul ? other(shooter) : shooter;
  } else if (cleared) {
    if (snooker.scores[0] === snooker.scores[1]) {
      // Level after the black: it goes back on its spot and the frame is decided on the next score or foul.
      respot(BLACK, colourSpots(BLACK));
      snooker.decider = true;
      state.phase = 'ball-in-hand';
      snooker.onColour = false;
    } else state.winner = snooker.scores[0] > snooker.scores[1] ? 0 : 1;
  }
  if (foul && state.winner === null && snookered(state, state.turn, snookerTargets(state, state.turn)))
    snooker.freeBall = true;

  if (state.winner !== null) {
    state.phase = 'over';
    state.message = `Frame to ${state.winner === 0 ? 'you' : 'the other side'}, ${snooker.scores[0]}-${snooker.scores[1]}.`;
  } else if (snooker.decider) state.message = 'Level frame. Respotted black: the next score or foul decides it.';
  else if (foul) state.message = `Foul, ${penalty} away.${snooker.freeBall ? ' Free ball to the other side.' : ''}`;
  else if (scored > 0) state.message = `${scored} up. Keep going.`;
  else state.message = 'No score. Over to the other side.';

  return {
    state,
    respots,
    events,
    outcome: {
      shooter,
      foul,
      scratched,
      wardRescued: false,
      ownPotted: foul ? 0 : objectPots.length,
      opponentPotted: foul ? objectPots.length : 0,
      respotEight: false,
      rerack: false,
      winner: state.winner,
    },
  };
}

/** Section 3 Rule 15: a player may concede the frame while at the table. */
export function concedeFrame(input: GameState, player: 0 | 1): GameState {
  const state = structuredClone(input);
  state.snooker!.conceded = player;
  state.winner = other(player);
  state.phase = 'over';
  state.message = `Frame conceded, ${state.snooker!.scores[0]}-${state.snooker!.scores[1]}.`;
  return state;
}
