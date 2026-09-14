import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShotSetup } from '../src/ui/shot-setup';

test('first click locks direction, pullback prepares the shot for the second click',()=>{
  const setup=new ShotSetup();setup.setTip(.3,-.4);setup.setElevation(.2);
  setup.lockAim(.4,100,200,0,-8);setup.pull(100,320,160);
  assert.equal(setup.stage,'power');
  assert.deepEqual(setup.shot(),{angle:.4,power:.8,elevation:.2,tipX:.3,tipY:-.4});
  setup.pull(100,180,160);assert.equal(setup.power,.05);
  setup.reset();assert.equal(setup.stage,'aim');assert.equal(setup.elevation,0);assert.equal(setup.tipY,0);
});
test('held spin and elevation adjustments preserve direction, stage and power',()=>{
  const setup=new ShotSetup();setup.lockAim(.4,200,100,1,0);setup.pull(150,100,100);
  const power=setup.power;
  setup.beginAdjustment('spin',150,100);setup.moveAdjustment(200,150);setup.pull(0,0,100);
  assert.equal(setup.stage,'power');assert.equal(setup.angle,.4);assert.equal(setup.power,power);
  assert.equal(setup.tipX,.3);assert.equal(setup.tipY,-.3);
  setup.endAdjustment(200,150);setup.pull(200,150,100);
  assert.equal(setup.power,power,'returning from a modifier must not jump the charge');
  setup.beginAdjustment('elevation',200,150);setup.moveAdjustment(200,100);setup.endAdjustment(200,100);
  assert.equal(setup.elevation,.2);assert.equal(setup.stage,'power');
});
test('contact/elevation are bounded and invalid pointer data does not poison a shot',()=>{
  const setup=new ShotSetup();setup.beginAdjustment('elevation',0,0);setup.moveAdjustment(0,-10000);
  assert.equal(setup.elevation,Math.PI/3);setup.moveAdjustment(0,10000);assert.equal(setup.elevation,0);
  setup.setTip(1,1);assert.ok(Math.hypot(setup.tipX,setup.tipY)<=.80000001);
  const prior=setup.shot();setup.setTip(NaN,Infinity);setup.setElevation(NaN);setup.moveAdjustment(NaN,1);
  assert.deepEqual(setup.shot(),prior);setup.lockAim(NaN,0,0,1,0);assert.equal(setup.stage,'aim');
});
test('fine cue adjustment has one quarter of the normal travel',()=>{
  const normal=new ShotSetup(),fine=new ShotSetup();
  for(const setup of [normal,fine])setup.beginAdjustment('spin',0,0);
  normal.moveAdjustment(100,0);fine.moveAdjustment(100,0,true);
  assert.equal(fine.tipX,normal.tipX/4);assert.equal(fine.stage,'aim');
});

test('switching fine adjustment mid-drag never jumps the existing contact or elevation',()=>{
  const setup=new ShotSetup();setup.beginAdjustment('spin',0,0);setup.moveAdjustment(100,0);
  setup.moveAdjustment(100,0,true);assert.equal(setup.tipX,.6);
  setup.moveAdjustment(120,0,true);assert.equal(setup.tipX,.63);
  setup.beginAdjustment('elevation',0,100);setup.moveAdjustment(0,50);const angle=setup.elevation;
  setup.moveAdjustment(0,50,true);assert.equal(setup.elevation,angle);
});
