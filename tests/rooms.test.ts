import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { initPhysics } from '../src/simulation/game';
import { LocalMatch } from '../src/match/local';
import type { RoomSnapshot, ClientToServerEvents, ServerToClientEvents } from '../src/match/protocol';
import { allowedOrigins, attachRooms } from '../server/rooms';
import { resolveRoomServer } from '../src/match/room-server';
import { activeSeat, type GameState, type TableEvent } from '../src/simulation/types';
let server: ReturnType<typeof attachRooms>;
let url: string;
type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
const sockets: TestSocket[]=[];
before(async()=>{
  await initPhysics(); const http=createServer(); server=attachRooms(http);
  await new Promise<void>((resolve,reject)=>{
    http.once('error',reject);
    http.listen(0,'127.0.0.1',()=>{ http.off('error',reject); resolve(); });
  });
  url=`http://127.0.0.1:${(http.address() as {port:number}).port}`;
});
after(async()=>{ for(const s of sockets)s.disconnect(); await server.close(); });
async function client() {
  const socket: TestSocket=io(url,{forceNew:true,transports:['websocket']}); sockets.push(socket);
  await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve); socket.once('connect_error',reject);}); return socket;
}
const request=(socket:Socket,event:string,data:unknown)=>socket.timeout(3000).emitWithAck(event,data);
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 2000;
  while (!predicate() && Date.now() < deadline) await delay(10);
  assert.ok(predicate(), message);
}

test('two friends share an authoritative seeded table; other turns, extra players and invalid shots are rejected',async()=>{
  const host=await client(),guest=await client(),third=await client();
  const hostId=randomUUID(),guestId=randomUUID();
  const created=await request(host,'room:create',{name:'Host',token:hostId});
  assert.equal(created.ok,true); assert.equal(created.seat,0); assert.match(created.code,/^[A-F0-9]{6}$/);
  assert.equal(created.format,'singles');assert.equal(created.capacity,2);assert.equal(activeSeat(created.state),0);
  const solo=await request(host,'game:shot',{angle:0,power:.8}); assert.equal(solo.ok,false);
  const joined=await request(guest,'room:join',{name:'Guest',token:guestId,code:created.code});
  assert.equal(joined.ok,true); assert.equal(joined.seat,1); assert.deepEqual(created.state.balls,joined.state.balls);
  const full=await request(third,'room:join',{name:'Third',token:randomUUID(),code:created.code}); assert.equal(full.ok,false);
  assert.equal((await request(guest,'game:shot',{angle:0,power:.9})).ok,false);
  assert.equal((await request(host,'game:shot',{angle:0,power:1000})).ok,false);
  let hostState:any,guestState:any;
  host.on('room:state',data=>hostState=data.state); guest.on('room:state',data=>guestState=data.state);
  assert.equal((await request(host,'game:shot',{angle:0,power:.85})).ok,true);
  assert.equal((await request(host,'game:shot',{angle:0,power:.85})).ok,false);
  await delay(250); assert.equal(hostState.phase,'rolling'); assert.deepEqual(hostState,guestState);
  // Advance the same authoritative engine to settlement without a slow real-time test.
  const room=server.rooms.get(created.code)!;
  for(let i=0;room.match.state.phase==='rolling'&&i<4000;i++)room.match.update(1/120);
  assert.equal(room.match.state.shotCount,1);
  const snapshot=JSON.parse(JSON.stringify(room.match.state)); guest.disconnect(); await delay(50);
  const returning=await client();
  const rejoined=await request(returning,'room:join',{name:'Guest',token:guestId,code:created.code});
  assert.equal(rejoined.seat,1); assert.deepEqual(rejoined.state,{...snapshot,arcade:{...snapshot.arcade,clock:rejoined.state.arcade.clock}}); assert.equal(rejoined.players.length,2);
  assert.equal((await request(host,'game:rematch',{})).ok,false);
  host.disconnect(); returning.disconnect(); third.disconnect();
});

