import { activeSeat, seatCount, type ArenaLayout, type GameState, type Mode } from '../simulation/types';
import type { RoomSnapshot } from '../match/protocol';
import type { deriveTablePresentation } from '../presentation/table-presentation';
import { BALL_COLORS } from '../render/materials';
import type { ShotSetupState } from './shot-input-controller';
import { levelName } from './player-profile';
import { icon } from './shell';

/** The element surface the HUD writes to; a DOM element satisfies it and a plain object fakes it in Node. */
export interface HudElement {
  textContent: string | null; innerHTML: string; hidden: boolean; value?: string;
  setAttribute(name: string, value: string): void;
  toggleAttribute(name: string, force: boolean): boolean;
  classList: { toggle(token: string, force: boolean): boolean };
  style: { setProperty(property: string, value: string): void };
}
export interface HudView {
  state: GameState;
  table: ReturnType<typeof deriveTablePresentation>;
  mode: Mode; seat: number; room: RoomSnapshot | null; ready: boolean;
  canAct: boolean; canAdvance: boolean; inspecting: boolean;
  setup: Readonly<ShotSetupState>;
  /** Shown in Settings before a rack has a layout. */
  layout: ArenaLayout;
  /** The cue view waits for a click to lock the pointer. */
  lockHint?: boolean;
}

const GROUPS = { solids: [1, 2, 3, 4, 5, 6, 7], stripes: [9, 10, 11, 12, 13, 14, 15] };
const MODES: Mode[] = ['ai', 'online', 'local'];
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);

/** Writes the HUD every frame but touches an element property only when its value (or a section's signature) changed. */
export class HudWriter {
  private readonly written = new Map<string, string | boolean>();
  constructor(private readonly element: (id: string) => HudElement) {}

  write(view: HudView) {
    const { state, table, mode, setup, canAct } = view, arcade = state.arcade, ready = state.phase === 'ready';
    for (const team of [0, 1] as const) this.writeTeam(view, team);
    this.toggle('scoreboard', 'doubles', state.format === 'doubles');
    this.writeInvite(view);
    const initial = (team: number) => table.teams[team].name.charAt(0).toUpperCase();
    this.text('avatar-0', mode === 'ai' ? 'Y' : initial(0));
    this.patch('avatar-1.html', `${mode}:${initial(1)}`, element => { element.innerHTML = mode === 'ai' ? icon('cue', 23) : escapeHtml(initial(1)); });
    for (const option of MODES) { this.toggle(`mode-${option}`, 'selected', mode === option); this.attr(`mode-${option}`, 'aria-pressed', String(mode === option)); }
    this.disabled('difficulty', mode !== 'ai'); this.disabled('layout', mode === 'online');
    this.value('layout', arcade?.layout || view.layout);
    this.text('rules-badge', table.rules);
    this.text('level-badge', `LV ${arcade?.level || 1}`); this.attr('level-badge', 'title', levelName(arcade?.level));
    this.hidden('portal-badge', !arcade?.portalTurns); this.text('portal-badge', `◎ ${arcade?.portalTurns || 0}`);
    this.text('status-text', table.status.text);
    this.toggle('shot-status', 'foul', table.status.foul); this.toggle('shot-status', 'waiting', table.status.waiting);
    const chalked = !!state.chalked[state.turn];
    this.disabled('chalk-button', !canAct || !ready || chalked); this.attr('chalk-button', 'aria-pressed', String(chalked));
    this.attr('table-view', 'aria-pressed', String(view.inspecting));
    this.attr('shoot-button', 'aria-label', setup.stage === 'aim' ? 'Lock aim' : 'Take shot');
    this.disabled('shoot-button', !ready || !canAct || !!setup.adjustment);
    this.disabled('power', !ready || !canAct || setup.stage !== 'power');
    this.writeShotSetup(view);
    this.hidden('lock-hint', !view.lockHint);
    if (state.phase === 'over') {
      const level = arcade?.level || 1;
      this.text('result-title', mode === 'ai' ? state.winner === 0 ? 'The table is yours.' : 'The house takes this one.' : `${table.teams[state.winner ?? 0].name} takes the rack.`);
      this.text('result-message', state.message);
      this.hidden('next-level-button', !view.canAdvance);
      this.text('next-level-button', `Level ${level + 1} →`);
      this.patch('rematch-button.html', String(level), element => { element.innerHTML = `Replay level ${level} ${icon('reset', 17)}`; });
    }
  }

