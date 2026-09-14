import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { arrangeBalls, edit } from './arrangements';
import { initPhysics, PoolGame } from '../src/simulation/game';
import { chooseGroup, choosePlacement, chooseShot } from '../src/simulation/ai';
import { humanControls } from '../src/match/policy';
import {
  activeSeat,
  initialState,
  seatCount,
  seededRandom,
  teamOfSeat,
  TABLE,
  type GameFormat,
  type RuleSet,
} from '../src/simulation/types';

before(async () => {
  await initPhysics();
});
type Position = { x: number; z: number };
function fixture(format: GameFormat = 'doubles', rules?: RuleSet) {
  const game = new PoolGame('scotch-doubles', { format, rules });
  edit(game, (s) => {
    s.shotCount = 1;
  });
  function position(positions: Record<number, Position>) {
    arrangeBalls(game, positions);
    edit(game, (s) => {
      s.phase = 'ready';
    });
  }
  return { game, position };
}
function settle(game: PoolGame) {
  let count = 0;
  while (game.state.phase === 'rolling' && count++ < 4000) game.step();
  assert.ok(count < 4000, 'shot must settle');
}

test('doubles map alternating seats into two teams while singles remain the default', () => {
  const single = initialState('default'),
    doubles = initialState('team', 'doubles');
  assert.equal(single.format, 'singles');
  assert.equal(seatCount(single.format), 2);
  assert.equal(seatCount(doubles.format), 4);
  assert.deepEqual(doubles.teamOrder, [0, 0]);
  assert.equal(activeSeat(doubles), 0);
  assert.deepEqual([0, 1, 2, 3].map(teamOfSeat), [0, 1, 0, 1]);
  doubles.teamOrder = [1, 1];
  assert.equal(activeSeat(doubles), 2);
  doubles.turn = 1;
  assert.equal(activeSeat(doubles), 3);
  single.teamOrder = [1, 1];
  single.turn = 1;
  assert.equal(activeSeat(single), 1, 'singles ignore partner order');
});

test('a legal pot retains the team turn but passes the next shot and queued pickup to its partner', () => {
  const { game, position } = fixture();
  try {
    position({ 0: { x: 0, z: -1 }, 1: { x: 0, z: -2.4 }, 2: { x: 3, z: 1 } });
    edit(game, (state) => {
      state.arcade!.pickups = [{ id: 10, x: 0, z: -1.45, radius: 0.16, power: 'ward', available: true }];
    });
    assert.equal(game.chalkCue(), true);
    assert.equal(activeSeat(game.state), 0);
    assert.equal(game.shoot({ angle: -Math.PI / 2, power: 0.16 }), true);
    assert.deepEqual(game.state.teamOrder, [0, 0], 'partner order changes only after the stroke completes');
    settle(game);
    assert.equal(game.state.foul, false);
    assert.equal(game.state.turn, 0);
    assert.equal(activeSeat(game.state), 2);
    assert.deepEqual(game.state.teamOrder, [1, 0]);
    assert.deepEqual(game.state.groups, ['solids', 'stripes']);
    assert.equal(game.state.arcade!.scores[0], 125);
    assert.equal(game.state.arcade!.scores[1], 0);
    assert.equal(game.state.arcade!.buffs[0].ward, 1, 'pickup belongs to the team and waits for its next shooter');
    assert.deepEqual(game.state.chalked, [false, false]);
    assert.equal(game.state.arcade!.activeShot.chalked, true);
    position({ 0: { x: 0, z: -1 }, 2: { x: 0, z: -2.4 }, 3: { x: 3, z: 1 } });
    assert.equal(game.shoot({ angle: -Math.PI / 2, power: 0.16 }), true);
    assert.equal(game.state.arcade!.activeShot.ward, true);
    assert.equal(game.state.arcade!.buffs[0].ward, 0);
    settle(game);
    assert.equal(game.state.turn, 0);
    assert.equal(activeSeat(game.state), 0);
    assert.deepEqual(game.state.teamOrder, [0, 0]);
    assert.deepEqual(game.state.groups, ['solids', 'stripes']);
    assert.equal(game.state.arcade!.scores[0], 225);
  } finally {
    game.dispose();
  }
});