type TeamPacket = RoomSnapshot;
async function doublesRoom() {
  const clients=await Promise.all([client(),client(),client(),client()]),tokens=clients.map(()=>randomUUID());
  const created=await request(clients[0],'room:create',{name:'Seat 0',token:tokens[0],format:'doubles'});
  assert.equal(created.ok,true);
  for(let i=1;i<4;i++){
    const joined=await request(clients[i],'room:join',{name:`Seat ${i}`,token:tokens[i],code:created.code});
    assert.equal(joined.ok,true);assert.equal(joined.seat,i);
  }
  return {clients,tokens,created,room:server.rooms.get(created.code)!};
}
function finishRack(match: LocalMatch, winner: 0 | 1) { const state = match.snapshot(); state.phase = 'over'; state.winner = winner; match.arrange(state); }
function settleRoom(room:{match:LocalMatch}) {
  for(let i=0;i<4000&&room.match.state.phase==='rolling';i++)room.match.update(1/120);
  assert.notEqual(room.match.state.phase,'rolling','the authoritative shot settles');
}

test('doubles waits for all four seats, advertises teams, and rejects a fifth player and invalid formats',async()=>{
  const clients=await Promise.all([client(),client(),client(),client(),client(),client()]);
  try {
    const invalid=await request(clients[5],'room:create',{name:'Invalid',token:randomUUID(),format:'trios'});
    assert.equal(invalid.ok,false);assert.match(invalid.error,/singles or doubles/);
    const created=await request(clients[0],'room:create',{name:'Seat 0',token:randomUUID(),format:'doubles'});
    assert.equal(created.format,'doubles');assert.equal(created.capacity,4);assert.equal(created.state.format,'doubles');
    const room=server.rooms.get(created.code)!;
    const clock=room.match.state.arcade!.clock;
    for(let seat=1;seat<=2;seat++)await request(clients[seat],'room:join',{name:`Seat ${seat}`,token:randomUUID(),code:created.code});
    await delay(90);
    assert.equal(room.match.state.arcade!.clock,clock,'ready timers cannot start with only three seats');
    assert.equal((await request(clients[0],'game:shot',{angle:0,power:.3})).ok,false);
    assert.equal((await request(clients[0],'game:chalk',{})).ok,false);
    const fourth=await request(clients[3],'room:join',{name:'Seat 3',token:randomUUID(),code:created.code,format:'singles'});
    assert.equal(fourth.seat,3);assert.equal(fourth.format,'doubles');assert.equal(fourth.capacity,4);
    assert.deepEqual(fourth.players.map((p:TeamPacket['players'][number])=>[p.seat,p.team,p.connected]),[[0,0,true],[1,1,true],[2,0,true],[3,1,true]]);
    await until(()=>room.match.state.arcade!.clock!>clock!,'the ready timer starts when the fourth seat connects');
    const fifth=await request(clients[4],'room:join',{name:'Fifth',token:randomUUID(),code:created.code});
    assert.equal(fifth.ok,false);assert.match(fifth.error,/four players/);
    assert.equal(room.seats.length,4);assert.equal((await request(clients[0],'game:chalk',{})).ok,true);
  } finally {clients.forEach(socket=>socket.disconnect());}
});

test('only the active doubles teammate can shoot, chalk or place the cue',async()=>{
  const {clients,room}=await doublesRoom();
  try {
    for(const seat of [1,2,3]){
      assert.equal((await request(clients[seat],'game:shot',{angle:0,power:.03})).ok,false);
      assert.equal((await request(clients[seat],'game:chalk',{})).ok,false);
    }
    assert.equal((await request(clients[0],'game:chalk',{})).ok,true);
    assert.equal((await request(clients[0],'game:shot',{angle:0,power:.03})).ok,true);
    settleRoom(room);
    assert.equal(room.match.state.phase,'ball-in-hand');assert.equal(activeSeat(room.match.state),1);
    assert.deepEqual(room.match.state.teamOrder,[1,0]);
    for(const seat of [0,2,3])assert.equal((await request(clients[seat],'game:place',{x:-2.85,z:0})).ok,false);
    assert.equal((await request(clients[1],'game:place',{x:-2.85,z:0})).ok,true);
    assert.equal((await request(clients[3],'game:chalk',{})).ok,false,'the active player’s partner must wait');
    assert.equal((await request(clients[1],'game:chalk',{})).ok,true);
    assert.equal((await request(clients[3],'game:shot',{angle:0,power:.03})).ok,false);
    assert.equal((await request(clients[1],'game:shot',{angle:0,power:.03})).ok,true);
  } finally {clients.forEach(socket=>socket.disconnect());}
});

