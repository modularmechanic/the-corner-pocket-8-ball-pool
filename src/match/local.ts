import { availableCues, canEquipCue, normalizeCues, type CueId } from '../simulation/cues';
import { PoolGame } from '../simulation/game';
import { chooseGroup, choosePlacement, chooseShot } from '../simulation/ai';
import {
  activeSeat,
  seatCount,
  type Difficulty,
  type GameOptions,
  type GameState,
  type Mode,
  type Shot,
  type TableEvent,
} from '../simulation/types';
import { normalizeLevel } from '../simulation/level-policy';
import { inPlacementZone, isCueLie } from '../simulation/table-geometry';
import { canAdvance, humanControls, matchCapabilities } from './policy';
import type { CommandResult } from './protocol';
import type { Match, MatchActor, MatchChange, MatchCommand, MatchUpdate } from './types';

export const MATCH_STEP = 1 / 120;
/** Rolling steps one update may run (half a second); a longer backlog finishes over later updates. */
export const CATCH_UP_STEPS = 60;
export interface LocalMatchOptions {
  seed: string;
  mode?: Mode;
  options?: GameOptions;
  difficulty?: Difficulty;
  random?: () => number;
  nextSeed?: () => string;
}
/** One authority for local play, AI and hosted rooms. Menus never stop its clock. */
export class LocalMatch implements Match {
  readonly mode: Mode;
  readonly connected = true;
  readonly pending = false;
  readonly room = null;
  readonly seat = 0;
  private game: PoolGame;
  private cached: GameState | null = null;
  private available: boolean;
  private accumulator = 0;
  private events: TableEvent[] = [];
  private muted = false;
  private listeners = new Set<(change: MatchChange) => void>();
  private plan: Shot | null = null;
  private aiElapsed = 0;
  private aiCameraStable = 0;
  private aiStrokeElapsed = 0;
  private aiPhase = '';
  private difficulty: Difficulty;
  private random: () => number;
  private nextSeed: () => string;
  private revision = 0;
  private disposed = false;
  constructor(config: LocalMatchOptions) {
    this.mode = config.mode || 'local';
    this.available = this.mode !== 'online';
    this.difficulty = config.difficulty || 'regular';
    this.random = config.random || Math.random;
    this.nextSeed =
      config.nextSeed || (() => `${config.seed}-${Date.now().toString(36)}-${(++this.revision).toString(36)}`);
    this.game = new PoolGame(config.seed, { ...config.options, level: normalizeLevel(config.options?.level) });
    this.trackEvents();
  }
  /** Frozen detached view, rebuilt only after a command, a rolling step or a table event. */
  get state(): GameState {
    if (!this.cached) {
      const freeze = (value: object) => {
        for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
        Object.freeze(value);
      };
      this.cached = this.game.detachedState();
      freeze(this.cached);
    }
    return this.cached;
  }
  snapshot(): GameState {
    return this.game.snapshot();
  }
  get ready() {
    return this.available;
  }
  get capabilities() {
    return matchCapabilities(this.state, this.mode, this.ready);
  }
  get actor(): MatchActor {
    const state = this.state,
      seat = activeSeat(state);
    return {
      seat,
      team: state.turn,
      controller: this.mode === 'ai' && seat !== 0 ? 'ai' : 'human',
      canAct:
        this.available &&
        humanControls(state, this.mode, this.seat) &&
        (state.phase === 'ready' || state.phase === 'ball-in-hand' || state.phase === 'choose-group'),
    };
  }
  get thinking() {
    return this.aiPhase !== '';
  }
  get aiPreview() {
    if (!this.plan) return null;
    return { angle: this.plan.angle, power: this.plan.power * Math.min(1, this.aiStrokeElapsed / 0.55) };
  }
  setReady(ready: boolean) {
    this.available = ready;
    if (!ready) this.pauseAI();
  }
  setDifficulty(difficulty: Difficulty) {
    this.difficulty = difficulty;
    this.pauseAI();
  }
  pauseAI() {
    this.plan = null;
    this.aiElapsed = 0;
    this.aiCameraStable = 0;
    this.aiStrokeElapsed = 0;
    this.aiPhase = '';
  }
  subscribe(listener: (change: MatchChange) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private changed() {
    this.cached = null;
    for (const listener of this.listeners) listener({ type: 'state' });
  }
  private trackEvents() {
    this.game.onEvent = (event) => {
      this.cached = null;
      if (!this.muted && this.events.length < 160) this.events.push(event);
    };
  }
  drainEvents() {
    return this.events.splice(0);
  }
  get hasEvents() {
    return this.events.length > 0;
  }
  presentation() {
    return this.state;
  }
  execute(command: MatchCommand) {
    return Promise.resolve(this.dispatch(command));
  }
  /** Server supplies the authenticated seat; the browser defaults to its human controller. */
  dispatch(command: MatchCommand, seat = this.mode === 'local' ? activeSeat(this.state) : 0): CommandResult {
    return this.apply(command, seat, 'human');
  }
  private apply(command: MatchCommand, seat: number, controller: 'human' | 'ai'): CommandResult {
    if (this.disposed) return { ok: false, error: 'This match has closed.' };
    const state = this.state;
    if (command.type === 'reset') {
      if (this.mode === 'online') return this.apply({ type: 'rematch' }, seat, controller);
      this.reset(command.seed, command.options);
      return { ok: true };
    }
    if (!Number.isInteger(seat) || seat < 0 || seat >= seatCount(state.format))
      return { ok: false, error: 'Wait for all players to be connected.' };
    if (command.type === 'equip') {
      if (this.mode === 'ai' && (seat === 0 ? controller !== 'human' : controller !== 'ai'))
        return { ok: false, error: 'Choose a cue for your own seat.' };
      if (!canEquipCue(command.cue, state.arcade?.level))
        return { ok: false, error: 'That cue is locked at this table level.' };
      const ok = this.game.equipCue(seat, command.cue);
      if (ok) {
        if (controller === 'human' && seat === activeSeat(state)) this.pauseAI();
        this.changed();
      }
      return { ok, ...(!ok ? { error: 'Change cues between shots.' } : {}) };
    }
    if (!this.available) return { ok: false, error: 'Wait for all players to be connected.' };
    if (command.type === 'rematch' || command.type === 'advance') {
      if (state.phase !== 'over') return { ok: false, error: 'Finish this rack before starting another.' };
      if (command.type === 'advance' && !canAdvance(state, this.mode))
        return { ok: false, error: 'Win this level to advance, or replay the final level.' };
      this.reset(undefined, {
        level: normalizeLevel((state.arcade?.level || 1) + (command.type === 'advance' ? 1 : 0)),
      });
      return { ok: true };
    }
    if (
      activeSeat(state) !== seat ||
      (this.mode === 'ai' && (seat === 0 ? controller !== 'human' : controller !== 'ai'))
    )
      return { ok: false, error: 'Wait for your turn.' };
    if (
      command.type === 'place' &&
      state.phase === 'ball-in-hand' &&
      !isCueLie(state, command) &&
      !inPlacementZone(state, command)
    )
      return { ok: false, error: 'Place the cue ball behind the head string.' };
    if (command.type === 'group' && state.phase !== 'choose-group')
      return { ok: false, error: 'There is no group to choose.' };
    const ok =
      command.type === 'shoot'
        ? this.game.shoot(command.shot)
        : command.type === 'place'
          ? this.game.placeCue(command.x, command.z)
          : command.type === 'group'
            ? this.game.chooseGroup(command.group)
            : this.game.chalkCue();
    if (ok) {
      if (controller === 'human') this.pauseAI();
      this.changed();
    }
    return { ok };
  }
  private reset(seed?: string, options?: GameOptions) {
    const state = this.state;
    // The rule set is fixed for the session: resets, rematches and new levels keep it.
    const next = {
      layout: state.arcade?.layout,
      level: state.arcade?.level,
      format: state.format,
      ...options,
      rules: state.rules,
    };
    this.game.dispose();
    this.game = new PoolGame(seed || this.nextSeed(), { ...next, level: normalizeLevel(next.level) });
    const restored = this.game.snapshot();
    restored.cues = normalizeCues(state.cues, restored.format, restored.arcade?.level);
    this.game.arrange(restored);
    this.accumulator = 0;
    this.events = [];
    this.pauseAI();
    this.trackEvents();
    this.changed();
  }
  /** Replay/test/restore boundary: all physical state is rebuilt by PoolGame. */
  arrange(state: GameState) {
    this.game.arrange(state);
    this.accumulator = 0;
    this.events = [];
    this.pauseAI();
    this.changed();
  }
  update(dt: number, options: MatchUpdate = {}) {
    this.muted = !!options.muted;
    if (this.muted) this.events = [];
    if (options.aiPaused) this.pauseAI();
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    const initialPhase = this.game.state.phase;
    if (initialPhase === 'over' || (!this.available && initialPhase !== 'rolling')) {
      this.accumulator = 0;
      this.pauseAI();
      return;
    }
    this.accumulator += dt;
    // Each authority consumes the same fixed steps; hidden tabs catch up on resume.
    // No menu flag is accepted here: only AI planning can pause independently.
    // A rolling update with more steps than its budget is catching up: it runs at most
    // CATCH_UP_STEPS, silently through any settle and idle remainder, and the rest waits
    // in the accumulator. The last budget's worth of a backlog plays as normal.
    if (initialPhase === 'rolling' && Math.floor((this.accumulator + 1e-10) / MATCH_STEP) > CATCH_UP_STEPS)
      this.muted = true;
    for (let steps = 0; this.accumulator + 1e-10 >= MATCH_STEP; steps++) {
      const phase = this.game.state.phase;
      if (phase === 'over' || (!this.available && phase !== 'rolling')) {
        this.accumulator = 0;
        break;
      }
      if (phase !== 'rolling') {
        const idle = Math.floor((this.accumulator + 1e-10) / MATCH_STEP) * MATCH_STEP;
        this.game.advanceIdle(idle);
        this.accumulator = Math.max(0, this.accumulator - idle);
        break;
      }
      if (steps === CATCH_UP_STEPS) break;
      this.game.step(MATCH_STEP);
      this.cached = null;
      this.accumulator = Math.max(0, this.accumulator - MATCH_STEP);
    }
    this.muted = !!options.muted;
    // Spawns and expiries emit events; a quiet table only moves its pickup clock,
    // so the frozen view is shared and just that number is refreshed.
    const clock = this.game.state.arcade?.clock,
      view = this.cached;
    if (view?.arcade && view.arcade.clock !== clock)
      this.cached = Object.freeze({ ...view, arcade: Object.freeze({ ...view.arcade, clock }) });
    if (
      options.aiPaused ||
      !this.available ||
      this.mode !== 'ai' ||
      activeSeat(this.state) === 0 ||
      !['ready', 'ball-in-hand', 'choose-group'].includes(this.state.phase)
    )
      this.pauseAI();
    else this.updateAI(Math.min(dt, 0.1), options.aiCameraReady !== false);
  }
  private updateAI(dt: number, cameraReady: boolean) {
    const state = this.state,
      key = `${activeSeat(state)}:${state.phase}:${state.shotCount}`;
    if (this.aiPhase !== key) {
      this.pauseAI();
      this.aiPhase = key;
      const eligible = availableCues(state.arcade?.level);
      const preferences: CueId[] =
        this.difficulty === 'casual'
          ? ['maple-control', 'ash-house']
          : this.difficulty === 'expert'
            ? ['walnut-master', 'ebony-finesse', 'maple-control', 'ash-house']
            : activeSeat(state) % 2 === 0
              ? ['ebony-finesse', 'maple-control', 'ash-house']
              : ['rosewood-power', 'maple-control', 'ash-house'];
      const cue = preferences.find((id) => eligible.some((c) => c.id === id))!;
      if (state.cues[activeSeat(state)] !== cue) this.apply({ type: 'equip', cue }, activeSeat(state), 'ai');
    }
    this.aiElapsed += dt;
    if (state.phase === 'ball-in-hand' || state.phase === 'choose-group') {
      if (this.aiElapsed >= 0.75) {
        this.apply(
          state.phase === 'choose-group'
            ? { type: 'group', group: chooseGroup(state) }
            : { type: 'place', ...choosePlacement(state) },
          activeSeat(state),
          'ai',
        );
        this.pauseAI();
      }
      return;
    }
    if (!this.plan) {
      if (this.difficulty !== 'casual') this.apply({ type: 'chalk' }, activeSeat(state), 'ai');
      this.plan = chooseShot(this.state, this.difficulty, this.random);
    }
    // Camera gating pauses only the presentation stroke, never the match clock
    // or the chosen plan. Headless/server callers default to an available view.
    if (!cameraReady) {
      this.aiCameraStable = 0;
      this.aiStrokeElapsed = 0;
      return;
    }
    this.aiCameraStable += dt;
    if (this.aiCameraStable >= 0.18 && this.aiElapsed >= 0.35) this.aiStrokeElapsed += dt;
    if (this.aiStrokeElapsed >= 0.55) {
      this.apply({ type: 'shoot', shot: this.plan }, activeSeat(this.state), 'ai');
      this.pauseAI();
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.game.dispose();
    this.events = [];
    this.listeners.clear();
  }
}
