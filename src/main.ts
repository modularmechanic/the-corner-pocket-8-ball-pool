import './style.css';
import { initPhysics } from './simulation/game';
import { LocalMatch, ZombieMatch, type Match, type MatchCommand } from './match';
import type { RemoteMatch } from './match/remote';
import { resolveRoomServer } from './match/room-server';
import { LAYOUTS } from './simulation/arcade';
import { normalizeLevel } from './simulation/level-policy';
import { CUE_CATALOG, canEquipCue, equippedCue } from './simulation/cues';
import { POWER_UPS, STATUS_EFFECTS } from './presentation/effects';
import { deriveTablePresentation, RULE_NAMES, seatLabel, teamLabel } from './presentation/table-presentation';
import { defaultRuleSet, ruleBookFor, type RuleBook, type RuleBookMode } from './presentation/rule-book';
import { CONTROL_HELP } from './presentation/control-help';
import { inPlacementZone, optionalPlacementChoice } from './simulation/table-geometry';
import {
  activeSeat,
  cueBallId,
  type GameFormat,
  type ArenaLayout,
  type Difficulty,
  type GameModeId,
  type GameState,
  type Group,
  type Mode,
  type RuleSet,
  type Shot,
  type TableEvent,
} from './simulation/types';
import { PoolScene, type Quality } from './render/scene';
import { shell, icon } from './ui/shell';
import { TableAudio } from './ui/audio';
import { createIdentity } from './ui/identity';
import {
  inputSchemeFor,
  ShotInputController,
  type PointerInput,
  type ShotInputContext,
  type ShotInputView,
} from './ui/shot-input-controller';
import { deadeyeCinematic } from './render/deadeye-cinematic';
import { PlayerProfile, rackOptions } from './ui/player-profile';
import { HudWriter, type HudElement } from './ui/hud-writer';
import { gameModeCopy, gameModeSupportsFormat, gameModeSupportsOpponent, gameModes } from './ui/game-modes';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const roomServer = resolveRoomServer(import.meta.env.VITE_ROOM_SERVER_URL);
$('app').innerHTML = shell({ online: !!roomServer });
const profile = new PlayerProfile(
  (() => {
    try {
      return localStorage;
    } catch {
      return null;
    }
  })(),
);
const sound = new TableAudio();
sound.enabled = profile.preferences.sound;
sound.volume = profile.preferences.volume;
function renderLevels() {
  const select = $<HTMLSelectElement>('menu-level');
  select.replaceChildren(
    ...profile.levelOptions().map(({ value, label, disabled }) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.disabled = !!disabled;
      return option;
    }),
  );
  select.value = String(profile.preferences.level);
}
let match: Match;
let unsubscribeMatch: (() => void) | undefined;
let scene: PoolScene;
let state: GameState;
let presentation: GameState;
let stateMatch: Match | undefined;
let roomPlayers = 0;
let roomReady = false;
let isConnecting = false;
let sessionIntent = 0;
let initialized = false;
let hasStarted = false;
const hud = new HudWriter((id) => $(id) as unknown as HudElement);
let cueLockerKey = '';
let toastTimer = 0;
let resultKey = '';
let input: ShotInputController;
let cueFocusRestore = '';
let coinResetting = false;
let inspectingTable = false;
let overheadView = false;
/** Finger or pen input shows the dial, Engage, power slider and Shoot; a mouse brings back the desktop controls. */
let touchInput = false;
let touchFitted = false;
let menuMode: Mode = 'ai';
let menuFormat: GameFormat = profile.preferences.format;
let menuGame: GameModeId = profile.preferences.game;
/** Which mode's book the rulebook dialog is open to; the Old/New tabs re-render this same mode. */
let rulebookMode: RuleBookMode = 'eight-ball';
let identity: string;
try {
  identity = sessionStorage.getItem('corner-pocket:identity') || createIdentity();
  sessionStorage.setItem('corner-pocket:identity', identity);
} catch {
  identity = createIdentity();
}
function renderRecords() {
  const records = profile.records;
  $('high-scores').replaceChildren();
  $('scores-empty').hidden = records.length > 0;
  for (const [index, record] of records.entries()) {
    const row = document.createElement('li');
    row.className = 'menu-score-row';
    const rank = document.createElement('span');
    rank.className = 'record-rank';
    rank.textContent = String(index + 1).padStart(2, '0');
    const detail = document.createElement('div'),
      name = document.createElement('strong'),
      meta = document.createElement('span');
    name.textContent = record.name;
    meta.textContent = `${LAYOUTS[record.layout].name} · ${record.win ? 'Won' : 'Played'}`;
    detail.append(name, meta);
    const score = document.createElement('b');
    score.textContent = Math.round(record.score).toLocaleString();
    row.append(rank, detail, score);
    $('high-scores').append(row);
  }
}
type MenuPanel = 'landing' | 'games' | 'setup';
function showMenuPanel(panel: MenuPanel) {
  $('menu-landing').hidden = panel !== 'landing';
  $('menu-games').hidden = panel !== 'games';
  $('menu-setup').hidden = panel !== 'setup';
  // The landing panel is the attract screen: the room plays behind it. One place decides the machine is idle
  // enough to advertise, and it is here rather than in the renderer — `startAttract` refuses on its own while a
  // rack is under way or the viewer asked for reduced motion, so this never has to know about either.
  $('main-menu').dataset.panel = panel;
  if (panel === 'landing') scene?.startAttract();
  else scene?.stopAttract();
}
/** One card per registered game mode; iterating `gameModes()` instead of a fixed list means a mode registered
 * later shows up here without touching this function. */
function renderGameModes() {
  $('menu-game-grid').replaceChildren(
    ...gameModes().map((spec) => {
      const copy = gameModeCopy(spec),
        button = document.createElement('button');
      button.className = 'menu-mode-card';
      button.dataset.game = spec.id;
      button.setAttribute('aria-pressed', String(spec.id === menuGame));
      button.innerHTML = `<span class="menu-card-icon">${icon(copy.icon, 30)}</span><strong>${spec.label}</strong><span class="menu-card-detail">${copy.description}</span><span class="menu-card-selected">${icon('check', 16)}</span>`;
      button.onclick = () => {
        selectMenuGame(spec.id);
        showMenuPanel('setup');
        selectMenuMode(menuMode);
        $('menu-session-start').focus();
      };
      return button;
    }),
  );
}
function syncGameCards() {
  for (const button of $('menu-game-grid').querySelectorAll<HTMLButtonElement>('[data-game]'))
    button.setAttribute('aria-pressed', String(button.dataset.game === menuGame));
}
/** Only the options that apply to the chosen game show: a mode whose own state never varies by rule set or match
 * format (probed structurally, never by id — see `ruleBookFor` and `gameModeSupportsFormat`) hides that field, and
 * one with no cue-sports spec at all (the zombie horde) hides the opponent picker too. */
