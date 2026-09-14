import { LAYOUTS } from '../simulation/arcade';
import { DEFAULT_CUE, getCue, type CueId } from '../simulation/cues';
import { MAX_LEVEL, normalizeLevel } from '../simulation/level-policy';
import type { ArenaLayout, Difficulty, GameFormat, GameState, Mode } from '../simulation/types';
import { canAdvance, resultTeams } from '../match/policy';
import { AI_NAMES } from '../presentation/table-presentation';
import type { RenderQuality } from '../render/performance';

/** The subset of Web Storage the profile needs; an in-memory map works in Node. */
export interface ProfileStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface HouseRecord { id: string; name: string; score: number; layout: ArenaLayout; win: boolean; date: string }
export interface Preferences {
  sound: boolean; volume: number; difficulty: Difficulty; layout: ArenaLayout; level: number;
  format: GameFormat; quality: RenderQuality; camera: 'angled' | 'overhead'; cue: CueId; name: string;
}
export interface MenuOption<T extends string = string> { value: T; label: string; disabled?: boolean }

const QUALITY_LABELS = { performance: 'Performance', auto: 'Auto · Smooth play', high: 'High', ultra: 'Ultra · 4K' } satisfies Record<RenderQuality, string>;
export const LEVEL_NAMES: readonly string[] = ['First round', 'Trick shots', 'Cross currents', 'Hard knocks', 'House champion'];
const entries = <K extends string, V>(record: Record<K, V>) => Object.entries(record) as [K, V][];
export const DIFFICULTY_OPTIONS: (MenuOption<Difficulty> & { opponent: string })[] =
  entries(AI_NAMES).map(([value, opponent]) => ({ value, label: value[0].toUpperCase() + value.slice(1), opponent }));
export const LAYOUT_OPTIONS: MenuOption<ArenaLayout>[] = entries(LAYOUTS).map(([value, layout]) => ({ value, label: layout.name }));
export const QUALITY_OPTIONS: MenuOption<RenderQuality>[] = entries(QUALITY_LABELS).map(([value, label]) => ({ value, label }));
export const levelName = (level: unknown) => LEVEL_NAMES[normalizeLevel(level) - 1];

const PREFIX = 'corner-pocket:', MAX_RECORDS = 8;
const oneOf = <T extends string>(record: Record<T, unknown>, value: string | null, fallback: T): T =>
  value !== null && Object.hasOwn(record, value) ? value as T : fallback;
function validRecord(record: unknown): record is HouseRecord {
  if (!record || typeof record !== 'object') return false;
  const r = record as Record<string, unknown>;
  return typeof r.id === 'string' && typeof r.name === 'string' && typeof r.score === 'number' && Number.isFinite(r.score) && r.score >= 0
    && typeof r.layout === 'string' && Object.hasOwn(LAYOUTS, r.layout) && typeof r.date === 'string';
}

/** Preferences, house records and level unlocks for this device. Corrupt or unavailable storage falls back to defaults. */
export class PlayerProfile {
  private prefs: Preferences;
  private unlocked: number;
  constructor(private readonly storage: ProfileStorage | null) {
    this.unlocked = normalizeLevel(this.read('unlocked-level'));
    const volume = Number(this.read('volume') ?? .65);
    this.prefs = {
      sound: this.read('sound') !== 'false',
      volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : .65,
      difficulty: oneOf(AI_NAMES, this.read('difficulty'), 'regular'),
      layout: oneOf(LAYOUTS, this.read('layout'), 'crossfire'),
      level: Math.min(this.unlocked, normalizeLevel(this.read('level'))),
      format: this.read('format') === 'doubles' ? 'doubles' : 'singles',
      quality: oneOf(QUALITY_LABELS, this.read('quality'), 'auto'),
      camera: this.read('camera') === 'overhead' ? 'overhead' : 'angled',
      cue: getCue(this.read('cue'))?.id ?? DEFAULT_CUE,
      name: this.read('name') ?? 'Player',
    };
  }
  get preferences(): Readonly<Preferences> { return this.prefs; }
  get unlockedLevel() { return this.unlocked; }
  /** Levels above the unlocked level cannot be chosen. */
  set<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    const next = { ...this.prefs, [key]: value };
    next.level = Math.min(this.unlocked, normalizeLevel(next.level));
    next.volume = Math.max(0, Math.min(1, next.volume));
    this.prefs = next;
    this.write(key, String(next[key]));
  }
  get records(): HouseRecord[] {
    try {
      const records: unknown = JSON.parse(this.read('records') ?? '[]');
      return Array.isArray(records) ? records.filter(validRecord).slice(0, MAX_RECORDS) : [];
    } catch { return []; }
  }
  levelOptions(): MenuOption[] {
    return Array.from({ length: MAX_LEVEL }, (_, index) => {
      const level = index + 1, locked = level > this.unlocked;
      return { value: String(level), label: `${level} · ${LEVEL_NAMES[index]}${locked ? ' · Locked' : ''}`, disabled: locked };
    });
  }
  /** Reports a finished rack once: unlocks the next level when the rack may advance and saves each local team's score. */
  recordResult(state: GameState, mode: Mode, seat: number, teamName: (team: number) => string) {
    if (state.phase !== 'over' || !state.arcade) return;
    if (canAdvance(state, mode)) { this.unlocked = Math.max(this.unlocked, normalizeLevel(state.arcade.level + 1)); this.write('unlocked-level', String(this.unlocked)); }
    const records = this.records;
    for (const team of resultTeams(mode, seat)) {
      const id = `${state.seed}:${mode}:${team}`;
      if (records.some(record => record.id === id)) continue;
      records.push({ id, name: teamName(team), score: state.arcade.scores[team], layout: state.arcade.layout, win: state.winner === team, date: new Date().toISOString() });
    }
    records.sort((a, b) => b.score - a.score || Number(b.win) - Number(a.win) || b.date.localeCompare(a.date));
    this.write('records', JSON.stringify(records.slice(0, MAX_RECORDS)));
  }
  private read(key: string) { try { return this.storage?.getItem(PREFIX + key) ?? null; } catch { return null; } }
  private write(key: string, value: string) { try { this.storage?.setItem(PREFIX + key, value); } catch { /* Playing does not require storage. */ } }
}
