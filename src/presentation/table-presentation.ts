import { activeSeat, legalTargets, seatCount, type Difficulty, type GameState, type Mode, type StatusEffect } from '../simulation/types';
import { EFFECTS, STATUS_IDS, type EffectId } from './effects';

export interface TableViewer {
  mode: Mode;
  difficulty: Difficulty;
  controlsTurn: boolean;
  canInteract: boolean;
  connected?: boolean;
  ready?: boolean;
  room?: {code:string;players:readonly {name:string;connected:boolean}[]} | null;
  aiThinking?: boolean;
  shotStage?: 'aim' | 'power';
  adjustment?: 'spin' | 'elevation' | null;
  resetting?: boolean;
}
export interface EffectPill {
  id: EffectId; title:string; icon:string; color:string; className:string;
  active:boolean; queued:boolean;
}
export const AI_NAMES:Readonly<Record<Difficulty,string>> = {casual:'The Newcomer',regular:'The Regular',expert:'The Hustler'};
export function seatLabel(state:GameState,viewer:Pick<TableViewer,'mode'|'difficulty'|'room'>,seat:number):string {
  if(viewer.mode==='ai')return seat===0?'You':seat===2?'AI Partner':state.format==='doubles'?`${AI_NAMES[viewer.difficulty]} ${seat===1?'A':'B'}`:AI_NAMES[viewer.difficulty];
  return viewer.mode==='local'?`Player ${seat+1}`:viewer.room?.players[seat]?.name || 'Seat open';
}
export function teamLabel(state:GameState,viewer:Pick<TableViewer,'mode'|'difficulty'|'room'>,team:number):string {
  return state.format==='doubles' ? viewer.mode==='ai' ? team===0?'Your team':'House team' : `Team ${team+1}` : seatLabel(state,viewer,team);
}

/** Queued awards never masquerade as effects on the shot that collected them. */
export function deriveTableEffects(state:GameState) {
  const teams=([0,1] as const).map(team=>{
    const shooting=state.phase==='rolling'&&state.turn===team;
    const preparing=state.phase!=='rolling'&&state.phase!=='over'&&state.turn===team;
    const shot=shooting?state.arcade?.activeShot:undefined;
    const queued=Object.fromEntries(STATUS_IDS.map(id=>[id,!!state.arcade?.buffs[team][id]])) as Record<StatusEffect,boolean>;
    const active=Object.fromEntries(STATUS_IDS.map(id=>[id,shooting ? id!=='jammed'&&!!shot?.[id] : preparing&&queued[id]])) as Record<StatusEffect,boolean>;
    const pills:EffectPill[]=[];
    const append=(id:EffectId,on:boolean,next:boolean)=>{
      const definition=EFFECTS[id];
      const suffix=shooting&&next ? on?' · Active; next shot queued':' · Next shot' : !on&&next?' · Next shot':'';
      pills.push({id,title:definition.name+suffix,icon:definition.icon,color:definition.color,className:definition.className,active:on,queued:next});
    };
    if(state.chalked[team]||shot?.chalked)append('chalked',!!shot?.chalked||preparing&&state.chalked[team],state.chalked[team]);
    for(const id of STATUS_IDS)if(active[id]||queued[id])append(id,active[id],queued[id]);
    return {active,queued,pills};
  });
  const active=teams[state.turn].active;
  const haloEffect=(['frozen','sticky','overdrive','focus','ward'] as const).find(id=>active[id]);
  return {
    teams, cue:active,
    halo:haloEffect?{id:haloEffect,color:EFFECTS[haloEffect].color}:null,
    trail:state.phase==='rolling' ? active.frozen?'ice':active.overdrive?'fire':null : null,
    guideVisible:!active.jammed,
  };
}

/** Presentation priorities are independent of DOM, Three.js and transport. */
export function deriveTablePresentation(state:GameState,viewer:TableViewer) {
  const effects=deriveTableEffects(state),actor=seatLabel(state,viewer,activeSeat(state));
  const waiting=viewer.mode==='online'&&!viewer.ready;
  let text='Your shot';
  if(viewer.resetting)text='Racking up';
  else if(waiting)text=!viewer.connected?'Reconnecting…':(viewer.room?.players.length||0)<seatCount(state.format)?`Room ${viewer.room?.code||'—'} · ${viewer.room?.players.length||0}/${seatCount(state.format)} players`:'Player disconnected';
  else if(state.phase==='rolling')text='Rolling';
  else if(state.phase==='over')text=`${teamLabel(state,viewer,state.winner!)} ${viewer.mode==='ai'&&state.winner===0&&state.format==='singles'?'win':'wins'}`;
  else if(viewer.aiThinking)text=`${actor} · Aiming`;
  else if(state.phase==='ball-in-hand')text=viewer.controlsTurn?'Ball in hand':`${actor} · Ball in hand`;
  else if(viewer.canInteract)text=viewer.adjustment==='spin'?'Cue contact':viewer.adjustment==='elevation'?'Cue elevation':viewer.shotStage==='power'?'2 · Pull back & shoot':'1 · Aim';
  else if(state.shotCount===0)text=viewer.controlsTurn?'Your break':`${actor} · Break`;
  else if(!viewer.controlsTurn)text=`${actor}’s shot`;
  else if(state.groups[state.turn]&&legalTargets(state).every(ball=>ball.id===8))text='Eight ball';
  if(!viewer.resetting&&!waiting&&state.format==='doubles'&&viewer.mode==='local'&&state.phase!=='over'&&state.phase!=='rolling')text=`${actor} · ${text}`;
  return {
    status:{text,waiting:waiting||state.phase==='rolling'||!!viewer.aiThinking,foul:state.phase==='ball-in-hand'},
    effects,
    teams:([0,1] as const).map(team=>({name:teamLabel(state,viewer,team),pills:effects.teams[team].pills})),
  };
}
