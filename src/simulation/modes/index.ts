import { settleShot, type SettlementContext, type ShotSettlement } from '../settlement';
import {
  initialState,
  legalTargets,
  newRack,
  type Ball,
  type CueSportsModeId,
  type GameModeId,
  type GameOptions,
  type GameState,
  type ShotResult,
} from '../types';
import { BILLIARDS_MODE } from './billiards';
import { initialSnookerState, settleSnookerShot, snookerRack, snookerTargets } from './snooker';
import { ZOMBIE_MODE } from './zombie';
import { EIGHT_BALL_TABLE, SNOOKER_TABLE, type TableSpec } from './table';

export type { TablePoint, TableSpec, PlacementZone } from './table';
export { EIGHT_BALL_TABLE, SNOOKER_TABLE, tableOf, pocketsFor, cushionGaps } from './table';
/** Snooker's own surface: ball values, the spots, and `concedeFrame`, which has no eight-ball equivalent and so
 * cannot live on GameModeSpec. Re-exported here so a caller needs one import per mode, not two. */
export * from './snooker';
/** Namespaced rather than flattened: billiards and snooker both export a `valueOf`, one scoring a ball
 * and one a stroke, and flattening them would make which is which depend on import order. */
export * as billiards from './billiards';
export * as zombie from './zombie';
export { BILLIARDS_MODE } from './billiards';
export { ZOMBIE_MODE } from './zombie';

/** Everything a game mode decides. Eight-ball is the first implementation and behaves exactly as it always did;
 * snooker is the second, and it is what forced each of these fields out of the eight-ball code. */
export interface GameModeSpec {
  id: GameModeId;
  label: string;
  /** Slate size, pocket positions and where a ball in hand goes. Read at runtime through `tableOf(state)`. */
  table: TableSpec;
  /** A fresh state for this mode, including whatever extra bookkeeping it attaches to GameState. */
  initialState(seed: string, options?: GameOptions): GameState;
  /** The starting ball layout on its own, for callers that only want the rack. */
  rack(seed: string): Ball[];
  /** Balls the striker may legally strike first. */
  legalTargets(state: GameState, player?: 0 | 1): Ball[];
  /** Settle one completed stroke. Pure. */
  settle(state: GameState, result: ShotResult, context: SettlementContext): ShotSettlement;
}

export const MODES: Record<CueSportsModeId, GameModeSpec> = {
  'eight-ball': {
    id: 'eight-ball',
    label: 'Eight-ball',
    table: EIGHT_BALL_TABLE,
    initialState: (seed, options) => initialState(seed, options?.format, options?.rules),
    rack: newRack,
    legalTargets,
    settle: settleShot,
  },
  billiards: BILLIARDS_MODE,
  snooker: {
    id: 'snooker',
    label: 'Snooker',
    table: SNOOKER_TABLE,
    initialState: (seed) => initialSnookerState(seed),
    rack: snookerRack,
    legalTargets: snookerTargets,
    settle: settleSnookerShot,
  },
};

export function modeOf(state: { mode?: GameModeId }): GameModeSpec {
  const id = state.mode ?? 'eight-ball';
  // Loud rather than silently falling back to eight-ball: the zombie mode runs its own engine, so a
  // zombie state reaching the cue-sports path is a wiring bug, and a quiet default would hide it.
  if (id === 'zombie') throw new Error('the zombie mode is not cue sports; use ZOMBIE_MODE directly');
  return MODES[id];
}

/** Every playable mode for a menu, cue sports and otherwise. The UI lists this, not `MODES`, so the
 * zombie mode appears without being forced into a shape it does not fit. */
export const ALL_MODES: readonly { id: GameModeId; label: string }[] = [
  ...Object.values(MODES).map(({ id, label }) => ({ id: id as GameModeId, label })),
  { id: 'zombie', label: ZOMBIE_MODE.label },
];
