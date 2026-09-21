import test from 'node:test';
import assert from 'node:assert/strict';
import { shelfBottlePositions } from '../src/render/pub-bottle-layout';

test('both bottle families share 20 evenly spaced slots per shelf without collisions or shelf overhang', () => {
  for (let row = 0; row < 3; row++) {
    const positions = [...shelfBottlePositions(row, 'classic'), ...shelfBottlePositions(row, 'labelled')].sort(
      (a, b) => a - b,
    );
    assert.equal(positions.length, 20);
    assert.ok(positions[0] >= -7.6 && positions.at(-1)! <= 7.6);
    for (let i = 1; i < positions.length; i++) assert.ok(positions[i] - positions[i - 1] >= 0.7499);
  }
});
