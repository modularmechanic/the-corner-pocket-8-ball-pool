import type { CueId } from '../simulation/cues';
import type { Difficulty, GameOptions, GameState, Mode, Shot, TableEvent } from '../simulation/types';
import type { MatchCapabilities } from './policy';
import type { CommandResult, RoomSnapshot } from './protocol';
export type MatchCommand =
  | { type: 'shoot'; shot: Shot }
  | { type: 'place'; x: number; z: number }
  | { type: 'chalk' }
  | { type: 'equip'; cue: CueId }
  | { type: 'rematch' }
  | { type: 'advance' }
  | { type: 'reset'; seed?: string; options?: GameOptions };
export interface MatchActor {
  seat: number;
  team: 0 | 1;
  controller: 'human' | 'ai';
  canAct: boolean;
}
export interface MatchUpdate {
  aiPaused?: boolean;
  muted?: boolean;
  aiCameraReady?: boolean;
}
export type MatchChange = { type: 'state' | 'connection' | 'replaced' } | { type: 'error'; error: string };
export interface Match {
  readonly mode: Mode;
  readonly state: GameState;
  readonly actor: MatchActor;
  readonly capabilities: MatchCapabilities;
  readonly seat: number;
  readonly connected: boolean;
  readonly ready: boolean;
  readonly pending: boolean;
  readonly room: RoomSnapshot | null;
  readonly aiPreview: { angle: number; power: number } | null;
  readonly thinking: boolean;
  execute(command: MatchCommand): Promise<CommandResult>;
  update(dt: number, options?: MatchUpdate): void;
  presentation(now?: number): GameState;
  drainEvents(): TableEvent[];
  pauseAI(): void;
  setDifficulty(difficulty: Difficulty): void;
  subscribe(listener: (change: MatchChange) => void): () => void;
  dispose(): void;
}