test('a disconnected doubles seat pauses readiness and rejoins its original team and rotation',async()=>{
  const {clients,tokens,created,room}=await doublesRoom();
  let returning:Socket|undefined,outsider:Socket|undefined;
  try {
    assert.equal((await request(clients[0],'game:shot',{angle:0,power:.03})).ok,true);settleRoom(room);
    assert.equal(activeSeat(room.match.state),1);
    clients[1].disconnect();await until(()=>room.seats[1].socketId===null,'the disconnected seat is marked offline');
    const saved=structuredClone(room.match.snapshot()),clock=room.match.state.arcade!.clock;
    await delay(90);assert.equal(room.match.state.arcade!.clock,clock);
    assert.equal((await request(clients[3],'game:place',{x:-2.85,z:0})).ok,false,'a partner cannot take over a disconnected seat');
    outsider=await client();
    assert.equal((await request(outsider,'room:join',{name:'Replacement',token:randomUUID(),code:created.code})).ok,false,'the fourth seat remains reserved for its token');
    returning=await client();
    const rejoined=await request(returning,'room:join',{name:'Seat 1 returned',token:tokens[1],code:created.code});
    assert.equal(rejoined.seat,1);assert.equal(rejoined.players[1].team,1);assert.equal(activeSeat(rejoined.state),1);
    assert.equal(rejoined.format,'doubles');assert.equal(rejoined.capacity,4);
    assert.deepEqual(rejoined.state.teamOrder,saved.teamOrder);assert.deepEqual(rejoined.state.balls,saved.balls);
    assert.equal(rejoined.state.shotCount,saved.shotCount);assert.equal(rejoined.players.length,4);
    assert.equal((await request(returning,'game:place',{x:-2.85,z:0})).ok,true);
    assert.equal((await request(returning,'game:chalk',{})).ok,true);
  } finally {clients.forEach(socket=>socket.disconnect());returning?.disconnect();outsider?.disconnect();}
});

test('all four clients receive partner rotation and a rematch preserves doubles while resetting the order',async()=>{
  const {clients,created,room}=await doublesRoom();
  const packets:TeamPacket[][]=clients.map(()=>[]);
  clients.forEach((socket,i)=>socket.on('room:state',packet=>packets[i].push(packet)));
  try {
    for(const shooter of [0,1]){
      assert.equal((await request(clients[shooter],'game:shot',{angle:0,power:.03})).ok,true);settleRoom(room);
      const next=activeSeat(room.match.state);
      assert.equal((await request(clients[next],'game:place',{x:-2.85,z:0})).ok,true);
      await until(()=>packets.every(list=>list.some(packet=>packet.state.shotCount===shooter+1&&packet.state.phase==='ready')),'every seat receives the completed shot and next active teammate');
      const expected=room.match.snapshot();
      for(const list of packets){const packet=list.filter(p=>p.state.shotCount===shooter+1&&p.state.phase==='ready').at(-1)!;assert.equal(activeSeat(packet.state),next);assert.deepEqual(packet.state.teamOrder,expected.teamOrder);}
    }
    assert.equal(activeSeat(room.match.state),2);assert.deepEqual(room.match.state.teamOrder,[1,1]);
    assert.equal((await request(clients[0],'game:shot',{angle:0,power:.03})).ok,false,'the previous team shooter cannot steal the next partner’s shot');
    assert.equal((await request(clients[2],'game:chalk',{})).ok,true);
    const oldSeed=room.match.state.seed;finishRack(room.match,0);
    assert.equal((await request(clients[3],'game:rematch',{advance:true,format:'singles'})).ok,true);
    await until(()=>packets.every(list=>list.some(packet=>packet.state.seed!==oldSeed)),'the rematch reaches all four seats');
    for(const list of packets){
      const packet=list.filter(p=>p.state.seed!==oldSeed).at(-1)!;
      assert.equal(packet.code,created.code);assert.equal(packet.format,'doubles');assert.equal(packet.capacity,4);
      assert.equal(packet.state.format,'doubles');assert.deepEqual(packet.state.teamOrder,[0,0]);assert.equal(activeSeat(packet.state),0);
      assert.equal(packet.state.shotCount,0);assert.equal(packet.state.arcade!.level,2);
      assert.deepEqual(packet.players.map(p=>[p.seat,p.team,p.connected]),[[0,0,true],[1,1,true],[2,0,true],[3,1,true]]);
      assert.deepEqual(packet.events,[]);
    }
  } finally {clients.forEach(socket=>socket.disconnect());}
});

