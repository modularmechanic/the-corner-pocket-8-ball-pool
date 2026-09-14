import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { initialState, TABLE, type GameState } from '../src/simulation/types';
import { createArcade } from '../src/simulation/arcade';
import { firstTableContact } from '../src/simulation/table-geometry';
import { FAN_RAY_COUNT, shotGuideRisk, shotPreview, type PreviewSegment } from '../src/simulation/shot-preview';
import { ShotPaths } from '../src/render/shot-paths';

function arrangement(positions:Record<number,{x:number;z:number}>):GameState {
  const state=initialState('guide-test');state.shotCount=1;
  for(const ball of state.balls){ball.pocketed=!positions[ball.id];if(positions[ball.id])Object.assign(ball,positions[ball.id]);}
  return state;
}
const unit=(segment:PreviewSegment)=>{const x=segment.to.x-segment.from.x,z=segment.to.z-segment.from.z,length=Math.hypot(x,z);return {x:x/length,z:z/length};};

test('head-on guidance has a precise ghost contact, an object route and no phantom cue continuation',()=>{
  const state=arrangement({0:{x:-3,z:0},1:{x:0,z:0}}),before=structuredClone(state);
  const preview=shotPreview(state,{angle:0});assert.deepEqual(state,before);
  assert.equal(preview.contact!.kind,'ball');assert.equal(preview.contact!.id,1);assert.ok(Math.abs(preview.ghost!.x+TABLE.radius*2)<1e-8);
  assert.deepEqual(preview.segments.map(path=>path.kind),['approach','object']);
  const object=preview.segments.find(path=>path.kind==='object')!;assert.deepEqual(unit(object),{x:1,z:0});assert.equal(object.to.x,1.7);
  const approach=preview.segments[0];assert.ok(approach.from.x>-3+TABLE.radius);assert.ok(approach.to.x<preview.ghost!.x);
});

test('cut shots separate into perpendicular equal-mass normal and tangent directions',()=>{
  for(const z of [-.31,-.2,.2,.31]) {
    const state=arrangement({0:{x:-3,z:0},1:{x:0,z}}),preview=shotPreview(state,{angle:0});
    const object=preview.segments.find(path=>path.kind==='object')!,cue=preview.segments.find(path=>path.kind==='cue')!;
    assert.ok(object&&cue);const a=unit(object),b=unit(cue);
    assert.ok(Math.abs(a.x*b.x+a.z*b.z)<1e-9,'the normal and tangent are perpendicular');
    assert.ok(Math.abs(a.x*object.strength+b.x*cue.strength-1)<1e-9);
    assert.ok(Math.abs(a.z*object.strength+b.z*cue.strength)<1e-9);
    assert.ok(Math.abs(object.strength**2+cue.strength**2-1)<1e-9,'the preview cannot invent outgoing momentum');
    assert.ok(cue.to.z*z<0,'the cue glances away from the struck side of the target');
  }
});

test('both continuations ignore the original cue and struck ball, but stop at the next real ball',()=>{
  const state=arrangement({0:{x:-3,z:0},1:{x:0,z:0},2:{x:.9,z:0}});
  const preview=shotPreview(state,{angle:0},true),object=preview.segments.find(path=>path.kind==='object')!;
  assert.ok(object);assert.ok(Math.abs(object.to.x-(.9-TABLE.radius*2))<1e-9);
  const cut=arrangement({0:{x:-3,z:0},1:{x:0,z:.2}}),baseline=shotPreview(cut,{angle:0},true);
  const cue=baseline.segments.find(path=>path.kind==='cue')!,direction=unit(cue),ghost=baseline.ghost!;
  cut.balls[2].pocketed=false;cut.balls[2].x=ghost.x+direction.x*.9;cut.balls[2].z=ghost.z+direction.z*.9;
  const clipped=shotPreview(cut,{angle:0},true).segments.find(path=>path.kind==='cue')!;
  assert.ok(Math.abs(Math.hypot(clipped.to.x-ghost.x,clipped.to.z-ghost.z)-(.9-TABLE.radius*2))<1e-9);
});

