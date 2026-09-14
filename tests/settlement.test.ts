import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createArcade } from '../src/simulation/arcade';
import { settleShot } from '../src/simulation/settlement';
import { initialState, legalTargets, type GameState, type ShotResult } from '../src/simulation/types';

const result=(changes:Partial<ShotResult>={}):ShotResult=>({firstContact:1,potted:[],railAfterContact:true,breakRails:[1,2,3,4],...changes});
function arranged(seed='settlement'):GameState {
  const state=initialState(seed);state.arcade=createArcade('crossfire',seed);state.shotCount=1;state.groups=['solids','stripes'];return state;
}
const settle=(state:GameState,shot:Partial<ShotResult>={},shooter:0|1=0,pendingPortal=false)=>settleShot(state,result(shot),{legalBefore:legalTargets(state,shooter).map(b=>b.id),shooter,pendingPortal});

test('settlement is pure and a legal own-group count drives score, combo, streak and doubles retention',()=>{
  const state=arranged();state.format='doubles';state.arcade!.potStreak[0]=3;
  const shot=result({potted:[1,2,9]}),before=structuredClone({state,shot});
  const outcome=settleShot(state,shot,{legalBefore:[1,2,3],shooter:0});
  assert.deepEqual({state,shot},before);
  assert.equal(outcome.outcome.ownPotted,2);assert.equal(outcome.outcome.opponentPotted,1);
  assert.equal(outcome.state.turn,0);assert.deepEqual(outcome.state.teamOrder,[1,0]);
  assert.equal(outcome.state.arcade!.scores[0],225);assert.equal(outcome.state.arcade!.combo,2);assert.equal(outcome.state.arcade!.potStreak[0],5);
  assert.deepEqual(outcome.events.map(e=>e.reason),['mixed-pot','pot-streak']);
  assert.deepEqual(settleShot(state,shot,{legalBefore:[1,2,3],shooter:0}),outcome,'seeded decisions replay identically');
});

test('groups stay open on the break and the first subsequent legal pot assigns complementary groups',()=>{
  let state=initialState('open-groups');
  state=settle(state,{potted:[2]}).state;assert.deepEqual(state.groups,[null,null]);assert.equal(state.turn,0);
  state=settle(state,{firstContact:9,potted:[9]}).state;assert.deepEqual(state.groups,['stripes','solids']);assert.equal(state.turn,0);
});

test('foul table covers contact, rail, scratch, illegal break and off-table outcomes without pot points',()=>{
  const cases:Partial<ShotResult>[]=[{firstContact:null},{firstContact:9},{railAfterContact:false},{potted:[0,1]},{offTable:[2],potted:[1]}];
  for(const shot of cases){
    const state=arranged();state.format='doubles';state.arcade!.potStreak[0]=4;
    const outcome=settle(state,shot);
    assert.equal(outcome.state.foul,true);assert.equal(outcome.state.turn,1);assert.equal(outcome.state.phase,'ball-in-hand');
    assert.deepEqual(outcome.state.teamOrder,[1,0]);assert.equal(outcome.state.arcade!.scores[0],0);assert.equal(outcome.state.arcade!.potStreak[0],0);
    if(shot.offTable) {assert.ok(outcome.respots.some(p=>p.id===2));assert.equal(outcome.state.balls[2].pocketed,false);assert.deepEqual(outcome.state.lastPotted,[1]);}
  }
  const state=initialState('illegal-break');assert.equal(settle(state,{breakRails:[1]}).state.foul,true);
  const arcade=arranged();arcade.shotCount=0;
  assert.equal(settle(arcade,{firstContact:null,breakRails:[],railAfterContact:false,obstacleContact:true}).state.foul,false);
});

test('ward rescue resets comeback scratches; eight and off-table fouls bypass ward',()=>{
  const state=arranged();state.arcade!.activeShot.ward=true;state.arcade!.scratchStreak[0]=1;
  const saved=settle(state,{potted:[0]});
  assert.equal(saved.outcome.wardRescued,true);assert.equal(saved.outcome.scratched,false);assert.equal(saved.state.foul,false);
  assert.equal(saved.state.arcade!.scratchStreak[0],0);assert.equal(saved.state.balls[0].pocketed,false);assert.ok(saved.respots.some(p=>p.id===0));
  assert.equal(saved.events.some(e=>e.reason==='scratch-streak'),false);
  for(const shot of [{potted:[0,8]},{potted:[0],offTable:[2]},{offTable:[0]}]){
    const lost=settle(state,shot);assert.equal(lost.outcome.wardRescued,false);assert.equal(lost.outcome.scratched,true);assert.equal(lost.state.foul,true);
  }
});

