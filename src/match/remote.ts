import { io, type Socket } from 'socket.io-client';
import { activeSeat, type Difficulty, type GameOptions, type GameState, type TableEvent } from '../simulation/types';
import { humanControls, matchCapabilities } from './policy';
import {
  acceptedRoom,
  type ClientToServerEvents,
  type CommandResult,
  type Identity,
  type RoomReply,
  type RoomSnapshot,
  type ServerToClientEvents,
} from './protocol';
import { SnapshotTimeline } from './timeline';
import type { Match, MatchActor, MatchChange, MatchCommand, MatchUpdate } from './types';

export interface RemoteMatchOptions {
  identity: Identity;
  url?: string;
  now?: () => number;
}
/** Owns reconnects, authenticated room requests and delayed visual snapshots. */
export class RemoteMatch implements Match {
  readonly mode = 'online' as const;
  readonly aiPreview = null;
  readonly thinking = false;
  private socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private timeline = new SnapshotTimeline();
  private listeners = new Set<(change: MatchChange) => void>();
  private current: GameState | null = null;
  private roomInfo: RoomSnapshot | null = null;
  private ownSeat = 0;
  private generation = 0;
  private inFlight = false;
  private recovering = false;
  private muted = false;
  private now: () => number;
  private readonly identity: Identity;
  constructor(config: RemoteMatchOptions) {
    this.identity = { ...config.identity };
    this.now = config.now || (() => performance.now());
    const options = { autoConnect: false, reconnection: true, reconnectionDelay: 700, reconnectionDelayMax: 4000 };
    this.socket = config.url ? io(config.url, options) : io(options);
    this.socket.on('connect', () => {
      const room = this.roomInfo;
      this.recovering = !!room;
      this.notify({ type: 'connection' });
      if (room) void this.recover(room.code);
    });
    this.socket.on('disconnect', () => {
      this.generation++;
      this.inFlight = false;
      this.recovering = false;
      this.timeline.clear();
      this.notify({ type: 'connection' });
    });
    this.socket.on('room:replaced', () => {
      this.leave();
      this.notify({ type: 'replaced' });
    });
    this.socket.on('room:state', (packet) => {
      if (!this.roomInfo || packet.code !== this.roomInfo.code) return;
      this.receive(packet);
      this.notify({ type: 'state' });
    });
  }
  get state(): GameState {
    if (!this.current) throw new Error('Join a room before reading its match.');
    return this.current;
  }
  get room() {
    return this.roomInfo;
  }
  get seat() {
    return this.ownSeat;
  }
  get connected() {
    return this.socket.connected;
  }
  get pending() {
    return this.inFlight || this.recovering;
  }
  get ready() {
    return (
      this.connected &&
      !this.recovering &&
      !!this.roomInfo &&
      this.roomInfo.players.length === this.roomInfo.capacity &&
      this.roomInfo.players.every((player) => player.connected)
    );
  }
  get capabilities() {
    return matchCapabilities(this.state, this.mode, this.ready, this.pending, this.connected);
  }
  get actor(): MatchActor {
    const state = this.state,
      shown = this.timeline.shown(this.now()) || state;
    return {
      seat: activeSeat(state),
      team: state.turn,
      controller: 'human',
      canAct:
        this.ready &&
        !this.pending &&
        humanControls(state, 'online', this.ownSeat) &&
        (state.phase === 'ready' || state.phase === 'ball-in-hand') &&
        shown.phase === state.phase &&
        shown.shotCount === state.shotCount &&
        activeSeat(shown) === activeSeat(state),
    };
  }
  subscribe(listener: (change: MatchChange) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private notify(change: MatchChange) {
    for (const listener of this.listeners) listener(change);
  }
  setDifficulty(_difficulty: Difficulty) {}
  pauseAI() {}
  update(_dt: number, options: MatchUpdate = {}) {
    this.muted = !!options.muted;
    if (this.muted) this.timeline.mute();
  }
  presentation(now = this.now()) {
    return this.timeline.sample(now) || this.state;
  }
  drainEvents(): TableEvent[] {
    return this.muted ? [] : this.timeline.drainEvents(this.now());
  }
  private receive(packet: RoomSnapshot, immediate = false) {
    this.roomInfo = packet;
    this.current = packet.state;
    this.timeline.push(packet.state, this.muted ? [] : packet.events || [], this.now(), immediate);
  }
  private accept(reply: RoomReply): CommandResult {
    if (!acceptedRoom(reply)) return { ok: false, error: reply.error || 'Could not open the table.' };
    this.ownSeat = reply.seat;
    this.recovering = false;
    this.timeline.clear();
    this.receive(reply, true);
    this.notify({ type: 'state' });
    return { ok: true };
  }
  private async recover(code: string) {
    const generation = this.generation;
    try {
      const reply = await this.socket.timeout(7000).emitWithAck('room:join', { ...this.identity, code });
      if (generation !== this.generation || !this.roomInfo || this.roomInfo.code !== code) return;
      const result = this.accept(reply);
      if (!result.ok) {
        this.leave();
        this.notify({ type: 'error', error: result.error! });
      }
    } catch {
      if (generation === this.generation) {
        this.leave();
        this.notify({ type: 'error', error: 'Could not recover the table.' });
      }
    } finally {
      if (generation === this.generation) {
        this.recovering = false;
        this.notify({ type: 'connection' });
      }
    }
  }
  private async connect() {
    if (this.socket.connected) return;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        this.socket.off('connect', ready);
        this.socket.off('connect_error', failed);
      };
      const ready = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error('The room server is unavailable. Please try again.'));
      };
      const timeout = setTimeout(failed, 8000);
      this.socket.once('connect', ready);
      this.socket.once('connect_error', failed);
      this.socket.connect();
    });
  }
  private async enter(send: () => Promise<RoomReply>): Promise<CommandResult> {
    if (this.pending) return { ok: false, error: 'A room request is already pending.' };
    const generation = this.generation;
    this.inFlight = true;
    try {
      await this.connect();
      if (generation !== this.generation) return { ok: false, error: 'The room request was cancelled.' };
      const reply = await send();
      if (generation !== this.generation) return { ok: false, error: 'The room request was cancelled.' };
      return this.accept(reply);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Could not open the table.' };
    } finally {
      if (generation === this.generation) {
        this.inFlight = false;
        this.notify({ type: 'connection' });
      }
    }
  }
  create(options: GameOptions = {}): Promise<CommandResult> {
    return this.enter(() => this.socket.timeout(7000).emitWithAck('room:create', { ...this.identity, ...options }));
  }
  join(code: string): Promise<CommandResult> {
    return this.enter(() => this.socket.timeout(7000).emitWithAck('room:join', { ...this.identity, code }));
  }
  async execute(command: MatchCommand): Promise<CommandResult> {
    if (!this.roomInfo || !this.connected || (command.type !== 'equip' && !this.ready) || this.pending)
      return { ok: false, error: 'Reconnect all players before playing.' };
    if (command.type === 'reset') command = { type: 'rematch' };
    if (['shoot', 'place', 'chalk'].includes(command.type) && !this.actor.canAct)
      return { ok: false, error: 'Wait for your turn.' };
    const generation = this.generation;
    this.inFlight = true;
    this.notify({ type: 'connection' });
    try {
      const socket = this.socket.timeout(7000);
      const reply =
        command.type === 'shoot'
          ? await socket.emitWithAck('game:shot', command.shot)
          : command.type === 'place'
            ? await socket.emitWithAck('game:place', { x: command.x, z: command.z })
            : command.type === 'equip'
              ? await socket.emitWithAck('game:equip', { cue: command.cue })
              : command.type === 'chalk'
                ? await socket.emitWithAck('game:chalk', {})
                : await socket.emitWithAck('game:rematch', { advance: command.type === 'advance' });
      return generation === this.generation ? reply : { ok: false, error: 'The connection changed. Please try again.' };
    } catch {
      return { ok: false, error: 'Connection interrupted. Reconnecting…' };
    } finally {
      if (generation === this.generation) {
        this.inFlight = false;
        this.notify({ type: 'connection' });
      }
    }
  }
  leave() {
    this.generation++;
    this.inFlight = false;
    this.recovering = false;
    this.socket.emit('room:leave');
    this.roomInfo = null;
    this.timeline.clear();
  }
  dispose() {
    this.leave();
    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.listeners.clear();
    this.current = null;
  }
}
