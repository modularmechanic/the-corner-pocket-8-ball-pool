import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createArcade } from '../src/simulation/arcade';
import { initialState, type GameState, type RuleSet } from '../src/simulation/types';
import { LocalMatch } from '../src/match/local';
import { initPhysics } from '../src/simulation/game';
import { deriveTablePresentation, type TableViewer } from '../src/presentation/table-presentation';
import { HudWriter, type HudElement } from '../src/ui/hud-writer';
import { PlayerProfile, rackOptions, RULE_OPTIONS, type ProfileStorage } from '../src/ui/player-profile';

before(initPhysics);
const viewer: TableViewer = { mode: 'local', difficulty: 'regular', controlsTurn: true, canInteract: false };
const table = (rules: RuleSet, changes: Partial<GameState> = {}) => {
  const state = initialState('rules-view', 'singles', rules);
  state.arcade = createArcade('crossfire', state.seed);
  state.shotCount = 2;
  return Object.assign(state, changes);
};
const status = (state: GameState, changes: Partial<TableViewer> = {}) =>
  deriveTablePresentation(state, { ...viewer, ...changes }).status;

test('the HUD names the active rule set, the two-shot allowance and the kitchen placement hint', () => {
  assert.equal(deriveTablePresentation(table('old'), viewer).rules, 'Old Rules');
  assert.equal(deriveTablePresentation(table('new'), viewer).rules, 'New Rules');
  assert.deepEqual(status(table('old', { phase: 'ball-in-hand', shotsLeft: 2 })), {
    text: 'Place the cue ball behind the head string · 2 shots',
    waiting: false,
    foul: true,
  });
  assert.equal(status(table('new', { phase: 'ball-in-hand' })).text, 'Ball in hand');
  assert.deepEqual(status(table('old', { shotsLeft: 2 })), { text: 'Your shot · 2 shots', waiting: false, foul: true });
  assert.equal(
    status(table('old', { shotsLeft: 1 }), { canInteract: true, shotStage: 'aim' }).text,
    '1 · Aim · 1 shot left',
  );
  assert.equal(
    status(table('old', { shotsLeft: 2, turn: 1 }), { mode: 'ai', controlsTurn: false }).text,
    'The Regular’s shot · 2 shots',
  );
  assert.equal(
    status(table('old', { shotsLeft: 2, phase: 'rolling' })).text,
    'Rolling',
    'a rolling shot shows no allowance',
  );

  const writes = new Map<string, string>();
  const element = (id: string) =>
    ({
      set textContent(value: string) {
        writes.set(id, value);
      },
      set innerHTML(value: string) {
        writes.set(id, value);
      },
      hidden: false,
      setAttribute() {},
      toggleAttribute: () => true,
      classList: { toggle: () => true },
      style: { setProperty() {} },
    }) as unknown as HudElement;
  const state = table('old', { shotsLeft: 1 });
  new HudWriter(element).write({
    state,
    table: deriveTablePresentation(state, viewer),
    mode: 'local',
    seat: 0,
    room: null,
    ready: true,
    canAct: true,
    canAdvance: false,
    inspecting: false,
    layout: 'crossfire',
    setup: { stage: 'aim', adjustment: null, angle: 0, power: 0.65, elevation: 0, tipX: 0, tipY: 0 },
  });
  assert.equal(writes.get('rules-badge'), 'Old Rules');
  assert.equal(writes.get('status-text'), 'Your shot · 1 shot left');
  const room = {
    code: 'ABC123',
    format: 'singles' as const,
    capacity: 2 as const,
    state,
    events: [],
    players: [{ name: 'Host', connected: true, seat: 0, team: 0 as const }],
  };
  new HudWriter(element).write({
    state,
    table: deriveTablePresentation(state, viewer),
    mode: 'online',
    seat: 1,
    room,
    ready: false,
    canAct: false,
    canAdvance: false,
    inspecting: false,
    layout: 'crossfire',
    setup: { stage: 'aim', adjustment: null, angle: 0, power: 0.65, elevation: 0, tipX: 0, tipY: 0 },
  });
  assert.equal(
    writes.get('invite-rules'),
    'Rule set · Old Rules (chosen by the host)',
    'joiners see the host’s rule set read-only',
  );
});

test('the profile defaults to Old Rules and remembers the last chosen rule set', () => {
  const map = new Map<string, string>();
  const storage: ProfileStorage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
  assert.equal(new PlayerProfile(storage).preferences.rules, 'old');
  new PlayerProfile(storage).set('rules', 'new');
  assert.equal(map.get('corner-pocket:rules'), 'new');
  assert.equal(new PlayerProfile(storage).preferences.rules, 'new');
  assert.deepEqual(
    RULE_OPTIONS.map((option) => option.value),
    ['old', 'new'],
    'the setup screen lists Old Rules first',
  );
});

test('UI new games pass the chosen rules only when a session starts; racks inside a session keep its rules', () => {
  const map = new Map<string, string>();
  const profile = new PlayerProfile({
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  });
  profile.set('rules', 'new');
  const started = rackOptions(profile.preferences, 'doubles', null);
  assert.deepEqual(
    started,
    { layout: 'crossfire', level: 1, format: 'doubles', rules: 'new' },
    'Start Session applies the chosen rules',
  );
  const session = new LocalMatch({
    seed: 'ui-session',
    mode: 'ai',
    options: rackOptions(profile.preferences, 'singles', null),
  });
  try {
    assert.equal(session.state.rules, 'new');
    // The menu selector changes the saved choice mid-session; a layout change or mode tab builds a new rack.
    profile.set('rules', 'old');
    profile.set('layout', 'fortress');
    const rack = rackOptions(profile.preferences, 'singles', session.state);
    assert.equal(rack.rules, 'new', 'the running session keeps its rules');
    assert.equal(rack.layout, 'fortress');
    assert.equal(
      rackOptions(profile.preferences, 'singles', null).rules,
      'old',
      'the next Start Session applies the new choice',
    );
  } finally {
    session.dispose();
  }
});
