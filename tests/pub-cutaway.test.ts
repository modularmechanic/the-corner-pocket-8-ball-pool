import test from 'node:test';
import assert from 'node:assert/strict';
import { pubCutaway, PUB_BOUNDS } from '../src/render/pub-interior';

// Camera positions are derived from the room's own bounds rather than hard-coded, so enlarging the
// pub (as the 12-foot snooker table required) cannot silently invalidate what these assert. `out`
// is comfortably beyond a wall; `inside` is comfortably within it.
const out = (edge: number) => edge + Math.sign(edge) * 2;
const inside = (edge: number) => edge - Math.sign(edge) * 2;

test('interior view retains all four walls and ceiling', () => {
  assert.deepEqual(pubCutaway({ x: inside(PUB_BOUNDS.left), y: 3, z: 0 }), {
    left: true,
    right: true,
    back: true,
    front: true,
    ceiling: true,
  });
});
test('outside orbit removes only the near walls and roof', () => {
  assert.deepEqual(pubCutaway({ x: out(PUB_BOUNDS.left), y: 11, z: out(PUB_BOUNDS.front) }), {
    left: false,
    right: true,
    back: true,
    front: false,
    ceiling: false,
  });
  assert.deepEqual(pubCutaway({ x: out(PUB_BOUNDS.right), y: 3, z: out(PUB_BOUNDS.back) }), {
    left: true,
    right: false,
    back: false,
    front: true,
    ceiling: true,
  });
});
test('overhead view opens the ceiling while retaining the entire room perimeter', () => {
  assert.deepEqual(pubCutaway({ x: 0, y: 23, z: -1.8 }), {
    left: true,
    right: true,
    back: true,
    front: true,
    ceiling: false,
  });
});
