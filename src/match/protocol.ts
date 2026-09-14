import type { CueId } from '../simulation/cues';
import type { GameFormat, GameOptions, GameState, Shot, TableEvent } from '../simulation/types';

export interface CommandResult { ok: boolean; error?: string }
export interface Identity { token: string; name: string }
export interface RoomPlayer { name: string; connected: boolean; seat: number; team: 0 | 1 }
export interface RoomSnapshot {
  code: string; format: GameFormat; capacity: 2 | 4; activeSeat: number;
  players: RoomPlayer[]; state: GameState; events: TableEvent[];
}
export type RoomReply = CommandResult & Partial<RoomSnapshot> & { seat?: number };
export type AcceptedRoom = RoomSnapshot & { ok: true; seat: number };
export type Ack<T = CommandResult> = (response: T) => void;
export interface ClientToServerEvents {
  'room:create': (data: Identity & GameOptions, ack: Ack<RoomReply>) => void;
  'room:join': (data: Identity & { code: string }, ack: Ack<RoomReply>) => void;
  'room:leave': () => void;
  'game:shot': (shot: Shot, ack: Ack) => void;
  'game:place': (point: { x: number; z: number }, ack: Ack) => void;
  'game:equip': (data: { cue: CueId }, ack: Ack) => void;
  'game:chalk': (data: Record<string, never>, ack: Ack) => void;
  'game:rematch': (data: { advance?: boolean }, ack: Ack) => void;
  'game:power': (data: unknown, ack: Ack) => void;
}
export interface ServerToClientEvents {
  'room:state': (room: RoomSnapshot) => void;
  'room:replaced': () => void;
}
export interface SocketData { room?: string; seat?: number }
export function acceptedRoom(reply: RoomReply): reply is AcceptedRoom {
  return reply.ok && !!reply.state && typeof reply.code === 'string' && typeof reply.seat === 'number' && Array.isArray(reply.players);
}
