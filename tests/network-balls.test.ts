import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpolateBalls } from '../src/match/interpolate';
import type { Ball } from '../src/simulation/types';
const ball = (overrides: Partial<Ball> = {}): Ball => ({
  id: 0,
  x: 0,
  z: 0,
  vx: 0,
  vz: 0,
  pocketed: false,
  ...overrides,
});

test('network flight uses the same time sample for height, horizontal travel and vertical velocity', () => {
  const start = ball({ x: 1, z: 2, vx: 4, elevation: 0.6, vy: 2, airborne: true });
  const end = ball({ x: 3, z: 4, vx: 2, elevation: 0.2, vy: -2, airborne: true });
  const sample = interpolateBalls([start], [end], 0.25)[0];
  assert.equal(sample.x, 1.5);
  assert.equal(sample.z, 2.5);
  assert.equal(sample.vx, 3.5);
  assert.equal(sample.elevation, 0.5);
  assert.equal(sample.vy, 1);
  assert.equal(sample.airborne, true);
  const landing = interpolateBalls([end], [ball({ x: 4 })], 1)[0];
  assert.equal(landing.elevation, 0);
  assert.equal(landing.vy, 0);
  assert.equal(landing.airborne, false);
});

test('network presentation does not interpolate a flight through a pot, portal or replaced ball', () => {
  const start = ball({ elevation: 0.8, airborne: true });
  for (const end of [ball({ pocketed: true }), ball({ teleport: 1 }), ball({ id: 1 })])
    assert.equal(interpolateBalls([start], [end], 0.5)[0], start);
  assert.equal(interpolateBalls([start], [], 0.5)[0], start);
});
