import { activeSeat, teamOfSeat, type GameState, type Mode } from '../simulation/types';
import { MAX_LEVEL, normalizeLevel } from '../simulation/level-policy';
export function canAdvance(state: GameState, mode: Mode): boolean {
  return state.phase === 'over' && normalizeLevel(state.arcade?.level) < MAX_LEVEL && (mode !== 'ai' || state.winner === 0);
}
export function humanControls(state: GameState, mode: Mode, seat = 0): boolean {
  return mode === 'local' || activeSeat(state) === (mode === 'ai' ? 0 : seat);
}
export function resultTeams(mode: Mode, seat = 0): number[] {
  return mode === 'local' ? [0, 1] : [mode === 'online' ? teamOfSeat(seat) : 0];
}
export interface MatchCapabilities { canReset: boolean; canRematch: boolean; canAdvance: boolean; canEquip: boolean }
export function matchCapabilities(state: GameState, mode: Mode, ready: boolean, pending = false, connected = true): MatchCapabilities {
  return {
    canEquip: connected && !pending && (state.phase === 'ready' || state.phase === 'ball-in-hand'),
    canReset: !pending && (mode !== 'online' || ready && state.phase === 'over'),
    canRematch: !pending && ready && state.phase === 'over',
    canAdvance: !pending && ready && canAdvance(state, mode),
  };
}
