import { ALL_MODES, MODES } from '../simulation/modes';
import type { GameFormat, GameModeId } from '../simulation/types';

/** Marketing copy for the game-mode picker. The registry carries no player-facing text beyond a label, so this is
 * presentation-owned. Which modes exist always comes from `ALL_MODES` (see `gameModes()`), never from the keys of
 * this map, so a mode registered later shows up with a generic fallback line built from its own label until this
 * map is taught about it. */
const COPY: Partial<Record<GameModeId, { icon: string; description: string }>> = {
  'eight-ball': { icon: 'target', description: 'Clear your group, then pot the eight. The house classic.' },
  snooker: { icon: 'trophy', description: 'Reds and colours, break-building, one table, no shortcuts.' },
  billiards: { icon: 'coin', description: 'Three balls, no pockets. Score a cannon off both.' },
  zombie: { icon: 'bolt', description: 'Arcade pool with a horde on the table. No mercy.' },
};

/** Every mode the menu should offer, cue sports and otherwise — `ALL_MODES` is the registry's own UI seam, built so
 * a mode that does not fit `GameModeSpec` (the zombie horde runs its own engine) still appears. Drive any picker or
 * loop off this, never off a literal list of ids, so a mode registered later shows up automatically. */
export const gameModes = () => ALL_MODES;

export function gameModeCopy({ id, label }: { id: GameModeId; label: string }): { icon: string; description: string } {
  return COPY[id] ?? { icon: 'cue', description: `${label}.` };
}

/** Whether a mode supports choosing singles/doubles, derived by probing its own `initialState` with both formats
 * and checking whether the result actually differs — so a mode that ignores the option (like snooker today) is
 * detected the same way any future one would be, with no id-based branching. A mode with no cue-sports spec to
 * probe (the zombie horde has its own engine, not `GameModeSpec`) has no format choice either, which is also true
 * today: this falls out of the same registry fact, not a special case written for zombie by name. */
export function gameModeSupportsFormat(id: GameModeId): boolean {
  const spec = MODES[id as keyof typeof MODES];
  if (!spec) return false;
  try {
    const singles = spec.initialState('__format-probe__', { format: 'singles' as GameFormat });
    const doubles = spec.initialState('__format-probe__', { format: 'doubles' as GameFormat });
    return singles.format !== doubles.format;
  } catch {
    return true;
  }
}

/** Whether a mode is played the ordinary turn-based way (an opponent to pick: the house, pass & play, online) —
 * true for every mode with a cue-sports `GameModeSpec` in `MODES`, false for one that isn't (today just the zombie
 * horde, which has no turns and one player). */
export function gameModeSupportsOpponent(id: GameModeId): boolean {
  return id in MODES;
}
