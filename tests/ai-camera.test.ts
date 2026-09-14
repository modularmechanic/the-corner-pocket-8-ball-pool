import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { initPhysics } from '../src/simulation/game';
import { LocalMatch } from '../src/match/local';
import { ShotCameraRig } from '../src/render/shot-camera';

before(initPhysics);

test('AI keeps its plan and the game clock running while waiting for camera alignment, then performs a fresh backswing', () => {
  let choices = 0;
  const match = new LocalMatch({
    seed: 'camera-gated-ai',
    mode: 'ai',
    random: () => {
      choices++;
      return 0.5;
    },
  });
  try {
    const state = match.snapshot();
    state.turn = 1;
    match.arrange(state);
    match.update(0.1, { aiCameraReady: false });
    const angle = match.aiPreview!.angle,
      calls = choices;
    for (let i = 0; i < 30; i++) match.update(0.1, { aiCameraReady: false });
    assert.equal(match.state.phase, 'ready');
    assert.equal(match.aiPreview!.power, 0);
    assert.equal(match.aiPreview!.angle, angle);
    assert.equal(choices, calls);
    assert.ok(match.state.arcade!.clock! >= 3);
    assert.equal(match.drainEvents().filter((event) => event.kind === 'cue').length, 0);
    for (let i = 0; i < 4; i++) match.update(0.1, { aiCameraReady: true });
    assert.ok(match.aiPreview!.power > 0);
    match.update(0.1, { aiCameraReady: false });
    assert.equal(match.aiPreview!.power, 0, 'rotating the view cancels a partially drawn stroke');
    for (let i = 0; i < 5; i++) match.update(0.1, { aiCameraReady: true });
    assert.equal(match.state.phase, 'ready');
    for (let i = 0; i < 3; i++) match.update(0.1, { aiCameraReady: true });
    assert.equal(match.state.phase, 'rolling');
    assert.equal(match.drainEvents().filter((event) => event.kind === 'cue').length, 1);
  } finally {
    match.dispose();
  }
});

test('all AI seats wait for the actual camera transition to settle before their stroke starts', () => {
  for (const seat of [1, 2, 3]) {
    const match = new LocalMatch({
      seed: `aligned-ai-${seat}`,
      mode: 'ai',
      options: { format: 'doubles' },
      random: () => 0.5,
    });
    try {
      const state = match.snapshot();
      state.turn = (seat % 2) as 0 | 1;
      state.teamOrder[state.turn] = seat >= 2 ? 1 : 0;
      match.arrange(state);
      const camera = new THREE.PerspectiveCamera(),
        rig = new ShotCameraRig();
      rig.update(camera, state, { angle: 1.1 }, 16 / 9, 0);
      let firstSettled = -1,
        struck = -1;
      for (let frame = 0; frame < 240; frame++) {
        const dt = 1 / 120,
          ready = !!match.aiPreview && rig.isSettled;
        match.update(dt, { aiCameraReady: ready });
        const preview = match.aiPreview ?? match.state.lastShot ?? { angle: 1.1, power: 0.5 };
        rig.update(camera, match.state, preview, 16 / 9, dt, true);
        if (rig.isSettled && firstSettled < 0) firstSettled = frame * dt;
        if (match.state.phase === 'rolling') {
          struck = frame * dt;
          break;
        }
        if (!rig.isSettled) assert.equal(match.aiPreview?.power, 0, 'backswing waits for the moving view');
      }
      assert.ok(firstSettled >= 0.55 && firstSettled <= 0.6);
      assert.ok(struck - firstSettled >= 0.7, 'stable hold and stroke follow camera alignment');
      assert.ok(struck < 1.5, 'alignment is event-driven, without a long universal AI delay');
    } finally {
      match.dispose();
    }
  }
});