test('portal, obstacle and rail routes share the exact first-contact cap; focus cannot see through them',()=>{
  for(const kind of ['portal','obstacle','rail'] as const){
    const state=arrangement({0:{x:-3,z:0},1:{x:kind==='rail'?4.4:0,z:0}});
    state.arcade=createArcade('crossfire','guide-test');state.arcade.obstacles=[];state.arcade.hazards=[];state.arcade.pickups=[];
    if(kind==='portal')state.arcade.hazards=[{id:7,kind:'portal',x:1,z:0,radius:.3,link:8}];
    if(kind==='obstacle')state.arcade.obstacles=[{id:9,x:1,z:0,width:.3,depth:.6,hp:2,maxHp:2,material:'steel'}];
    const reduced={...state,balls:state.balls.filter(ball=>ball.id!==0&&ball.id!==1)},expected=firstTableContact(reduced,state.balls[1],0,1);
    assert.equal(expected.kind,kind);
    const object=shotPreview(state,{angle:0},true).segments.find(path=>path.kind==='object')!;
    assert.ok(object);assert.ok(Math.abs(object.to.x-expected.x)<1e-8);assert.ok(Math.abs(object.to.z-expected.z)<1e-8);
  }
  const state=arrangement({0:{x:-3,z:0},1:{x:0,z:0}});
  assert.ok(shotPreview(state,{angle:0},true).segments[1].to.x>shotPreview(state,{angle:0},false).segments[1].to.x);
});

test('guidance never fabricates a struck ball beyond an obstacle or portal and hides outside aiming',()=>{
  const state=arrangement({0:{x:-3,z:0},1:{x:0,z:0}});state.arcade=createArcade('crossfire','guide-test');state.arcade.obstacles=[];state.arcade.hazards=[{id:0,kind:'portal',x:-2,z:0,radius:.3}];
  const preview=shotPreview(state,{angle:0});assert.equal(preview.contact!.kind,'portal');assert.equal(preview.ghost,null);assert.deepEqual(preview.segments.map(path=>path.kind),['approach']);
  state.phase='rolling';assert.deepEqual(shotPreview(state,{angle:0}).segments,[]);
  state.phase='ready';state.balls[0].pocketed=true;assert.equal(shotPreview(state,{angle:0}).contact,null);
  state.balls[0].pocketed=false;assert.equal(shotPreview(state,{angle:NaN}).contact,null);
});

test('rendered shot paths are solid depth-tested meshes, update visibility and dispose owned resources',()=>{
  const scene=new THREE.Scene(),paths=new ShotPaths(scene),state=arrangement({0:{x:-3,z:0},1:{x:0,z:.2}});
  paths.update(state,{angle:0},true,true);
  const group=scene.getObjectByName('shot-guidance')!;assert.equal(group.visible,true);
  let visibleMeshes=0;
  group.traverse(object=>{
    assert.equal(object instanceof THREE.Line,false,'guidance must not fall back to one-pixel dashed lines');
    if(object instanceof THREE.Mesh){
      if(object.visible)visibleMeshes++;
      const material=object.material as THREE.ShaderMaterial;assert.equal(material.depthTest,true);assert.equal(material.depthWrite,false);assert.equal(material.transparent,true);
      assert.ok(object.position.y>0&&object.position.y<TABLE.radius);
    }
  });
  assert.equal(visibleMeshes,12,'two approach edges, two fan edges, cue continuation, their glows, fan and ghost');
  paths.update(state,{angle:0},false);assert.equal(group.visible,false);
  paths.dispose();paths.dispose();assert.equal(scene.getObjectByName('shot-guidance'),undefined);
});

