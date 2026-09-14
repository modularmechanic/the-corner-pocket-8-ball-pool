import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { initPhysics } from '../src/simulation/game';
import { LocalMatch, MATCH_STEP } from '../src/match/local';
import { HEAD_STRING_X } from '../src/simulation/table-geometry';
import type { GameState, RuleSet } from '../src/simulation/types';
import { attachRooms } from '../server/rooms';

let server: ReturnType<typeof attachRooms>,
  url = '';
before(async () => {
  await initPhysics();
  const http = createServer();
  server = attachRooms(http);
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
after(() => server.close());
const settled = (match: LocalMatch) => {
  for (let i = 0; i < 4000 && match.state.phase === 'rolling'; i++) match.update(MATCH_STEP, { aiPaused: true });
  assert.notEqual(match.state.phase, 'rolling');
};
const finish = (match: LocalMatch) => {
  const state = match.snapshot();
  state.phase = 'over';
  state.winner = 0;
  match.arrange(state);
};
/** The scratched cue ball is in hand for team 1, holding two Old Rules shots on a clear table. */
function inHand(state: GameState): GameState {
  delete state.simulation;
  Object.assign(state, { shotCount: 3, groups: ['stripes', 'solids'], turn: 1, phase: 'ball-in-hand', shotsLeft: 2 });
  state.balls[0].pocketed = true;
  Object.assign(state.arcade!, { pickups: [], hazards: [], obstacles: [] });
  return state;
}

test('human placement outside the kitchen is rejected with a clear reason only under Old Rules', () => {
  for (const rules of ['old', 'new'] as RuleSet[]) {
    const match = new LocalMatch({ seed: 'kitchen-command', mode: 'local', options: { rules } });
    try {
      match.arrange(inHand(match.snapshot()));
      const outside = match.dispatch({ type: 'place', x: 0, z: 0 });
      if (rules === 'new') {
        assert.equal(outside.ok, true);
        continue;
      }
      assert.deepEqual(outside, { ok: false, error: 'Place the cue ball behind the head string.' });
      assert.equal(match.state.phase, 'ball-in-hand');
      assert.equal(match.dispatch({ type: 'place', x: -4, z: 1 }).ok, true);
      assert.equal(match.state.phase, 'ready');
      assert.equal(match.state.shotsLeft, 2);
    } finally {
      match.dispose();
    }
  }
});

test('the rule set is locked for the session through resets, rematches and new levels', () => {
  const match = new LocalMatch({ seed: 'rules-lock', mode: 'ai', options: { rules: 'old' } }),
    fallback = new LocalMatch({ seed: 'rules-default' });
  try {
    assert.equal(match.state.rules, 'old');
    assert.equal(match.dispatch({ type: 'reset', options: { rules: 'new', level: 2 } }).ok, true);
    assert.equal(match.state.rules, 'old');
    assert.equal(match.state.arcade!.level, 2);
    for (const type of ['rematch', 'advance'] as const) {
      finish(match);
      assert.equal(match.dispatch({ type }).ok, true);
      assert.equal(match.state.rules, 'old');
    }
    assert.equal(fallback.state.rules, 'new', 'an engine without a chosen rule set keeps current behaviour');
  } finally {
    match.dispose();
    fallback.dispose();
  }
});

test('after a non-scratch Old Rules foul the AI shoots from where the cue ball stopped', () => {
  const match = new LocalMatch({
    seed: 'old-ai-lie',
    mode: 'ai',
    difficulty: 'expert',
    options: { rules: 'old' },
    random: () => 0.5,
  });
  try {
    assert.equal(match.dispatch({ type: 'shoot', shot: { angle: Math.PI, power: 0.03 } }).ok, true);
    settled(match);
    const lie = { ...match.state.balls[0] };
    assert.deepEqual(
      [match.state.turn, match.state.phase, match.state.shotsLeft, lie.pocketed],
      [1, 'ready', 2, false],
    );
    for (let i = 0; i < 40 && match.state.phase === 'ready'; i++) match.update(0.1);
    assert.equal(match.state.phase, 'rolling', 'the AI plays without asking for placement');
    assert.deepEqual([match.state.balls[0].x, match.state.balls[0].z], [lie.x, lie.z]);
  } finally {
    match.dispose();
  }
});

test('the AI places a scratched cue ball in the kitchen and plays both of its Old Rules shots', () => {
  const match = new LocalMatch({
    seed: 'old-ai-3',
    mode: 'ai',
    difficulty: 'expert',
    options: { rules: 'old' },
    random: () => 0.5,
  });
  try {
    match.arrange(inHand(match.snapshot()));
    const shots: [number, number][] = [];
    let shotCount = match.state.shotCount,
      placed = false;
    for (let i = 0; i < 3000 && match.state.turn === 1; i++) {
      const phase = match.state.phase;
      match.update(0.05);
      if (phase === 'ball-in-hand' && match.state.phase === 'ready') {
        placed = true;
        assert.ok(match.state.balls[0].x <= HEAD_STRING_X + 1e-9, 'placement is behind the head string');
      }
      if (match.state.shotCount !== shotCount) {
        shotCount = match.state.shotCount;
        assert.equal(match.state.foul, false);
        shots.push([match.state.turn, match.state.shotsLeft]);
      }
    }
    assert.ok(placed);
    assert.deepEqual(
      shots,
      [
        [1, 1],
        [0, 0],
      ],
      'a first-shot miss keeps the table; the second miss passes it',
    );
  } finally {
    match.dispose();
  }
});

test('a hazard-covered kitchen still gets a kitchen placement; a fully blocked kitchen opens the table instead of stalling', () => {
  const electric = [-5, -4, -3]
    .flatMap((x) => [-2, 0, 2].map((z) => ({ x, z })))
    .map((point, id) => ({ id, kind: 'electric' as const, radius: 0.9, angle: 0, ...point }));
  const wall = { id: 0, x: -4.3, z: 0, width: 3.2, depth: 6, hp: 4, maxHp: 4, material: 'steel' as const };
  for (const [label, edit, inKitchen] of [
    [
      'hazards',
      (state: GameState) => {
        state.arcade!.hazards = electric;
      },
      true,
    ],
    [
      'blocks',
      (state: GameState) => {
        state.arcade!.obstacles = [wall];
      },
      false,
    ],
  ] as const) {
    const match = new LocalMatch({
      seed: `blocked-kitchen-${label}`,
      mode: 'ai',
      difficulty: 'expert',
      options: { rules: 'old' },
      random: () => 0.5,
    });
    try {
      const state = inHand(match.snapshot());
      edit(state);
      match.arrange(state);
      for (let i = 0; i < 40 && match.state.phase === 'ball-in-hand'; i++) match.update(0.1);
      assert.equal(match.state.phase === 'ball-in-hand', false, `${label}: the AI places the cue ball`);
      assert.equal(match.state.balls[0].x <= HEAD_STRING_X + 1e-9, inKitchen, label);
    } finally {
      match.dispose();
    }
  }
  const human = new LocalMatch({ seed: 'blocked-kitchen-human', mode: 'local', options: { rules: 'old' } });
  try {
    const state = inHand(human.snapshot());
    state.arcade!.obstacles = [wall];
    human.arrange(state);
    assert.equal(human.dispatch({ type: 'place', x: 1, z: 0 }).ok, true, 'a human is not stuck either');
  } finally {
    human.dispose();
  }
});

const sockets: Socket[] = [];
after(() => {
  for (const socket of sockets) socket.disconnect();
});
async function client() {
  const socket = io(url, { forceNew: true, transports: ['websocket'] });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}
const request = (socket: Socket, event: string, data: unknown) => socket.timeout(3000).emitWithAck(event, data);

test('a room uses the host’s rule set for every seat, rematch and out-of-kitchen placement check', async () => {
  const host = await client(),
    guest = await client(),
    invalid = await client();
  assert.match(
    (await request(invalid, 'room:create', { name: 'Host', token: randomUUID(), rules: 'house' })).error,
    /Old Rules or New Rules/,
  );
  const created = await request(host, 'room:create', { name: 'Host', token: randomUUID(), rules: 'old' });
  assert.equal(created.state.rules, 'old');
  const joined = await request(guest, 'room:join', {
    name: 'Guest',
    token: randomUUID(),
    code: created.code,
    rules: 'new',
  });
  assert.equal(joined.state.rules, 'old', 'joiners play and see the host’s rules');
  const room = server.rooms.get(created.code)!;
  room.match.arrange(inHand(room.match.snapshot()));
  assert.deepEqual(await request(guest, 'game:place', { x: 1, z: 0 }), {
    ok: false,
    error: 'Place the cue ball behind the head string.',
  });
  assert.equal((await request(guest, 'game:place', { x: -4, z: 0 })).ok, true);
  finish(room.match);
  assert.equal((await request(host, 'game:rematch', { rules: 'new' })).ok, true);
  assert.equal(room.match.state.rules, 'old', 'a rematch keeps the session’s rules');
});
