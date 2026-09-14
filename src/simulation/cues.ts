import { activeSeat, seatCount, type GameState } from './types';
import { normalizeLevel } from './level-policy';

export type CueId = 'ash-house' | 'maple-control' | 'rosewood-power' | 'ebony-finesse' | 'walnut-master';
export interface CueDefinition {
  readonly id: CueId;
  readonly name: string;
  readonly wood: string;
  readonly weightOz: number;
  readonly unlockLevel: number;
  readonly description: string;
  /** Authored strike/response ratios. These never come from a network payload. */
  readonly power: number;
  readonly spin: number;
  readonly curve: number;
  readonly color: string;
  readonly accent: string;
}
export const CUE_CATALOG: readonly CueDefinition[] = Object.freeze([
  Object.freeze({
    id: 'ash-house',
    name: 'House Ash',
    wood: 'Ash',
    weightOz: 18,
    unlockLevel: 1,
    description: 'A familiar, balanced strike.',
    power: 1,
    spin: 1,
    curve: 1,
    color: '#ba884d',
    accent: '#25231f',
  }),
  Object.freeze({
    id: 'maple-control',
    name: 'Maple Control',
    wood: 'Maple',
    weightOz: 17,
    unlockLevel: 2,
    description: 'Softer power, extra spin and gentle curve.',
    power: 0.96,
    spin: 1.1,
    curve: 1.06,
    color: '#e6c994',
    accent: '#436e61',
  }),
  Object.freeze({
    id: 'rosewood-power',
    name: 'Rosewood Breaker',
    wood: 'Rosewood',
    weightOz: 21,
    unlockLevel: 3,
    description: 'A stronger strike with less spin and curve.',
    power: 1.08,
    spin: 0.9,
    curve: 0.88,
    color: '#67372d',
    accent: '#c3914b',
  }),
  Object.freeze({
    id: 'ebony-finesse',
    name: 'Ebony Finesse',
    wood: 'Ebony',
    weightOz: 18,
    unlockLevel: 4,
    description: 'More draw and curve in exchange for power.',
    power: 0.97,
    spin: 1.16,
    curve: 1.18,
    color: '#292526',
    accent: '#dbd6bb',
  }),
  Object.freeze({
    id: 'walnut-master',
    name: 'Walnut Master',
    wood: 'Walnut',
    weightOz: 19,
    unlockLevel: 5,
    description: 'Firm power and draw with a calmer curved path.',
    power: 1.04,
    spin: 1.08,
    curve: 0.96,
    color: '#795139',
    accent: '#c5a661',
  }),
] as const);
export const DEFAULT_CUE: CueId = 'ash-house';
export function getCue(id: unknown): CueDefinition | undefined {
  return CUE_CATALOG.find((cue) => cue.id === id);
}
export function availableCues(level: unknown): readonly CueDefinition[] {
  return CUE_CATALOG.filter((cue) => cue.unlockLevel <= normalizeLevel(level));
}
export function canEquipCue(id: unknown, level: unknown): id is CueId {
  const cue = getCue(id);
  return !!cue && cue.unlockLevel <= normalizeLevel(level);
}
export function normalizeCues(
  cues: readonly unknown[] | undefined,
  format: GameState['format'],
  level: unknown,
): CueId[] {
  return Array.from({ length: seatCount(format) }, (_, seat) =>
    canEquipCue(cues?.[seat], level) ? (cues![seat] as CueId) : DEFAULT_CUE,
  );
}
export function equippedCue(
  state: Pick<GameState, 'cues' | 'format' | 'teamOrder' | 'turn' | 'arcade'>,
  seat = activeSeat(state as GameState),
): CueDefinition {
  const id = state.cues?.[seat];
  return canEquipCue(id, state.arcade?.level) ? getCue(id)! : CUE_CATALOG[0];
}
