import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createArcade } from '../src/simulation/arcade';
import { settleShot } from '../src/simulation/settlement';
import {
  activeSeat,
  initialState,
  legalTargets,
  type GameState,
  type RuleSet,
  type ShotResult,
} from '../src/simulation/types';

const result = (changes: Partial<ShotResult> = {}): ShotResult => ({
  firstContact: 1,
  potted: [],
  railAfterContact: true,
  breakRails: [1, 2, 3, 4],
  ...changes,
});
function arranged(rules: RuleSet = 'old', seed = 'old-rules'): GameState {
  const state = initialState(seed, 'singles', rules);
  state.arcade = createArcade('crossfire', seed);
  state.shotCount = 1;
  state.groups = ['solids', 'stripes'];
  return state;
}
const settle = (state: GameState, shot: Partial<ShotResult> = {}, shooter = state.turn) =>
  settleShot(state, result(shot), { legalBefore: legalTargets(state, shooter).map((b) => b.id), shooter });
const view = (state: GameState) => ({
  turn: state.turn,
  phase: state.phase,
  shotsLeft: state.shotsLeft,
  foul: state.foul,
});
const scratch = { potted: [0] },
  wrongBall = { firstContact: 9 },
  miss = {},
  pot = { potted: [1] };

test('Old Rules: a foul gives two shots; only a scratched or off-table cue ball is placed behind the head string', () => {
  for (const shot of [scratch, { offTable: [0] }]) {
    assert.deepEqual(view(settle(arranged(), shot).state), {
      turn: 1,
      phase: 'ball-in-hand',
      shotsLeft: 2,
      foul: true,
    });
  }
  for (const shot of [wrongBall, { firstContact: null }, { railAfterContact: false }, { offTable: [2], potted: [1] }]) {
    const state = arranged(),
      settled = settle(state, shot);
    assert.deepEqual(view(settled.state), { turn: 1, phase: 'ready', shotsLeft: 2, foul: true }, JSON.stringify(shot));
    assert.deepEqual(settled.state.balls[0], state.balls[0], 'the cue ball stays where it stopped');
    assert.equal(
      settled.respots.some((spot) => spot.id === 0),
      false,
    );
  }
});

test('Old Rules: a legal pot on the first shot cancels the second; a later miss ends the turn', () => {
  let state = settle(arranged(), wrongBall).state;
  state = settle(state, { firstContact: 9, potted: [9] }).state;
  assert.deepEqual(
    view(state),
    { turn: 1, phase: 'ready', shotsLeft: 0, foul: false },
    'normal continuation, not two more shots',
  );
  state = settle(state, { firstContact: 10, potted: [10] }).state;
  assert.equal(state.turn, 1);
  state = settle(state, { firstContact: 11 }).state;
  assert.deepEqual(view(state), { turn: 0, phase: 'ready', shotsLeft: 0, foul: false });
});

test('Old Rules: a legal miss on the first shot keeps the table for the second; then ordinary rules apply', () => {
  const first = settle(settle(arranged(), wrongBall).state, { firstContact: 9 }).state;
  assert.deepEqual(view(first), { turn: 1, phase: 'ready', shotsLeft: 1, foul: false });
  assert.deepEqual(
    view(settle(first, { firstContact: 9 }).state),
    { turn: 0, phase: 'ready', shotsLeft: 0, foul: false },
    'a second miss passes the turn',
  );
  const potted = settle(first, { firstContact: 9, potted: [9] }).state;
  assert.deepEqual(
    view(potted),
    { turn: 1, phase: 'ready', shotsLeft: 0, foul: false },
    'a pot on the second shot continues normally',
  );
  assert.equal(settle(potted, { firstContact: 10 }).state.turn, 0);
  assert.deepEqual(
    view(settle(potted, { firstContact: 1 }).state),
    { turn: 0, phase: 'ready', shotsLeft: 2, foul: true },
    'a foul after the allowance is spent gives two shots again',
  );
});

test('Old Rules: a foul on either of the two shots (first or second) forfeits the rest and gives the opponent one visit', () => {
  const two = settle(arranged(), wrongBall).state,
    second = settle(two, { firstContact: 9 }).state;
  for (const [label, state] of [
    ['first shot', two],
    ['second shot', second],
  ] as const) {
    assert.deepEqual(
      view(settle(state, { firstContact: 1 }).state),
      { turn: 0, phase: 'ready', shotsLeft: 0, foul: true },
      label,
    );
    const scratched = settle(state, { firstContact: 9, potted: [0] }).state;
    assert.deepEqual(
      view(scratched),
      { turn: 0, phase: 'ball-in-hand', shotsLeft: 0, foul: true },
      `${label}: placement still follows the scratch`,
    );
    // The single visit is ordinary: its miss passes the turn back.
    assert.deepEqual(view(settle(settle(state, { firstContact: 1 }).state, { firstContact: 2 }).state), {
      turn: 1,
      phase: 'ready',
      shotsLeft: 0,
      foul: false,
    });
  }
});