test('comeback awards require consecutive scratches by the same team and reset independently',()=>{
  let state=arranged();
  state=settle(state,{potted:[0]},0).state;
  state=settle(state,{potted:[0],firstContact:9},1).state;
  assert.deepEqual(state.arcade!.scratchStreak,[1,1]);
  const comeback=settle(state,{potted:[0]},0);
  assert.deepEqual(comeback.state.arcade!.scratchStreak,[2,1]);
  const event=comeback.events.find(e=>e.reason==='scratch-streak')!;assert.ok(event);assert.ok(['overdrive','ward','focus'].includes(event.status!));
  assert.equal(comeback.state.arcade!.buffs[0][event.status!],1);
  assert.deepEqual(settle(comeback.state,{},0).state.arcade!.scratchStreak,[0,1]);
});

test('five-ball streak penalty triggers only on crossing, and a miss resets eligibility',()=>{
  const state=arranged();state.arcade!.potStreak[0]=4;
  const crossing=settle(state,{potted:[1]});assert.equal(crossing.events.filter(e=>e.reason==='pot-streak').length,1);
  const continuing=settle(crossing.state,{firstContact:2,potted:[2]});assert.equal(continuing.events.filter(e=>e.reason==='pot-streak').length,0);
  const missed=settle(continuing.state,{firstContact:3});assert.equal(missed.state.arcade!.potStreak[0],0);
  const fresh=arranged();fresh.arcade!.potStreak[0]=0;
  assert.equal(settle(fresh,{potted:[1,2,3,4,5]}).events.filter(e=>e.reason==='pot-streak').length,1);
});

test('eight outcomes include legal wins, early eight, scratch, off-table, and break respots',()=>{
  for(const [potted,offTable,legal,winner] of [[[8],[],[8],0],[[8],[],[1,2],1],[[8,0],[],[8],1],[[],[8],[8],1]] as [number[],number[],number[],number][]){
    const state=arranged();state.arcade!.scratchStreak[0]=1;
    const ended=settleShot(state,result({firstContact:legal[0],potted,offTable}),{legalBefore:legal});
    assert.equal(ended.state.phase,'over');assert.equal(ended.state.winner,winner);assert.equal(ended.state.arcade!.scores[0],winner===0?500:0);
    assert.deepEqual(ended.events,[],'rack-ending shots do not grant comeback or streak effects');
  }
  for(const shot of [{potted:[8]},{offTable:[8]}]){
    const state=initialState('break-eight');const outcome=settle(state,shot);
    assert.equal(outcome.outcome.respotEight,true);assert.ok(outcome.respots.some(p=>p.id===8));assert.equal(outcome.state.balls[8].pocketed,false);assert.equal(outcome.state.winner,null);
  }
});

test('one portal reward creates a clear stationary pair for exactly two subsequent settlements',()=>{
  const state=arranged('portal-lifetime');const positions=state.balls.map(b=>[b.x,b.z]);
  const acquired=settle(state,{},0,true);
  assert.deepEqual(acquired.state.balls.map(b=>[b.x,b.z]),positions,'portal creation never displaces a ball');
  assert.equal(acquired.state.arcade!.portalTurns,2);
  const pair=acquired.state.arcade!.hazards.filter(h=>h.kind==='portal');assert.equal(pair.length,2);assert.equal(pair[0].link,pair[1].id);assert.equal(pair[1].link,pair[0].id);
  const first=settle(acquired.state);assert.equal(first.state.arcade!.portalTurns,1);
  const second=settle(first.state);assert.equal(second.state.arcade!.portalTurns,0);assert.equal(second.state.arcade!.hazards.some(h=>h.kind==='portal'),false);
  const renewed=settle(first.state,{},0,true);assert.equal(renewed.state.arcade!.portalTurns,2,'another collected reward renews the pair');
  const ending=settleShot(acquired.state,result({firstContact:8,potted:[8]}),{legalBefore:[8],pendingPortal:true});
  assert.equal(ending.state.arcade!.portalTurns,0);assert.equal(ending.state.arcade!.hazards.some(h=>h.kind==='portal'),false);
});
