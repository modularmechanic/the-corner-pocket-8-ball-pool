import './style.css';
import { initPhysics } from './simulation/game';
import { LocalMatch, RemoteMatch, normalizeLevel, canAdvance as matchCanAdvance, resultTeams, type Match, type MatchCommand, type RoomSnapshot } from './match';
import { LAYOUTS } from './simulation/arcade';
import { CUE_CATALOG, canEquipCue, equippedCue, type CueId } from './simulation/cues';
import { POWER_UPS, STATUS_EFFECTS } from './presentation/effects';
import { deriveTablePresentation, seatLabel, teamLabel } from './presentation/table-presentation';
import { TABLE, activeSeat, seatCount, type GameFormat, type ArenaLayout, type Difficulty, type GameState, type Mode, type Shot, type TableEvent } from './simulation/types';
import { PoolScene, type Quality } from './render/scene';
import { BALL_COLORS } from './render/materials';
import { shell, icon } from './ui/shell';
import { TableAudio } from './ui/audio';
import { createIdentity } from './ui/identity';
import { ShotSetup } from './ui/shot-setup';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
$('app').innerHTML = shell();
const storage = {
  get(key: string, fallback: string) { try { return localStorage.getItem(`corner-pocket:${key}`) ?? fallback; } catch { return fallback; } },
  set(key: string, value: string) { try { localStorage.setItem(`corner-pocket:${key}`, value); } catch { /* Playing does not require storage. */ } },
};
const sound = new TableAudio();
sound.enabled = storage.get('sound', 'true') === 'true';
const savedVolume = Number(storage.get('volume', '.65'));
sound.volume = Number.isFinite(savedVolume) ? savedVolume : .65;
let mode: Mode = 'ai';
let difficulty: Difficulty = (['casual', 'regular', 'expert'].includes(storage.get('difficulty', 'regular')) ? storage.get('difficulty', 'regular') : 'regular') as Difficulty;
let layout: ArenaLayout = Object.hasOwn(LAYOUTS, storage.get('layout', 'crossfire')) ? storage.get('layout', 'crossfire') as ArenaLayout : 'crossfire';
const levelNames = ['First round', 'Trick shots', 'Cross currents', 'Hard knocks', 'House champion'];
const parseLevel = normalizeLevel;
let unlockedLevel = parseLevel(storage.get('unlocked-level', '1'));
let level = Math.min(unlockedLevel, parseLevel(storage.get('level', '1')));
function renderLevels() {
  const select = $<HTMLSelectElement>('menu-level');
  select.replaceChildren(...levelNames.map((name, index) => {
    const option = document.createElement('option'); option.value = String(index + 1);
    option.textContent = `${index + 1} · ${name}${index + 1 > unlockedLevel ? ' · Locked' : ''}`;
    option.disabled = index + 1 > unlockedLevel; return option;
  }));
  select.value = String(level);
}
function canAdvance() { return matchCanAdvance(state,mode); }
let match: Match;
let unsubscribeMatch: (()=>void) | undefined;
let scene: PoolScene;
let state: GameState;
let presentation: GameState;
let room: RoomSnapshot | null = null;
let seat = 0;
let connected = false;
let isConnecting = false;
let sessionIntent = 0;
let initialized = false;
let hasStarted = false;
let lastUI = '';
let toastTimer = 0;
let resultKey = '';
let aimAngle = 0;
let power = .65;
const shotSetup = new ShotSetup();
let activePointer: number | null = null;
let orbitPointer: { id: number; x: number; y: number } | null = null;
let keyboardOrbit = false;
const heldKeys = new Set<string>();
let lastPointer = { x: 0, y: 0 };
let cueFocusRestore='';
let coinResetting = false;
let inspectingTable = false;
let menuMode: Mode = mode;
let menuFormat: GameFormat = storage.get('format', 'singles') === 'doubles' ? 'doubles' : 'singles';
let aiMessage = false;
let identity: string;
try { identity = sessionStorage.getItem('corner-pocket:identity') || createIdentity(); sessionStorage.setItem('corner-pocket:identity', identity); } catch { identity = createIdentity(); }
interface HouseRecord { id: string; name: string; score: number; layout: ArenaLayout; win: boolean; date: string }
function readRecords(): HouseRecord[] {
  try {
    const records: unknown = JSON.parse(storage.get('records', '[]'));
    return Array.isArray(records) ? records.filter((record): record is HouseRecord => !!record && typeof record.id === 'string' && typeof record.name === 'string' && Number.isFinite(record.score) && record.score >= 0 && Object.hasOwn(LAYOUTS, record.layout) && typeof record.date === 'string').slice(0, 8) : [];
  } catch { return []; }
}
function renderRecords() {
  const records = readRecords();
  $('high-scores').replaceChildren(); $('scores-empty').hidden = records.length > 0;
  for (const [index, record] of records.entries()) {
    const row = document.createElement('li'); row.className = 'menu-score-row';
    const rank = document.createElement('span'); rank.className = 'record-rank'; rank.textContent = String(index + 1).padStart(2, '0');
    const detail = document.createElement('div'), name = document.createElement('strong'), meta = document.createElement('span');
    name.textContent = record.name; meta.textContent = `${LAYOUTS[record.layout].name} · ${record.win ? 'Won' : 'Played'}`;
    detail.append(name, meta);
    const score = document.createElement('b'); score.textContent = Math.round(record.score).toLocaleString();
    row.append(rank, detail, score); $('high-scores').append(row);
  }
}
function saveResult() {
  if (state.phase !== 'over' || !state.arcade) return;
  if (canAdvance()) { unlockedLevel = Math.max(unlockedLevel, state.arcade?.level + 1); storage.set('unlocked-level', String(unlockedLevel)); }
  const players = resultTeams(mode, seat);
  const records = readRecords();
  for (const player of players) {
    const id = `${state.seed}:${mode}:${player}`;
    if (records.some(record => record.id === id)) continue;
    records.push({ id, name: playerName(player), score: state.arcade.scores[player], layout: state.arcade.layout, win: state.winner === player, date: new Date().toISOString() });
  }
  records.sort((a, b) => b.score - a.score || Number(b.win) - Number(a.win) || b.date.localeCompare(a.date));
  storage.set('records', JSON.stringify(records.slice(0, 8))); renderRecords();
}
function setMenuPanel(setup: boolean) {
  $('menu-landing').hidden = setup; $('menu-setup').hidden = !setup;
}
function selectMenuMode(selected: Mode) {
  menuMode = selected;
  for (const [id, value] of [['menu-start','ai'],['menu-local','local'],['menu-online','online']]) $(''+id).setAttribute('aria-pressed', String(selected === value));
  $('menu-ai-options').hidden = selected !== 'ai';
  $('menu-mode-label').textContent = selected === 'ai' ? 'Against the house' : selected === 'local' ? 'Pass & play' : 'Private online room';
  $('menu-session-start').setAttribute('aria-label', selected === 'online' ? 'Start session in online lobby' : 'Start session');
  refreshMenuFormat();
}
function refreshMenuFormat() {
  const doubles = menuFormat === 'doubles';
  $<HTMLSelectElement>('menu-format').value = menuFormat;
  $('menu-format-note').textContent = doubles ? menuMode === 'ai' ? 'You + an AI partner versus two AI opponents.' : menuMode === 'local' ? 'Four players, two teams, one screen.' : 'Four friends, two teams. Share one room code.' : 'Two players, one rack.';
  $('menu-ai-description').textContent = doubles ? 'You + AI · Team doubles' : 'Solo · AI opponent';
  $('menu-local-description').textContent = doubles ? 'Four players · One screen' : 'Two players · One screen';
  $('menu-online-description').textContent = doubles ? 'Four friends · Two teams' : 'Private room · Invite a friend';
}
function showMainMenu() {
  menuFormat = state.format;
  setMenuPanel(false); selectMenuMode(mode);
  stopAI(); renderRecords(); renderLevels();
  $<HTMLButtonElement>('menu-resume').hidden = !hasStarted || state.phase === 'over';
  $<HTMLSelectElement>('menu-difficulty').value = difficulty;
  $('menu-session-note').textContent = mode === 'online' && room ? `Room ${room.code} keeps playing while this menu is open.` : 'Singles or doubles · Up to four players';
  openDialog('main-menu');
}
function toast(message: string) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = window.setTimeout(() => $('toast').classList.remove('show'), 3000); }
function anyDialog() { return !!document.querySelector('dialog[open]'); }
function closeDialog(id: string) { $<HTMLDialogElement>(id).close(); }
function openDialog(id: string) { cancelDrag(); if (!$<HTMLDialogElement>(id).open) $<HTMLDialogElement>(id).showModal(); }
function bothConnected() { return match?.ready ?? false; }
function myTurn() { return match?.actor.canAct ?? false; }
function canAct() { return initialized && myTurn() && !anyDialog() && !match.pending && !coinResetting && !orbitPointer && !keyboardOrbit && !document.hidden; }
function seatName(player: number) {
  return seatLabel(state,{mode,difficulty,room},player);
}
function playerName(team: number) {
  return teamLabel(state,{mode,difficulty,room},team);
}
function renderInvite() {
  const roster = $('invite-roster'); roster.replaceChildren(); roster.hidden = !room;
  if (!room) return;
  const capacity = seatCount(state.format), filled = room.players.filter(p => p.connected).length;
  $('invite-status').textContent = bothConnected() ? `All ${capacity} players are ready.` : `${filled}/${capacity} connected · Waiting for ${capacity === 4 ? 'the teams' : 'your friend'}…`;
  for (const team of [0, 1]) {
    const section = document.createElement('section'); section.className = 'invite-team';
    const title = document.createElement('h3'); title.textContent = state.format === 'doubles' ? `Team ${team + 1}` : `Player ${team + 1}`; section.append(title);
    for (const player of state.format === 'doubles' ? [team, team + 2] : [team]) {
      const entry = room.players[player], row = document.createElement('div'); row.className = `invite-seat${entry?.connected ? '' : ' waiting'}`;
      row.textContent = `${player + 1} · ${entry?.name || 'Open seat'}${player === seat ? ' (you)' : ''}${entry && !entry.connected ? ' · Reconnecting' : ''}`;
      section.append(row);
    }
    roster.append(section);
  }
}

