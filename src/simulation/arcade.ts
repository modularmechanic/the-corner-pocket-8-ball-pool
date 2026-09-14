import { MAX_LEVEL, normalizeLevel } from './level-policy';
import { newRack, seededRandom, type ArcadeState, type ArenaLayout, type Obstacle, type PlayerBuffs, type PowerUp, type Hazard, type GameState, type Pickup } from './types';
import { isClearLayoutBlock, isClearLayoutHazard, isClearLayoutPickup, isClearPickupSpawn, isClearPortalSpawn } from './table-geometry';
export const LAYOUTS: Record<ArenaLayout, { name: string; blocks: [number, number, number, number, number, Obstacle['material']][] }> = {
  crossfire: { name: 'Crossfire', blocks: [[-.4,-1.15,.32,1.12,2,'wood'],[.65,-1.65,1,.28,1,'wood'],[.65,1.65,1,.28,1,'wood'],[-3.6,-1.9,.72,.3,1,'wood'],[-3.6,1.9,.72,.3,1,'wood'],[4.8,-1.65,.3,.72,3,'steel'],[4.8,1.65,.3,.72,3,'steel']] },
  fortress: { name: 'Fortress', blocks: [[.75,-.95,.28,.95,3,'steel'],[.75,.95,.28,.95,3,'steel'],[2.05,-1.85,1.15,.3,2,'wood'],[2.05,1.85,1.15,.3,2,'wood'],[4.1,-1.85,1.1,.3,4,'steel'],[4.1,1.85,1.1,.3,4,'steel'],[-2.7,-2.2,1.05,.26,1,'wood'],[-2.7,2.2,1.05,.26,1,'wood']] },
  gauntlet: { name: 'Hex Gauntlet', blocks: [[-1.1,-1.1,.35,1,2,'hex'],[.25,1.1,.35,1,2,'hex'],[1.5,-1.15,.32,.9,3,'steel'],[-3.8,1.75,.85,.3,1,'wood'],[3.35,-2.05,.95,.32,2,'hex'],[3.35,2.05,.95,.32,2,'hex'],[4.85,0,.28,1.2,4,'steel']] },
};
const HAZARDS: Record<ArenaLayout, Omit<Hazard,'id'>[]> = {
  crossfire: [{kind:'ramp',x:-1.2,z:1.15,radius:.58,angle:0},{kind:'water',x:2,z:-1.65,radius:.65},{kind:'smoke',x:-4.4,z:-1.2,radius:.5}],
  fortress: [{kind:'electric',x:-1.1,z:-1.45,radius:.55},{kind:'electric',x:4.7,z:.85,radius:.45},{kind:'water',x:-3.9,z:1.05,radius:.75},{kind:'smoke',x:1.9,z:1.15,radius:.55},{kind:'ramp',x:-.6,z:1.25,radius:.52,angle:0}],
  gauntlet: [{kind:'slime',x:-2.9,z:1.5,radius:.65},{kind:'smoke',x:2.6,z:-1.15,radius:.6},{kind:'electric',x:.1,z:-1.45,radius:.45}],
};
export function createArcade(layout: ArenaLayout = 'crossfire', seed = 'house', level = 1): ArcadeState {
  level = normalizeLevel(level);
  const random=seededRandom(seed+':arena:'+layout+':'+level),balls=newRack(seed),mirror=random()<.5?-1:1;
  const buffs=():PlayerBuffs=>({overdrive:0,frozen:0,ward:0,focus:0,jammed:0,sticky:0});
  const state:ArcadeState={layout,level,portalTurns:0,clock:0,obstacles:[],hazards:[],pickups:[],scores:[0,0],combo:0,buffs:[buffs(),buffs()],destroyed:[0,0],scratchStreak:[0,0],potStreak:[0,0],activeShot:{overdrive:false,frozen:false,ward:false,focus:false,sticky:false}};
  // Keep a guaranteed corridor from the cue ball to the rack. Every generated
  // object is also checked against the initial balls and all existing props.
  function position(baseX:number,baseZ:number,valid:(x:number,z:number)=>boolean) {
    for(let attempt=0;attempt<600;attempt++) {
      const x=attempt<36?baseX+(random()-.5)*1.15:(random()-.5)*10.4;
      const z=attempt<36?baseZ*mirror+(random()-.5)*.75:(random()-.5)*4.8;
      if(valid(x,z))return {x,z};
    }
    throw new Error('Could not generate a clear table layout.');
  }
  for(const [baseX,baseZ,width,depth,baseHp,baseMaterial] of LAYOUTS[layout].blocks.slice(0,level)) {
    const material=level<=2?'wood':baseMaterial;
    const hp=level===1?1:Math.min(level,baseHp+(level===MAX_LEVEL?1:0));
    const p=position(baseX,baseZ,(x,z)=>isClearLayoutBlock(state,balls,{x,z,width,depth}));
    state.obstacles.push({id:state.obstacles.length,...p,width,depth,hp,maxHp:hp,material});
  }
  for(const hazard of HAZARDS[layout].slice(0,Math.min(3,level-1))) {
    const p=position(hazard.x,hazard.z,(x,z)=>isClearLayoutHazard(state,balls,{x,z,radius:hazard.radius}));
    state.hazards.push({...hazard,...p,id:state.hazards.length,angle:hazard.kind==='ramp'?(random()-.5)*.7:hazard.angle});
  }
  for(let id=0;id<2;id++) {
    const radius=.16,p=position((id%2?1:-1)*2,(id<2?1:-1)*1.2,(x,z)=>isClearLayoutPickup(state,balls,{x,z},radius));
    state.pickups.push(makePickup(seed,id,p.x,p.z,0));
  }
  return state;
}
export function makePickup(seed:string,id:number,x:number,z:number,clock:number):Pickup {
  const random=seededRandom(seed+':pickup:'+id);
  const choices:PowerUp[]=['overdrive','frost','ward','focus','portal'];
  return {id,x,z,radius:.16,available:true,power:choices[Math.floor(random()*choices.length)],expiresAt:clock+12+random()*8};
}
export function pickupPosition(state:GameState,random:()=>number):{x:number;z:number}|undefined {
  const a=state.arcade;if(!a)return;
  for(let attempt=0;attempt<300;attempt++) {
    const x=(random()-.5)*10.1,z=(random()-.5)*4.5;
    if(!isClearPickupSpawn(state,{x,z}))continue;
    return {x,z};
  }
}
/** Create the collected portal reward only after the acquisition shot settles. */
export function spawnTemporaryPortals(state: GameState): boolean {
  const arena=state.arcade;
  if(!arena || state.winner!==null)return false;
  const terrain=arena.hazards.filter(h=>h.kind!=='portal');
  const random=seededRandom(state.seed+':portals:'+state.shotCount),radius=.34;
  const points:{x:number;z:number}[]=[];
  const clear=(x:number,z:number)=>isClearPortalSpawn(state,{x,z},radius,points);
  for(const side of [-1,1]) {
    let point:{x:number;z:number}|undefined;
    for(let attempt=0;attempt<400;attempt++) {
      const x=side*(1+random()*3.6),z=(random()-.5)*4.1;
      if(clear(x,z)){point={x,z};break;}
    }
    if(!point) for(let x=-4.7;x<4.8&&!point;x+=.3)for(let z=-2.1;z<2.2;z+=.3)if(clear(x,z)){point={x,z};break;}
    if(!point)return false;
    points.push(point);
  }
  const firstId=Math.max(-1,...arena.hazards.map(h=>h.id))+1;
  arena.hazards=[...terrain,
    {id:firstId,kind:'portal',...points[0],radius,link:firstId+1},
    {id:firstId+1,kind:'portal',...points[1],radius,link:firstId},
  ];
  arena.portalTurns=2;
  return true;
}
