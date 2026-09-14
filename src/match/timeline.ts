import type { GameState, TableEvent } from '../simulation/types';
import { interpolateBalls } from './interpolate';
export const NETWORK_DELAY = 45;
/** One timeline for every ball and impact, never per-ball independent smoothing. */
export class SnapshotTimeline {
  private snapshots: { at: number; state: GameState }[] = [];
  private events: { at: number; event: TableEvent }[] = [];
  private latest: GameState | null = null;
  push(state: GameState, events: TableEvent[], now: number, immediate = false) {
    if (this.latest?.seed !== state.seed) { this.clear(); immediate = true; }
    this.latest = state;
    this.snapshots.push({ at: now - (immediate ? NETWORK_DELAY : 0), state });
    if (this.snapshots.length > 24) this.snapshots.shift();
    for (const event of events) this.events.push({ at: now + NETWORK_DELAY, event });
  }
  /** The authoritative snapshot on screen now; `sample` only interpolates its ball positions. */
  shown(now: number): GameState | null {
    const target = now - NETWORK_DELAY;
    while (this.snapshots.length > 1 && this.snapshots[1].at <= target) this.snapshots.shift();
    return this.snapshots[0]?.state ?? this.latest;
  }
  sample(now: number): GameState | null {
    const target = now - NETWORK_DELAY, shown = this.shown(now);
    const before = this.snapshots[0], after = this.snapshots[1];
    if (!before) return shown;
    if (!after || target <= before.at || before.state.seed !== after.state.seed) return before.state;
    if (before.state.phase !== 'rolling' || after.state.shotCount !== before.state.shotCount) return before.state;
    const alpha = Math.max(0, Math.min(1, (target - before.at) / Math.max(.01, after.at - before.at)));
    return { ...before.state, balls: interpolateBalls(before.state.balls, after.state.balls, alpha) };
  }
  drainEvents(now: number): TableEvent[] {
    const ready: TableEvent[] = [];
    while (this.events.length && this.events[0].at <= now) ready.push(this.events.shift()!.event);
    return ready;
  }
  mute() { this.events = []; }
  clear() { this.snapshots = []; this.events = []; this.latest = null; }
}