test('Old Rules: obstacle-only contact is legal, and a foul after obstacle contact still gives two shots', () => {
  const blocked = { firstContact: null, obstacleContact: true, railAfterContact: false };
  assert.deepEqual(view(settle(arranged(), blocked).state), { turn: 1, phase: 'ready', shotsLeft: 0, foul: false });
  assert.deepEqual(
    view(settle(settle(arranged(), wrongBall).state, blocked).state),
    { turn: 1, phase: 'ready', shotsLeft: 1, foul: false },
    'it spends only the first of two shots',
  );
  const state = arranged(),
    wrong = settle(state, { ...blocked, firstContact: 9 });
  assert.deepEqual(view(wrong.state), { turn: 1, phase: 'ready', shotsLeft: 2, foul: true });
  assert.deepEqual(wrong.state.balls[0], state.balls[0]);
  assert.deepEqual(view(settle(state, { ...blocked, potted: [0] }).state), {
    turn: 1,
    phase: 'ball-in-hand',
    shotsLeft: 2,
    foul: true,
  });
});

test('Old Rules: sending the eight off the table while holding two shots loses the rack; on the break it is respotted', () => {
  const two = settle(arranged(), wrongBall).state;
  for (const legal of [[9, 10], [8]]) {
    const lost = settleShot(two, result({ firstContact: legal[0], offTable: [8] }), { legalBefore: legal, shooter: 1 });
    assert.equal(lost.state.phase, 'over');
    assert.equal(lost.state.winner, 0);
    assert.equal(lost.state.shotsLeft, 0);
    assert.equal(lost.state.message, 'The eight left the table. Rack lost.');
  }
  const breaking = initialState('old-break-off', 'singles', 'old'),
    respotted = settle(breaking, { offTable: [8] });
  assert.equal(respotted.outcome.respotEight, true);
  assert.equal(respotted.state.balls[8].pocketed, false);
  assert.deepEqual(view(respotted.state), { turn: 1, phase: 'ready', shotsLeft: 2, foul: true });
});

test('an eight potted alone on the break passes the turn and says so, under both rule sets', () => {
  for (const rules of ['old', 'new'] as RuleSet[]) {
    const settled = settle(initialState('eight-only-break', 'singles', rules), { potted: [8] }).state;
    assert.equal(settled.turn, 1);
    assert.equal(settled.message, 'Eight on the break — respotted. Over to the other side.');
    assert.equal(
      settle(initialState('eight-and-two', 'singles', rules), { potted: [8, 2] }).state.message,
      'Eight on the break — respotted. Keep playing.',
    );
  }
});

test('Old Rules doubles: the two-shot allowance belongs to the team while partners alternate every shot', () => {
  const state = arranged();
  state.format = 'doubles';
  const fouled = settle(state, wrongBall).state;
  assert.equal(activeSeat(fouled), 1);
  assert.equal(fouled.shotsLeft, 2);
  const second = settle(fouled, { firstContact: 9 }).state;
  assert.equal(second.turn, 1);
  assert.equal(activeSeat(second), 3, 'the partner takes the team’s second shot');
  assert.equal(second.shotsLeft, 1);
  const over = settle(second, { firstContact: 9 }).state;
  assert.equal(over.turn, 0);
  assert.equal(activeSeat(over), 2);
  assert.equal(over.shotsLeft, 0);
  assert.deepEqual(over.teamOrder, [1, 0]);
});

test('Old Rules keep break, eight-ball and Scratch shield outcomes; New Rules never hold an allowance', () => {
  const breaking = initialState('old-break', 'singles', 'old');
  assert.deepEqual(view(settle(breaking, { potted: [2] }).state), {
    turn: 0,
    phase: 'ready',
    shotsLeft: 0,
    foul: false,
  });
  const eight = settle(breaking, { potted: [8] });
  assert.equal(eight.outcome.respotEight, true);
  assert.equal(eight.state.winner, null);
  assert.equal(eight.state.balls[8].pocketed, false);
  assert.deepEqual(
    view(settle(breaking, { breakRails: [1] }).state),
    { turn: 1, phase: 'ready', shotsLeft: 2, foul: true },
    'an illegal break is a foul like any other',
  );
  for (const [potted, legal, winner] of [
    [[8], [8], 1],
    [[8], [9, 10], 0],
    [[8, 0], [8], 0],
  ] as [number[], number[], 0 | 1][]) {
    const state = settle(arranged(), wrongBall).state;
    const ended = settleShot(state, result({ firstContact: legal[0], potted }), { legalBefore: legal, shooter: 1 });
    assert.equal(ended.state.phase, 'over');
    assert.equal(ended.state.winner, winner);
    assert.equal(ended.state.shotsLeft, 0);
  }
  const shielded = arranged();
  shielded.arcade!.activeShot.ward = true;
  const rescued = settle(shielded, scratch);
  assert.equal(rescued.outcome.wardRescued, true);
  assert.deepEqual(
    view(rescued.state),
    { turn: 1, phase: 'ready', shotsLeft: 0, foul: false },
    'a rescued scratch is not a foul',
  );
  for (const shot of [scratch, wrongBall, miss, pot]) {
    const modern = settle(arranged('new'), shot).state;
    assert.equal(modern.shotsLeft, 0);
    if (modern.foul) assert.equal(modern.phase, 'ball-in-hand');
  }
});