function refreshMenuSetupForGame() {
  syncGameCards();
  const entry = gameModes().find((mode) => mode.id === menuGame)!,
    copy = gameModeCopy(entry),
    book = ruleBookFor(menuGame),
    hasOpponent = gameModeSupportsOpponent(menuGame);
  $('menu-setup-title').firstChild!.textContent = entry.label;
  $('menu-game-blurb').textContent = copy.description;
  $('menu-rules-field').hidden = !book.ruleSets;
  $('menu-format-field').hidden = !gameModeSupportsFormat(menuGame);
  $('menu-opponent-section').hidden = !hasOpponent;
  $('menu-lobby').hidden = !hasOpponent || !roomServer;
}
function selectMenuGame(id: GameModeId) {
  menuGame = id;
  refreshMenuSetupForGame();
}
function selectMenuMode(selected: Mode) {
  menuMode = selected;
  for (const [id, value] of [
    ['menu-start', 'ai'],
    ['menu-local', 'local'],
    ['menu-online', 'online'],
  ])
    $('' + id).setAttribute('aria-pressed', String(selected === value));
  $('menu-ai-options').hidden = selected !== 'ai' || !gameModeSupportsOpponent(menuGame);
  $('menu-mode-label').textContent =
    selected === 'ai' ? 'Against the house' : selected === 'local' ? 'Pass & play' : 'Private online room';
  $('menu-session-start').setAttribute(
    'aria-label',
    selected === 'online' ? 'Start session in online lobby' : 'Start session',
  );
  refreshMenuFormat();
}
function refreshMenuFormat() {
  const doubles = menuFormat === 'doubles';
  $<HTMLSelectElement>('menu-format').value = menuFormat;
  $('menu-format-note').textContent = doubles
    ? menuMode === 'ai'
      ? 'You + an AI partner versus two AI opponents.'
      : menuMode === 'local'
        ? 'Four players, two teams, one screen.'
        : 'Four friends, two teams. Share one room code.'
    : 'Two players, one rack.';
  $('menu-ai-description').textContent = doubles ? 'You + AI · Team doubles' : 'Solo · AI opponent';
  $('menu-local-description').textContent = doubles ? 'Four players · One screen' : 'Two players · One screen';
  $('menu-online-description').textContent = doubles ? 'Four friends · Two teams' : 'Private room · Invite a friend';
}
function showMainMenu() {
  menuFormat = state.format;
  menuGame = state.mode ?? 'eight-ball';
  showMenuPanel('landing');
  refreshMenuSetupForGame();
  selectMenuMode(match.mode);
  stopAI();
  renderRecords();
  renderLevels();
  $<HTMLButtonElement>('menu-resume').hidden = !hasStarted || state.phase === 'over';
  $<HTMLSelectElement>('menu-difficulty').value = profile.preferences.difficulty;
  // Mid-session the selector shows the rules in play; a different choice applies from the next Start Session.
  $<HTMLSelectElement>('menu-rules').value = hasStarted ? state.rules : profile.preferences.rules;
  $('menu-session-note').textContent =
    match.mode === 'online' && match.room
      ? `Room ${match.room.code} keeps playing while this menu is open · ${RULE_NAMES[state.rules]}.`
      : hasStarted
        ? `${RULE_NAMES[state.rules]} in play · A new rule set applies from Start Session.`
        : 'Singles or doubles · Up to four players';
  openDialog('main-menu');
}
function toast(message: string) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => $('toast').classList.remove('show'), 3000);
}
function anyDialog() {
  return !!document.querySelector('dialog[open]');
}
function closeDialog(id: string) {
  $<HTMLDialogElement>(id).close();
}
function openDialog(id: string) {
  input.cancel();
  if (!$<HTMLDialogElement>(id).open) $<HTMLDialogElement>(id).showModal();
}
function seatName(player: number) {
  return seatLabel(state, { mode: match.mode, difficulty: profile.preferences.difficulty, room: match.room }, player);
}
function playerName(team: number) {
  return teamLabel(state, { mode: match.mode, difficulty: profile.preferences.difficulty, room: match.room }, team);
}
function playEvent(event: TableEvent) {
  sound.play(event);
  scene.handleEvent(event);
  if (event.kind === 'pickup' && event.power) toast(POWER_UPS[event.power].name);
  else if (event.kind === 'status' && event.status && event.reason !== 'pickup') {
    const label = STATUS_EFFECTS[event.status];
    toast(event.reason === 'scratch-streak' ? `Comeback · ${label}` : `Debuff · ${label}`);
  }
}
function stopAI() {
  match?.pauseAI();
  if (scene) scene.aiPreview = null;
}
/** Detects room and table transitions once per change; the HUD reads the match directly. */
function syncMatch() {
  if (!match) return;
  const room = match.room;
  if (room && room.players.length > roomPlayers) toast(`${room.players.at(-1)!.name} joined.`);
  if (room && !roomReady && match.ready) closeDialog('invite-dialog');
  roomPlayers = room?.players.length || 0;
  roomReady =
    match.connected &&
    !!room &&
    room.players.every((player) => player.connected) &&
    room.players.length === room.capacity;
  if (match.state === state) return;
  const previousState = state,
    watched = stateMatch === match ? previousState : null;
  state = match.state;
  stateMatch = match;
  const changedRack = !!previousState && previousState.seed !== state.seed;
  if (changedRack) {
    if (match.mode === 'online' && !coinResetting && hasStarted) sound.playMechanism('coin');
    resultKey = '';
    input.newRack();
    closeDialog('result-dialog');
    profile.set('level', normalizeLevel(state.arcade?.level));
  } else if (
    previousState &&
    (previousState.shotCount !== state.shotCount || activeSeat(previousState) !== activeSeat(state))
  )
    input.cancel();
  if (profile.recordResult(watched, state, match.mode, match.seat, playerName)) renderRecords();
}
function installMatch(next: Match) {
  unsubscribeMatch?.();
  match?.dispose();
  match = next;
  syncMatch();
  presentation = next.presentation();
  unsubscribeMatch = next.subscribe((change) => {
    if (match !== next) return;
    if (change.type === 'replaced') {
      toast('Your seat was opened in another tab.');
      newGame('ai');
      return;
    }
    if (change.type === 'error') {
      toast(change.error);
      if (!next.room) {
        newGame('ai');
        return;
      }
    }
    syncMatch();
    if (change.type === 'connection' && !next.connected) input.cancel();
  });
}
async function command(command: MatchCommand, fallback: string) {
  const current = match,
    result = await current.execute(command);
  if (match !== current) return false;
  syncMatch();
  if (!result.ok) toast(result.error || fallback);
  updateUI();
  return result.ok;
}
/** Only an explicit camera choice is remembered; the touch overhead default is not. */
function chooseCamera(overhead: boolean, remember = true) {
  input.cameraChanged();
  inspectingTable = false;
  overheadView = overhead;
  scene.setInspection(false);
  scene.setOverhead(overhead);
  scene.resetAimPointer();
  $<HTMLSelectElement>('camera').value = overhead ? 'overhead' : 'angled';
  $('camera-toggle').setAttribute('aria-label', overhead ? 'Switch to cue view' : 'Switch to overhead view');
  $('camera-toggle').setAttribute('aria-pressed', String(overhead));
  $('fps-view').setAttribute('aria-pressed', String(!overhead));
  if (remember) profile.set('camera', overhead ? 'overhead' : 'angled');
}
async function chalkCue() {
  if (!input.canAct || input.phase !== 'ready' || state.chalked[state.turn]) return;
  await sound.unlock().catch(() => undefined);
  if (input.canAct && input.phase === 'ready') await command({ type: 'chalk' }, 'Chalk is available before your shot.');
}
async function insertCoin() {
  if (coinResetting || anyDialog()) return;
  if (state.phase === 'rolling') return toast('Let the balls settle first.');
  if (!match.capabilities.canReset) return toast('Finish this rack with everyone connected to reset the table.');
  const current = match,
    seed = state.seed;
  input.cancel();
  stopAI();
  coinResetting = true;
  inspectingTable = true;
  scene.setInspection(true);
  await sound.unlock().catch(() => undefined);
  const duration = scene.animateCoinReset();
  sound.playMechanism('coin');
  updateUI();
  window.setTimeout(async () => {
    try {
      if (match === current && state.seed === seed) await command({ type: 'reset' }, 'The table cannot be reset yet.');
    } finally {
      coinResetting = false;
      updateUI();
    }
  }, duration);
}
function renderCueLocker(force = false) {
  const owner = match.mode === 'local' ? activeSeat(state) : match.seat,
    current = equippedCue(state, owner);
  const key = `${owner}:${seatName(owner)}:${current.id}:${state.arcade?.level}:${match.capabilities.canEquip}:${match.pending}`;
  if (!force && key === cueLockerKey) return;
  cueLockerKey = key;
  const focused = document.activeElement as HTMLElement | null;
  if (focused?.dataset.cue) cueFocusRestore = focused.dataset.cue;
  $('cue-owner').textContent = `${seatName(owner)} · Level ${state.arcade?.level} · ${current.name}`;
  $('cue-collection').replaceChildren(
    ...CUE_CATALOG.map((cue) => {
      const selected = current.id === cue.id,
        unlocked = canEquipCue(cue.id, state.arcade?.level),
        button = document.createElement('button');
      button.className = 'cue-card';
      button.dataset.cue = cue.id;
      button.setAttribute('aria-pressed', String(selected));
      button.disabled = !unlocked || !match.capabilities.canEquip || match.pending;
      button.style.setProperty('--cue-wood', cue.color);
      button.style.setProperty('--cue-accent', cue.accent);
      const stat = (name: string, value: number) =>
        `<span>${name}<b>${Math.round(value * 100)}%</b><i style="--stat:${(value / 1.2) * 100}%"></i></span>`;
      button.innerHTML = `<i class="cue-swatch" aria-hidden="true"></i><div class="cue-card-title"><strong>${cue.name}</strong><span>${selected ? 'Equipped' : unlocked ? 'Equip' : `Level ${cue.unlockLevel}`}</span></div><small>${cue.wood} · ${cue.weightOz} oz</small><p>${cue.description}</p><div class="cue-stats">${stat('Power', cue.power)}${stat('Spin', cue.spin)}${stat('Curve', cue.curve)}</div>`;
      button.onclick = async () => {
        if (await command({ type: 'equip', cue: cue.id }, 'This cue cannot be equipped yet.'))
          profile.set('cue', cue.id);
        renderCueLocker(true);
      };
      return button;
    }),
  );
  if (cueFocusRestore && !match.pending) {
    const target = $('cue-collection').querySelector<HTMLButtonElement>(`[data-cue="${cueFocusRestore}"]`);
    if (target && !target.disabled) target.focus();
    cueFocusRestore = '';
  }
}
function openCueLocker() {
  openDialog('cue-dialog');
  renderCueLocker(true);
}
function equipPreferredCue() {
  const preferred = profile.preferences.cue;
  if (canEquipCue(preferred, state.arcade?.level) && match.capabilities.canEquip)
    void command({ type: 'equip', cue: preferred }, 'This cue is not available at this table.');
}
function updateUI() {
  if (!state) return;
  const room = match.room,
    ready = match.ready,
    interactive = input.canAct,
    shown = input.played(state);
  const table = deriveTablePresentation(shown, {
    mode: match.mode,
    difficulty: profile.preferences.difficulty,
    room,
    connected: match.connected,
    ready,
    controlsTurn: match.actor.canAct,
    canInteract: interactive,
    aiThinking: match.thinking,
    shotStage: input.setup.stage,
    adjustment: input.setup.adjustment,
    resetting: coinResetting,
  });
  hud.write({
    state: shown,
    table,
    mode: match.mode,
    seat: match.seat,
    room,
    ready,
    canAct: interactive,
    canAdvance: match.capabilities.canAdvance,
    inspecting: inspectingTable,
    setup: input.setup,
    layout: profile.preferences.layout,
    touch: touchInput,
    lockHint: input.lockHint,
    placement: input.placementOption,
    placing: input.placing,
  });
  if ($<HTMLDialogElement>('cue-dialog').open) renderCueLocker();
  // The arcade layout only means anything for a rack that actually carries arcade state; other modes hide it.
  if ($<HTMLDialogElement>('settings-dialog').open) $('setting-layout').hidden = !state.arcade;
  if (state.phase === 'over' && presentation?.phase === 'over') {
    const key = `${state.seed}:${state.shotCount}:${state.winner}`;
    if (key !== resultKey && !$<HTMLDialogElement>('main-menu').open) {
      resultKey = key;
      openDialog('result-dialog');
    }
  }
}
const selectedRules = (id: string): RuleSet => ($<HTMLSelectElement>(id).value === 'new' ? 'new' : 'old');
function renderSections(container: HTMLElement, sections: RuleBook['sections']) {
  container.replaceChildren(
    ...sections.map(({ title, bullets }) => {
      const section = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = title;
      const list = document.createElement('ul');
      list.replaceChildren(
        ...bullets.map((bullet) => {
          const item = document.createElement('li');
          item.textContent = bullet;
          return item;
        }),
      );
      section.append(summary, list);
      return section;
    }),
  );
}
function renderRuleBook(mode: RuleBookMode, rules: RuleSet) {
  rulebookMode = mode;
  const book = ruleBookFor(mode, rules);
  $('rulebook-title').textContent = book.title;
  $('rulebook-source').textContent = book.source;
  $('rulebook-tabs').hidden = !book.ruleSets;
  $('rulebook-tab-old').setAttribute('aria-pressed', String(rules === 'old'));
  $('rulebook-tab-new').setAttribute('aria-pressed', String(rules === 'new'));
  renderSections($('rulebook-sections'), book.sections);
}
/** New racks keep the running session's rules; Start Session passes `session: null` to apply the chosen rules. */
function newGame(
  nextMode: Mode = match.mode,
  nextFormat: GameFormat = state?.format ?? menuFormat,
  session: GameState | null = state ?? null,
) {
  if (nextMode === 'online') return;
  sessionIntent++;
  const seed = createIdentity().slice(0, 8),
    options = rackOptions(profile.preferences, nextFormat, session);
  // The horde is not cue sports and cannot go through PoolGame — `modeOf` throws on it deliberately. It has its own
  // authority, which speaks the same `Match` language everything downstream already speaks.
  installMatch(
    options.mode === 'zombie'
      ? new ZombieMatch({ seed })
      : new LocalMatch({ seed, mode: nextMode, difficulty: profile.preferences.difficulty, options }),
  );
  initialized = true;
  stopAI();
  resultKey = '';
  input.newRack(0.65);
  updateUI();
  equipPreferredCue();
}
async function shoot(shot: Shot) {
  if (!input.canAct || input.phase !== 'ready') return;
  await sound.unlock().catch(() => undefined);
  if (!input.canAct || input.phase !== 'ready') return;
  input.cancel();
  await command({ type: 'shoot', shot }, 'That shot could not be played.');
}
async function place(point: { x: number; z: number }) {
  if (!input.canAct || input.phase !== 'ball-in-hand') return;
  void sound.unlock();
  await command({ type: 'place', ...point }, 'Place the cue ball on clear felt.');
}
async function chooseGroup(group: Group) {
  if (!input.canAct || state.phase !== 'choose-group') return;
  await command({ type: 'group', group }, 'Choose solids or stripes.');
}
async function enterRoom(create: boolean) {
  if (isConnecting || !roomServer) return;
  const name = $<HTMLInputElement>('player-name').value.trim() || 'Player';
  const code = $<HTMLInputElement>('room-code').value.trim().toUpperCase();
  if (!create && !/^[A-Z0-9]{6}$/.test(code)) {
    $('room-error').textContent = 'Enter a six-character room code.';
    return;
  }
  isConnecting = true;
  $('room-error').textContent = '';
  const intent = ++sessionIntent;
  $<HTMLButtonElement>('create-room').disabled = true;
  $<HTMLButtonElement>('join-room').disabled = true;
  let candidate: RemoteMatch | undefined;
  try {
    const { RemoteMatch } = await import('./match/remote').catch(() => {
      throw new Error('Online play could not load. Check your connection and try again.');
    });
    if (intent !== sessionIntent) return;
    candidate = new RemoteMatch({ identity: { token: identity, name }, url: roomServer.url });
    const rules = selectedRules('room-rules');
    const result = create
      ? await candidate.create({
          layout: profile.preferences.layout,
          level: profile.preferences.level,
          format: $<HTMLSelectElement>('room-format').value === 'doubles' ? 'doubles' : 'singles',
          rules,
        })
      : await candidate.join(code);
    if (intent !== sessionIntent) {
      candidate.dispose();
      return;
    }
    if (!result.ok) throw new Error(result.error || 'Could not open the table.');
    profile.set('name', name);
    if (create) profile.set('rules', rules);
    hasStarted = true;
    installMatch(candidate);
    resultKey = '';
    input.newRack();
    closeDialog('main-menu');
    closeDialog('room-dialog');
    $('invite-code').textContent = match.room!.code;
    void sound.unlock();
    if (create || !match.ready) openDialog('invite-dialog');
    else toast(`You’re in · ${RULE_NAMES[state.rules]}.`);
    if (state.cues[match.seat] === 'ash-house') equipPreferredCue();
    updateUI();
  } catch (error) {
    candidate?.dispose();
    if (intent === sessionIntent)
      $('room-error').textContent = error instanceof Error ? error.message : 'Could not open the table.';
  } finally {
    isConnecting = false;
    $<HTMLButtonElement>('create-room').disabled = false;
    $<HTMLButtonElement>('join-room').disabled = false;
  }
}
async function copy(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    (document.querySelector('dialog[open]') || document.body).append(area);
    area.select();
    const success = document.execCommand('copy');
    area.remove();
    toast(success ? message : `Copy this: ${text}`);
  }
}
/** A matching open room shows its invitation; otherwise open a table in the menu's format. */
function openLobby(format: GameFormat) {
  if (match.mode === 'online' && match.room && format === state.format) {
    $('invite-code').textContent = match.room.code;
    openDialog('invite-dialog');
  } else {
    $<HTMLSelectElement>('room-format').value = menuFormat;
    $<HTMLSelectElement>('room-rules').value = profile.preferences.rules;
    openDialog('room-dialog');
  }
}
function chooseDifficulty(difficulty: Difficulty) {
  $<HTMLSelectElement>('menu-difficulty').value = difficulty;
  $<HTMLSelectElement>('difficulty').value = difficulty;
  profile.set('difficulty', difficulty);
  match.setDifficulty(difficulty);
  stopAI();
  updateUI();
}
/** Touch screens fit the overhead table between their controls, measured from the live layout; a mouse restores desktop framing. */
function fitTouchOverhead() {
  // Mouse mode leaves the cameras alone on every resize and scoreboard change; it only restores the desktop framing once.
  if (!touchInput) {
    if (touchFitted) {
      touchFitted = false;
      scene.setOverheadInsets(null);
    }
    return;
  }
  touchFitted = true;
  const box = $('scene').getBoundingClientRect(),
    portrait = matchMedia('(orientation: portrait)').matches;
  const rects = (...elements: (Element | null)[]) =>
    elements
      .map((element) => element?.getBoundingClientRect())
      .filter((rect): rect is DOMRect => !!rect?.width && !!rect.height);
  const tools = document.querySelector('.stage-tools'),
    dial = $('aim-dial'),
    shoot = $('touch-shoot'),
    engage = $('touch-engage'),
    tabs = document.querySelector('.bottom-hud');
  // Portrait stacks tools, dial, Engage, Shoot and the mode tabs along the bottom; landscape puts tools and dial in a left column
  // and the tabs, slider, Engage and Shoot in a right column. The status line is not a control and may cross the table.
  const top =
    Math.max(
      box.top,
      ...rects($('player-0'), $('player-1'), document.querySelector('.header-actions')).map((rect) => rect.bottom),
    ) - box.top;
  const left = Math.max(box.left, ...rects(...(portrait ? [] : [tools, dial])).map((rect) => rect.right)) - box.left;
  const right =
    box.right -
    Math.min(
      box.right,
      ...rects($('touch-power'), shoot, ...(portrait ? [] : [engage, tabs])).map((rect) => rect.left),
    );
  const bottom =
    box.bottom -
    Math.min(box.bottom, ...rects(...(portrait ? [tools, dial, engage, shoot, tabs] : [])).map((rect) => rect.top));
  const gap = 8;
  scene.setOverheadInsets({ top: top + gap, right: right + gap, bottom: bottom + gap, left: left + gap });
}
function setTouchInput(touch: boolean) {
  if (touch === touchInput && document.documentElement.dataset.input) return;
  touchInput = touch;
  document.documentElement.dataset.input = touch ? 'touch' : 'mouse';
  if (touch) input.releasePointerLock();
  fitTouchOverhead();
}
function setupUI() {
  // Phones and tablets start overhead; the camera button switches to the cue view and back.
  setTouchInput(matchMedia('(pointer: coarse)').matches);
  document
    .querySelectorAll<HTMLButtonElement>('[data-close]')
    .forEach((button) => (button.onclick = () => button.closest('dialog')!.close()));
  document.querySelectorAll<HTMLDialogElement>('dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (dialog.id !== 'main-menu' && event.target === dialog) {
        const r = dialog.getBoundingClientRect();
        if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)
          dialog.close();
      }
    });
    dialog.addEventListener('close', () => updateUI());
  });
  renderSections($('control-help-sections'), CONTROL_HELP);
  $('help-button').onclick = () => openDialog('rules-dialog');
  $('rulebook-button').onclick = () => {
    renderRuleBook(state.mode ?? 'eight-ball', defaultRuleSet(hasStarted, state.rules, profile.preferences.rules));
    openDialog('rulebook-dialog');
  };
  $('rulebook-tab-old').onclick = () => renderRuleBook(rulebookMode, 'old');
  $('rulebook-tab-new').onclick = () => renderRuleBook(rulebookMode, 'new');
  $('play-nav').onclick = showMainMenu;
  $<HTMLDialogElement>('main-menu').addEventListener('cancel', (event) => {
    if (!hasStarted) event.preventDefault();
  });
  $('main-menu').addEventListener('close', () => scene?.stopAttract());
  // Nobody waits out the movie: any input on the attract screen goes straight to the game picker. Resume Game is
  // the one control that must keep its own behaviour, so someone mid-session is never stranded; Escape stays
  // Escape and Tab still moves focus. The prompt button does exactly what a stray key does, so it needs no
  // exception of its own. The tour stops itself on these same events, so this only decides where the player lands.
  const skipAttract = (event: Event) => {
    if ($('menu-landing').hidden || !$<HTMLDialogElement>('main-menu').open) return;
    const resume = $('menu-resume');
    if (event instanceof KeyboardEvent) {
      if (event.key === 'Escape' || event.key === 'Tab') return;
      if (document.activeElement === resume && (event.key === 'Enter' || event.key === ' ')) return;
    } else if (event.target instanceof Node && resume.contains(event.target)) return;
    $('menu-begin').click();
  };
  for (const type of ['pointerdown', 'keydown', 'touchstart'] as const)
    window.addEventListener(type, skipAttract, { capture: true, passive: true });
  $('menu-resume').onclick = () => closeDialog('main-menu');
  const chooseMenuRules = () => profile.set('rules', selectedRules('menu-rules'));
  const chooseMenuGame = () => profile.set('game', menuGame);
  const startFromMenu = (nextMode: Mode) => {
    hasStarted = true;
    chooseMenuRules();
    chooseMenuGame();
    newGame(nextMode, menuFormat, null);
    closeDialog('main-menu');
  };
  renderLevels();
  renderGameModes();
  refreshMenuFormat();
  $('menu-format').onchange = () => {
    menuFormat = $<HTMLSelectElement>('menu-format').value === 'doubles' ? 'doubles' : 'singles';
    profile.set('format', menuFormat);
    refreshMenuFormat();
  };
  $('menu-level').onchange = () => profile.set('level', normalizeLevel($<HTMLSelectElement>('menu-level').value));
  $('menu-rules').onchange = chooseMenuRules;
  $('menu-rules-info').onclick = () => {
    renderRuleBook(menuGame, selectedRules('menu-rules'));
    openDialog('rulebook-dialog');
  };
  $('menu-begin').onclick = () => {
    showMenuPanel('games');
    syncGameCards();
    $('menu-game-grid').querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
  };
  $('menu-games-back').onclick = () => {
    showMenuPanel('landing');
    $('menu-begin').focus();
  };
  $('menu-back').onclick = () => {
    showMenuPanel('games');
    syncGameCards();
  };
  $('menu-start').onclick = () => selectMenuMode('ai');
  $('menu-local').onclick = () => selectMenuMode('local');
  $('menu-online').onclick = () => selectMenuMode('online');
  $('menu-lobby').onclick = () => {
    chooseMenuRules();
    openLobby(menuFormat);
  };
  $('menu-session-start').onclick = () => {
    if (menuMode === 'online') {
      chooseMenuRules();
      openLobby(menuFormat);
    } else startFromMenu(menuMode);
  };
  $('menu-difficulty').onchange = () => chooseDifficulty($<HTMLSelectElement>('menu-difficulty').value as Difficulty);
  const resolutionNote = () => {
    const perf = scene.getPerformance();
    $('resolution-note').textContent =
      `${Math.round(perf.fps)} FPS · ${perf.width} × ${perf.height} · ${perf.tier}. ${perf.gpuMs !== null ? `GPU ${perf.gpuMs.toFixed(1)} ms · ` : ''}${perf.drawCalls} draws. Auto adjusts effects and resolution for smooth play.`;
  };
  window.setInterval(() => {
    if ($<HTMLDialogElement>('settings-dialog').open) resolutionNote();
  }, 1000);
  $('settings-button').onclick = () => {
    resolutionNote();
    openDialog('settings-dialog');
  };
  $('menu-settings').onclick = $('settings-button').onclick;
  const updateSound = () => {
    $('sound-toggle').innerHTML = icon(sound.enabled ? 'sound' : 'mute');
    $('sound-toggle').setAttribute('aria-label', sound.enabled ? 'Mute sound' : 'Enable sound');
    $('sound-toggle').setAttribute('aria-pressed', String(sound.enabled));
  };
  $('sound-toggle').onclick = () => {
    sound.enabled = !sound.enabled;
    if (sound.enabled) sound.unlock();
    profile.set('sound', sound.enabled);
    updateSound();
  };
  updateSound();
  $('fullscreen').onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      toast('Fullscreen is unavailable in this view.');
    }
  };
  document.addEventListener('fullscreenchange', () =>
    $('fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'),
  );
  $<HTMLInputElement>('volume').value = String(sound.volume * 100);
  $('volume').oninput = () => {
    sound.volume = Number($<HTMLInputElement>('volume').value) / 100;
    profile.set('volume', sound.volume);
    sound.unlock();
  };
  $('preview-audio').onclick = () => sound.preview();
  $<HTMLSelectElement>('quality').value = profile.preferences.quality;
  scene.setQuality(profile.preferences.quality);
  $('quality').onchange = () => {
    const q = $<HTMLSelectElement>('quality').value as Quality;
    scene.setQuality(q);
    profile.set('quality', q);
    resolutionNote();
  };
  chooseCamera(touchInput || profile.preferences.camera === 'overhead', false);
  $('camera').onchange = () => chooseCamera($<HTMLSelectElement>('camera').value === 'overhead');
  $('camera-toggle').onclick = () => chooseCamera($<HTMLSelectElement>('camera').value !== 'overhead');
  $('fps-view').onclick = () => chooseCamera(false);
  $('reset-view').onclick = () => {
    scene.setFPSView();
    chooseCamera(false);
  };
  $('spin-button').onclick = () => input.toggleAdjustment('spin');
  $('elevation-button').onclick = () => input.toggleAdjustment('elevation');
  $('cue-locker-button').onclick = openCueLocker;
  $('aim-guide').onchange = () => {
    scene.aim.visible = $<HTMLInputElement>('aim-guide').checked;
  };
  $('layout').onchange = () => {
    if (match.mode === 'online') return;
    const layout = $<HTMLSelectElement>('layout').value as ArenaLayout;
    profile.set('layout', layout);
    newGame();
    closeDialog('settings-dialog');
    toast(LAYOUTS[layout].name);
  };
  $('power').oninput = () => input.setPower(Number($<HTMLInputElement>('power').value) / 100);
  $('shoot-button').onclick = () => input.advance();
  $('touch-engage').onclick = () => input.toggleEngage();
  $('touch-shoot').onclick = () => input.touchShoot();
  $('chalk-button').onclick = () => void chalkCue();
  $('place-button').onclick = () => input.togglePlacement();
  $('choose-solids').onclick = () => void chooseGroup('solids');
  $('choose-stripes').onclick = () => void chooseGroup('stripes');
  $('coin-button').onclick = () => void insertCoin();
  $('table-view').onclick = () => {
    input.cancel();
    inspectingTable = !inspectingTable;
    scene.setInspection(inspectingTable);
  };
  $('cue-angle').oninput = () => input.setElevation((Number($<HTMLInputElement>('cue-angle').value) * Math.PI) / 180);
  $('tip-center').onclick = () => input.setTip(0, 0);
  $('reset-button').onclick = () => {
    if (!match.capabilities.canReset) return toast('Finish this rack with everyone connected to reset the table.');
    if (match.capabilities.canRematch) return openDialog('result-dialog');
    openDialog('reset-dialog');
  };
  $('concede-button').onclick = () => openDialog('concede-dialog');
  $('confirm-concede').onclick = async () => {
    if (await command({ type: 'concede' }, 'This game cannot be conceded.')) closeDialog('concede-dialog');
  };
  $('confirm-reset').onclick = async () => {
    if (await command({ type: 'reset' }, 'The table cannot be reset yet.')) {
      closeDialog('reset-dialog');
      toast('Fresh rack.');
    }
  };
  $('next-level-button').onclick = async () => {
    if (!match.capabilities.canAdvance) return;
    if (await command({ type: 'advance' }, 'This level cannot advance yet.')) closeDialog('result-dialog');
  };
  $('rematch-button').onclick = async () => {
    if (await command({ type: 'rematch' }, 'The rack cannot restart yet.')) closeDialog('result-dialog');
  };
  $('mode-ai').onclick = () => {
    if (match.mode !== 'ai') newGame('ai');
  };
  $('mode-local').onclick = () => {
    if (match.mode !== 'local') newGame('local');
  };
  $('mode-online').onclick = () => openLobby(state.format);
  $<HTMLSelectElement>('difficulty').value = profile.preferences.difficulty;
  $('difficulty').onchange = () => chooseDifficulty($<HTMLSelectElement>('difficulty').value as Difficulty);
  $<HTMLInputElement>('player-name').value = profile.preferences.name;
  $('create-room').onclick = () => void enterRoom(true);
  $('join-room').onclick = () => void enterRoom(false);
  $('room-code').oninput = () => {
    $<HTMLInputElement>('room-code').value = $<HTMLInputElement>('room-code')
      .value.toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
  };
  $('room-code').onkeydown = (event) => {
    if (event.key === 'Enter') void enterRoom(false);
  };
  $('copy-code').onclick = () => {
    if (match.room) void copy(match.room.code, 'Room code copied.');
  };
  $('copy-link').onclick = () => {
    if (match.room) {
      const url = new URL(location.href);
      url.search = '';
      url.searchParams.set('room', match.room.code);
      void copy(url.href, 'Invitation link copied.');
    }
  };
}
function createShotInput() {
  const canvas = scene.renderer.domElement;
  const view: ShotInputView = {
    aimAt: (x, y) => scene.aimAtScreen(x, y, state.balls[cueBallId(state)]),
    screenDirection: (angle) => {
      const cue = state.balls[cueBallId(state)],
        from = scene.tableToScreen(cue.x, cue.z),
        to = scene.tableToScreen(cue.x + Math.cos(angle), cue.z + Math.sin(angle));
      return { x: to.x - from.x, y: to.y - from.y };
    },
    tableAt: (x, y) => scene.screenToTable(x, y),
    tableControlAt: (x, y) => scene.hitTableControl(x, y),
    showPlacement: (point) => scene.showPlacement(point && inPlacementZone(state, point) ? point : null),
    showAim: ({ contactEditing, ...aim }) => {
      Object.assign(scene.aim, aim);
      scene.contactEditing = contactEditing;
    },
    beginOrbit: () => scene.beginOrbit(),
    orbitBy: (dx, dy) => scene.orbitBy(dx, dy),
    rotateView: (yaw, pitch) => scene.rotateView(yaw, pitch),
    endOrbit: () => scene.endOrbit(),
    resetAimPointer: () => scene.resetAimPointer(),
    capturePointer: (id, grab) => {
      canvas.setPointerCapture(id);
      if (grab) canvas.style.cursor = 'grabbing';
    },
    releasePointer: (id) => {
      canvas.style.cursor = '';
      if (id !== null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    },
    requestPointerLock: () => {
      if (!('requestPointerLock' in canvas)) return false;
      // Refusals also arrive as pointerlockerror; older engines return no promise.
      try {
        Promise.resolve(canvas.requestPointerLock()).catch(() => undefined);
      } catch {
        return false;
      }
      return true;
    },
    // A lock that already ended reports its release at once, so the controller never keeps integrating movement.
    exitPointerLock: () => {
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      else input.pointerLockChanged(false);
    },
  };
  // The kitchen scan behind an optional placement runs once per match state, not on every input query.
  let placementState: GameState | null = null,
    placement: ShotInputContext['optionalPlacement'] = null;
  const context = (): ShotInputContext => ({
    canAct: initialized && match.actor.canAct && !anyDialog() && !match.pending && !coinResetting && !document.hidden,
    blocked: !initialized || anyDialog() || coinResetting,
    phase: state.phase,
    optionalPlacement:
      placementState === state ? placement : ((placementState = state), (placement = optionalPlacementChoice(state))),
    width: canvas.clientWidth,
    cueView: !overheadView && !inspectingTable,
    ownTurn: match.actor.controller === 'human' && (match.mode !== 'online' || match.actor.seat === match.seat),
  });
  return new ShotInputController(view, context, (command) => {
    if (command.type === 'shoot') void shoot(command.shot);
    else if (command.type === 'place') void place({ x: command.x, z: command.z });
    else if (command.type === 'chalk') void chalkCue();
    else if (command.type === 'coin') void insertCoin();
    else if (command.type === 'cue-locker') openCueLocker();
    else chooseCamera(command.toggleOverhead && $<HTMLSelectElement>('camera').value !== 'overhead');
  });
}
function setupInput() {
  const canvas = scene.renderer.domElement;
  let seenMouse = false;
  const noteMouse = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') seenMouse = true;
  };
  window.addEventListener('pointermove', noteMouse, true);
  const fingerLike = (event: PointerEvent) => {
    noteMouse(event);
    return (
      inputSchemeFor(
        event.pointerType,
        seenMouse,
        matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches,
      ) === 'touch'
    );
  };
  const pointer = (event: PointerEvent): PointerInput => ({
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    button: event.button,
    buttons: event.buttons,
    primary: event.isPrimary,
    shift: event.shiftKey,
    dx: event.movementX,
    dy: event.movementY,
    touch: fingerLike(event),
  });
  window.addEventListener('pointerdown', (event) => setTouchInput(fingerLike(event)), true);
  new ResizeObserver(fitTouchOverhead).observe($('scene'));
  for (const element of [$('player-0'), $('player-1'), document.querySelector('.stage-tools')!])
    new ResizeObserver(fitTouchOverhead).observe(element);
  document.addEventListener('pointerlockchange', () =>
    input.pointerLockChanged(document.pointerLockElement === canvas),
  );
  document.addEventListener('pointerlockerror', () => input.pointerLockError());
  canvas.addEventListener('pointerenter', (event) => input.pointerEnter(pointer(event)));
  canvas.addEventListener('pointerleave', () => input.pointerLeave());
  canvas.addEventListener('pointermove', (event) => input.pointerMove(pointer(event)));
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button === 2) event.preventDefault();
    else if (event.button === 0) void sound.unlock();
    input.pointerDown(pointer(event));
  });
  canvas.addEventListener('pointerup', (event) => input.pointerUp(pointer(event)));
  canvas.addEventListener('pointercancel', () => input.cancel());
  canvas.addEventListener('lostpointercapture', (event) => input.pointerLost(event.pointerId));
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  const tip = $('tip-control');
  let tipPointer: number | null = null;
  const chooseTip = (event: PointerEvent) => {
    const rect = tip.getBoundingClientRect();
    input.setTip(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      1 - ((event.clientY - rect.top) / rect.height) * 2,
    );
  };
  tip.onpointerdown = (event) => {
    if (!input.canAct || event.button !== 0) return;
    tipPointer = event.pointerId;
    tip.setPointerCapture(event.pointerId);
    chooseTip(event);
  };
  tip.onpointermove = (event) => {
    if (tipPointer === event.pointerId) chooseTip(event);
  };
  tip.onpointerup = (event) => {
    if (tipPointer === event.pointerId) {
      chooseTip(event);
      tipPointer = null;
      tip.releasePointerCapture(event.pointerId);
    }
  };
  tip.onpointercancel = () => {
    tipPointer = null;
  };
  // Aim dial: the finger's turn around the dial centre; near the centre the angle is meaningless, so that stretch is skipped.
  const dial = $('aim-dial');
  let dialTouch: { id: number; angle: number } | null = null;
  const dialAngle = (event: PointerEvent) => {
    const rect = dial.getBoundingClientRect(),
      x = event.clientX - rect.left - rect.width / 2,
      y = event.clientY - rect.top - rect.height / 2;
    return Math.hypot(x, y) < rect.width * 0.12 ? NaN : Math.atan2(y, x);
  };
  dial.onpointerdown = (event) => {
    if (dialTouch) return;
    dial.setPointerCapture(event.pointerId);
    dialTouch = { id: event.pointerId, angle: dialAngle(event) };
  };
  dial.onpointermove = (event) => {
    if (dialTouch?.id !== event.pointerId) return;
    const angle = dialAngle(event);
    input.rotateDial(angle - dialTouch.angle);
    dialTouch.angle = angle;
  };
  dial.onpointerup = dial.onpointercancel = (event) => {
    if (dialTouch?.id === event.pointerId) dialTouch = null;
  };
  // Power slider: the finger's height on the track sets power; letting go leaves it for the Shoot button.
  const power = $('touch-power'),
    track = $('touch-power-track');
  let powerTouch: number | null = null;
  const slide = (event: PointerEvent) => {
    const rect = track.getBoundingClientRect();
    input.setSliderPower((rect.bottom - event.clientY) / rect.height);
  };
  power.onpointerdown = (event) => {
    if (powerTouch !== null) return;
    powerTouch = event.pointerId;
    power.setPointerCapture(event.pointerId);
    slide(event);
  };
  power.onpointermove = (event) => {
    if (powerTouch === event.pointerId) slide(event);
  };
  power.onpointerup = power.onpointercancel = (event) => {
    if (powerTouch === event.pointerId) powerTouch = null;
  };
  tip.onkeydown = (event) => {
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-0.08, 0],
      ArrowRight: [0.08, 0],
      ArrowUp: [0, 0.08],
      ArrowDown: [0, -0.08],
    };
    if (!deltas[event.key] || !input.canAct) return;
    event.preventDefault();
    event.stopPropagation();
    const [x, y] = deltas[event.key];
    input.setTip(input.setup.tipX + x, input.setup.tipY + y);
  };
  window.addEventListener('blur', () => {
    input.releasePointerLock();
    input.cancel();
    stopAI();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      input.cancel();
      stopAI();
      sound.updateRolling([]);
    }
    match.update(0, { aiPaused: document.hidden, muted: document.hidden });
    syncMatch();
    updateUI();
  });
  const typing = (target: EventTarget | null) =>
    target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName));
  window.addEventListener('keydown', (event) => {
    const target = typing(event.target) ? 'text' : event.target instanceof HTMLButtonElement ? 'button' : 'other';
    if (
      input.keyDown({
        code: event.key === 'Escape' ? 'Escape' : event.code,
        repeat: event.repeat,
        shift: event.shiftKey,
        target,
      })
    )
      event.preventDefault();
  });
  window.addEventListener('keyup', (event) => input.keyUp(event.code));
}
let previous = performance.now();
function frame(now: number) {
  const elapsed = Math.max(0, (now - previous) / 1000),
    dt = Math.min(elapsed, 0.06);
  previous = now;
  // Presentation only: the accumulator still steps at a fixed MATCH_STEP, so the trajectory is unchanged.
  match.update(elapsed * (match.mode === 'online' ? 1 : deadeyeCinematic.timeScale), {
    aiPaused: coinResetting || anyDialog() || document.hidden,
    muted: document.hidden || elapsed > 0.5,
    aiCameraReady: scene.isAIViewReady(),
  });
  syncMatch();
  presentation = match.presentation();
  scene.aiPreview = match.aiPreview;
  scene.setAIControlled(match.actor.controller === 'ai');
  const events = match.drainEvents();
  if (!document.hidden && elapsed <= 0.5) for (const event of events) playEvent(event);
  input.frame(dt);
  scene.update(input.played(presentation), dt, input.canAct);
  sound.updateRolling(document.hidden ? [] : presentation.balls);
  updateUI();
  requestAnimationFrame(frame);
}
async function boot() {
  try {
    void sound.prepare().catch((error) => console.warn('Audio is unavailable:', error));
    await initPhysics();
    scene = new PoolScene($('scene'), (lost) => {
      if (lost) {
        input?.cancel();
        $('loading').classList.remove('done');
        $('loading').querySelector('h2')!.textContent = 'Restoring the table.';
        $('loading').querySelector('p')!.textContent = 'Graphics were interrupted. Your game is still here.';
      } else $('loading').classList.add('done');
    });
    input = createShotInput();
    newGame('ai');
    setupUI();
    setupInput();
    $('loading').classList.add('done');
    showMainMenu();
    previous = performance.now();
    requestAnimationFrame(frame);
    const invitation = new URL(location.href).searchParams.get('room');
    if (invitation && !roomServer)
      $('menu-session-note').textContent =
        'Online play is unavailable in this version, so room invitations cannot open here.';
    else if (invitation) {
      $<HTMLInputElement>('room-code').value = invitation.slice(0, 6).toUpperCase();
      openDialog('room-dialog');
    }
    Object.defineProperty(window, '__POOL__', {
      value: {
        snapshot: () => structuredClone(state),
        project: (x: number, z: number) => scene.tableToScreen(x, z),
        resolution: () => scene.getResolution(),
        mode: () => match.mode,
        seat: () => match.seat,
        audio: () => sound.diagnostics(),
        performance: () => scene.getPerformance(),
      },
      writable: false,
    });
  } catch (error) {
    console.error('Could not open the club:', error);
    const message = error instanceof Error ? error.message : String(error);
    const graphicsError = /WebGL|WebGLRenderingContext|Error creating WebGL context/i.test(message);
    $('loading').classList.remove('done');
    $('loading').classList.add('error');
    $('loading').querySelector('h2')!.textContent = graphicsError
      ? 'Graphics could not start.'
      : 'Could not start the game.';
    $('loading').querySelector('p')!.textContent = graphicsError
      ? 'Enable WebGL 2 and hardware acceleration, then reload.'
      : message;
  }
}
void boot();
