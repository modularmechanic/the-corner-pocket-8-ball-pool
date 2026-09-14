import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { initPhysics } from '../src/simulation/game';
import { LocalMatch, MATCH_STEP } from '../src/match/local';
import { chooseGroup, choosePlacement, chooseShot } from '../src/simulation/ai';
import { HEAD_STRING_X } from '../src/simulation/table-geometry';
import { activeSeat, TABLE, type GameState, type RuleSet } from '../src/simulation/types';
import { attachRooms } from '../server/rooms';

const BOTH: RuleSet[] = ['old', 'new'];
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
/** Team 1 (solids) to play after the other side's foul, holding two visits on a clear table. */
function afterFoul(state: GameState, lostCue: boolean): GameState {
  delete state.simulation;
  Object.assign(state, { shotCount: 3, groups: ['stripes', 'solids'], turn: 1, phase: 'ball-in-hand', shotsLeft: 2 });
  state.balls[0].pocketed = lostCue;
  Object.assign(state.arcade!, { pickups: [], hazards: [], obstacles: [] });
  return state;
}
const inHand = (state: GameState) => afterFoul(state, true);

test('a lost cue ball must be placed behind the head string under both rule sets', () => {
  for (const rules of BOTH) {
    const match = new LocalMatch({ seed: 'kitchen-command', mode: 'local', options: { rules } });
    try {
      match.arrange(inHand(match.snapshot()));
      assert.deepEqual(match.dispatch({ type: 'place', x: 0, z: 0 }), {
        ok: false,
        error: 'Place the cue ball behind the head string.',
      });
      assert.equal(match.state.phase, 'ball-in-hand');
      assert.equal(match.dispatch({ type: 'place', x: -4, z: 1 }).ok, true);
      assert.deepEqual([match.state.phase, match.state.shotsLeft], ['ready', 2]);
    } finally {
      match.dispose();
    }
  }
});

test('optional placement: place behind the head string or play from where the cue ball lies, not elsewhere', () => {
  const match = new LocalMatch({ seed: 'optional-placement', mode: 'local', options: { rules: 'old' } });
  try {
    const state = afterFoul(match.snapshot(), false);
    Object.assign(state.balls[0], { x: 0.5, z: -1 });
    match.arrange(state);
    assert.equal(match.dispatch({ type: 'place', x: 1, z: 1 }).ok, false, 'not a third spot');
    assert.equal(match.dispatch({ type: 'place', x: 0.5, z: -1 }).ok, true, 'play from here');
    assert.deepEqual([match.state.phase, match.state.balls[0].x, match.state.balls[0].z], ['ready', 0.5, -1]);
    match.arrange(state);
    assert.equal(match.dispatch({ type: 'place', x: -4, z: 0.5 }).ok, true);
    assert.deepEqual([match.state.phase, match.state.balls[0].x], ['ready', -4]);
    assert.equal(match.dispatch({ type: 'place', x: -4, z: 0.5 }).ok, false, 'only before the shot is taken');
  } finally {
    match.dispose();
  }
});

test('optional placement: a shot from where the cue ball lies is accepted at once and uses up the option', () => {
  for (const rules of BOTH) {
    const match = new LocalMatch({ seed: `shoot-from-lie-${rules}`, mode: 'local', options: { rules } });
    try {
      const state = afterFoul(match.snapshot(), false);
      Object.assign(state.balls[0], { x: 0.5, z: -1 });
      match.arrange(state);
      assert.equal(match.dispatch({ type: 'chalk' }).ok, true, `${rules}: chalk before the shot`);
      assert.equal(match.dispatch({ type: 'shoot', shot: { angle: 0, power: 0.3 } }).ok, true, rules);
      assert.equal(match.state.phase, 'rolling');
      assert.equal(match.dispatch({ type: 'place', x: -4, z: 0 }).ok, false, `${rules}: the option is gone`);
      settled(match);
      match.arrange(afterFoul(match.snapshot(), true));
      assert.equal(
        match.dispatch({ type: 'shoot', shot: { angle: 0, power: 0.3 } }).ok,
        false,
        `${rules}: a lost cue ball must still be placed first`,
      );
      assert.equal(match.state.phase, 'ball-in-hand');
    } finally {
      match.dispose();
    }
  }
});

