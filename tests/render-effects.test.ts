import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TableEffects } from '../src/render/effects';
import type { TableEvent } from '../src/simulation/types';

const event=(kind:TableEvent['kind'],extra:Partial<TableEvent>={}):TableEvent=>({kind,strength:1,x:.4,z:-.2,time:0,...extra});

function fixture(){
  const scene=new THREE.Scene(),effects=new TableEffects(scene);
  const mesh=(name:string)=>scene.getObjectByName(name) as THREE.InstancedMesh;
  const objects=()=>{let count=0;scene.traverse(()=>count++);return count;};
  return {scene,effects,mesh,objects};
}

test('sparks, debris and ripples share bounded instanced pools instead of per-particle meshes and materials',()=>{
  const {effects,mesh,objects}=fixture(),baseline=objects();
  const sparks=mesh('effect-sparks'),wood=mesh('effect-debris'),steel=mesh('effect-debris-steel'),ripples=mesh('effect-ripples');
  const materials=[sparks,wood,steel,ripples].map(item=>item.material);
  for(let i=0;i<8;i++)effects.emit(event('obstacle',{destroyed:true}),'wood');
  effects.emit(event('obstacle',{destroyed:true}),'steel');
  effects.update(1/120);
  assert.equal(objects(),baseline,'emission adds no scene objects');
  assert.equal(sparks.count,120);assert.equal(wood.count,70);assert.equal(steel.count,0,'the debris pool was already full');
  assert.equal(ripples.count,16);
  const color=sparks.geometry.getAttribute('color');
  assert.ok(color.getW(0)>0&&color.getW(0)<=.9,'per-instance opacity rides in the alpha channel');
  effects.update(2);
  assert.deepEqual([sparks,wood,steel,ripples].map(item=>item.count),[0,0,0,0]);
  effects.emit(event('obstacle',{destroyed:true}),'steel');effects.update(1/120);
  assert.equal(steel.count,14);assert.equal(wood.count,0);assert.equal(sparks.count,40);assert.equal(ripples.count,2);
  const expected=new THREE.Color('#c5e1ed');
  assert.ok(Math.abs(color.getX(0)-expected.r)<1e-6&&Math.abs(color.getZ(0)-expected.b)<1e-6,'reused slots take the new burst color');
  assert.deepEqual([sparks,wood,steel,ripples].map(item=>item.material),materials,'materials persist, so programs are never released and recompiled');
  effects.clear();effects.update(1/120);
  assert.deepEqual([sparks,wood,steel,ripples].map(item=>item.count),[0,0,0,0]);
  effects.dispose();
});

test('electric arcs rewrite one preallocated vertex buffer each frame',()=>{
  const {scene,effects}=fixture();
  effects.emit(event('hazard',{hazard:'electric'}));
  const line=scene.getObjectsByProperty('type','LineSegments').find(item=>item.visible) as THREE.LineSegments;
  const positions=line.geometry.getAttribute('position'),array=positions.array;
  effects.update(1/60);const first=Array.from(array);
  effects.update(1/60);
  assert.equal(line.geometry.getAttribute('position'),positions);assert.equal(positions.array,array);
  assert.equal(positions.count,56);assert.ok(Array.from(array).every(Number.isFinite));
  assert.ok(Math.abs(positions.getX(0)-.4)<1e-6&&Math.abs(positions.getZ(0)+.2)<1e-6,'every branch starts at the strike point');
  assert.notDeepEqual(Array.from(array),first,'the bolt flickers between frames');
  effects.update(1);assert.equal(line.visible,false);effects.dispose();
});
