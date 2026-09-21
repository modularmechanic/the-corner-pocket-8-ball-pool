import type { CueId } from './cues';
export const TABLE = { halfWidth: 5.7, halfDepth: 2.85, radius: 0.18, pocketRadius: 0.3 };
export const POCKETS = [
  { x: -5.66, z: -2.82 },
  { x: 0, z: -2.95 },
  { x: 5.66, z: -2.82 },
  { x: -5.66, z: 2.82 },
  { x: 0, z: 2.95 },
  { x: 5.66, z: 2.82 },
];
export type Group = 'solids' | 'stripes';
export type Difficulty = 'casual' | 'regular' | 'expert';
export type Mode = 'ai' | 'online' | 'local';
export type GameFormat = 'singles' | 'doubles';
/** Both follow the English Pool Association: a foul gives two visits. Old Rules (1991 pub rules) add a free shot;
 * New Rules (World Eightball poster) grant a free ball only when the incoming player is foul snookered. */
export type RuleSet = 'old' | 'new';
/** `ball-in-hand` places the cue ball: mandatory while it is off the table, optional (it may be shot from where it
 * lies instead) while it is still on the table. `choose-group` waits for the shooter to pick solids or stripes. */
export type Phase = 'ready' | 'rolling' | 'ball-in-hand' | 'choose-group' | 'over';
/** Which game is being played. Absent means eight-ball, so states written before modes existed still load. */
/** Modes settled by the shared cue-sports engine: the simulation produces a `ShotResult` and the mode
 * judges it. These are the modes `MODES` in `./modes` can hold. */
export type CueSportsModeId = 'eight-ball' | 'snooker' | 'billiards';
/** Every mode, including ones that are not cue sports. The zombie mode owns its own physics and has no
 * turns, fouls or pockets, so it is named here but deliberately absent from the cue-sports registry. */
export type GameModeId = CueSportsModeId | 'zombie';
export type ArenaLayout = 'crossfire' | 'fortress' | 'gauntlet' | 'riptide' | 'livewire' | 'blackout';
export type HazardKind = 'ramp' | 'portal' | 'electric' | 'water' | 'slime' | 'smoke';
export interface Hazard {
  id: number;
  kind: HazardKind;
  x: number;
  z: number;
  radius: number;
  angle?: number;
  link?: number;
}
export type PowerUp = 'overdrive' | 'frost' | 'ward' | 'focus' | 'portal';
export type StatusEffect = 'overdrive' | 'frozen' | 'ward' | 'focus' | 'jammed' | 'sticky';
export interface Pickup {
  id: number;
  x: number;
  z: number;
  radius: number;
  available: boolean;
  power?: PowerUp;
  expiresAt?: number;
}
export interface TableEvent {
  kind:
    | 'cue'
    | 'ball'
    | 'cushion'
    | 'pocket'
    | 'obstacle'
    | 'power'
    | 'hazard'
    | 'pickup'
    | 'status'
    | 'chalk'
    | 'coin'
    | 'spawn'
    | 'expire'
    | 'jump'
    | 'land'
    | 'out';
  strength: number;
  x: number;
  z: number;
  time: number;
  ball?: number;
  obstacle?: number;
  destroyed?: boolean;
  power?: PowerUp;
  hazard?: HazardKind;
  fromX?: number;
  fromZ?: number;
  status?: StatusEffect;
  reason?: 'pickup' | 'scratch-streak' | 'mixed-pot' | 'pot-streak';
  pickup?: number;
  elevation?: number;
  tipX?: number;
  tipY?: number;
  chalked?: boolean;
}
export interface Obstacle {
  id: number;
  x: number;
  z: number;
  width: number;
  depth: number;
  hp: number;
  maxHp: number;
  material: 'wood' | 'steel' | 'hex';
}
/** A scorch the Overdrive cue ball burned into the cloth. `heat` 0..1 is how fresh and fierce it is: it is both
 * the look of the mark and how much it drags on any ball that crosses it. Scorches outlive the shot that made them. */