test('optional placement with no clear spot behind the head string leaves only the lie, for people and the AI', () => {
  const wall = { id: 0, x: -4.3, z: 0, width: 3.2, depth: 6, hp: 4, maxHp: 4, material: 'steel' as const };
  /** Team 1 (solids) boxed in by stripes and the black, so no pot keeps the AI at the lie, with the kitchen walled off. */
  const blocked = (match: LocalMatch) => {
    const state = afterFoul(match.snapshot(), false);
    for (const ball of state.balls) if (ball.id > 0) ball.pocketed = true;
    Object.assign(state.balls[0], { x: 2, z: 0 });
    [9, 10, 11, 12, 13, 14, 15, 8].forEach((id, i) => {
      const angle = (i / 8) * Math.PI * 2;
      Object.assign(state.balls[id], {
        pocketed: false,
        x: 2 + Math.cos(angle) * TABLE.radius * 2.05,
        z: Math.sin(angle) * TABLE.radius * 2.05,
      });
    });
    Object.assign(state.balls[3], { pocketed: false, x: 4.5, z: 1.5 });
    state.arcade!.obstacles = [wall];
    return state;
  };
  const human = new LocalMatch({ seed: 'full-kitchen-lie', mode: 'local', options: { rules: 'old' } });
  try {
    const state = blocked(human);
    human.arrange(state);
    assert.equal(human.dispatch({ type: 'place', x: 0, z: 1.5 }).ok, false, 'the table does not open');
    assert.equal(human.dispatch({ type: 'place', x: -4, z: 0 }).ok, false, 'the kitchen is full');
    assert.equal(human.dispatch({ type: 'place', x: 2, z: 0 }).ok, true, 'the lie stays');
    human.arrange(state);
    assert.equal(human.dispatch({ type: 'shoot', shot: { angle: 0, power: 0.3 } }).ok, true);
  } finally {
    human.dispose();
  }
  const ai = new LocalMatch({ seed: 'full-kitchen-ai', mode: 'ai', difficulty: 'expert', options: { rules: 'old' } });
  try {
    const state = blocked(ai);
    assert.deepEqual(choosePlacement(state), { x: 2, z: 0 }, 'the AI falls back to the lie');
    ai.arrange(state);
    aiPlacement(ai);
    assert.deepEqual([ai.state.balls[0].x, ai.state.balls[0].z], [2, 0]);
  } finally {
    ai.dispose();
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
    assert.equal(fallback.state.rules, 'new', 'an engine without a chosen rule set uses New Rules');
  } finally {
    match.dispose();
    fallback.dispose();
  }
});

/** Runs the AI seat until it leaves ball in hand. */
function aiPlacement(match: LocalMatch) {
  for (let i = 0; i < 40 && match.state.phase === 'ball-in-hand'; i++) match.update(0.1);
  assert.equal(match.state.phase, 'ready', 'the AI settles its placement');
}

test('AI optional placement keeps a lie with a pot on, and moves to the kitchen when snookered from it', () => {
  const ai = (seed: string) =>
    new LocalMatch({ seed, mode: 'ai', difficulty: 'expert', options: { rules: 'old' }, random: () => 0.5 });
  const potting = ai('ai-keeps-lie');
  try {
    const state = afterFoul(potting.snapshot(), false);
    for (const ball of state.balls) if (ball.id > 0) ball.pocketed = ball.id !== 2;
    Object.assign(state.balls[0], { x: 1, z: 0 });
    Object.assign(state.balls[2], { x: 3, z: 0 });
    potting.arrange(state);
    aiPlacement(potting);
    assert.deepEqual([potting.state.balls[0].x, potting.state.balls[0].z], [1, 0]);
  } finally {
    potting.dispose();
  }
  const boxed = ai('ai-leaves-lie');
  try {
    const state = afterFoul(boxed.snapshot(), false);
    for (const ball of state.balls) if (ball.id > 0) ball.pocketed = true;
    Object.assign(state.balls[0], { x: 2, z: 0 });
    [9, 10, 11, 12, 13, 14, 15, 8].forEach((id, i) => {
      const angle = (i / 8) * Math.PI * 2;
      Object.assign(state.balls[id], {
        pocketed: false,
        x: 2 + Math.cos(angle) * TABLE.radius * 2.05,
        z: Math.sin(angle) * TABLE.radius * 2.05,
      });
    });
    Object.assign(state.balls[3], { pocketed: false, x: 4.5, z: 1.5 });
    boxed.arrange(state);
    aiPlacement(boxed);
    assert.ok(boxed.state.balls[0].x <= HEAD_STRING_X + 1e-9, 'placed behind the head string');
  } finally {
    boxed.dispose();
  }
});

