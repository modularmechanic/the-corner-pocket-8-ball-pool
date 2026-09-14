import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, type GameState } from '../src/simulation/types';
import { createArcade } from '../src/simulation/arcade';
import { EFFECTS, POWER_UPS, STATUS_EFFECTS, effectDefinition } from '../src/presentation/effects';
import { deriveTableEffects, deriveTablePresentation, type TableViewer } from '../src/presentation/table-presentation';

const viewer: TableViewer = {
  mode: 'ai',
  difficulty: 'regular',
  controlsTurn: true,
  canInteract: true,
  shotStage: 'aim',
};
const table = () => {
  const state = initialState('presentation');
  state.arcade = createArcade('crossfire', state.seed);
  return state;
};

test('status priority handles reconnection, rolls, results, AI, placement and setup without DOM', () => {
  const state = table();
  const cases: [Partial<GameState>, Partial<TableViewer>, string][] = [
    [{ phase: 'rolling' }, { mode: 'online', connected: false, ready: false }, 'Reconnecting…'],
    [
      { phase: 'rolling' },
      {
        mode: 'online',
        connected: true,
        ready: false,
        room: { code: 'ABC123', players: [{ name: 'Host', connected: true }] },
      },
      'Room ABC123 · 1/2 players',
    ],
    [{ phase: 'rolling' }, { aiThinking: true }, 'Rolling'],
    [{ phase: 'over', winner: 0 }, { aiThinking: true }, 'You win'],
    [
      { phase: 'ready', turn: 1 },
      { aiThinking: true, controlsTurn: false, canInteract: false },
      'The Regular · Aiming',
    ],
    [{ phase: 'ball-in-hand' }, {}, 'Ball in hand'],
    [{ phase: 'ready' }, { adjustment: 'elevation' }, 'Cue elevation'],
    [{ phase: 'ready' }, { shotStage: 'power' }, '2 · Pull back & shoot'],
    [{ phase: 'rolling' }, { resetting: true, mode: 'online', connected: false }, 'Racking up'],
  ];
  for (const [changes, context, expected] of cases)
    assert.equal(deriveTablePresentation({ ...state, ...changes }, { ...viewer, ...context }).status.text, expected);
});

test('a queued mid-shot power has a next-shot pill but cannot color the current ball or trail', () => {
  const state = table();
  state.phase = 'rolling';
  state.arcade!.activeShot.frozen = true;
  state.arcade!.buffs[0].overdrive = 1;
  const before = structuredClone(state),
    model = deriveTablePresentation(state, viewer),
    effects = deriveTableEffects(state);
  assert.deepEqual(model.effects, effects);
  assert.equal(effects.cue.overdrive, false);
  assert.equal(effects.cue.frozen, true);
  assert.equal(effects.halo?.id, 'frozen');
  assert.equal(effects.trail, 'ice');
  assert.deepEqual(
    model.teams[0].pills.find((p) => p.id === 'overdrive'),
    {
      id: 'overdrive',
      title: 'Overdrive · Next shot',
      icon: EFFECTS.overdrive.icon,
      color: EFFECTS.overdrive.color,
      className: 'overdrive',
      active: false,
      queued: true,
    },
  );
  assert.deepEqual(state, before, 'presentation must not mutate authoritative state');
  state.phase = 'ready';
  assert.equal(deriveTableEffects(state).cue.overdrive, true);
  assert.equal(
    deriveTableEffects(state).cue.frozen,
    false,
    'completed activeShot data must not leak into a later turn',
  );
});

test('doubles presentation follows the active partner and keeps opposing effects on their team', () => {
  const state = table();
  state.format = 'doubles';
  state.teamOrder = [1, 0];
  state.arcade!.buffs[1].ward = 1;
  state.arcade!.buffs[0].jammed = 1;
  const model = deriveTablePresentation(state, { ...viewer, mode: 'local' });
  assert.equal(model.status.text, 'Player 3 · 1 · Aim');
  assert.equal(model.effects.halo, null);
  assert.equal(model.effects.guideVisible, false);
  assert.equal(model.teams[1].pills[0].title, 'Scratch shield · Next shot');
  state.phase = 'over';
  state.winner = 0;
  assert.equal(deriveTablePresentation(state, viewer).status.text, 'Your team wins');
  assert.equal(deriveTableEffects(state).halo, null);
});

test('every power and status resolves to the same name, color and icon catalog', () => {
  for (const power of ['overdrive', 'frost', 'ward', 'focus', 'portal'] as const) {
    assert.equal(POWER_UPS[power], effectDefinition(power));
    assert.match(effectDefinition(power).color, /^#[0-9a-f]{6}$/);
    assert.ok(effectDefinition(power).icon);
  }
  for (const status of ['overdrive', 'frozen', 'ward', 'focus', 'jammed', 'sticky'] as const)
    assert.equal(STATUS_EFFECTS[status], effectDefinition(status).name);
  assert.equal(effectDefinition('frost'), effectDefinition('frozen'));
});