export interface ScorchMark {
  id: number;
  x: number;
  z: number;
  radius: number;
  heat: number;
  /** Heading of the ball that burned it, in radians. The renderer stretches each mark along this so a
   * trail reads as one dragged scar rather than a string of beads. Absent on marks laid at a standstill. */
  angle?: number;
}
/** Ice a frozen cue ball left behind. `life` 0..1 is how much of it has not evaporated yet. */
export interface FrostMark {
  id: number;
  x: number;
  z: number;
  life: number;
}
export interface PlayerBuffs {
  overdrive: number;
  frozen: number;
  ward: number;
  focus: number;
  jammed: number;
  sticky: number;
}
export interface ArcadeState {
  layout: ArenaLayout;
  level: number;
  portalTurns: number;
  clock?: number;
  obstacles: Obstacle[];
  hazards: Hazard[];
  pickups: Pickup[];
  /** Scorch marks burned by Overdrive, newest last. Capped, oldest dropped: see MARK_LIMIT in ./arcade. */
  burns?: ScorchMark[];
  /** Ice dropped by a frozen cue ball, newest last. Same cap, same ordering. */
  frost?: FrostMark[];
  scratchStreak: [number, number];
  potStreak: [number, number];
  scores: [number, number];
  combo: number;
  buffs: [PlayerBuffs, PlayerBuffs];
  destroyed: [number, number];
  activeShot: {
    overdrive: boolean;
    frozen: boolean;
    ward: boolean;
    focus: boolean;
    sticky: boolean;
    chalked?: boolean;
    elevation?: number;
    tipX?: number;
    tipY?: number;
  };
}
/** Snooker's own bookkeeping, attached like `arcade` is. Frame scores, the red/colour alternation and the free ball
 * have no eight-ball equivalent, so they live here rather than widening GameState for every mode. */
export interface SnookerState {
  scores: [number, number];
  /** The striker is on a colour, having just potted a red. False means on a red, or on the next colour of the clearance. */
  onColour: boolean;
  /** A free ball is on: the striker was snookered on every ball on after the opponent's foul (WPBSA Section 2 Rule 16). */
  freeBall: boolean;
  /** The frame was conceded by this player (WPBSA Section 3 Rule 15). */
  conceded: 0 | 1 | null;
  /** The black was respotted because the frame finished level: the next score or foul decides it (WPBSA Section 4 Rule 4). */
  decider: boolean;
}
/** The horde's own bookkeeping, attached like `arcade` and `snooker` are. A run counts waves rather than racks, and
 * `arcade.level` is pinned at 1 on purpose, so the wave has nowhere else to live. Kills, combo and score ride along
 * so the HUD and the end-of-run dialog read one run record instead of the lossy arcade mapping beside it. */
export interface HordeState {
  /** The wave being fought, from 1. Waves survived is `wave - 1`. */
  wave: number;
  kills: number;
  /** Kills in the shot just taken; reset when the next shot is fired. */
  combo: number;
  score: number;
}
export interface GameOptions {
  mode?: GameModeId;
  layout?: ArenaLayout;
  level?: number;
  format?: GameFormat;
  rules?: RuleSet;
}
export interface Ball {
  id: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  pocketed: boolean;
  elevation?: number;
  vy?: number;
  airborne?: boolean;
  teleport?: number;
}
export interface GameState {
  format: GameFormat;
  teamOrder: [0 | 1, 0 | 1];
  cues: CueId[];
  /** Fixed for the session. */
  rules: RuleSet;
  /** Visits the current team holds after the other side's foul, counting the one in progress; 0 is an ordinary visit. */
  shotsLeft: 0 | 1 | 2;
  /** The next shot may hit any ball first: the Old Rules free shot or the New Rules free ball (foul snooker). */
  freeShot: boolean;
  /** New Rules: a group chosen after the break that was not potted; it is decided only if the next shot pots one. */
  nominated: Group | null;
  /** The balls were re-racked, so the next shot is a break again. */
  rebreak: boolean;
  seed: string;
  balls: Ball[];
  turn: 0 | 1;
  groups: [Group | null, Group | null];
  phase: Phase;
  shotCount: number;
  winner: 0 | 1 | null;
  message: string;
  lastPotted: number[];
  foul: boolean;
  chalked: [boolean, boolean];
  lastShot?: Shot;
  /** Absent means eight-ball. */
  mode?: GameModeId;
  arcade?: ArcadeState;
  snooker?: SnookerState;
  horde?: HordeState;
  /** Engine continuation included by snapshot(), so a rolling arrangement can resume. */
  simulation?: SimulationContinuation;
}
export interface Shot {
  angle: number;
  power: number;
  elevation?: number;
  tipX?: number;
  tipY?: number;
}
export interface ShotResult {
  firstContact: number | null;
  /** Every object ball the cue ball struck, in contact order. Eight-ball and snooker judge a shot by
   * `firstContact` alone, but an English Billiards cannon is contact with BOTH object balls, so a mode
   * that scores cannons cannot be settled without this. Optional: fixtures and older callers omit it. */
  contacts?: number[];
  potted: number[];
  railAfterContact: boolean;
  breakRails: number[];
  obstacleContact?: boolean;
  offTable?: number[];
}
export interface SimulationContinuation {
  shotResult: ShotResult;
  legalBefore: number[];
  stillTime: number;
  rollTime: number;
  portalRewardPending: boolean;
  /** Pockets the ward has turned a ball away from during this shot, so a shielded ball cannot ping-pong forever. */
  wardDeflects: number;
  pickupDraws: number;
  nextPickupAt: number;
  nextPickupId: number;
  obstacleCooldown: [number, number][];
  portalCooldown: [number, number][];
  zoneOccupants: [number, number[]][];
  hazardRewards: string[];
  activeContacts?: string[];
  cueSpin: {
    side: number;
    follow: number;
    energy: number;
    elevation: number;
    tipY: number;
    dx: number;
    dz: number;
    contact: boolean;
  };
  pendingSpin: { x: number; z: number };
}
export const groupOf = (id: number): Group | null => (id > 0 && id < 8 ? 'solids' : id > 8 ? 'stripes' : null);
export const other = (player: 0 | 1): 0 | 1 => (player === 0 ? 1 : 0);
/** Scotch doubles: seat 0 partners with 2; seat 1 partners with 3. */
export const activeSeat = (state: GameState): number =>
  state.format === 'doubles' ? state.turn + 2 * state.teamOrder[state.turn] : state.turn;
