import {
  CUE_HOME,
  fire,
  initialZombieState,
  step as zombieStep,
  ZOMBIE_DT,
  type ZombieEvent,
  type ZombieState,
} from '../simulation/modes/zombie';
import { normalizeCues } from '../simulation/cues';
import type { Difficulty, GameState, PlayerBuffs, TableEvent } from '../simulation/types';
import { matchCapabilities } from './policy';
import type { CommandResult } from './protocol';
import type { Match, MatchActor, MatchChange, MatchCommand, MatchUpdate } from './types';

/** The zombie horde beside the match controller rather than inside it.
 *
 * `PoolGame` cannot host this mode and `modeOf` throws on it on purpose: the horde has its own engine, no turns, no
 * fouls and no pockets, and `resolveShot` is both its physics and its settlement. So this is a sibling authority
 * that speaks the same `Match` language the shell, the renderer and the HUD already speak, and projects the run into
 * a `GameState` view for them — one cue ball, the walkers as arcade obstacles (which is how the arena visuals find
 * them), and the run's score on the arcade scoreboard. Nothing here judges the run; the engine does.
 */
const NO_BUFFS: PlayerBuffs = { overdrive: 0, frozen: 0, ward: 0, focus: 0, jammed: 0, sticky: 0 };
const buffs = (): [PlayerBuffs, PlayerBuffs] => [{ ...NO_BUFFS }, { ...NO_BUFFS }];

/** The run as the rest of the app reads it. The run's own numbers ride on `horde`, the way snooker's ride on
 * `snooker`: the arcade copies below are what the arena visuals and the score badge already read, but the wave has
 * no arcade home (`level` is pinned) and a readout that parsed it back out of `message` would break on a reword. */
export function projectZombie(run: ZombieState): GameState {
  return {
    format: 'singles',
    teamOrder: [0, 0],
    cues: normalizeCues([], 'singles', 1),
    rules: 'new',
    shotsLeft: 0,
    freeShot: false,
    nominated: null,
    rebreak: false,
    seed: run.seed,
    balls: [{ ...run.cue }],
    turn: 0,
    groups: [null, null],
    phase: run.phase === 'aim' ? 'ready' : run.phase === 'rolling' ? 'rolling' : 'over',
    shotCount: run.shots,
    // Nobody wins a horde: a run ends when they get through. The presentation reads the mode and shows the run's
    // own message instead of a winner, but the field is not nullable while the phase is over.
    winner: run.phase === 'over' ? 1 : null,
    message: run.message,
    lastPotted: [],
    foul: false,
    chalked: [false, false],
    ...(run.lastShot ? { lastShot: { ...run.lastShot } } : {}),
    mode: 'zombie',
    horde: { wave: run.wave, kills: run.kills, combo: run.combo, score: run.score },
    arcade: {
      layout: 'crossfire',
      // The table level is a five-rung arcade ladder, not a wave counter: pinned, so a long run cannot index past it.
      level: 1,
      portalTurns: 0,
      obstacles: run.zombies.map((zombie) => ({ ...zombie })),
      hazards: [],
      pickups: [],
      scratchStreak: [0, 0],
      potStreak: [0, 0],
      scores: [run.score, 0],
      combo: run.combo,
      buffs: buffs(),
      destroyed: [run.kills, 0],
      activeShot: { overdrive: false, frozen: false, ward: false, focus: false, sticky: false },
    },
  };
}

/** The renderer's own language: a walker hit is an obstacle strike, and a kill is one that destroyed it. The wave
 * and breach events have no table equivalent and are carried by the projected message instead. */
function asTableEvent(event: ZombieEvent, time: number): TableEvent | null {
  if (event.kind === 'hit' || event.kind === 'kill')
    return {
      kind: 'obstacle',
      x: event.x,
      z: event.z,
      strength: event.strength,
      time,
      obstacle: event.zombie,
      destroyed: event.kind === 'kill',
    };
  if (event.kind === 'cushion') return { kind: 'cushion', x: event.x, z: event.z, strength: event.strength, time };
  return null;
}