test('a missing room returns an actionable error and does not create a table',async()=>{
  const socket=await client(); const before=server.rooms.size;
  const response=await request(socket,'room:join',{name:'Lost guest',token:randomUUID(),code:'XXXXXX'});
  assert.equal(response.ok,false); assert.match(response.error,/not open/); assert.equal(server.rooms.size,before); socket.disconnect();
});

test('friends share seeded layouts, collect visible powers and receive each effect once', async () => {
  const host = await client(), guest = await client();
  type Packet = { state: GameState; events: TableEvent[] };
  const hostPackets: Packet[] = [], guestPackets: Packet[] = [];
  host.on('room:state', packet => hostPackets.push(packet));
  guest.on('room:state', packet => guestPackets.push(packet));
  const created = await request(host, 'room:create', { name: 'Arcade host', token: randomUUID(), layout: 'gauntlet' });
  assert.equal(created.ok, true);
  assert.equal(created.state.arcade.layout, 'gauntlet');
  const joined = await request(guest, 'room:join', { name: 'Arcade guest', token: randomUUID(), code: created.code, layout: 'fortress' });
  assert.equal(joined.state.arcade.layout, 'gauntlet', 'joining uses the host’s selected layout');
  assert.deepEqual(joined.state.arcade.obstacles, created.state.arcade.obstacles);
  const room = server.rooms.get(created.code)!;
  const arrangement = room.match.snapshot(), pickup = arrangement.arcade!.pickups[0];
  pickup.x = -2.1; pickup.z = 0; room.match.arrange(arrangement);
  assert.ok(pickup.power, 'the pickup snapshot identifies its visible power');
  assert.equal((await request(host, 'game:shot', { angle: 0, power: 1 })).ok, true);
  await until(() => guestPackets.some(packet => packet.events.some(event => event.kind === 'ball')), 'the guest receives real collision events from the authoritative table');
  await delay(100);
  for (const packets of [hostPackets, guestPackets]) {
    const events = packets.flatMap(packet => packet.events);
    assert.equal(events.filter(event => event.kind === 'pickup' && event.pickup === pickup.id).length, 1, 'a pickup reward is emitted once');
    assert.equal(events.filter(event => event.kind === 'cue').length, 1, 'cue audio and effects must not replay in later snapshots');
    assert.ok(events.filter(event => event.kind === 'ball').length > 0);
    for (const event of events) assert.ok([event.x, event.z, event.strength, event.time].every(Number.isFinite));
    assert.ok(packets.every(packet => packet.state.arcade?.layout === 'gauntlet'));
  }
  assert.deepEqual(hostPackets.flatMap(packet => packet.events), guestPackets.flatMap(packet => packet.events), 'both seats receive the same effects');
  // Resolve the rack without a long real-time test, then check the real rematch handler.
  finishRack(room.match, 0);
  const oldSeed = room.match.state.seed;
  const oldObstacles = structuredClone(room.match.state.arcade!.obstacles);
  assert.equal((await request(host, 'game:rematch', {})).ok, true);
  await until(() => guestPackets.some(packet => packet.state.seed !== oldSeed), 'the guest receives the rematch');
  assert.equal(room.match.state.arcade!.layout, 'gauntlet');
  assert.notDeepEqual(room.match.state.arcade!.obstacles.map(o => [o.x, o.z]), oldObstacles.map(o => [o.x, o.z]), 'a rematch generates a fresh seeded layout');
  assert.equal(room.match.state.arcade!.pickups.length, 2);
  assert.ok(room.match.state.arcade!.pickups.every(p => p.available && !!p.power));
  assert.ok(room.match.state.arcade!.buffs.every(b => Object.values(b).every(value => value === 0)));
  assert.ok(room.match.state.arcade!.obstacles.every(obstacle => obstacle.hp === obstacle.maxHp));
  assert.deepEqual(guestPackets.at(-1)!.events, [], 'a rematch cannot replay the previous shot’s impacts');
  host.disconnect(); guest.disconnect();
});