test('approach has two parallel ball-width rails that finish at the contact ghost',()=>{
  const state=arrangement({0:{x:-3,z:0},1:{x:0,z:0}}),preview=shotPreview(state,{angle:0,power:.5});
  const [left,right]=preview.corridor;assert.ok(left&&right);
  assert.deepEqual(unit(left),{x:1,z:0});assert.deepEqual(unit(right),{x:1,z:0});
  assert.ok(Math.abs(right.from.z-left.from.z-TABLE.radius*2)<1e-9);
  assert.ok(Math.abs(left.to.x-preview.ghost!.x)<1e-9&&Math.abs(right.to.x-preview.ghost!.x)<1e-9);
  assert.equal(preview.fan!.spread,0);assert.equal(preview.fan!.cutAngle,0);
  const outer=preview.fan!.rays.filter((_,index)=>index===0||index===FAN_RAY_COUNT-1);
  assert.ok(outer.every(ray=>Math.abs(ray.to.z-ray.from.z)<1e-9),'head-on outgoing boundaries are parallel');
});

test('fan width and risk vary continuously with cut angle while power independently raises risk',()=>{
  let previousSpread=-1,previousRisk=-1;
  for(const z of [0,.08,.16,.24,.32,.345]) {
    const state=arrangement({0:{x:-3,z:0},1:{x:0,z}}),preview=shotPreview(state,{angle:0,power:.4});
    const fan=preview.fan!;assert.ok(fan);assert.equal(fan.rays.length,FAN_RAY_COUNT);
    assert.ok(fan.spread>previousSpread&&fan.risk>previousRisk);previousSpread=fan.spread;previousRisk=fan.risk;
    const slow=shotPreview(state,{angle:0,power:.15}).fan!,fast=shotPreview(state,{angle:0,power:.95}).fan!;
    assert.ok(fast.risk>slow.risk);assert.equal(fast.cutAngle,slow.cutAngle);
  }
  for(let angle=0;angle<=Math.PI/2;angle+=.07) for(let power=0;power<=1;power+=.07) {
    const risk=shotGuideRisk(power,angle);assert.ok(risk>=0&&risk<=1);
    assert.ok(Math.abs(risk-shotGuideRisk(power+.0001,angle+.0001))<.001);
  }
  assert.ok(Number.isFinite(shotGuideRisk(NaN,Infinity)));
});

test('every fan ray stops before a ball, obstacle or portal even when only an outer branch is obstructed',()=>{
  for(const kind of ['ball','obstacle','portal'] as const) {
    const state=arrangement({0:{x:-3,z:0},1:{x:0,z:.2}});
    state.arcade=createArcade('crossfire','guide-fan');state.arcade.obstacles=[];state.arcade.hazards=[];state.arcade.pickups=[];
    const baseline=shotPreview(state,{angle:0,power:.7},true).fan!;
    const branch=baseline.rays[FAN_RAY_COUNT-1];
    const point={x:branch.from.x+(branch.to.x-branch.from.x)*.68,z:branch.from.z+(branch.to.z-branch.from.z)*.68};
    if(kind==='ball')Object.assign(state.balls[2],{...point,pocketed:false});
    if(kind==='obstacle')state.arcade.obstacles=[{id:4,...point,width:.16,depth:.16,hp:2,maxHp:2,material:'steel'}];
    if(kind==='portal')state.arcade.hazards=[{id:6,...point,radius:.18,kind:'portal'}];
    const fan=shotPreview(state,{angle:0,power:.7},true).fan!;assert.ok(fan);
    const continuing={...state,balls:state.balls.filter(ball=>ball.id!==0&&ball.id!==1)};
    let clipped=0;
    for(let i=0;i<FAN_RAY_COUNT;i++) {
      const ray=fan.rays[i],length=Math.hypot(ray.to.x-ray.from.x,ray.to.z-ray.from.z);
      if(length<.001)continue;
      const contact=firstTableContact(continuing,ray.from,Math.atan2(ray.to.z-ray.from.z,ray.to.x-ray.from.x),1);
      assert.ok(length<=contact.distance-.0199,'no fan branch continues behind its first contact');
      if(length+1e-4<Math.hypot(baseline.rays[i].to.x-baseline.rays[i].from.x,baseline.rays[i].to.z-baseline.rays[i].from.z))clipped++;
    }
    assert.ok(clipped>0,`${kind} shortens the fan`);
  }
});