export class ZombieMatch implements Match {
  /** There is one player and no opponent, so the horde is always a local session. */
  readonly mode = 'local' as const;
  readonly connected = true;
  readonly pending = false;
  readonly room = null;
  readonly seat = 0;
  readonly ready = true;
  readonly aiPreview = null;
  readonly thinking = false;
  private run: ZombieState;
  private seed: string;
  private cached: GameState | null = null;
  private accumulator = 0;
  private events: TableEvent[] = [];
  private muted = false;
  private listeners = new Set<(change: MatchChange) => void>();
  private disposed = false;
  constructor(config: { seed: string }) {
    this.seed = config.seed;
    this.run = initialZombieState(config.seed);
  }
  get state(): GameState {
    if (!this.cached) this.cached = projectZombie(this.run);
    return this.cached;
  }
  snapshot(): GameState {
    return projectZombie(this.run);
  }
  get capabilities() {
    // A run has no levels to advance through: it ends when they get through, and the only way on is another run.
    return { ...matchCapabilities(this.state, this.mode, true), canAdvance: false };
  }
  get actor(): MatchActor {
    return { seat: 0, team: 0, controller: 'human', canAct: this.run.phase === 'aim' };
  }
  presentation() {
    return this.state;
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
  drainEvents() {
    return this.events.splice(0);
  }
  execute(command: MatchCommand) {
    return Promise.resolve(this.dispatch(command));
  }
  dispatch(command: MatchCommand): CommandResult {
    if (this.disposed) return { ok: false, error: 'This run has closed.' };
    if (command.type === 'reset' || command.type === 'rematch' || command.type === 'advance') {
      this.seed = command.type === 'reset' && command.seed ? command.seed : `${this.seed}-${this.run.tick}`;
      this.run = initialZombieState(this.seed);
      this.accumulator = 0;
      this.events = [];
      this.changed();
      return { ok: true };
    }
    // Cues, chalk and groups are pool furniture. A run has none of them and the shell offers them anyway, so they
    // are accepted and ignored rather than answered with an error the player cannot act on.
    if (command.type !== 'shoot') return { ok: true };
    const next = fire(this.run, command.shot);
    if (next === this.run) return { ok: false, error: 'Wait for the ball to settle.' };
    this.run = next;
    this.accumulator = 0;
    this.changed();
    return { ok: true };
  }
  update(dt: number, options: MatchUpdate = {}) {
    this.muted = !!options.muted;
    if (this.muted) this.events = [];
    if (this.disposed || !Number.isFinite(dt) || dt <= 0 || this.run.phase !== 'rolling') return;
    this.accumulator += dt;
    // The same fixed-step contract the pool match keeps, and the same half-second catch-up budget: the horde only
    // ever walks inside these steps, so a hidden tab resumes where it left off instead of skipping a shot.
    for (let steps = 0; steps < 60 && this.accumulator + 1e-10 >= ZOMBIE_DT; steps++) {
      this.run = zombieStep(this.run);
      this.accumulator = Math.max(0, this.accumulator - ZOMBIE_DT);
      if (!this.muted)
        for (const event of this.run.events) {
          const table = asTableEvent(event, this.run.tick * ZOMBIE_DT);
          if (table && this.events.length < 160) this.events.push(table);
        }
      if (this.run.phase !== 'rolling') break;
    }
    this.changed();
  }
  /** Nothing to arrange: the run has no physics world and no cue to place. Kept so the shell can treat every
   * authority the same way, and used by tests to drive a run to a chosen position. */
  arrange(run: ZombieState) {
    this.run = structuredClone(run);
    this.accumulator = 0;
    this.events = [];
    this.changed();
  }
  get homeSpot() {
    return CUE_HOME;
  }
  pauseAI() {}
  setDifficulty(_difficulty: Difficulty) {}
  dispose() {
    this.disposed = true;
    this.events = [];
    this.listeners.clear();
  }
}
