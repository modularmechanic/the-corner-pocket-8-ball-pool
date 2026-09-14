import { Server, type Socket } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { LocalMatch } from '../src/match/local';
import type { MatchCommand } from '../src/match/types';
import type { Ack, ClientToServerEvents, CommandResult, Identity, RoomReply, RoomSnapshot, ServerToClientEvents, SocketData } from '../src/match/protocol';
import { activeSeat, teamOfSeat, seatCount, type GameOptions } from '../src/simulation/types';
interface Seat { token: string; name: string; socketId: string | null }
interface Room { code: string; match: LocalMatch; seats: Seat[]; updated: number; broadcastTime: number }
type RoomSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
const reply = (ack: unknown, response: CommandResult) => { if (typeof ack === 'function') ack(response); };
function validIdentity(data: unknown): data is Identity {
  return !!data && typeof data === 'object' && 'token' in data && typeof data.token === 'string' && /^[\w-]{16,80}$/.test(data.token) && 'name' in data && typeof data.name === 'string';
}
export function attachRooms(http: HttpServer) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(http, { maxHttpBufferSize: 16_384 });
  const rooms = new Map<string, Room>();
  const syncSeats = (room: Room) => room.match.setReady(room.seats.length === seatCount(room.match.state.format) && room.seats.every(seat => !!seat.socketId));
  const info = (room: Room): RoomSnapshot => ({ code: room.code, format: room.match.state.format, capacity: seatCount(room.match.state.format), activeSeat: activeSeat(room.match.state), players: room.seats.map((s, seat) => ({ name: s.name, connected: !!s.socketId, seat, team: teamOfSeat(seat) })), state: room.match.snapshot(), events: [] });
  const publish = (room: Room) => { io.to(room.code).emit('room:state', { ...info(room), events: room.match.drainEvents() }); };
  const socketRoom = (socket: RoomSocket) => socket.data.room ? rooms.get(socket.data.room) : undefined;
  function leave(socket: RoomSocket) {
    const room = socketRoom(socket);
    if (room) {
      const seat = room.seats.find(s => s.socketId === socket.id);
      if (seat) seat.socketId = null;
      syncSeats(room); room.updated = Date.now(); socket.leave(room.code); publish(room);
    }
    delete socket.data.room; delete socket.data.seat;
  }
  function command(socket: RoomSocket, command: MatchCommand, ack: unknown) {
    const room = socketRoom(socket), seat = socket.data.seat;
    if (!room || seat === undefined || room.seats[seat]?.socketId !== socket.id) return reply(ack, { ok: false, error: 'Join a table before playing.' });
    const result = room.match.dispatch(command, seat);
    if (result.ok) { room.updated = Date.now(); publish(room); }
    reply(ack, result);
  }
  io.on('connection', socket => {
    let lastAction = 0;
    const limited = () => { const now = Date.now(); if (now - lastAction < 180) return true; lastAction = now; return false; };
    const sit = (room: Room, seat: number, data: Identity, ack: Ack<RoomReply>) => {
      const existing = room.seats[seat];
      if (existing?.socketId && existing.socketId !== socket.id) {
        const oldSocket = io.sockets.sockets.get(existing.socketId);
        if (oldSocket) { oldSocket.leave(room.code); delete oldSocket.data.room; delete oldSocket.data.seat; oldSocket.emit('room:replaced'); }
      }
      room.seats[seat] = { token: data.token, name: data.name.trim().slice(0, 22) || (seat ? 'Guest' : 'Host'), socketId: socket.id };
      syncSeats(room); room.updated = Date.now(); socket.data.room = room.code; socket.data.seat = seat;
      socket.join(room.code); ack({ ok: true, seat, ...info(room) }); publish(room);
    };
    socket.on('room:create', (data, ack) => {
      if (typeof ack !== 'function') return;
      if (limited() || !validIdentity(data)) return ack({ ok: false, error: 'Please wait a moment and try again.' });
      if (data.format !== undefined && data.format !== 'singles' && data.format !== 'doubles') return ack({ ok: false, error: 'Choose singles or doubles for this table.' });
      if (rooms.size >= 120) return ack({ ok: false, error: 'The club is full. Please try again shortly.' });
      leave(socket);
      let code: string; do { code = randomBytes(5).toString('hex').slice(0, 6).toUpperCase(); } while (rooms.has(code));
      const room: Room = { code, match: new LocalMatch({ seed: code, mode: 'online', options: data as GameOptions, nextSeed: () => code + '-' + randomBytes(3).toString('hex') }), seats: [], updated: Date.now(), broadcastTime: 0 };
      rooms.set(code, room); sit(room, 0, data, ack);
    });
    socket.on('room:join', (data, ack) => {
      if (typeof ack !== 'function') return;
      if (limited() || !validIdentity(data) || typeof data.code !== 'string') return ack({ ok: false, error: 'Enter a valid six-character room code.' });
      const room = rooms.get(data.code.trim().toUpperCase());
      if (!room) return ack({ ok: false, error: 'That table is not open. Check the code with your friend.' });
      const returning = room.seats.findIndex(s => s.token === data.token);
      if (returning === -1 && room.seats.length >= seatCount(room.match.state.format)) return ack({ ok: false, error: `This table already has ${seatCount(room.match.state.format) === 4 ? 'four' : 'two'} players.` });
      leave(socket); sit(room, returning === -1 ? room.seats.length : returning, data, ack);
    });
    socket.on('game:shot', (shot, ack) => command(socket, { type: 'shoot', shot }, ack));
    socket.on('game:equip', (data, ack) => command(socket, { type: 'equip', cue: data?.cue }, ack));
    socket.on('game:chalk', (_, ack) => command(socket, { type: 'chalk' }, ack));
    socket.on('game:place', (point, ack) => command(socket, { type: 'place', x: point?.x, z: point?.z }, ack));
    socket.on('game:rematch', (data, ack) => command(socket, { type: data?.advance === true ? 'advance' : 'rematch' }, ack));
    socket.on('game:power', (_, ack) => reply(ack, { ok: false, error: 'Power-ups are collected on the table.' }));
    socket.on('room:leave', () => leave(socket));
    socket.on('disconnect', () => leave(socket));
  });
  let previous = performance.now();
  const tick = setInterval(() => {
    const now = performance.now(), dt = Math.max(0, (now - previous) / 1000); previous = now;
    for (const room of rooms.values()) {
      const wasRolling = room.match.state.phase === 'rolling';
      room.match.update(dt);
      room.broadcastTime += dt;
      if (wasRolling && (room.broadcastTime >= 1 / 60 || room.match.state.phase !== 'rolling') || room.match.hasEvents) { publish(room); room.broadcastTime %= 1 / 60; }
    }
  }, 8);
  const cleanup = setInterval(() => {
    for (const [code, room] of rooms) if (room.seats.every(s => !s.socketId) && Date.now() - room.updated > 10 * 60_000) { room.match.dispose(); rooms.delete(code); }
  }, 60_000);
  return { io, rooms, close: async () => { clearInterval(tick); clearInterval(cleanup); for (const room of rooms.values()) room.match.dispose(); rooms.clear(); await io.close(); } };
}
