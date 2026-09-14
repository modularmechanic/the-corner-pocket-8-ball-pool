import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RoomReflections } from '../src/render/room-reflections';
import type { SettledProps } from '../src/render/asset-installer';

test('reflections capture when the table is stable, once when the pub settles, then after later swaps', async () => {
  let settle!: (result: SettledProps) => void;
  const props = { revision: 0, settled: () => new Promise<SettledProps>(resolve => settle = resolve) };
  const renderer = { extensions: { has: () => false }, compile: () => {} } as unknown as THREE.WebGLRenderer;
  const reflections = new RoomReflections(renderer, new THREE.Scene(), () => [], capture => capture(), props);
  let captures = 0;
  (reflections as unknown as { capture: () => void }).capture = () => captures++;
  const frames = (seconds: number, idle = true) => { for (let t = 0; t < seconds; t += .1) reflections.update(.1, idle); };

  frames(2); assert.equal(captures, 0, 'the table and its first props are still being built');
  frames(.3); assert.equal(captures, 1);
  props.revision = 5; frames(10); assert.equal(captures, 1, 'swaps before the pub settles wait');
  settle({ loaded: [], failed: [] }); await Promise.resolve();
  frames(.2); assert.equal(captures, 2, 'the settled pub is captured once');
  frames(10); assert.equal(captures, 2);
  props.revision = 6; frames(3, false); assert.equal(captures, 2, 'never while balls roll');
  frames(.2); assert.equal(captures, 3, 'a later swap recaptures');
  props.revision = 7; frames(5); assert.equal(captures, 3, 'the cooldown still holds');
  frames(4); assert.equal(captures, 4);
  reflections.dispose();
});

test('a prop request that never answers cannot freeze reflections on the placeholder capture', () => {
  const props = { revision: 0, settled: () => new Promise<SettledProps>(() => {}) };
  const renderer = { extensions: { has: () => false }, compile: () => {} } as unknown as THREE.WebGLRenderer;
  const reflections = new RoomReflections(renderer, new THREE.Scene(), () => [], capture => capture(), props);
  let captures = 0;
  (reflections as unknown as { capture: () => void }).capture = () => captures++;
  const frames = (seconds: number) => { for (let t = 0; t < seconds; t += .1) reflections.update(.1, true); };
  frames(2.3); assert.equal(captures, 1);
  props.revision = 3; frames(12); assert.equal(captures, 1, 'props are still arriving');
  frames(1); assert.equal(captures, 2, 'after 15 seconds the pub is treated as settled');
  frames(20); assert.equal(captures, 2);
  reflections.dispose();
});
