import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {PUB_LAYOUT,pubBackZ,pubFrontZ,pubSideX} from '../src/render/pub-layout';
import {billiardFixtureVisible,updateBilliardFixture} from '../src/render/pub-interior';
import {fitTableCamera} from '../src/render/camera';

test('room expansion adds fifty percent floor area and keeps its height and prop dimensions',()=>{
  const b=PUB_LAYOUT.bounds;
  assert.ok(Math.abs((b.right-b.left)*(b.front-b.back)/(29.6*23.4)-1.5)<1e-12);
  assert.equal(b.ceiling-PUB_LAYOUT.floor,10);
  assert.ok(Math.abs((pubSideX(12)-pubSideX(9))-3)<1e-12);
  assert.ok(Math.abs((pubBackZ(-8.1)-pubBackZ(-10.56))-2.46)<1e-12);
  assert.ok(Math.abs((pubFrontZ(11.4)-pubFrontZ(7.25))-4.15)<1e-12);
});

test('billiard fixture stays visible above the table in the default pub camera',()=>{
  const camera=new THREE.PerspectiveCamera(39,16/9,.1,100);
  fitTableCamera(camera,new THREE.Vector3(0,-.15,-1.5),new THREE.Vector3(.035,.62,.784).normalize(),16/9);
  assert.equal(billiardFixtureVisible(camera),true);
});

test('billiard fixture clears the playing surface in overhead and steep orbit views',()=>{
  const overhead=new THREE.OrthographicCamera(-12,12,7,-7,.1,100);overhead.position.set(0,23,.001);overhead.lookAt(0,0,0);overhead.updateMatrixWorld(true);
  assert.equal(billiardFixtureVisible(overhead),false);
  const camera=new THREE.PerspectiveCamera(39,16/9,.1,100);
  fitTableCamera(camera,new THREE.Vector3(0,-.15,-1.5),new THREE.Vector3(0,.99,.14).normalize(),16/9);
  assert.equal(billiardFixtureVisible(camera),false);
  const fixture=new THREE.Group();updateBilliardFixture(fixture,camera);assert.equal(fixture.visible,false);
  fitTableCamera(camera,new THREE.Vector3(0,-.15,-1.5),new THREE.Vector3(.035,.62,.784).normalize(),16/9);
  updateBilliardFixture(fixture,camera);assert.equal(fixture.visible,true);
});
