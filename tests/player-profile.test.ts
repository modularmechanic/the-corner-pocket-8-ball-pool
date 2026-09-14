import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerProfile, DIFFICULTY_OPTIONS, LAYOUT_OPTIONS, QUALITY_OPTIONS, LEVEL_NAMES, type ProfileStorage } from '../src/ui/player-profile';
import { LAYOUTS, createArcade } from '../src/simulation/arcade';
import { MAX_LEVEL } from '../src/simulation/level-policy';
import { AI_NAMES } from '../src/presentation/table-presentation';
import { initialState, type GameState, type Mode } from '../src/simulation/types';

function memory(values: Record<string, string> = {}) {
  const map = new Map(Object.entries(values).map(([key, value]) => [`corner-pocket:${key}`, value]));
  const storage: ProfileStorage = { getItem: key => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value); } };
  return { map, storage };
}
const unlocked = (profile: PlayerProfile) => profile.levelOptions().filter(option => !option.disabled).length;
function playing(seed = 'profile'): GameState { const state = initialState(seed); state.arcade = createArcade('fortress', seed); return state; }
function finished(level: number, winner: 0 | 1, seed = 'profile'): GameState {
  const state = initialState(seed); state.arcade = createArcade('fortress', seed, level);
  state.arcade.scores = [300, 150]; state.phase = 'over'; state.winner = winner;
  return state;
}
const names = (team: number) => `Team ${team + 1}`;

test('corrupt or unavailable storage falls back to typed defaults', () => {
  const { storage } = memory({ difficulty: 'nightmare', layout: 'moon', volume: 'loud', level: '99', 'unlocked-level': '2', quality: '8k', cue: 'broom', records: '{nope', sound: 'maybe', rules: 'house' });
  const profile = new PlayerProfile(storage);
  assert.deepEqual(profile.preferences, { sound: true, volume: .65, difficulty: 'regular', layout: 'crossfire', level: 2, format: 'singles', rules: 'old', quality: 'auto', camera: 'angled', cue: 'ash-house', name: 'Player' });
  assert.deepEqual(profile.records, []);
  const throwing: ProfileStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  for (const blocked of [new PlayerProfile(throwing), new PlayerProfile(null)]) {
    assert.equal(unlocked(blocked), 1); blocked.set('difficulty', 'expert');
    assert.equal(blocked.preferences.difficulty, 'expert', 'play continues without storage');
  }
  const mixed = memory({ records: JSON.stringify([{ id: 'a', name: 'A', score: 10, layout: 'fortress', win: true, date: '2026' }, { id: 'b', name: 'B', score: -1, layout: 'fortress', win: false, date: '2026' }, null]) });
  assert.deepEqual(new PlayerProfile(mixed.storage).records.map(record => record.id), ['a']);
});

test('preferences persist and levels above the unlocked level cannot be chosen', () => {
  const { map, storage } = memory({ 'unlocked-level': '3' });
  const profile = new PlayerProfile(storage);
  profile.set('level', 5); profile.set('volume', 4); profile.set('camera', 'overhead');
  assert.equal(profile.preferences.level, 3); assert.equal(profile.preferences.volume, 1);
  assert.equal(map.get('corner-pocket:level'), '3'); assert.equal(map.get('corner-pocket:camera'), 'overhead');
  assert.deepEqual(new PlayerProfile(storage).preferences, profile.preferences);
  assert.deepEqual(profile.levelOptions().map(option => option.disabled), [false, false, false, true, true]);
  assert.equal(profile.levelOptions()[3].label, `4 · ${LEVEL_NAMES[3]} · Locked`);
});

test('winning against the house or any pass-and-play rack unlocks the next level up to the cap', () => {
  const cases: [Mode, number, 0 | 1, number][] = [['ai', 1, 1, 1], ['ai', 1, 0, 2], ['local', 2, 1, 3], ['online', 3, 1, 4], ['ai', MAX_LEVEL, 0, MAX_LEVEL]];
  for (const [mode, level, winner, expected] of cases) {
    const { storage } = memory({ 'unlocked-level': String(level) });
    const profile = new PlayerProfile(storage);
    assert.equal(profile.recordResult(playing(), finished(level, winner), mode, 1, names), true);
    assert.equal(unlocked(profile), expected, `${mode} level ${level} winner ${winner}`);
    assert.equal(unlocked(new PlayerProfile(storage)), expected);
  }
  const { storage } = memory();
  const profile = new PlayerProfile(storage), ready = finished(1, 0); ready.phase = 'ready';
  assert.equal(profile.recordResult(playing(), ready, 'ai', 0, names), false);
  assert.equal(unlocked(profile), 1); assert.deepEqual(profile.records, []);
});

test('joining a rack that has already ended neither unlocks a level nor records a result', () => {
  const { storage } = memory();
  const profile = new PlayerProfile(storage), result = finished(1, 1, 'joined-late');
  for (const previous of [null, playing('local-table'), finished(1, 1, 'joined-late')]) assert.equal(profile.recordResult(previous, result, 'online', 1, names), false);
  assert.equal(unlocked(profile), 1); assert.deepEqual(profile.records, []);
  assert.equal(profile.recordResult(playing('joined-late'), result, 'online', 1, names), true, 'a seat that watched the rack end records it');
});

test('a finished rack records each local team once and keeps the eight best results', () => {
  const { storage } = memory();
  const profile = new PlayerProfile(storage);
  const rack = finished(1, 1);
  profile.recordResult(playing(), rack, 'local', 0, names); profile.recordResult(playing(), rack, 'local', 0, names);
  assert.deepEqual(profile.records.map(record => [record.name, record.score, record.win, record.layout]), [['Team 1', 300, false, 'fortress'], ['Team 2', 150, true, 'fortress']]);
  profile.recordResult(playing('online-rack'), finished(1, 1, 'online-rack'), 'online', 3, names);
  assert.equal(profile.records.find(record => record.id === 'online-rack:online:1')?.name, 'Team 2', 'online seat 4 records team two');
  for (let rackIndex = 0; rackIndex < 10; rackIndex++) profile.recordResult(playing(`rack-${rackIndex}`), finished(1, 0, `rack-${rackIndex}`), 'ai', 0, names);
  assert.equal(profile.records.length, 8);
});

test('menu option lists come from the difficulty, layout, quality and level sources', () => {
  assert.deepEqual(DIFFICULTY_OPTIONS.map(option => [option.value, option.opponent]), Object.entries(AI_NAMES));
  assert.deepEqual(DIFFICULTY_OPTIONS.map(option => option.label), ['Casual', 'Regular', 'Expert']);
  assert.deepEqual(LAYOUT_OPTIONS, Object.entries(LAYOUTS).map(([value, layout]) => ({ value, label: layout.name })));
  assert.deepEqual(QUALITY_OPTIONS.map(option => option.value).sort(), ['auto', 'high', 'performance', 'ultra']);
  assert.equal(LEVEL_NAMES.length, MAX_LEVEL);
});
