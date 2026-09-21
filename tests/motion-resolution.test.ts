import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MotionResolution } from '../src/render/motion-resolution';
import { budgetDpr, graphicsBudget, type RenderQuality } from '../src/render/performance';

const camera = () => new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);

test('a still camera renders at full resolution', () => {
  const motion = new MotionResolution(),
    cam = camera();
  for (let i = 0; i < 10; i++) assert.equal(motion.sample(cam, 16, 0.7), 1);
  assert.equal(motion.moving, false);
});

test('a moving camera drops to the tier the budget allows, and recovers once it settles', () => {
  const motion = new MotionResolution(220),
    cam = camera();
  motion.sample(cam, 16, 0.7);
  cam.position.x += 0.5;
  assert.equal(motion.sample(cam, 16, 0.7), 0.7, 'drops while moving');
  assert.equal(motion.moving, true);
  // Still, but inside the settle window: the ratio must not flicker back immediately.
  assert.equal(motion.sample(cam, 16, 0.7), 0.7, 'holds through the settle window');
  for (let i = 0; i < 20; i++) motion.sample(cam, 16, 0.7);
  assert.equal(motion.sample(cam, 16, 0.7), 1, 'recovers when the camera settles');
});

test('rotation counts as movement, not just translation', () => {
  const motion = new MotionResolution(),
    cam = camera();
  motion.sample(cam, 16, 0.5);
  cam.rotateY(0.05);
  assert.equal(motion.sample(cam, 16, 0.5), 0.5);
});

test('the buffers are only reallocated when the scale actually changes', () => {
  const motion = new MotionResolution();
  assert.equal(motion.shouldApply(1), true, 'first application');
  assert.equal(motion.shouldApply(1), false, 'same scale does nothing');
  assert.equal(motion.shouldApply(0.7), true, 'a real change applies');
  assert.equal(motion.shouldApply(0.705), false, 'noise does not');
});

test('Very High targets 1440p, between High and Ultra', () => {
  const veryHigh = graphicsBudget('veryHigh');
  assert.equal(veryHigh.pixels, 2560 * 1440);
  assert.ok(veryHigh.pixels > graphicsBudget('high').pixels, 'above High');
  assert.ok(veryHigh.pixels < graphicsBudget('ultra').pixels, 'below Ultra');
  // 1440p at dpr 1 is exactly the budget, so the tier renders natively rather than upscaling.
  assert.equal(budgetDpr(veryHigh, 2560, 1440, 2), 1);
  assert.ok(veryHigh.bloom && !veryHigh.glassTransmission && veryHigh.shadowLights === 3);
  assert.equal(budgetDpr(veryHigh, 2560, 1440, 2, 16384, 16384, veryHigh.motionPixelScale), 1);
});

test('every tier spends no more pixels while moving than standing still', () => {
  for (const quality of ['performance', 'auto', 'high', 'veryHigh', 'ultra'] as RenderQuality[]) {
    const budget = graphicsBudget(quality);
    assert.ok(budget.motionPixelScale > 0 && budget.motionPixelScale <= 1, `${quality} motion scale`);
    const still = budgetDpr(budget, 2560, 1440, 2),
      moving = budgetDpr(budget, 2560, 1440, 2, 16384, 16384, budget.motionPixelScale);
    assert.ok(moving <= still, `${quality} does not render more pixels while moving`);
  }
});

test('Very High keeps native 1440p in motion while lower tiers and Ultra can scale', () => {
  assert.equal(graphicsBudget('veryHigh').motionPixelScale, 1);
  assert.ok(graphicsBudget('auto').motionPixelScale < 1);
  assert.ok(graphicsBudget('high').motionPixelScale < 1);
  assert.ok(graphicsBudget('ultra').motionPixelScale < 1);
  assert.equal(graphicsBudget('performance').motionPixelScale, 1);
});

test('slow 120 Hz movement accumulates and camera parent movement and zoom count', () => {
  const motion = new MotionResolution(),
    cam = camera(),
    parent = new THREE.Group();
  parent.add(cam);
  motion.sample(cam, 8.33, 0.8);
  for (let i = 0; i < 12; i++) {
    cam.position.x += 0.00002;
    motion.sample(cam, 8.33, 0.8);
  }
  assert.equal(motion.moving, true, 'slow motion is not lost by resetting the comparison each frame');
  motion.sample(cam, 500, 0.8);
  assert.equal(motion.moving, false);
  parent.position.x = 1;
  assert.equal(motion.sample(cam, 8.33, 0.8), 0.8);
  motion.sample(cam, 500, 0.8);
  cam.fov = 40;
  cam.updateProjectionMatrix();
  assert.equal(motion.sample(cam, 8.33, 0.8), 0.8);
  motion.sample(cam, 500, 0.8);
  cam.rotateY(0.001);
  assert.equal(motion.sample(cam, 8.33, 0.8), 0.8, 'gentle rotation counts');
});

test('invalid timing and scale values cannot poison render resolution', () => {
  const motion = new MotionResolution(),
    cam = camera();
  motion.sample(cam, 16, 0.8);
  cam.position.x = 1;
  assert.equal(motion.sample(cam, NaN, NaN), 1);
  assert.equal(motion.sample(cam, 500, 0.8), 1);
  assert.ok(Number.isFinite(budgetDpr(graphicsBudget('high'), 2560, 1440, 2, 16384, 16384, NaN)));
});