test('room levels synchronize, replay preserves the level and progression advances only after a rack', async () => {
  const host = await client(), guest = await client();
  const created = await request(host, 'room:create', { name: 'Host', token: randomUUID(), level: 2 });
  assert.equal(created.state.arcade.level, 2);
  const joined = await request(guest, 'room:join', { name: 'Guest', token: randomUUID(), code: created.code, level: 5 });
  assert.equal(joined.state.arcade.level, 2, 'guest uses host level');
  const room = server.rooms.get(created.code)!;
  assert.equal((await request(host, 'game:rematch', { advance: true })).ok, false);
  assert.equal(room.match.state.arcade!.level, 2);
  finishRack(room.match, 0);
  assert.equal((await request(guest, 'game:rematch', {})).ok, true);
  assert.equal(room.match.state.arcade!.level, 2, 'replay retains difficulty');
  finishRack(room.match, 1);
  let packet: GameState | undefined;
  guest.on('room:state', data => { packet = data.state; });
  assert.equal((await request(host, 'game:rematch', { advance: true, level: 5 })).ok, true);
  await until(() => packet?.arcade?.level === 3, 'both clients receive the next level');
  assert.equal(room.match.state.arcade!.level, 3, 'clients cannot skip levels with a rematch payload');
  assert.equal(room.match.state.arcade!.portalTurns, 0);
  assert.ok(room.match.state.arcade!.hazards.every(h => h.kind !== 'portal'));
  for (let i = 0; i < 2; i++) {
    finishRack(room.match, 0);
    assert.equal((await request(host, 'game:rematch', { advance: true })).ok, true);
  }
  finishRack(room.match, 0);
  assert.equal((await request(host, 'game:rematch', { advance: true })).ok, false, 'the final level cannot advance');
  assert.equal((await request(host, 'game:rematch', {})).ok, true, 'the final level can be replayed');
  assert.equal(room.match.state.arcade!.level, 5, 'last level remains replayable');
  host.disconnect(); guest.disconnect();
});

test('chalk is authoritative, validates the shooting seat, and survives rejected spin input', async () => {
  const host = await client(), guest = await client();
  const created = await request(host, 'room:create', {name:'Host',token:randomUUID()});
  await request(guest,'room:join',{name:'Guest',token:randomUUID(),code:created.code});
  const room = server.rooms.get(created.code)!;
  assert.equal((await request(guest,'game:chalk',{})).ok,false);
  assert.equal((await request(host,'game:chalk',{})).ok,true);
  assert.deepEqual(room.match.state.chalked,[true,false]);
  assert.equal((await request(host,'game:chalk',{})).ok,false);
  assert.equal((await request(host,'game:shot',{angle:0,power:.8,tipX:1,tipY:1,elevation:0})).ok,false);
  assert.equal(room.match.state.chalked[0],true);
  assert.equal((await request(host,'game:shot',{angle:0,power:.8,tipX:.2,tipY:.3,elevation:.2})).ok,true);
  assert.equal(room.match.state.chalked[0],false);
  assert.deepEqual(room.match.state.lastShot,{angle:0,power:.8,tipX:.2,tipY:.3,elevation:.2});
  assert.equal((await request(host,'game:chalk',{})).ok,false,'cannot chalk a rolling shot');
  host.disconnect(); guest.disconnect();
});