  private writeTeam({ state, table }: HudView, team: 0 | 1) {
    const over = state.phase === 'over', doubles = state.format === 'doubles', shooter = activeSeat(state);
    this.text(`name-${team}`, table.teams[team].name);
    const members = doubles ? [team, team + 2] : [];
    this.hidden(`roster-${team}`, !doubles);
    this.patch(`roster-${team}.html`, members.map(seat => `${table.seats[seat]}:${!over && shooter === seat}`).join('|'), element => {
      element.innerHTML = members.map(seat => {
        const current = !over && shooter === seat, name = escapeHtml(table.seats[seat]);
        return `<span class="roster-player${current ? ' active' : ''}"${current ? ' aria-current="true"' : ''} title="${name}${current ? ' · Shooting' : ''}">${name}</span>`;
      }).join('');
    });
    this.toggle(`player-${team}`, 'active', state.turn === team && !over);
    this.hidden(`turn-${team}`, state.turn !== team || over);
    const group = state.groups[team], ids = group ? GROUPS[group] : [], potted = ids.filter(id => state.balls[id].pocketed);
    this.patch(`rack-${team}.html`, `${group}:${potted.join()}`, element => {
      element.innerHTML = group
        ? ids.map(id => { const down = state.balls[id].pocketed; return `<span class="mini-ball ${id > 8 ? 'stripe' : ''} ${down ? 'potted' : ''}" style="--ball:${BALL_COLORS[id]}" title="${id}${down ? ' · potted' : ''}"><span>${id}</span></span>`; }).join('')
        : '<span class="mini-ball unassigned"></span>'.repeat(7);
    });
    this.attr(`rack-${team}`, 'aria-label', group ? `${group}: ${potted.length} potted` : 'Open table');
    const score = Math.round(state.arcade?.scores[team] || 0);
    this.patch(`score-${team}.text`, String(score), element => { element.textContent = score.toLocaleString(); });
    const pills = table.teams[team].pills;
    this.patch(`buffs-${team}.html`, pills.map(pill => `${pill.id}:${pill.title}:${pill.active}:${pill.queued}`).join('|'), element => {
      element.innerHTML = pills.map(pill => `<span class="buff-pill ${pill.className}" style="--effect-color:${pill.color}" title="${pill.title}" data-active="${pill.active}" data-queued="${pill.queued}">${icon(pill.icon, 10)}</span>`).join('');
    });
  }
  private writeInvite({ state, table, room, seat, ready }: HudView) {
    this.hidden('invite-roster', !room);
    if (!room) { this.patch('invite-roster.html', '', element => { element.innerHTML = ''; }); return; }
    this.text('invite-rules', `Rule set · ${table.rules} (chosen by the host)`);
    const capacity = seatCount(state.format), doubles = state.format === 'doubles', filled = room.players.filter(player => player.connected).length;
    this.text('invite-status', ready ? `All ${capacity} players are ready.` : `${filled}/${capacity} connected · Waiting for ${capacity === 4 ? 'the teams' : 'your friend'}…`);
    this.patch('invite-roster.html', `${state.format}:${seat}:${room.players.map(player => `${player.name}:${player.connected}`).join('|')}`, element => {
      element.innerHTML = [0, 1].map(team => `<section class="invite-team"><h3>${doubles ? 'Team' : 'Player'} ${team + 1}</h3>${(doubles ? [team, team + 2] : [team]).map(player => {
        const entry = room.players[player];
        return `<div class="invite-seat${entry?.connected ? '' : ' waiting'}">${player + 1} · ${escapeHtml(entry?.name || 'Open seat')}${player === seat ? ' (you)' : ''}${entry && !entry.connected ? ' · Reconnecting' : ''}</div>`;
      }).join('')}</section>`).join('');
    });
  }
  private writeShotSetup({ state, setup, canAct }: HudView) {
    const percent = Math.round(setup.power * 100), degrees = Math.round(setup.elevation * 180 / Math.PI);
    this.hidden('cue-setup', !setup.adjustment || !canAct || state.phase !== 'ready');
    this.attr('spin-button', 'aria-pressed', String(setup.adjustment === 'spin'));
    this.attr('elevation-button', 'aria-pressed', String(setup.adjustment === 'elevation'));
    this.style('tip-marker', 'left', `${50 + setup.tipX * 50}%`); this.style('tip-marker', 'top', `${50 - setup.tipY * 50}%`);
    this.value('cue-angle', String(degrees)); this.text('cue-angle-value', `${degrees}°`);
    this.value('power', String(percent)); this.style('power-fill', 'height', `${setup.power * 100}%`);
    this.patch('power-value.html', String(percent), element => { element.innerHTML = `${percent}<span>%</span>`; });
  }

  private patch(key: string, value: string | boolean, write: (element: HudElement) => void) {
    if (this.written.get(key) === value) return;
    this.written.set(key, value); write(this.element(key.slice(0, key.indexOf('.'))));
  }
  private text(id: string, value: string) { this.patch(`${id}.text`, value, element => { element.textContent = value; }); }
  private hidden(id: string, value: boolean) { this.patch(`${id}.hidden`, value, element => { element.hidden = value; }); }
  private value(id: string, value: string) { this.patch(`${id}.value`, value, element => { element.value = value; }); }
  private disabled(id: string, value: boolean) { this.patch(`${id}.disabled`, value, element => { element.toggleAttribute('disabled', value); }); }
  private attr(id: string, name: string, value: string) { this.patch(`${id}.${name}`, value, element => { element.setAttribute(name, value); }); }
  private toggle(id: string, className: string, on: boolean) { this.patch(`${id}.class-${className}`, on, element => { element.classList.toggle(className, on); }); }
  private style(id: string, property: string, value: string) { this.patch(`${id}.style-${property}`, value, element => { element.style.setProperty(property, value); }); }
}
