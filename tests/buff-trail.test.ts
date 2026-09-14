import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BuffTrail, BUFF_TRAIL_CAPACITY } from '../src/render/buff-trail';

test('buff trail draws from its second point and keeps the newest points in a fixed buffer', () => {
  const trail = new BuffTrail(),
    geometry = trail.line.geometry,
    position = geometry.getAttribute('position');
  const warnings: unknown[] = [],
    warn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    trail.push(0, 0.03, 0);
    assert.equal(trail.line.visible, false, 'a single point is not a line');
    trail.push(0.01, 0.03, 0);
    assert.equal(geometry.drawRange.count, 1, 'points closer than the spacing are skipped');
    for (let i = 1; i <= 30; i++) trail.push(i * 0.1, 0.03, 0);
    assert.equal(trail.line.visible, true);
    assert.equal(geometry.getAttribute('position'), position, 'the buffer is never reallocated');
    assert.equal(position.count, BUFF_TRAIL_CAPACITY);
    assert.equal(geometry.drawRange.count, BUFF_TRAIL_CAPACITY);
    assert.ok(
      Math.abs(position.getX(0) - 1.9) < 1e-6 && Math.abs(position.getX(BUFF_TRAIL_CAPACITY - 1) - 3) < 1e-6,
      'oldest points shift out',
    );
    trail.clear();
    assert.equal(trail.line.visible, false);
    assert.equal(geometry.drawRange.count, 0);
    trail.push(5, 0.03, 5);
    trail.push(5.1, 0.03, 5);
    assert.equal(geometry.drawRange.count, 2);
    assert.equal(position.getX(0), 5);
    assert.deepEqual(warnings, []);
  } finally {
    console.warn = warn;
  }
});