test('timed pickups spawn and expire for both friends while the balls are resting', async () => {
  const host=await client(),guest=await client();
  const created=await request(host,'room:create',{name:'Host',token:randomUUID()});
  await request(guest,'room:join',{name:'Guest',token:randomUUID(),code:created.code});
  const received:TableEvent[]=[];
  guest.on('room:state',packet=>received.push(...packet.events));
  const room=server.rooms.get(created.code)!;
  const old=structuredClone(room.match.state.balls);
  for(let i=0;i<1200;i++)room.match.update(1/120);
  await until(()=>received.some(e=>e.kind==='spawn'),'spawn events publish while ready');
  for(let i=0;i<1800;i++)room.match.update(1/120);
  await until(()=>received.some(e=>e.kind==='expire'),'expiry events publish while ready');
  assert.deepEqual(room.match.state.balls,old,'timers cannot move resting balls');
  assert.ok(room.match.state.arcade!.pickups.length<=3);
  host.disconnect();guest.disconnect();
});

test('both friends receive authoritative jump height, vertical velocity and unmodified shot contact fields', async () => {
  const host=await client(),guest=await client();
  type Packet={state:GameState;events:TableEvent[]};
  const hostPackets:Packet[]=[],guestPackets:Packet[]=[];
  try {
    const created=await request(host,'room:create',{name:'Jump host',token:randomUUID()});
    await request(guest,'room:join',{name:'Jump guest',token:randomUUID(),code:created.code});
    host.on('room:state',packet=>hostPackets.push(packet));
    guest.on('room:state',packet=>guestPackets.push(packet));
    const room=server.rooms.get(created.code)!;
    const shot={angle:.015,power:1,elevation:.15,tipX:.1,tipY:-.75};
    for(const invalid of [null,{...shot,elevation:Math.PI/3+.01},{...shot,elevation:null},{...shot,tipY:null},{...shot,tipX:.6,tipY:-.6},{...shot,power:1.01}]) {
      assert.equal((await request(host,'game:shot',invalid)).ok,false,'invalid jump geometry must be rejected, not stripped or defaulted');
      assert.equal(room.match.state.phase,'ready');
      assert.equal(room.match.state.lastShot,undefined);
      assert.equal(room.match.state.balls[0].elevation||0,0);
    }
    assert.equal((await request(guest,'game:shot',shot)).ok,false,'the other seat cannot launch the host cue');
    assert.equal((await request(host,'game:shot',shot)).ok,true);
    assert.deepEqual(room.match.state.lastShot,shot,'server retains every accepted contact field');
    await until(()=>[hostPackets,guestPackets].every(packets=>
      packets.some(p=>(p.state.balls[0].elevation||0)>.1&&(p.state.balls[0].vy||0)>0)&&
      packets.some(p=>p.state.balls[0].airborne&&(p.state.balls[0].vy||0)<-.3)),
      'both seats receive rising and descending authoritative flight');
    for(const packets of [hostPackets,guestPackets]) {
      const flying=packets.filter(p=>p.state.balls[0].airborne);
      assert.ok(flying.length>=3);
      assert.ok(flying.every(p=>Number.isFinite(p.state.balls[0].elevation)&&Number.isFinite(p.state.balls[0].vy)));
      for(const packet of flying)assert.deepEqual(packet.state.lastShot,shot);
      const cue=packets.flatMap(p=>p.events).find(e=>e.kind==='cue')!;
      assert.equal(cue.elevation,shot.elevation);assert.equal(cue.tipX,shot.tipX);assert.equal(cue.tipY,shot.tipY);
      assert.ok(packets.some(p=>p.events.some(e=>e.kind==='jump'&&e.ball===0)),'the launch effect reaches each seat');
    }
    const guestByClock=new Map(guestPackets.filter(packet=>packet.state.phase==='rolling').map(packet=>[packet.state.arcade!.clock,packet]));
    let matched=0;
    for(const packet of hostPackets) {
      if(packet.state.phase!=='rolling')continue;
      const same=guestByClock.get(packet.state.arcade!.clock);
      if(!same)continue;
      assert.deepEqual(packet.state,same.state,'both clients must receive the identical 3D state at each server tick');
      assert.deepEqual(packet.events,same.events);matched++;
    }
    assert.ok(matched>=3);
  } finally { host.disconnect();guest.disconnect(); }
});

