import test from 'node:test';
import assert from 'node:assert/strict';
import { PUB_ENTERTAINMENT, pubBroadcastFrame } from '../src/render/pub-entertainment';
import { PUB_LAYOUT } from '../src/render/pub-layout';

test('three cabinets and two large televisions fit the expanded room outside the cue aisle', () => {
  assert.equal(PUB_ENTERTAINMENT.slots.length, 3);
  assert.equal(PUB_ENTERTAINMENT.televisions.length, 2);
  for (const cabinet of PUB_ENTERTAINMENT.slots) {
    assert.ok(cabinet.x > PUB_LAYOUT.bounds.left && cabinet.x < -15);
    assert.equal(cabinet.y, PUB_LAYOUT.floor);
    assert.ok(cabinet.z > 1 && cabinet.z < 11);
    assert.equal(cabinet.rotation, Math.PI / 2);
    assert.ok(cabinet.height > 4);
  }
  for (const tv of PUB_ENTERTAINMENT.televisions) {
    assert.ok(tv.x > 15 && tv.x < PUB_LAYOUT.bounds.right);
    assert.ok(tv.y + tv.height < PUB_LAYOUT.bounds.ceiling);
    assert.ok(tv.z - 2.7 > PUB_LAYOUT.bounds.back && tv.z + 2.7 < PUB_LAYOUT.bounds.front);
    assert.equal(tv.rotation, -Math.PI / 2);
  }
});

test('fictional soccer and rugby broadcasts keep all action in the field across long sessions', () => {
  for (const sport of ['soccer', 'rugby'] as const) {
    const initial = pubBroadcastFrame(sport, 0);
    assert.equal(initial.players.length, sport === 'soccer' ? 22 : 30);
    assert.notDeepEqual(pubBroadcastFrame(sport, 3).ball, initial.ball, 'the broadcast contains actual moving action');
    assert.deepEqual(
      pubBroadcastFrame(sport, 3),
      pubBroadcastFrame(sport, 3),
      'every television runs deterministic channel animation',
    );
    for (let time = 0; time < 86400; time += 97) {
      const frame = pubBroadcastFrame(sport, time);
      assert.match(frame.clock, /^\d{2}:\d{2}$/);
      for (const point of [...frame.players, frame.ball])
        assert.ok(
          Number.isFinite(point.x) &&
            Number.isFinite(point.y) &&
            point.x >= 0 &&
            point.x <= 1 &&
            point.y >= 0 &&
            point.y <= 1,
        );
    }
  }
});
