import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {PracticalLightBudget,practicalLightLimits} from '../src/render/light-budget';

function fixture(){
  const scene=new THREE.Scene(),points:THREE.PointLight[]=[],areas:THREE.RectAreaLight[]=[];
  for(let i=0;i<14;i++){const light=new THREE.PointLight(i<7?'#ffb16b':'#a5d4ff',8+i,8,2);light.position.set(i<7?-4:4,2,(i%7)-3);scene.add(light);points.push(light);}
  for(let i=0;i<4;i++){const light=new THREE.RectAreaLight(0xffffff,2,4,2);light.position.set(i-2,3,-2);light.lookAt(0,0,0);scene.add(light);areas.push(light);}
  for(let i=0;i<3;i++){const light=new THREE.SpotLight(0xffffff,30);light.position.set(i-1,4,0);scene.add(light);}
  const camera=new THREE.PerspectiveCamera(55,16/9,.05,100);camera.position.set(-3,2,6);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
  const budget=new PracticalLightBudget(scene);
  return {scene,points,areas,camera,budget};
}
function count(scene:THREE.Scene){const result={point:0,area:0,spot:0};scene.traverseVisible(object=>{if(object instanceof THREE.PointLight)result.point++;if(object instanceof THREE.RectAreaLight)result.area++;if(object instanceof THREE.SpotLight)result.spot++;});return result;}

function lit(scene:THREE.Scene){const result={point:0,area:0};scene.getObjectByName('adaptive-practical-lights')!.traverseVisible(object=>{if(object instanceof THREE.PointLight&&object.intensity>0)result.point++;if(object instanceof THREE.RectAreaLight&&object.intensity>0)result.area++;});return result;}

test('adaptive tiers fade pooled practicals without changing the light counts that key shader programs',()=>{
  const {scene,budget,camera,points}=fixture();
  for(const [tier,point,area]of [['refined',6,2],['balanced',6,2],['fast',4,2],['light',3,1],['minimum',3,1],['refined',6,2]] as const){
    budget.configure('auto',tier,'refined');for(let i=0;i<60;i++)budget.update(camera,1/120);
    assert.deepEqual(count(scene),{point:6,area:2,spot:3},`${tier} keeps the session's shader light counts`);
    assert.deepEqual(lit(scene),{point,area},`${tier} lights only its allowance`);
    assert.ok(points.every(light=>!light.visible));assert.deepEqual(budget.getCounts(),{pointLights:6,areaLights:2});
  }
  budget.configure('auto','minimum','fast');assert.deepEqual(count(scene),{point:4,area:2,spot:3},'a phone ceiling keeps a smaller fixed pool');
  assert.deepEqual(practicalLightLimits('performance','performance'),{points:3,areas:1});budget.dispose();
});

test('orbiting and source replacement preserve the fixed shader count and finite proxy transforms',()=>{
  const {scene,budget,camera}=fixture();budget.configure('auto','fast');
  const group=scene.getObjectByName('adaptive-practical-lights')!,ids=group.children.map(child=>child.id);
  for(let frame=0;frame<360;frame++){
    camera.position.set(Math.cos(frame/60)*6,2,Math.sin(frame/60)*6);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);budget.update(camera,1/120);
    assert.deepEqual(count(scene),{point:4,area:2,spot:3});
    for(const light of group.children)if(light instanceof THREE.PointLight||light instanceof THREE.RectAreaLight){assert.ok(Number.isFinite(light.intensity));assert.ok(light.position.toArray().every(Number.isFinite));}
  }
  assert.deepEqual(group.children.map(child=>child.id),ids);budget.dispose();
});

test('reflection capture restores every original practical and never leaves duplicates enabled after capture',()=>{
  const {scene,budget,points}=fixture();budget.configure('auto','minimum');
  const group=scene.getObjectByName('adaptive-practical-lights')!;
  // RoomReflections temporarily hides root gameplay objects before invoking its
  // enclosure callback, so the proxy group is already hidden when this begins.
  group.visible=false;
  assert.throws(()=>budget.withFullLighting(()=>{assert.deepEqual(count(scene),{point:14,area:4,spot:3});throw Error('capture test');}));
  assert.equal(group.visible,false);assert.ok(points.every(light=>!light.visible));
  group.visible=true;assert.deepEqual(count(scene),{point:3,area:1,spot:3});budget.dispose();
});

test('high and ultra pool generously, and disposal restores original source visibility without touching table lamps',()=>{
  const {scene,budget,points,camera}=fixture();
  budget.configure('high','high');for(let i=0;i<60;i++)budget.update(camera,1/120);
  assert.deepEqual(count(scene),{point:8,area:3,spot:3});assert.deepEqual(lit(scene),{point:8,area:3});
  budget.configure('ultra','ultra');for(let i=0;i<60;i++)budget.update(camera,1/120);
  assert.deepEqual(count(scene),{point:12,area:4,spot:3});assert.deepEqual(lit(scene),{point:12,area:4});
  budget.configure('auto','fast');assert.ok(points.every(light=>!light.visible));budget.dispose();
  assert.equal(scene.getObjectByName('adaptive-practical-lights'),undefined);assert.deepEqual(count(scene),{point:14,area:4,spot:3});
});

test('short effect flashes reuse a practical slot without introducing another shader light',()=>{
  const {scene,budget,camera}=fixture();const flash=new THREE.PointLight('#00ffff',0,5,2);flash.position.set(0,.5,0);flash.userData.performanceFlash=true;scene.add(flash);
  budget.configure('auto','minimum');budget.update(camera,2.1);
  flash.intensity=40;budget.update(camera,1/120);
  assert.deepEqual(count(scene),{point:3,area:1,spot:3});
  const group=scene.getObjectByName('adaptive-practical-lights')!;
  assert.ok(group.children.some(light=>light instanceof THREE.PointLight&&light.intensity>30&&light.color.equals(flash.color)),'the flash is visible immediately, within the existing slot count');
  flash.intensity=0;for(let i=0;i<30;i++)budget.update(camera,1/120);assert.deepEqual(count(scene),{point:3,area:1,spot:3});budget.dispose();
});