test('remote match owns room transport, delayed effects, authenticated commands and reconnect recovery', async () => {
  const { RemoteMatch } = await import('../src/match/remote');
  const host = new RemoteMatch({ url, identity: { name: 'Adapter host', token: randomUUID() } });
  const guest = new RemoteMatch({ url, identity: { name: 'Adapter guest', token: randomUUID() } });
  const changes: string[] = [];
  guest.subscribe(change => changes.push(change.type));
  try {
    assert.equal((await host.create({ level: 2 })).ok, true);
    assert.equal(host.ready, false); assert.equal(host.actor.canAct, false);
    assert.equal(host.capabilities.canEquip, true);
    assert.equal((await host.execute({ type: 'equip', cue: 'maple-control' })).ok, true);
    assert.equal((await guest.join(host.room!.code)).ok, true);
    await until(() => host.ready && guest.ready, 'both remote adapters know their room is ready');
    assert.equal(guest.seat, 1); assert.equal(guest.actor.canAct, false);
    assert.equal((await guest.execute({ type: 'chalk' })).ok, false);
    assert.equal((await host.execute({ type: 'chalk' })).ok, true);
    await delay(65);
    assert.equal(host.drainEvents().filter(event => event.kind === 'chalk').length, 1);
    assert.equal(guest.drainEvents().filter(event => event.kind === 'chalk').length, 1);
    assert.deepEqual(guest.drainEvents(), []);
    assert.equal((await host.execute({ type: 'shoot', shot: { angle: 0, power: .03 } })).ok, true);
    const room = server.rooms.get(host.room!.code)!;
    settleRoom(room);
    const socketId = room.seats[1].socketId!;
    server.io.sockets.sockets.get(socketId)!.conn.close();
    await until(() => !guest.connected && !host.ready, 'transport loss suspends commands and room readiness');
    await until(() => guest.connected && guest.ready && host.ready, 'the adapter rejoins using its reserved identity');
    assert.equal(guest.seat, 1); assert.equal(guest.state.phase, 'ball-in-hand');
    assert.deepEqual(guest.state.teamOrder, room.match.state.teamOrder);
    assert.equal(guest.actor.canAct, true);
    assert.equal((await guest.execute({ type: 'place', x: -2.85, z: 0 })).ok, true);
    await until(() => host.state.phase === 'ready' && guest.state.phase === 'ready', 'authoritative placement reaches both adapters');
    assert.deepEqual(host.state.balls, guest.state.balls);
    assert.ok(changes.filter(type => type === 'connection').length >= 3);
    assert.equal((await host.execute({ type: 'reset' })).ok, false, 'online resets must finish the current rack');
  } finally { host.dispose(); guest.dispose(); }
});