test('arrow animation and risk update in fixed buffers without allocating new render objects',()=>{
  const scene=new THREE.Scene(),paths=new ShotPaths(scene),state=arrangement({0:{x:-3,z:0},1:{x:0,z:.2}});
  paths.update(state,{angle:0,power:.1},true,false,.02);
  const group=scene.getObjectByName('shot-guidance')!,ids=group.children.map(child=>child.id);
  const left=scene.getObjectByName('shot-approach-edge-0') as THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>;
  const edge=scene.getObjectByName('shot-object-edge-0') as THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>;
  const fan=scene.getObjectByName('shot-cut-fan') as THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>;
  const positions=fan.geometry.attributes.position.array,index=fan.geometry.index,clock=left.material.uniforms.clock.value,risk=edge.material.uniforms.risk.value;
  assert.equal(left.material.uniforms.arrows.value,1);assert.ok(left.material.uniforms.pathLength.value>0);
  paths.update(state,{angle:0,power:.9},true,false,.02);
  assert.ok(left.material.uniforms.clock.value>clock);assert.ok(edge.material.uniforms.risk.value>risk);
  for(let i=0;i<120;i++)paths.update(state,{angle:0,power:i/120},true,false,1/60);
  assert.deepEqual(group.children.map(child=>child.id),ids);assert.equal(fan.geometry.attributes.position.array,positions);assert.equal(fan.geometry.index,index);
  state.balls[1].z=0;paths.update(state,{angle:0,power:.5},true);assert.equal(fan.visible,false);
  assert.equal((scene.getObjectByName('shot-object-edge-0') as THREE.Mesh).visible,true);
  assert.equal((scene.getObjectByName('shot-object-edge-1') as THREE.Mesh).visible,true);
  paths.dispose();
});

test('unchanged guide geometry is not uploaded for clock or power changes, while every collision input invalidates it',()=>{
  const scene=new THREE.Scene(),paths=new ShotPaths(scene),state=arrangement({0:{x:-3,z:0},1:{x:0,z:.2}});
  state.arcade=createArcade('crossfire','cached-guide');state.arcade.obstacles=[];state.arcade.hazards=[];
  paths.update(state,{angle:0,power:.2},true);
  const fan=scene.getObjectByName('shot-cut-fan') as THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>;
  const position=fan.geometry.attributes.position as THREE.BufferAttribute,version=position.version;
  for(let i=0;i<100;i++){state.arcade.clock=i;paths.update(structuredClone(state),{angle:0,power:i/100},true);}
  assert.equal(position.version,version,'immutable match snapshots and clocks do not invalidate unchanged collision geometry');
  const expectChanged=(change:()=>void,focus=false)=>{const before=position.version;change();paths.update(state,{angle:0,power:.5},true,focus);assert.ok(position.version>before);};
  expectChanged(()=>{state.balls[1].z=.18;});
  expectChanged(()=>{state.balls[1].elevation=.01;});
  expectChanged(()=>{Object.assign(state.balls[2],{pocketed:false,x:3,z:2});});
  expectChanged(()=>{state.arcade!.obstacles.push({id:4,x:4,z:2,width:.3,depth:.3,hp:1,maxHp:1,material:'wood'});});
  expectChanged(()=>{state.arcade!.obstacles[0].hp=0;});
  expectChanged(()=>{state.arcade!.hazards.push({id:9,kind:'portal',x:4,z:2,radius:.2});});
  expectChanged(()=>{state.arcade!.hazards[0].x=3;});
  expectChanged(()=>{},true);paths.dispose();
});
