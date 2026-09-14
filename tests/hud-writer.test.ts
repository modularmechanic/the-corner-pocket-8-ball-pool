import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HudWriter, type HudElement, type HudView } from '../src/ui/hud-writer';
import { deriveTablePresentation } from '../src/presentation/table-presentation';
import { createArcade } from '../src/simulation/arcade';
import { initialState, type GameState } from '../src/simulation/types';
import type { RoomSnapshot } from '../src/match/protocol';

function fakeDocument() {
  const log: string[] = [], elements = new Map<string, HudElement & { attributes: Record<string, string> }>();
  const element = (id: string) => {
    if (!elements.has(id)) {
      const values = { text: '', html: '', hidden: false, value: '' };
      const record = (what: string) => log.push(`${id}.${what}`);
      elements.set(id, {
        attributes: {},
        get textContent() { return values.text; }, set textContent(value) { record('text'); values.text = value ?? ''; },
        get innerHTML() { return values.html; }, set innerHTML(value) { record('html'); values.html = value; },
        get hidden() { return values.hidden; }, set hidden(value) { record('hidden'); values.hidden = value; },
        get value() { return values.value; }, set value(value) { record('value'); values.value = value ?? ''; },
        setAttribute(name, value) { record(name); this.attributes[name] = value; },
        toggleAttribute(name, force) { record(name); if (force) this.attributes[name] = ''; else delete this.attributes[name]; return force; },
        classList: { toggle: (token, force) => { record(`class-${token}`); return force; } },
        style: { setProperty: property => record(`style-${property}`) },
      });
    }
    return elements.get(id)!;
  };
  return { log, element };
}
function view(state: GameState, changes: Partial<HudView> = {}): HudView {
  const base = { mode: 'online' as const, seat: 0, room: null, ready: true, canAct: true, canAdvance: false, inspecting: false, layout: 'crossfire' as const, setup: { stage: 'aim' as const, adjustment: null, angle: 0, power: .65, elevation: 0, tipX: 0, tipY: 0 }, ...changes };
  const table = deriveTablePresentation(state, { mode: base.mode, difficulty: 'regular', room: base.room, connected: true, ready: base.ready, controlsTurn: true, canInteract: base.canAct, shotStage: base.setup.stage, adjustment: base.setup.adjustment });
  return { state, table, ...base };
}
const table = () => { const state = initialState('hud'); state.arcade = createArcade('crossfire', state.seed); return state; };

test('an unchanged presentation performs no element writes; a change writes only its own properties', () => {
  const { log, element } = fakeDocument(), hud = new HudWriter(element), state = table();
  hud.write(view(state));
  assert.ok(log.length > 40, 'the first frame writes the whole HUD');
  log.length = 0; hud.write(view(state)); hud.write(view(structuredClone(state)));
  assert.equal(log.length, 0, 'an equal table in a new object (a network packet) is not rewritten');
  const setup = { stage: 'power' as const, adjustment: null, angle: 0, power: .4, elevation: 0, tipX: 0, tipY: 0 };
  hud.write(view(state, { setup }));
  assert.deepEqual(log.sort(), ['power-fill.style-height', 'power-value.html', 'power.disabled', 'power.value', 'shoot-button.aria-label', 'status-text.text'].sort());
  log.length = 0;
  const potted = structuredClone(state); potted.groups = ['solids', 'stripes']; potted.balls[3].pocketed = true;
  hud.write(view(potted, { setup }));
  assert.deepEqual(log.filter(entry => entry.startsWith('rack-')).sort(), ['rack-0.aria-label', 'rack-0.html', 'rack-1.aria-label', 'rack-1.html']);
  assert.match(element('rack-0').innerHTML, /mini-ball {2}potted" style="--ball:[^"]+" title="3 · potted"/);
});

test('next-level visibility follows every update, not only the first result frame', () => {
  const { element } = fakeDocument(), hud = new HudWriter(element), state = table();
  state.phase = 'over'; state.winner = 0;
  hud.write(view(state, { ready: false, canAdvance: false }));
  assert.equal(element('next-level-button').hidden, true);
  hud.write(view(state, { ready: true, canAdvance: true }));
  assert.equal(element('next-level-button').hidden, false, 'reconnecting players reveal Next level while the result stays open');
  assert.equal(element('next-level-button').textContent, 'Level 2 →');
});

test('the pointer-lock hint shows only while the cue view waits for a click', () => {
  const { element } = fakeDocument(), hud = new HudWriter(element), state = table();
  hud.write(view(state, { lockHint: true })); assert.equal(element('lock-hint').hidden, false);
  hud.write(view(state)); assert.equal(element('lock-hint').hidden, true);
});

test('room names are escaped in the roster and invitation', () => {
  const { element } = fakeDocument(), hud = new HudWriter(element), state = table(); state.format = 'doubles';
  const room: RoomSnapshot = { code: 'ABC123', format: 'doubles', capacity: 4, state, events: [], players: [{ name: '<img src=x>', connected: true, seat: 0, team: 0 }, { name: 'Guest', connected: false, seat: 1, team: 1 }] };
  hud.write(view(state, { room, ready: false }));
  for (const id of ['roster-0', 'invite-roster']) { assert.doesNotMatch(element(id).innerHTML, /<img/); assert.match(element(id).innerHTML, /&#60;img src=x&#62;/); }
  assert.match(element('invite-roster').innerHTML, /2 · Guest · Reconnecting/);
  assert.equal(element('invite-status').textContent, '1/4 connected · Waiting for the teams…');
});
