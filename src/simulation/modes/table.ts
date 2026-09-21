import { POCKETS, TABLE, type GameModeId } from '../types';

export interface TablePoint {
  x: number;
  z: number;
}
/** Where a ball in hand may go. `headStringX` is the near edge of the zone on the long axis; `dRadius`, when set,
 * narrows it to the semicircle of that radius centred on (headStringX, 0) — the snooker D. */
export interface PlacementZone {
  headStringX: number;
  dRadius?: number;
}
/** Everything a mode changes about the slate: how big it is, where the pockets are, and where a ball in hand goes.
 * The ball radius is deliberately shared by every mode so one physics tuning fits them all. */
export interface TableSpec {
  halfWidth: number;
  halfDepth: number;
  radius: number;
  pocketRadius: number;
  pockets: TablePoint[];
  placement: PlacementZone;
}

/** Pocket-mouth scale relative to the eight-ball table; every cushion gap, jaw and pocket offset below is a pool
 * measurement multiplied by it, so a tighter mouth pulls the cushions in with it. */
const mouthScale = (pocketRadius: number) => pocketRadius / TABLE.pocketRadius;
/** Corners sit just inside the playing surface, middles just outside it. The offsets scale with the slate rather
 * than with the mouth, so every table puts its pockets at the same angle from the centre spot and a shot that is on
 * from the middle of a pool table is on from the middle of a snooker table too. */
export function pocketsFor(halfWidth: number, halfDepth: number): TablePoint[] {
  // Rounded so the derived pool table is bit-for-bit the hand-written one it replaces.
  const round = (value: number) => Math.round(value * 1e9) / 1e9;
  const side = round(halfWidth * (1 - 0.04 / TABLE.halfWidth)),
    corner = round(halfDepth * (1 - 0.03 / TABLE.halfDepth)),
    middle = round(halfDepth * (1 + 0.1 / TABLE.halfDepth));
  return [-1, 1].flatMap((sign) => [
    { x: -side, z: sign * corner },
    { x: 0, z: sign * middle },
    { x: side, z: sign * corner },
  ]);
}
/** Cushion gaps around each pocket, all scaled with the mouth: how far the end rails stop short of the corners,
 * how far the side rails stop short of them, and the half-width of the middle-pocket gap. */
export function cushionGaps(pocketRadius: number) {
  const k = mouthScale(pocketRadius);
  return { corner: 0.37 * k, sideInset: 0.43 * k, middle: 0.41 * k, jawInset: 0.5 * k, jawRadius: 0.075 * k };
}

export const EIGHT_BALL_TABLE: TableSpec = {
  ...TABLE,
  pockets: POCKETS,
  placement: { headStringX: -TABLE.halfWidth / 2 },
};

/** Snooker plays on a 12-foot table: a 3569 x 1778 mm playing surface, so exactly twice as long as it is wide, and
 * pockets cut tighter than a pub table's (WPBSA Official Rules of Snooker, Section 1 Rules 1 and 3). Scaled to this
 * engine's units at the same millimetres-per-unit as the pool table, and keeping the shared ball radius. */
export const SNOOKER_TABLE: TableSpec = {
  halfWidth: 10.24,
  halfDepth: 5.12,
  radius: TABLE.radius,
  pocketRadius: 0.26,
  pockets: pocketsFor(10.24, 5.12),
  // The baulk line is 737 mm from the baulk cushion and the D has a 292 mm radius (WPBSA Section 1 Rule 2).
  placement: { headStringX: -6.011, dRadius: 1.676 },
};

/** English Billiards is played on the same 12-foot table as snooker (WPBSA Section 1 Rule 1), and the
 * zombie mode is set on the pub table. Keyed rather than chained so a new mode cannot silently inherit
 * the pool table by falling through an `else`. */
const TABLES: Record<GameModeId, TableSpec> = {
  'eight-ball': EIGHT_BALL_TABLE,
  snooker: SNOOKER_TABLE,
  billiards: SNOOKER_TABLE,
  zombie: EIGHT_BALL_TABLE,
};
export function tableOf(state: { mode?: GameModeId }): TableSpec {
  return TABLES[state.mode ?? 'eight-ball'];
}