test('cue choices are seat-owned, level-validated and synchronized through shots, reconnects and rematches', async () => {
  const host = await client(), guest = await client(), token = randomUUID();
  let returning: Socket | undefined;
  const packets: RoomSnapshot[] = [];
  try {
    const created = await request(host, 'room:create', { name: 'Cue host', token: randomUUID(), level: 3, cues: ['walnut-master'] });
    const room = server.rooms.get(created.code)!;
    assert.deepEqual(created.state.cues, ['ash-house', 'ash-house'], 'creation cannot inject equipment');
    assert.equal((await request(host, 'game:equip', { cue: 'rosewood-power', seat: 1, power: 999, spin: 999 })).ok, true);
    assert.deepEqual(room.match.state.cues, ['rosewood-power', 'ash-house'], 'payload seat and stat fields cannot alter another seat or the catalog');
    for (const cue of ['ebony-finesse', 'walnut-master', '__proto__', { id: 'ash-house', power: 999 }]) {
      assert.equal((await request(host, 'game:equip', { cue })).ok, false);
    }
    const joined = await request(guest, 'room:join', { name: 'Cue guest', token, code: created.code });
    assert.deepEqual(joined.state.cues, ['rosewood-power', 'ash-house']);
    guest.on('room:state', packet => packets.push(packet));
    assert.equal((await request(guest, 'game:equip', { cue: 'maple-control', seat: 0 })).ok, true);
    await until(() => packets.some(packet => packet.state.cues[1] === 'maple-control'), 'equipment reaches the other players without a shot');
    assert.deepEqual(room.match.state.cues, ['rosewood-power', 'maple-control']);
    assert.equal((await request(host, 'game:shot', { angle: 0, power: .5, powerMultiplier: 999 })).ok, true);
    assert.equal((await request(guest, 'game:equip', { cue: 'ash-house' })).ok, false, 'equipment cannot change during an in-flight shot');
    await until(() => packets.some(packet => packet.state.phase === 'rolling'), 'the equipped shot broadcasts');
    const launch = packets.find(packet => packet.state.phase === 'rolling')!;
    assert.ok(Math.abs(launch.state.balls[0].vx - (1.4 + .5 * 15) * 1.08) < 1e-9, 'the server derives power solely from its cue catalog');
    settleRoom(room);
    guest.disconnect(); await until(() => room.seats[1].socketId === null, 'equipment seat disconnects');
    returning = await client();
    const rejoined = await request(returning, 'room:join', { name: 'Cue guest', token, code: created.code });
    assert.equal(rejoined.seat, 1); assert.deepEqual(rejoined.state.cues, ['rosewood-power', 'maple-control']);
    finishRack(room.match, 0);
    assert.equal((await request(host, 'game:rematch', {})).ok, true);
    assert.deepEqual(room.match.state.cues, ['rosewood-power', 'maple-control']);
    finishRack(room.match, 0);
    assert.equal((await request(host, 'game:rematch', { advance: true })).ok, true);
    assert.equal(room.match.state.arcade!.level, 4);
    assert.equal((await request(returning, 'game:equip', { cue: 'ebony-finesse' })).ok, true, 'advancing unlocks the next cue on the authority');
  } finally { host.disconnect(); guest.disconnect(); returning?.disconnect(); }
});

test('the build-time room server setting disables, targets same-origin or names a server', () => {
  for (const setting of [undefined, '', '  ', 'not a url', 'ftp://rooms.example']) assert.equal(resolveRoomServer(setting), null, String(setting));
  assert.deepEqual(resolveRoomServer('same-origin'), {});
  assert.deepEqual(resolveRoomServer(' https://rooms.example:8443 '), { url: 'https://rooms.example:8443/' });
  assert.deepEqual(allowedOrigins(' https://a.example, ,http://b.example:5173 '), ['https://a.example', 'http://b.example:5173']);
  assert.deepEqual(allowedOrigins(undefined), []);
});

test('room transport answers cross-origin browsers only for configured origins', async () => {
  const handshake = async (address: string, origin: string) => (await fetch(`${address}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: origin } })).headers.get('access-control-allow-origin');
  assert.equal(await handshake(url, 'https://friends.example'), null, 'the default server is same-origin only');
  const http = createServer(), rooms = attachRooms(http, ['https://friends.example']);
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  try {
    const address = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
    assert.equal(await handshake(address, 'https://friends.example'), 'https://friends.example');
    assert.equal(await handshake(address, 'https://elsewhere.example'), null);
  } finally { await rooms.close(); }
});