test('misses and fouls alternate each team’s shooter independently, while placement and chalk do not', () => {
  // Old Rules offer (optional) placement after every foul.
  const { game, position } = fixture('doubles', 'old');
  try {
    position({ 0: { x: -1, z: 0 }, 1: { x: 1.3, z: 0 } });
    assert.equal(game.shoot({ angle: 0, power: 0.45 }), true);
    settle(game);
    assert.equal(game.state.foul, false, 'a real contact followed by a cushion is a legal miss');
    assert.equal(game.state.turn, 1);
    assert.equal(activeSeat(game.state), 1);
    assert.deepEqual(game.state.teamOrder, [1, 0]);
    for (const [expectedSeat, nextSeat, order] of [
      [1, 2, [1, 1]],
      [2, 3, [0, 1]],
      [3, 0, [0, 0]],
    ] as [number, number, [0 | 1, 0 | 1]][]) {
      assert.equal(activeSeat(game.state), expectedSeat);
      position({ 0: { x: -3, z: 0 }, 1: { x: 3, z: 1 } });
      const before = [...game.state.teamOrder];
      assert.equal(game.chalkCue(), true);
      assert.deepEqual(game.state.teamOrder, before);
      assert.equal(game.shoot({ angle: 0, power: 2 }), false);
      assert.deepEqual(game.state.teamOrder, before);
      assert.equal(game.shoot({ angle: Math.PI, power: 0.03 }), true);
      assert.equal(game.shoot({ angle: Math.PI, power: 0.03 }), false);
      assert.deepEqual(game.state.teamOrder, before);
      settle(game);
      assert.equal(game.state.foul, true);
      assert.equal(game.state.phase, 'ball-in-hand');
      assert.equal(activeSeat(game.state), nextSeat);
      assert.deepEqual(game.state.teamOrder, order);
      assert.equal(game.placeCue(100, 0), false);
      assert.equal(game.placeCue(-3, 0), true);
      assert.equal(activeSeat(game.state), nextSeat);
      assert.deepEqual(game.state.teamOrder, order);
    }
  } finally {
    game.dispose();
  }
});

test('the partner who sinks the legal eight wins the rack for the team and its shared score', () => {
  const { game, position } = fixture();
  try {
    position({ 0: { x: 0, z: -1 }, 8: { x: 0, z: -2.4 }, 9: { x: 3, z: 1 } });
    edit(game, (state) => {
      state.groups = ['solids', 'stripes'];
    });
    edit(game, (state) => {
      state.teamOrder = [1, 0];
    });
    assert.equal(activeSeat(game.state), 2);
    game.shoot({ angle: -Math.PI / 2, power: 0.16 });
    settle(game);
    assert.equal(game.state.phase, 'over');
    assert.equal(game.state.winner, 0, 'winner is a team ID, never the partner seat');
    assert.deepEqual(game.state.groups, ['solids', 'stripes']);
    assert.equal(game.state.arcade!.scores[0], 500);
    assert.equal(game.state.arcade!.scores[1], 0);
    assert.deepEqual(game.state.teamOrder, [0, 0]);
  } finally {
    game.dispose();
  }
});