test('the AI places a lost cue ball in the kitchen and plays through its two visits', () => {
  for (const rules of BOTH) {
    const match = new LocalMatch({
      seed: 'old-ai-3',
      mode: 'ai',
      difficulty: 'expert',
      options: { rules },
      random: () => 0.5,
    });
    try {
      match.arrange(inHand(match.snapshot()));
      const visits: number[] = [];
      let shotCount = match.state.shotCount,
        placed = false;
      for (let i = 0; i < 4000 && match.state.turn === 1 && match.state.phase !== 'over'; i++) {
        const phase = match.state.phase;
        match.update(0.05);
        if (phase === 'ball-in-hand' && match.state.phase === 'ready') {
          placed = true;
          assert.ok(match.state.balls[0].x <= HEAD_STRING_X + 1e-9, 'placement is behind the head string');
        }
        if (match.state.shotCount !== shotCount) {
          shotCount = match.state.shotCount;
          if (match.state.turn === 1 && !match.state.foul) visits.push(match.state.shotsLeft);
        }
      }
      assert.ok(placed);
      assert.ok(visits.length > 0 && visits.every((left) => left === 1 || left === 2), `${rules}: ${visits}`);
      assert.ok(visits.includes(1), `${rules}: the second visit follows the first`);
      assert.notEqual(match.state.turn, 1, `${rules}: the table eventually changes hands`);
    } finally {
      match.dispose();
    }
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
      options: { rules: 'new' },
      random: () => 0.5,
    });
    try {
      const state = inHand(match.snapshot());
      edit(state);
      match.arrange(state);
      aiPlacement(match);
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

/** Team 1 has just potted balls of both groups on an open table. */
function choosing(state: GameState): GameState {
  delete state.simulation;
  Object.assign(state, { shotCount: 2, turn: 1, phase: 'choose-group', lastPotted: [3, 11] });
  state.balls[3].pocketed = true;
  state.balls[11].pocketed = true;
  return state;
}

test('group choice: only the seat to play may choose, once, and only solids or stripes', () => {
  const match = new LocalMatch({ seed: 'group-command', mode: 'online', options: { rules: 'old' } });
  try {
    match.setReady(true);
    match.arrange(choosing(match.snapshot()));
    assert.equal(match.actor.canAct, false, 'seat 0 watches');
    assert.deepEqual(match.dispatch({ type: 'group', group: 'solids' }, 0), {
      ok: false,
      error: 'Wait for your turn.',
    });
    assert.deepEqual(match.dispatch({ type: 'shoot', shot: { angle: 0, power: 0.5 } }, 1).ok, false);
    assert.equal(match.dispatch({ type: 'group', group: 'spots' as 'solids' }, 1).ok, false);
    assert.equal(match.dispatch({ type: 'group', group: 'stripes' }, 1).ok, true);
    assert.deepEqual([match.state.groups, match.state.phase, match.state.turn], [['solids', 'stripes'], 'ready', 1]);
    assert.deepEqual(match.dispatch({ type: 'group', group: 'solids' }, 1), {
      ok: false,
      error: 'There is no group to choose.',
    });
  } finally {
    match.dispose();
  }
  const ai = new LocalMatch({ seed: 'group-ai', mode: 'ai', options: { rules: 'new' } });
  try {
    ai.arrange(choosing(ai.snapshot()));
    assert.equal(ai.dispatch({ type: 'group', group: 'solids' }).ok, false, 'the human cannot choose for the AI');
    for (let i = 0; i < 20 && ai.state.phase === 'choose-group'; i++) ai.update(0.1);
    assert.equal(ai.state.phase, 'ready');
    assert.equal(ai.state.groups[1], chooseGroup(choosing(ai.snapshot())));
  } finally {
    ai.dispose();
  }
});

test('AI and scripted players complete many shots under both rule sets without stalling', () => {
  for (const rules of BOTH) {
    const match = new LocalMatch({ seed: `epa-flow-${rules}`, mode: 'ai', options: { rules }, random: () => 0.37 });
    try {
      let iterations = 0;
      for (; iterations < 20000 && match.state.shotCount < 16 && match.state.phase !== 'over'; iterations++) {
        const state = match.state;
        if (activeSeat(state) === 0 && state.phase !== 'rolling') {
          const command =
            state.phase === 'choose-group'
              ? ({ type: 'group', group: chooseGroup(state) } as const)
              : state.phase === 'ball-in-hand'
                ? ({ type: 'place', ...choosePlacement(state) } as const)
                : ({ type: 'shoot', shot: chooseShot(state, 'regular', () => 0.37) } as const);
          assert.equal(match.dispatch(command).ok, true, `${rules}: ${state.phase} command accepted`);
        } else match.update(0.05);
      }
      assert.ok(match.state.shotCount >= 16 || match.state.phase === 'over', `${rules}: stalled at ${iterations}`);
    } finally {
      match.dispose();
    }
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

test('a room uses the host’s rule set for every seat, rematch, kitchen check, shot from the lie and group choice', async () => {
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
  room.match.arrange(afterFoul(room.match.snapshot(), false));
  assert.equal((await request(host, 'game:shot', { angle: 0, power: 0.3 })).ok, false, 'not the host’s turn');
  assert.equal(
    (await request(guest, 'game:shot', { angle: 0, power: 0.3 })).ok,
    true,
    'the server accepts a shot from the lie',
  );
  settled(room.match);
  room.match.arrange(choosing(room.match.snapshot()));
  assert.deepEqual(await request(host, 'game:group', { group: 'solids' }), { ok: false, error: 'Wait for your turn.' });
  assert.equal((await request(guest, 'game:group', { group: 42 })).ok, false);
  assert.equal((await request(guest, 'game:group', { group: 'solids' })).ok, true);
  assert.deepEqual(room.match.state.groups, ['stripes', 'solids']);
  finish(room.match);
  assert.equal((await request(host, 'game:rematch', { rules: 'new' })).ok, true);
  assert.equal(room.match.state.rules, 'old', 'a rematch keeps the session’s rules');
});
