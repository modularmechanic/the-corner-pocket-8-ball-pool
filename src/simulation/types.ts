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
/** `ball-in-hand` places the cue ball: mandatory while it is off the table, optional (it may be played from where it
 * lies) while it is still on the table. `choose-group` waits for the shooter to pick solids or stripes. */
export type Phase = 'ready' | 'rolling' | 'ball-in-hand' | 'choose-group' | 'over';
export type ArenaLayout = 'crossfire' | 'fortress' | 'gauntlet';
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
export interface GameOptions {
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
  arcade?: ArcadeState;
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
/** Balls the shooter may hit first. A free shot or free ball allows any ball. */
export function legalTargets(state: GameState, player = state.turn): Ball[] {
  const active = state.balls.filter((b) => !b.pocketed && b.id !== 0);
  if (state.freeShot) return active;
  const group = state.groups[player];
  if (!group) return active.filter((b) => b.id !== 8);
  const targets = active.filter((b) => groupOf(b.id) === group);
  return targets.length ? targets : active.filter((b) => b.id === 8);
}