test('explicit singles preserve ordinary retained-turn ownership and never alternate partner order', () => {
  const { game, position } = fixture('singles');
  try {
    position({ 0: { x: 0, z: -1 }, 1: { x: 0, z: -2.4 }, 2: { x: 3, z: 1 } });
    game.shoot({ angle: -Math.PI / 2, power: 0.16 });
    settle(game);
    assert.equal(game.state.format, 'singles');
    assert.equal(game.state.turn, 0);
    assert.equal(activeSeat(game.state), 0);
    assert.deepEqual(game.state.teamOrder, [0, 0]);
    assert.deepEqual(game.state.groups, ['solids', 'stripes']);
    position({ 0: { x: -3, z: 0 }, 1: { x: 3, z: 1 } });
    game.shoot({ angle: Math.PI, power: 0.03 });
    settle(game);
    assert.equal(game.state.turn, 1);
    assert.equal(activeSeat(game.state), 1);
    assert.deepEqual(game.state.teamOrder, [0, 0]);
  } finally {
    game.dispose();
  }
});

test('a full doubles AI sequence plays both opponents and the partner repeatedly, then returns control to human seat zero', () => {
  const game = new PoolGame('doubles-ai-teamplay', { format: 'doubles', level: 2, rules: 'old' });
  // Past the break, so the human's opening miss is an ordinary foul that hands the AI ball in hand.
  edit(game, (state) => {
    state.shotCount = 1;
  });
  const random = seededRandom('scotch-team-bots');
  const shotsBySeat = [0, 0, 0, 0],
    placementsBySeat = [0, 0, 0, 0];
  let returnedAfterPartner = false,
    total = 0;
  try {
    for (; total < 64 && game.state.phase !== 'over'; total++) {
      const shooter = activeSeat(game.state),
        team = teamOfSeat(shooter);
      assert.equal(
        humanControls(game.state, 'ai'),
        shooter === 0,
        'the same ownership helper used by the UI leaves partner 2 to AI',
      );
      if (game.state.phase === 'choose-group') assert.equal(game.chooseGroup(chooseGroup(game.state)), true);
      if (game.state.phase === 'ball-in-hand') {
        const point = choosePlacement(game.state);
        assert.equal(game.placeCue(point.x, point.z), true, `seat ${shooter} must find a playable cue placement`);
        placementsBySeat[shooter]++;
        assert.equal(activeSeat(game.state), shooter);
      }
      const previousOrder = [...game.state.teamOrder];
      if (shooter !== 0) game.chalkCue();
      // Script the human's moves with the same planner so a full rack can run
      // without a browser; all three non-human seats follow the actual AI path.
      // An opening human miss deliberately exercises the AI's ball-in-hand
      // recovery, rather than relying on a random bot to make a foul.
      const shot = total === 0 ? { angle: Math.PI, power: 0.03 } : chooseShot(game.state, 'regular', random);
      assert.ok([shot.angle, shot.power].every(Number.isFinite));
      assert.equal(game.shoot(shot), true, `seat ${shooter}'s AI plan must be accepted`);
      assert.equal(activeSeat(game.state), shooter, 'ownership stays with the striker until balls settle');
      shotsBySeat[shooter]++;
      settle(game);
      assert.equal(game.state.teamOrder[team], 1 - previousOrder[team]);
      assert.equal(game.state.teamOrder[1 - team], previousOrder[1 - team]);
      assert.ok(game.state.balls.every((b) => [b.x, b.z, b.vx, b.vz].every(Number.isFinite)));
      assert.equal(game.state.arcade!.scores.length, 2);
      assert.equal(game.state.groups.length, 2);
      if (shotsBySeat[2] >= 2 && game.state.winner === null && humanControls(game.state, 'ai'))
        returnedAfterPartner = true;
      if (returnedAfterPartner && shotsBySeat.every((count) => count >= 2) && humanControls(game.state, 'ai')) break;
    }
    assert.ok(
      shotsBySeat.every((count) => count >= 2),
      `each doubles seat needs multiple accepted strokes: ${shotsBySeat}`,
    );
    assert.ok(
      placementsBySeat.slice(1).some((count) => count > 0),
      'AI seats exercise real ball-in-hand recovery',
    );
    assert.ok(returnedAfterPartner, 'the AI partner must yield control back to the human after playing multiple times');
    assert.ok(total < 64, 'turn ownership must make progress without stalling');
  } finally {
    game.dispose();
  }
});