function playEvent(event: TableEvent) {
  sound.play(event); scene.handleEvent(event);
  if (event.kind === 'pickup' && event.power) toast(POWER_UPS[event.power].name);
  else if (event.kind === 'status' && event.status && event.reason !== 'pickup') {
    const label = STATUS_EFFECTS[event.status];
    toast(event.reason === 'scratch-streak' ? `Comeback · ${label}` : `Debuff · ${label}`);
  }
}
function stopAI() { match?.pauseAI(); aiMessage = false; if (scene) scene.aiPreview = null; }
function syncMatch() {
  if (!match) return;
  const previousState=state,previousPlayers=room?.players.length||0,wasReady=connected&&!!room&&room.players.every(player=>player.connected)&&room.players.length===room.capacity;
  state=match.state;presentation=match.presentation();mode=match.mode;room=match.room;seat=match.seat;connected=match.connected;aiMessage=match.thinking;
  if(scene){scene.aiPreview=match.aiPreview;scene.setAIControlled(match.actor.controller==='ai');}
  const changedRack=!!previousState&&previousState.seed!==state.seed;
  if(changedRack){
    if(mode==='online'&&!coinResetting&&hasStarted)sound.playMechanism('coin');
    resultKey='';aimAngle=0;if(scene)scene.aim.angle=0;cancelDrag();closeDialog('result-dialog');
    level=normalizeLevel(state.arcade?.level);storage.set('level',String(level));
  }else if(previousState&&(previousState.shotCount!==state.shotCount||activeSeat(previousState)!==activeSeat(state)))cancelDrag();
  if(room&&room.players.length>previousPlayers)toast(`${room.players.at(-1)!.name} joined.`);
  if(room&&!wasReady&&match.ready)closeDialog('invite-dialog');
  if(state.phase==='over'&&(changedRack||previousState?.phase!=='over'))saveResult();
}
function installMatch(next:Match) {
  unsubscribeMatch?.();match?.dispose();match=next;syncMatch();
  unsubscribeMatch=next.subscribe(change=>{
    if(match!==next)return;
    if(change.type==='replaced'){toast('Your seat was opened in another tab.');newGame('ai');return;}
    if(change.type==='error'){toast(change.error);if(!next.room){newGame('ai');return;}}
    syncMatch();if(change.type==='connection'&&!next.connected)cancelDrag();updateUI(true);
  });
}
async function command(command:MatchCommand,fallback:string) {
  const current=match,result=await current.execute(command);
  if(match!==current)return false;
  syncMatch();if(!result.ok)toast(result.error||fallback);updateUI(true);return result.ok;
}
function setPower(value: number) {
  power = Math.max(.05, Math.min(1, value));
  $<HTMLInputElement>('power').value = String(Math.round(power * 100));
  $('power-fill').style.height = `${power * 100}%`; $('power-value').innerHTML = `${Math.round(power * 100)}<span>%</span>`;
  shotSetup.power = power;
  if (scene) scene.aim.power = power;
}
function refreshShotSetup() {
  if (!scene) return;
  Object.assign(scene.aim, { elevation: shotSetup.elevation, tipX: shotSetup.tipX, tipY: shotSetup.tipY, power, pullback: shotSetup.stage === 'power' ? power : .02 });
  scene.contactEditing = !!shotSetup.adjustment;
  $('cue-setup').hidden = !shotSetup.adjustment || !canAct() || state.phase !== 'ready';
  $('spin-button').setAttribute('aria-pressed', String(shotSetup.adjustment === 'spin'));
  $('elevation-button').setAttribute('aria-pressed', String(shotSetup.adjustment === 'elevation'));
  $('tip-marker').style.left = `${50 + shotSetup.tipX * 50}%`; $('tip-marker').style.top = `${50 - shotSetup.tipY * 50}%`;
  $<HTMLInputElement>('cue-angle').value = String(Math.round(shotSetup.elevation * 180 / Math.PI));
  $('cue-angle-value').textContent = `${Math.round(shotSetup.elevation * 180 / Math.PI)}°`;
}
function endOrbit() {
  const pointer = orbitPointer; orbitPointer = null;
  if (scene) {
    const canvas = scene.renderer.domElement; canvas.style.cursor = '';
    if (pointer && canvas.hasPointerCapture(pointer.id)) canvas.releasePointerCapture(pointer.id);
    if(!keyboardOrbit)scene.endOrbit();
    scene.resetAimPointer();shotSetup.reanchorPower(lastPointer.x,lastPointer.y);
    if(!keyboardOrbit&&!orbitPointer){const adjustment=heldKeys.has('KeyS')?'spin':heldKeys.has('KeyE')?'elevation':null;if(adjustment)shotSetup.beginAdjustment(adjustment,lastPointer.x,lastPointer.y);}
  }
}
function cancelDrag() {
  keyboardOrbit=false;heldKeys.clear();
  endOrbit();
  scene?.resetAimPointer();
  if (activePointer !== null && scene?.renderer.domElement.hasPointerCapture(activePointer)) scene.renderer.domElement.releasePointerCapture(activePointer);
  activePointer = null; shotSetup.reset(); if (scene) refreshShotSetup();
}
function chooseCamera(overhead:boolean) {
  // A new projection changes the pullback axis; require a fresh aim lock.
  shotSetup.stage='aim';
  keyboardOrbit=false;endOrbit();inspectingTable=false;
  scene.setInspection(false);scene.setOverhead(overhead);scene.resetAimPointer();
  $<HTMLSelectElement>('camera').value=overhead?'overhead':'angled';
  $('camera-toggle').setAttribute('aria-label',overhead?'Switch to cue view':'Switch to overhead view');
  $('camera-toggle').setAttribute('aria-pressed',String(overhead));
  $('fps-view').setAttribute('aria-pressed',String(!overhead));
  $('table-view').setAttribute('aria-pressed','false');
  storage.set('camera',overhead?'overhead':'angled');updateUI(true);
}
function setAdjustment(mode:'spin'|'elevation'|null) {
  if(mode&&(!canAct()||state.phase!=='ready'))return;
  if(mode)shotSetup.beginAdjustment(mode,lastPointer.x,lastPointer.y);
  else shotSetup.endAdjustment(lastPointer.x,lastPointer.y);
  scene.resetAimPointer();refreshShotSetup();updateUI(true);
}
function advanceShotSetup(x = lastPointer.x, y = lastPointer.y) {
  if (!canAct() || state.phase !== 'ready' || shotSetup.adjustment) return;
  scene.resetAimPointer();
  if (shotSetup.stage === 'aim') {
    const cue = state.balls[0], from = scene.tableToScreen(cue.x, cue.z), to = scene.tableToScreen(cue.x + Math.cos(aimAngle), cue.z + Math.sin(aimAngle));
    shotSetup.lockAim(aimAngle,x,y,to.x-from.x,to.y-from.y); setPower(shotSetup.power);
  } else { void shoot(shotSetup.shot()); return; }
  refreshShotSetup(); updateUI(true);
}
async function chalkCue() {
  if (!canAct() || state.phase !== 'ready' || state.chalked[state.turn]) return;
  await sound.unlock().catch(() => undefined);
  if (canAct() && state.phase === 'ready') await command({type:'chalk'},'Chalk is available before your shot.');
}
async function insertCoin() {
  if (coinResetting || anyDialog()) return;
  if (state.phase === 'rolling') return toast('Let the balls settle first.');
  if (!match.capabilities.canReset) return toast('Finish this rack with everyone connected to reset the table.');
  const current=match,seed=state.seed;
  cancelDrag();stopAI();coinResetting=true;inspectingTable=true;scene.setInspection(true);
  await sound.unlock().catch(()=>undefined);const duration=scene.animateCoinReset();sound.playMechanism('coin');updateUI(true);
  window.setTimeout(async()=>{
    try{if(match===current&&state.seed===seed)await command({type:'reset'},'The table cannot be reset yet.');}
    finally{coinResetting=false;updateUI(true);}
  },duration);
}
function renderCueLocker() {
  const owner=mode==='local'?activeSeat(state):seat,current=equippedCue(state,owner);
  const focused=document.activeElement as HTMLElement|null;
  if(focused?.dataset.cue)cueFocusRestore=focused.dataset.cue;
  $('cue-owner').textContent=`${seatName(owner)} · Level ${state.arcade?.level} · ${current.name}`;
  $('cue-collection').replaceChildren(...CUE_CATALOG.map(cue=>{
    const selected=current.id===cue.id,unlocked=canEquipCue(cue.id,state.arcade?.level),button=document.createElement('button');
    button.className='cue-card';button.dataset.cue=cue.id;button.setAttribute('aria-pressed',String(selected));button.disabled=!unlocked||!match.capabilities.canEquip||match.pending;
    button.style.setProperty('--cue-wood',cue.color);button.style.setProperty('--cue-accent',cue.accent);
    const stat=(name:string,value:number)=>`<span>${name}<b>${Math.round(value*100)}%</b><i style="--stat:${value/1.2*100}%"></i></span>`;
    button.innerHTML=`<i class="cue-swatch" aria-hidden="true"></i><div class="cue-card-title"><strong>${cue.name}</strong><span>${selected?'Equipped':unlocked?'Equip':`Level ${cue.unlockLevel}`}</span></div><small>${cue.wood} · ${cue.weightOz} oz</small><p>${cue.description}</p><div class="cue-stats">${stat('Power',cue.power)}${stat('Spin',cue.spin)}${stat('Curve',cue.curve)}</div>`;
    button.onclick=async()=>{if(await command({type:'equip',cue:cue.id},'This cue cannot be equipped yet.'))storage.set('cue',cue.id);renderCueLocker();};
    return button;
  }));
  if(cueFocusRestore&&!match.pending){const target=$('cue-collection').querySelector<HTMLButtonElement>(`[data-cue="${cueFocusRestore}"]`);if(target&&!target.disabled)target.focus();cueFocusRestore='';}
}
function openCueLocker(){openDialog('cue-dialog');renderCueLocker();}
function equipPreferredCue() {
  const preferred=storage.get('cue','ash-house');
  if(canEquipCue(preferred,state.arcade?.level)&&match.capabilities.canEquip)void command({type:'equip',cue:preferred as CueId},'This cue is not available at this table.');
}
function updateUI(force = false) {
  if (!state) return;
  const arcadeUI = state.arcade ? { ...state.arcade, clock: undefined } : undefined;
  const key = JSON.stringify([!!orbitPointer,keyboardOrbit,shotSetup.adjustment,shotSetup.stage,state.cues,state.chalked, coinResetting, state.phase, presentation?.phase, presentation?.shotCount, presentation ? activeSeat(presentation) : null, state.turn, state.format, state.teamOrder, state.groups, state.shotCount, state.message, state.balls.filter(b => b.pocketed).map(b => b.id), state.winner, arcadeUI, difficulty, mode, room?.players, connected, aiMessage, anyDialog(), match.pending, document.hidden]);
  if (!force && key === lastUI) return; lastUI = key;
  const viewModel=deriveTablePresentation(state,{mode,difficulty,room,connected,ready:!!bothConnected(),controlsTurn:myTurn(),canInteract:canAct(),aiThinking:aiMessage,shotStage:shotSetup.stage,adjustment:shotSetup.adjustment,resetting:coinResetting});
  for (const player of [0, 1]) {
    $(`name-${player}`).textContent = playerName(player);
    const roster = $(`roster-${player}`); roster.hidden = state.format !== 'doubles'; roster.replaceChildren();
    if (state.format === 'doubles') for (const member of [player, player + 2]) {
      const label = document.createElement('span'); label.className = 'roster-player'; label.textContent = seatName(member);
      const current = activeSeat(state) === member && state.phase !== 'over';
      label.classList.toggle('active', current); if (current) label.setAttribute('aria-current', 'true');
      label.title = `${seatName(member)}${current ? ' · Shooting' : ''}`; roster.append(label);
    }
    $(`player-${player}`).classList.toggle('active', state.turn === player && state.phase !== 'over');
    $(`turn-${player}`).hidden = state.turn !== player || state.phase === 'over';
    const group = state.groups[player];
    const ids = group === 'solids' ? [1,2,3,4,5,6,7] : group === 'stripes' ? [9,10,11,12,13,14,15] : [];
    $(`rack-${player}`).innerHTML = group ? ids.map(id => `<span class="mini-ball ${id > 8 ? 'stripe' : ''} ${state.balls[id].pocketed ? 'potted' : ''}" style="--ball:${BALL_COLORS[id]}" title="${id}${state.balls[id].pocketed ? ' · potted' : ''}"><span>${id}</span></span>`).join('') : Array.from({length:7}, () => '<span class="mini-ball unassigned"></span>').join('');
    $(`rack-${player}`).setAttribute('aria-label', group ? `${group}: ${ids.filter(id => state.balls[id].pocketed).length} potted` : 'Open table');
    $(`score-${player}`).textContent = Math.round(state.arcade?.scores[player] || 0).toLocaleString();
    $(`buffs-${player}`).innerHTML = viewModel.teams[player].pills.map(pill=>`<span class="buff-pill ${pill.className}" style="--effect-color:${pill.color}" title="${pill.title}" data-active="${pill.active}" data-queued="${pill.queued}">${icon(pill.icon,10)}</span>`).join('');
  }
  document.querySelector('.scoreboard')?.classList.toggle('doubles', state.format === 'doubles');
  renderInvite();if($<HTMLDialogElement>('cue-dialog').open)renderCueLocker();
  $('avatar-0').textContent = mode === 'ai' ? 'Y' : playerName(0).charAt(0).toUpperCase();
  $('avatar-1').innerHTML = mode === 'ai' ? icon('cue',23) : '';
  if (mode !== 'ai') $('avatar-1').textContent = playerName(1).charAt(0).toUpperCase();
  for (const m of ['ai','online','local']) { $(`mode-${m}`).classList.toggle('selected', mode === m); $(`mode-${m}`).setAttribute('aria-pressed', String(mode === m)); }
  $<HTMLSelectElement>('difficulty').disabled = mode !== 'ai';
  $<HTMLSelectElement>('layout').disabled = mode === 'online';
  $<HTMLSelectElement>('layout').value = state.arcade?.layout || layout;
  $('level-badge').textContent = `LV ${state.arcade?.level || 1}`;
  $('level-badge').title = levelNames[(state.arcade?.level || 1) - 1];
  $('portal-badge').hidden = !state.arcade?.portalTurns;
  $('portal-badge').textContent = `◎ ${state.arcade?.portalTurns || 0}`;
  $('status-text').textContent = viewModel.status.text;
  $<HTMLButtonElement>('chalk-button').disabled = !canAct() || state.phase !== 'ready' || !!state.chalked?.[state.turn];
  $('chalk-button').setAttribute('aria-pressed', String(!!state.chalked?.[state.turn]));
  $('table-view').setAttribute('aria-pressed', String(inspectingTable));
  $('shoot-button').setAttribute('aria-label', shotSetup.stage === 'aim' ? 'Lock aim' : 'Take shot');
  refreshShotSetup();
  $('shot-status').classList.toggle('foul', viewModel.status.foul);
  $('shot-status').classList.toggle('waiting', viewModel.status.waiting);
  $<HTMLButtonElement>('shoot-button').disabled = state.phase !== 'ready' || !canAct() || !!shotSetup.adjustment;
  $<HTMLInputElement>('power').disabled = state.phase !== 'ready' || !canAct() || shotSetup.stage !== 'power';
  if (state.phase === 'over') saveResult();
  if (state.phase === 'over' && presentation.phase === 'over') {
    const key = `${state.seed}:${state.shotCount}:${state.winner}`;
    if (key !== resultKey && !$<HTMLDialogElement>('main-menu').open) {
      resultKey = key;
      $('result-title').textContent = mode === 'ai' ? state.winner === 0 ? 'The table is yours.' : 'The house takes this one.' : `${playerName(state.winner!)} takes the rack.`;
      $('result-message').textContent = state.message;
      $('next-level-button').hidden = !canAdvance();
      $('next-level-button').textContent = `Level ${(state.arcade?.level || 1) + 1} →`;
      $('rematch-button').innerHTML = `Replay level ${state.arcade?.level || 1} ${icon('reset',17)}`;
      openDialog('result-dialog');
    }
  }
}
function newGame(nextMode:Mode=mode,nextFormat:GameFormat=state?.format??menuFormat) {
  if(nextMode==='online')return;
  sessionIntent++;
  installMatch(new LocalMatch({seed:createIdentity().slice(0,8),mode:nextMode,difficulty,options:{layout,level,format:nextFormat}}));
  initialized=true;stopAI();aimAngle=0;scene.aim.angle=0;resultKey='';
  cancelDrag();setPower(.65);updateUI(true);equipPreferredCue();
}
async function shoot(shot:Shot=shotSetup.shot()) {
  if(!canAct()||state.phase!=='ready')return;
  await sound.unlock().catch(()=>undefined);
  if(!canAct()||state.phase!=='ready')return;
  cancelDrag();await command({type:'shoot',shot},'That shot could not be played.');
}
async function place(point:{x:number;z:number}) {
  if(!canAct()||state.phase!=='ball-in-hand')return;
  void sound.unlock();await command({type:'place',...point},'Place the cue ball on clear felt.');
}
async function enterRoom(create:boolean) {
  if(isConnecting)return;
  const name=$<HTMLInputElement>('player-name').value.trim()||'Player';
  const code=$<HTMLInputElement>('room-code').value.trim().toUpperCase();
  if(!create&&!/^[A-Z0-9]{6}$/.test(code)){$('room-error').textContent='Enter a six-character room code.';return;}
  isConnecting=true;$('room-error').textContent='';
  const intent=++sessionIntent;
  $<HTMLButtonElement>('create-room').disabled=true;$<HTMLButtonElement>('join-room').disabled=true;
  const candidate=new RemoteMatch({identity:{token:identity,name}});
  try{
    const result=create?await candidate.create({layout,level,format:$<HTMLSelectElement>('room-format').value==='doubles'?'doubles':'singles'}):await candidate.join(code);
    if(intent!==sessionIntent){candidate.dispose();return;}
    if(!result.ok)throw new Error(result.error||'Could not open the table.');
    storage.set('name',name);hasStarted=true;installMatch(candidate);resultKey='';aimAngle=0;scene.aim.angle=0;cancelDrag();
    closeDialog('main-menu');closeDialog('room-dialog');$('invite-code').textContent=room!.code;void sound.unlock();
    if(create||!bothConnected())openDialog('invite-dialog');else toast('You’re in.');
    if(state.cues[seat]==='ash-house')equipPreferredCue();
    updateUI(true);
  }catch(error){candidate.dispose();if(intent===sessionIntent)$('room-error').textContent=error instanceof Error?error.message:'Could not open the table.';}
  finally{isConnecting=false;$<HTMLButtonElement>('create-room').disabled=false;$<HTMLButtonElement>('join-room').disabled=false;}
}
async function copy(text: string, message: string) {
  try { await navigator.clipboard.writeText(text); toast(message); } catch {
    const area = document.createElement('textarea'); area.value = text; (document.querySelector('dialog[open]') || document.body).append(area); area.select();
    const success = document.execCommand('copy'); area.remove(); toast(success ? message : `Copy this: ${text}`);
  }
}
function setupUI() {
  document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(button => button.onclick = () => button.closest('dialog')!.close());
  document.querySelectorAll<HTMLDialogElement>('dialog').forEach(dialog => {
    dialog.addEventListener('click', event => { if (dialog.id !== 'main-menu' && event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
    dialog.addEventListener('close', () => updateUI(true));
  });
  $('help-button').onclick = () => openDialog('rules-dialog');
  $('play-nav').onclick = showMainMenu;
  $<HTMLDialogElement>('main-menu').addEventListener('cancel', event => { if (!hasStarted) event.preventDefault(); });
  $('menu-resume').onclick = () => closeDialog('main-menu');
  const startFromMenu = (nextMode: Mode) => { hasStarted = true; newGame(nextMode, menuFormat); closeDialog('main-menu'); };
  renderLevels(); refreshMenuFormat();
  $('menu-format').onchange = () => { menuFormat = $<HTMLSelectElement>('menu-format').value === 'doubles' ? 'doubles' : 'singles'; storage.set('format', menuFormat); refreshMenuFormat(); };
  $('menu-level').onchange = () => { level = Math.min(unlockedLevel, parseLevel($<HTMLSelectElement>('menu-level').value)); storage.set('level', String(level)); };
  const openLobby = () => { if (mode === 'online' && room && menuFormat === state.format) { $('invite-code').textContent = room.code; openDialog('invite-dialog'); } else { $<HTMLSelectElement>('room-format').value = menuFormat; openDialog('room-dialog'); } };
  $('menu-begin').onclick = () => { setMenuPanel(true); selectMenuMode(menuMode); $('menu-session-start').focus(); };
  $('menu-back').onclick = () => { setMenuPanel(false); $('menu-begin').focus(); };
  $('menu-start').onclick = () => selectMenuMode('ai');
  $('menu-local').onclick = () => selectMenuMode('local');
  $('menu-online').onclick = () => selectMenuMode('online');
  $('menu-lobby').onclick = openLobby;
  $('menu-session-start').onclick = () => { if (menuMode === 'online') openLobby(); else startFromMenu(menuMode); };
  $('menu-difficulty').onchange = () => { difficulty = $<HTMLSelectElement>('menu-difficulty').value as Difficulty; $<HTMLSelectElement>('difficulty').value = difficulty; storage.set('difficulty', difficulty); match.setDifficulty(difficulty); stopAI(); updateUI(true); };
  const resolutionNote = () => { const perf=scene.getPerformance();$('resolution-note').textContent = `${Math.round(perf.fps)} FPS · ${perf.width} × ${perf.height} · ${perf.tier}. ${perf.gpuMs!==null?`GPU ${perf.gpuMs.toFixed(1)} ms · `:''}${perf.drawCalls} draws. Auto adjusts effects and resolution for smooth play.`; };
  window.setInterval(()=>{if($<HTMLDialogElement>('settings-dialog').open)resolutionNote();},1000);
  $('settings-button').onclick = () => { resolutionNote(); openDialog('settings-dialog'); };
  $('menu-settings').onclick = $('settings-button').onclick;
  const updateSound = () => { $('sound-toggle').innerHTML = icon(sound.enabled ? 'sound' : 'mute'); $('sound-toggle').setAttribute('aria-label', sound.enabled ? 'Mute sound' : 'Enable sound'); $('sound-toggle').setAttribute('aria-pressed', String(sound.enabled)); };
  $('sound-toggle').onclick = () => { sound.enabled = !sound.enabled; if (sound.enabled) sound.unlock(); storage.set('sound', String(sound.enabled)); updateSound(); };
  updateSound();
  $('fullscreen').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { toast('Fullscreen is unavailable in this view.'); } };
  document.addEventListener('fullscreenchange', () => $('fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'));
  $<HTMLInputElement>('volume').value = String(sound.volume * 100);
  $('volume').oninput = () => { sound.volume = Number($<HTMLInputElement>('volume').value) / 100; storage.set('volume', String(sound.volume)); sound.unlock(); };
  $('preview-audio').onclick = () => sound.preview();
  // Migrate the former forced-High default once; later manual choices persist.
  const savedQuality = storage.get('quality-policy','')==='adaptive-v1'?storage.get('quality','auto') as Quality:'auto';
  storage.set('quality-policy','adaptive-v1');storage.set('quality',savedQuality);
  if (['auto','high','ultra','performance'].includes(savedQuality)) { $<HTMLSelectElement>('quality').value = savedQuality; scene.setQuality(savedQuality); }
  $('quality').onchange = () => { const q = $<HTMLSelectElement>('quality').value as Quality; scene.setQuality(q); storage.set('quality', q); resolutionNote(); };
  chooseCamera(storage.get('camera','angled')==='overhead');
  $('camera').onchange=()=>chooseCamera($<HTMLSelectElement>('camera').value==='overhead');
  $('camera-toggle').onclick=()=>chooseCamera($<HTMLSelectElement>('camera').value!=='overhead');
  $('fps-view').onclick=()=>chooseCamera(false);
  $('reset-view').onclick=()=>{scene.setFPSView();chooseCamera(false);};
  $('spin-button').onclick=()=>setAdjustment(shotSetup.adjustment==='spin'?null:'spin');
  $('elevation-button').onclick=()=>setAdjustment(shotSetup.adjustment==='elevation'?null:'elevation');
  $('cue-locker-button').onclick=openCueLocker;
  $('aim-guide').onchange = () => { scene.aim.visible = $<HTMLInputElement>('aim-guide').checked; };
  $('layout').onchange = () => {
    if (mode === 'online') return;
    layout = $<HTMLSelectElement>('layout').value as ArenaLayout; storage.set('layout', layout); newGame(); closeDialog('settings-dialog'); toast(LAYOUTS[layout].name);
  };
  $('power').oninput = () => setPower(Number($<HTMLInputElement>('power').value) / 100);
  $('shoot-button').onclick = () => advanceShotSetup();
  $('chalk-button').onclick = () => void chalkCue();
  $('coin-button').onclick = () => void insertCoin();
  $('table-view').onclick = () => { cancelDrag(); inspectingTable = !inspectingTable; scene.setInspection(inspectingTable); updateUI(true); };
  $('cue-angle').oninput = () => { shotSetup.setElevation(Number($<HTMLInputElement>('cue-angle').value) * Math.PI / 180); refreshShotSetup(); };
  $('tip-center').onclick = () => { shotSetup.setTip(0, 0); refreshShotSetup(); };
  $('reset-button').onclick = () => { if (!match.capabilities.canReset) return toast('Finish this rack with everyone connected to reset the table.'); if (match.capabilities.canRematch) return openDialog('result-dialog'); openDialog('reset-dialog'); };
  $('confirm-reset').onclick = async () => { if(await command({type:'reset'},'The table cannot be reset yet.')){closeDialog('reset-dialog');toast('Fresh rack.');} };
  $('next-level-button').onclick = async () => {
    if (!canAdvance()) return;
    if(await command({type:'advance'},'This level cannot advance yet.'))closeDialog('result-dialog');
  };
  $('rematch-button').onclick = async () => {
    if(await command({type:'rematch'},'The rack cannot restart yet.'))closeDialog('result-dialog');
  };
  $('mode-ai').onclick = () => { if (mode !== 'ai') newGame('ai'); };
  $('mode-local').onclick = () => { if (mode !== 'local') newGame('local'); };
  $('mode-online').onclick = () => { if (mode === 'online' && room) { $('invite-code').textContent = room.code; openDialog('invite-dialog'); } else { $<HTMLSelectElement>('room-format').value = menuFormat; openDialog('room-dialog'); } };
  $<HTMLSelectElement>('difficulty').value = difficulty;
  $('difficulty').onchange = () => { difficulty = $<HTMLSelectElement>('difficulty').value as Difficulty; $<HTMLSelectElement>('menu-difficulty').value = difficulty; storage.set('difficulty', difficulty); match.setDifficulty(difficulty); stopAI(); updateUI(true); };
  $<HTMLInputElement>('player-name').value = storage.get('name', 'Player');
  $('create-room').onclick = () => void enterRoom(true); $('join-room').onclick = () => void enterRoom(false);
  $('room-code').oninput = () => { $<HTMLInputElement>('room-code').value = $<HTMLInputElement>('room-code').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
  $('room-code').onkeydown = event => { if (event.key === 'Enter') void enterRoom(false); };
  $('copy-code').onclick = () => { if (room) void copy(room.code, 'Room code copied.'); };
  $('copy-link').onclick = () => { if (room) { const url = new URL(location.href); url.search = ''; url.searchParams.set('room', room.code); void copy(url.href, 'Invitation link copied.'); } };
}
function setupInput() {
  const canvas = scene.renderer.domElement;
  const releaseShotPointer = () => {
    const pointer=activePointer; activePointer=null;
    if(pointer!==null&&canvas.hasPointerCapture(pointer))canvas.releasePointerCapture(pointer);
  };
  const beginLook = () => {
    releaseShotPointer(); shotSetup.endAdjustment(lastPointer.x,lastPointer.y);
    scene.beginOrbit(); scene.resetAimPointer();
  };
  const beginPointerOrbit = (event:PointerEvent) => {
    if(!initialized||anyDialog()||coinResetting||!event.isPrimary)return false;
    beginLook(); orbitPointer={id:event.pointerId,x:event.clientX,y:event.clientY};
    canvas.setPointerCapture(event.pointerId);canvas.style.cursor='grabbing';updateUI(true);return true;
  };
  const moveAim = (x:number,y:number,fine=false) => {
    const angle=scene.aimAtScreen(x,y,state.balls[0]);
    if(angle!==null){const delta=Math.atan2(Math.sin(angle-aimAngle),Math.cos(angle-aimAngle));aimAngle+=delta*(fine?.2:1);}
    scene.aim.angle=aimAngle;
  };
  canvas.addEventListener('pointerenter',event=>{
    lastPointer={x:event.clientX,y:event.clientY};scene.resetAimPointer();
    if(shotSetup.adjustment)shotSetup.beginAdjustment(shotSetup.adjustment,event.clientX,event.clientY);
    else shotSetup.reanchorPower(event.clientX,event.clientY);
  });
  canvas.addEventListener('pointerleave',()=>scene.resetAimPointer());
  canvas.addEventListener('pointermove',event=>{
    const dx=event.clientX-lastPointer.x,dy=event.clientY-lastPointer.y;
    lastPointer={x:event.clientX,y:event.clientY};
    if(event.buttons&2){
      if(!orbitPointer&&!beginPointerOrbit(event))return;
      if(orbitPointer?.id===event.pointerId){scene.orbitBy(event.clientX-orbitPointer.x,event.clientY-orbitPointer.y);orbitPointer.x=event.clientX;orbitPointer.y=event.clientY;}
      return;
    }
    if(orbitPointer){endOrbit();updateUI(true);return;}
    if(keyboardOrbit){scene.orbitBy(dx,dy);return;}
    if(!canAct()||activePointer!==null&&activePointer!==event.pointerId)return;
    if(state.phase==='ball-in-hand'){scene.showPlacement(scene.screenToTable(event.clientX,event.clientY));return;}
    if(state.phase!=='ready')return;
    if(shotSetup.adjustment)shotSetup.moveAdjustment(event.clientX,event.clientY,event.shiftKey);
    else if(shotSetup.stage==='aim')moveAim(event.clientX,event.clientY,event.shiftKey);
    else{shotSetup.pull(event.clientX,event.clientY,Math.min(180,canvas.clientWidth*.3));setPower(shotSetup.power);}
    refreshShotSetup();
  });
  canvas.addEventListener('pointerdown',event=>{
    if(event.button===2){event.preventDefault();beginPointerOrbit(event);return;}
    if(orbitPointer||keyboardOrbit||shotSetup.adjustment)return;
    if(event.button!==0||activePointer!==null||!event.isPrimary||anyDialog())return;
    const control=scene.hitTableControl(event.clientX,event.clientY);
    if(control){if(control==='coin')void insertCoin();else void chalkCue();return;}
    if(!canAct())return;
    void sound.unlock();lastPointer={x:event.clientX,y:event.clientY};
    if(state.phase==='ball-in-hand'){const point=scene.screenToTable(event.clientX,event.clientY);if(point)void place(point);return;}
    if(state.phase!=='ready')return;
    if(shotSetup.stage==='aim')moveAim(event.clientX,event.clientY,event.shiftKey);
    activePointer=event.pointerId;canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointerup',event=>{
    if(orbitPointer?.id===event.pointerId&&event.button===2){endOrbit();updateUI(true);return;}
    if(event.button!==0||activePointer!==event.pointerId)return;
    releaseShotPointer();advanceShotSetup(event.clientX,event.clientY);
  });
  canvas.addEventListener('pointercancel',cancelDrag);
  canvas.addEventListener('lostpointercapture',event=>{
    if(activePointer===event.pointerId)activePointer=null;
    if(orbitPointer?.id===event.pointerId){endOrbit();updateUI(true);}
  });
  canvas.addEventListener('contextmenu',event=>event.preventDefault());
  const tip=$('tip-control');let tipPointer:number|null=null;
  const chooseTip=(event:PointerEvent)=>{
    const rect=tip.getBoundingClientRect();shotSetup.setTip((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);refreshShotSetup();
  };
  tip.onpointerdown=event=>{if(!canAct()||event.button!==0)return;tipPointer=event.pointerId;tip.setPointerCapture(event.pointerId);chooseTip(event);};
  tip.onpointermove=event=>{if(tipPointer===event.pointerId)chooseTip(event);};
  tip.onpointerup=event=>{if(tipPointer===event.pointerId){chooseTip(event);tipPointer=null;tip.releasePointerCapture(event.pointerId);}};
  tip.onpointercancel=()=>{tipPointer=null;};
  tip.onkeydown=event=>{
    const deltas:Record<string,[number,number]>={ArrowLeft:[-.08,0],ArrowRight:[.08,0],ArrowUp:[0,.08],ArrowDown:[0,-.08]};
    if(!deltas[event.key]||!canAct())return;event.preventDefault();event.stopPropagation();
    const[x,y]=deltas[event.key];shotSetup.setTip(shotSetup.tipX+x,shotSetup.tipY+y);refreshShotSetup();
  };
  window.addEventListener('blur',()=>{cancelDrag();stopAI();});
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){cancelDrag();stopAI();sound.updateRolling([]);}
    match.update(0,{aiPaused:document.hidden,muted:document.hidden});updateUI(true);
  });
  const typing=(target:EventTarget|null)=>target instanceof HTMLElement&&(target.isContentEditable||/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName));
  window.addEventListener('keydown',event=>{
    if(event.key==='Escape'){cancelDrag();updateUI(true);return;}
    if(!initialized||typing(event.target)||anyDialog()||coinResetting)return;
    const code=event.code;
    if(code==='KeyF'||code==='KeyV'){event.preventDefault();if(!event.repeat)chooseCamera(code==='KeyV'&&$<HTMLSelectElement>('camera').value!=='overhead');return;}
    if(code==='KeyB'){event.preventDefault();if(!event.repeat)openCueLocker();return;}
    if(code==='KeyR'){
      event.preventDefault();if(!keyboardOrbit){beginLook();keyboardOrbit=true;heldKeys.add(code);updateUI(true);}return;
    }
    if(keyboardOrbit){if(code.startsWith('Arrow')){event.preventDefault();heldKeys.add(code);}return;}
    if(!canAct()||state.phase!=='ready')return;
    if(code==='KeyS'||code==='KeyE'){
      event.preventDefault();if(!event.repeat){heldKeys.add(code);setAdjustment(code==='KeyS'?'spin':'elevation');}return;
    }
    if(code==='KeyC'){event.preventDefault();if(!event.repeat)void chalkCue();return;}
    if(code==='KeyX'){event.preventDefault();shotSetup.resetStrike();if(shotSetup.adjustment)shotSetup.beginAdjustment(shotSetup.adjustment,lastPointer.x,lastPointer.y);refreshShotSetup();return;}
    if(code==='Space'){
      if(event.target instanceof HTMLButtonElement)return;
      event.preventDefault();if(!event.repeat)advanceShotSetup();return;
    }
    if(!code.startsWith('Arrow'))return;event.preventDefault();
    const direction=code==='ArrowUp'||code==='ArrowRight'?1:-1,fine=event.shiftKey?.2:1;
    if(shotSetup.adjustment==='spin'){
      shotSetup.setTip(shotSetup.tipX+(code==='ArrowLeft'||code==='ArrowRight'?direction*.06*fine:0),shotSetup.tipY+(code==='ArrowUp'||code==='ArrowDown'?direction*.06*fine:0));
    }else if(shotSetup.adjustment==='elevation')shotSetup.setElevation(shotSetup.elevation+direction*Math.PI/180*fine);
    else if(shotSetup.stage==='aim'&&(code==='ArrowLeft'||code==='ArrowRight')){aimAngle+=direction*.012*fine;scene.aim.angle=aimAngle;}
    else if(shotSetup.stage==='power'&&(code==='ArrowUp'||code==='ArrowDown')){setPower(power+direction*.03*fine);shotSetup.reanchorPower(lastPointer.x,lastPointer.y);}
    if(shotSetup.adjustment)shotSetup.beginAdjustment(shotSetup.adjustment,lastPointer.x,lastPointer.y);
    refreshShotSetup();
  });
  window.addEventListener('keyup',event=>{
    heldKeys.delete(event.code);
    if(event.code==='KeyR'&&keyboardOrbit){keyboardOrbit=false;if(!orbitPointer)endOrbit();updateUI(true);}
    if(event.code==='KeyS'&&shotSetup.adjustment==='spin'||event.code==='KeyE'&&shotSetup.adjustment==='elevation')setAdjustment(heldKeys.has('KeyS')?'spin':heldKeys.has('KeyE')?'elevation':null);
  });
}
let previous=performance.now();
function frame(now:number) {
  const elapsed=Math.max(0,(now-previous)/1000),dt=Math.min(elapsed,.06);previous=now;
  match.update(elapsed,{aiPaused:coinResetting||anyDialog()||document.hidden,muted:document.hidden||elapsed>.5,aiCameraReady:scene.isAIViewReady()});
  syncMatch();
  const events=match.drainEvents();if(!document.hidden&&elapsed<=.5)for(const event of events)playEvent(event);
  if(keyboardOrbit)scene.rotateView(((heldKeys.has('ArrowRight')?1:0)-(heldKeys.has('ArrowLeft')?1:0))*dt,((heldKeys.has('ArrowUp')?1:0)-(heldKeys.has('ArrowDown')?1:0))*dt*.65);
  scene.update(presentation,dt,canAct());
  sound.updateRolling(document.hidden?[]:presentation.balls);updateUI();requestAnimationFrame(frame);
}
async function boot() {
  try {
    void sound.prepare().catch(error => console.warn('Audio is unavailable:', error));
    await initPhysics();
    scene = new PoolScene($('scene'), lost => {
      if (lost) { cancelDrag(); $('loading').classList.remove('done'); $('loading').querySelector('h2')!.textContent = 'Restoring the table.'; $('loading').querySelector('p')!.textContent = 'Graphics were interrupted. Your game is still here.'; }
      else $('loading').classList.add('done');
    });
    newGame('ai'); setupUI(); setupInput();
    $('loading').classList.add('done'); showMainMenu(); previous = performance.now(); requestAnimationFrame(frame);
    const invitation = new URL(location.href).searchParams.get('room');
    if (invitation) { $<HTMLInputElement>('room-code').value = invitation.slice(0,6).toUpperCase(); openDialog('room-dialog'); }
    Object.defineProperty(window, '__POOL__', { value: { snapshot: () => structuredClone(state), project: (x: number, z: number) => scene.tableToScreen(x,z), resolution: () => scene.getResolution(), mode: () => mode, seat: () => seat, audio: () => sound.diagnostics(), performance:()=>scene.getPerformance() }, writable: false });
  } catch (error) {
    console.error('Could not open the club:', error);
    const message = error instanceof Error ? error.message : String(error);
    const graphicsError = /WebGL|WebGLRenderingContext|Error creating WebGL context/i.test(message);
    $('loading').classList.remove('done'); $('loading').classList.add('error');
    $('loading').querySelector('h2')!.textContent = graphicsError ? 'Graphics could not start.' : 'Could not start the game.';
    $('loading').querySelector('p')!.textContent = graphicsError ? 'Enable WebGL 2 and hardware acceleration, then reload.' : message;
  }
}
void boot();