export const teamOfSeat = (seat: number): 0 | 1 => (seat % 2 === 0 ? 0 : 1);
export const seatCount = (format: GameFormat): 2 | 4 => (format === 'doubles' ? 4 : 2);
export function seededRandom(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const RACK_ROW = TABLE.radius * Math.sqrt(3) * 1.015;
/** The black's place in the rack (the centre of the third row): its spot after it leaves the table. */
export const BLACK_SPOT = { x: 2.55 + 2 * RACK_ROW, z: 0 };
export function newRack(seed: string): Ball[] {
  const random = seededRandom(seed);
  const remaining = [2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
  for (let i = remaining.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
  }
  const solidCorner = remaining.splice(
    remaining.findIndex((id) => id < 8),
    1,
  )[0];
  const stripeCorner = remaining.splice(
    remaining.findIndex((id) => id > 8),
    1,
  )[0];
  const balls: Ball[] = [{ id: 0, x: -2.85, z: 0, vx: 0, vz: 0, pocketed: false }];
  for (let row = 0; row < 5; row++)
    for (let col = 0; col <= row; col++) {
      const id =
        row === 0
          ? 1
          : row === 2 && col === 1
            ? 8
            : row === 4 && col === 0
              ? solidCorner
              : row === 4 && col === 4
                ? stripeCorner
                : remaining.pop()!;
      balls.push({
        id,
        x: 2.55 + row * RACK_ROW,
        z: (col - row / 2) * TABLE.radius * 2.03,
        vx: 0,
        vz: 0,
        pocketed: false,
      });
    }
  return balls.sort((a, b) => a.id - b.id);
}
export function initialState(seed: string, format: GameFormat = 'singles', rules: RuleSet = 'new'): GameState {
  return {
    format: format === 'doubles' ? 'doubles' : 'singles',
    rules: rules === 'old' ? 'old' : 'new',
    shotsLeft: 0,
    freeShot: false,
    nominated: null,
    rebreak: false,
    teamOrder: [0, 0],
    cues: Array.from({ length: format === 'doubles' ? 4 : 2 }, () => 'ash-house' as CueId),
    seed,
    balls: newRack(seed),
    turn: 0,
    groups: [null, null],
    phase: 'ready',
    shotCount: 0,
    winner: null,
    message: 'The table is yours. Make the break.',
    lastPotted: [],
    foul: false,
    chalked: [false, false],
  };
}
export const isBreakShot = (state: GameState): boolean => state.shotCount === 0 || state.rebreak;
/** Which ball the striker strikes. Every mode here has a single cue ball at index 0 except English Billiards, where
 * each side owns one: plain White for player 0, Yellow for player 1 (see `modes/billiards.ts`, whose `cueBallOf`
 * is this same branch). Anything that means "the striker's cue ball" must ask here rather than assume `balls[0]`;
 * anything that means "the entity at index 0" (a collision index, say) must not. `player` is explicit for the
 * callers that judge a shot on someone else's behalf — the AI and the settlement's `context.shooter`. */
export const cueBallId = (state: Pick<GameState, 'mode' | 'turn'>, player: 0 | 1 = state.turn): number =>
  state.mode === 'billiards' && player === 1 ? 2 : 0;
/** Optional placement: ball in hand while the cue ball is still on the table, so it may also be shot from where it lies. */
export const optionalPlacement = (state: Pick<GameState, 'phase' | 'balls' | 'mode' | 'turn'>): boolean =>
  state.phase === 'ball-in-hand' && !state.balls[cueBallId(state)].pocketed;
/** Balls the shooter may hit first. A free shot or free ball allows any ball. */
export function legalTargets(state: GameState, player = state.turn): Ball[] {
  const active = state.balls.filter((b) => !b.pocketed && b.id !== 0);
  if (state.freeShot) return active;
  const group = state.groups[player];
  if (!group) return active.filter((b) => b.id !== 8);
  const targets = active.filter((b) => groupOf(b.id) === group);
  return targets.length ? targets : active.filter((b) => b.id === 8);
}
