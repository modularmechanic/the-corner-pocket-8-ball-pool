import { firstTableContact, type Point, type TableContact } from './table-geometry';
import { TABLE, type GameState, type Shot } from './types';

export interface PreviewSegment { kind:'approach'|'object'|'cue'; from:Point;to:Point;strength:number }
export type PreviewShot = Pick<Shot,'angle'> & Partial<Pick<Shot,'power'>>;
export const FAN_RAY_COUNT = 33;
export interface PreviewFan {
  /** Display-only difficulty score in [0,1], not a pot probability. */
  risk:number;cutAngle:number;spread:number;
  rays:{from:Point;to:Point}[];
}
export interface ShotPreview { contact:TableContact|null;ghost:Point|null;segments:PreviewSegment[];corridor:(PreviewSegment|null)[];fan:PreviewFan|null }
const offset=(point:Point,dx:number,dz:number,distance:number):Point=>({x:point.x+dx*distance,z:point.z+dz*distance});
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));

/** A bounded visual heuristic: fast strokes and thinner cuts raise difficulty.
 * It deliberately omits distance, aim error and spin and is not a probability. */
export function shotGuideRisk(power:number,cutAngle:number):number {
  const stroke=clamp(Number.isFinite(power)?power:.65,0,1);
  const cut=Math.sin(clamp(Number.isFinite(cutAngle)?Math.abs(cutAngle):0,0,Math.PI/2));
  return 1-(1-.62*stroke*stroke)*(1-.82*Math.pow(cut,1.3));
}

/** Geometric aiming guidance, not an exact prediction of spin, jump or cloth drag. */
export function shotPreview(state:GameState,shot:PreviewShot,focus=false):ShotPreview {
  const preview:ShotPreview={contact:null,ghost:null,segments:[],corridor:[null,null],fan:null},cue=state.balls.find(ball=>ball.id===0);
  if(state.phase!=='ready'||!cue||cue.pocketed||!Number.isFinite(shot.angle))return preview;
  const dx=Math.cos(shot.angle),dz=Math.sin(shot.angle);
  const contact=firstTableContact(state,cue,shot.angle,0);preview.contact=contact;
  const approachEnd=Math.max(0,contact.distance-(contact.kind==='ball'?TABLE.radius:0));
  if(approachEnd>TABLE.radius+.025)preview.segments.push({kind:'approach',from:offset(cue,dx,dz,TABLE.radius+.018),to:offset(cue,dx,dz,approachEnd),strength:1});
  // The two edges describe a ball-width corridor. Independently cap an edge
  // when terrain/balls clip it, instead of painting through an adjacent prop.
  for(let i=0;i<2;i++) {
    const edge=offset(cue,-dz,dx,(i===0?-1:1)*TABLE.radius);
    const next=firstTableContact(state,edge,shot.angle,0),end=Math.min(contact.distance,next.distance),start=TABLE.radius+.018;
    if(end>start+.025)preview.corridor[i]={kind:'approach',from:offset(edge,dx,dz,start),to:offset(edge,dx,dz,end),strength:1};
  }
  if(contact.kind!=='ball')return preview;
  const struck=state.balls.find(ball=>ball.id===contact.id)!;
  preview.ghost={x:contact.x,z:contact.z};
  // A planar contact ring is useful for ordinary aiming. Elevated sphere
  // contacts have a vertical impulse, so omit their misleading flat continuations.
  if((struck.elevation??0)>.03||(cue.elevation??0)>.03)return preview;
  const gap=Math.hypot(struck.x-contact.x,struck.z-contact.z);
  if(gap<1e-8)return preview;
  const nx=(struck.x-contact.x)/gap,nz=(struck.z-contact.z)/gap;
  const normal=Math.max(0,dx*nx+dz*nz);
  const tangentX=dx-nx*normal,tangentZ=dz-nz*normal;
  const continuing={...state,balls:state.balls.filter(ball=>ball.id!==0&&ball.id!==struck.id)};
  const append=(kind:'object'|'cue',origin:Point,vx:number,vz:number,cap:number)=>{
    const strength=Math.hypot(vx,vz);if(strength<.035)return;
    const ux=vx/strength,uz=vz/strength;
    const next=firstTableContact(continuing,origin,Math.atan2(uz,ux),kind==='object'?struck.id:0);
    const length=Math.min(next.distance,cap*strength),start=TABLE.radius+.025;
    if(length<=start+.025)return;
    preview.segments.push({kind,from:offset(origin,ux,uz,start),to:offset(origin,ux,uz,length),strength});
  };
  append('object',struck,nx*normal,nz*normal,focus?3.4:1.7);
  append('cue',contact,tangentX,tangentZ,focus?2.8:1.35);
  const object=preview.segments.find(segment=>segment.kind==='object');
  if(object) {
    const cutAngle=Math.acos(clamp(normal,0,1)),spread=(focus?.9:.66)*Math.sin(cutAngle);
    const length=Math.hypot(object.to.x-object.from.x,object.to.z-object.from.z);
    const fan:PreviewFan={cutAngle,spread,risk:shotGuideRisk(shot.power??.65,cutAngle),rays:[]};
    for(let i=0;i<FAN_RAY_COUNT;i++) {
      const across=i/(FAN_RAY_COUNT-1)*2-1;
      const from=offset(object.from,-nz,nx,across*TABLE.radius);
      const end=offset(object.to,-nz,nx,across*(TABLE.radius+spread));
      const vx=end.x-from.x,vz=end.z-from.z,desired=Math.hypot(vx,vz);
      const next=firstTableContact(continuing,from,Math.atan2(vz,vx),struck.id);
      // A small clearance protects the strip between neighbouring ray samples.
      const cap=Math.max(0,Math.min(desired,next.distance-.02));
      fan.rays.push({from,to:desired>1e-8?offset(from,vx/desired,vz/desired,cap):from});
    }
    // At a thin cut the continuation still needs a finite, local footprint.
    if(length>.025)preview.fan=fan;
  }
  return preview;
}
