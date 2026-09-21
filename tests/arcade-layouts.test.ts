import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HAZARDS, LAYOUTS } from '../src/simulation/arcade';

/** Golden parity for corner-pocket-bevy/sim/src/simulation/arcade.rs: `LAYOUTS` and `hazards_of` there must hold the
 * exact same numbers as `LAYOUTS`/`HAZARDS` here, key for key, block for block, hazard for hazard. Whoever changes
 * one side must update the other and this pinned literal, so the two arena tables cannot silently drift apart. */
test('every arcade layout matches its pinned data, so the TypeScript and Rust tables cannot drift apart', () => {
  assert.deepEqual(LAYOUTS, {
    crossfire: {
      name: 'Crossfire',
      blocks: [
        [-0.4, -1.15, 0.32, 1.12, 2, 'wood'],
        [0.65, -1.65, 1, 0.28, 1, 'wood'],
        [0.65, 1.65, 1, 0.28, 1, 'wood'],
        [-3.6, -1.9, 0.72, 0.3, 1, 'wood'],
        [-3.6, 1.9, 0.72, 0.3, 1, 'wood'],
        [4.8, -1.65, 0.3, 0.72, 3, 'steel'],
        [4.8, 1.65, 0.3, 0.72, 3, 'steel'],
      ],
    },
    fortress: {
      name: 'Fortress',
      blocks: [
        [0.75, -0.95, 0.28, 0.95, 3, 'steel'],
        [0.75, 0.95, 0.28, 0.95, 3, 'steel'],
        [2.05, -1.85, 1.15, 0.3, 2, 'wood'],
        [2.05, 1.85, 1.15, 0.3, 2, 'wood'],
        [4.1, -1.85, 1.1, 0.3, 4, 'steel'],
        [4.1, 1.85, 1.1, 0.3, 4, 'steel'],
        [-2.7, -2.2, 1.05, 0.26, 1, 'wood'],
        [-2.7, 2.2, 1.05, 0.26, 1, 'wood'],
      ],
    },
    gauntlet: {
      name: 'Hex Gauntlet',
      blocks: [
        [-1.1, -1.1, 0.35, 1, 2, 'hex'],
        [0.25, 1.1, 0.35, 1, 2, 'hex'],
        [1.5, -1.15, 0.32, 0.9, 3, 'steel'],
        [-3.8, 1.75, 0.85, 0.3, 1, 'wood'],
        [3.35, -2.05, 0.95, 0.32, 2, 'hex'],
        [3.35, 2.05, 0.95, 0.32, 2, 'hex'],
        [4.85, 0, 0.28, 1.2, 4, 'steel'],
      ],
    },
    riptide: {
      name: 'Riptide',
      blocks: [
        [-2.6, -2.0, 0.9, 0.3, 1, 'wood'],
        [-2.6, 2.0, 0.9, 0.3, 1, 'wood'],
        [2.2, -1.3, 0.32, 1.0, 2, 'steel'],
        [2.2, 1.3, 0.32, 1.0, 2, 'steel'],
        [4.6, 0, 0.3, 1.3, 3, 'steel'],
      ],
    },
    livewire: {
      name: 'Live Wire',
      blocks: [
        [1.0, -1.0, 0.3, 1.0, 3, 'steel'],
        [1.0, 1.0, 0.3, 1.0, 3, 'steel'],
        [-1.3, 0, 0.3, 0.9, 2, 'steel'],
        [3.6, -1.9, 0.9, 0.3, 2, 'wood'],
        [3.6, 1.9, 0.9, 0.3, 2, 'wood'],
        [-4.3, -1.3, 0.3, 0.9, 4, 'steel'],
        [-4.3, 1.3, 0.3, 0.9, 4, 'steel'],
      ],
    },
    blackout: {
      name: 'Blackout',
      blocks: [
        [-0.8, -1.3, 0.35, 0.95, 2, 'hex'],
        [-0.8, 1.3, 0.35, 0.95, 2, 'hex'],
        [1.8, 0, 0.3, 1.1, 3, 'hex'],
        [-3.4, 0, 0.3, 0.9, 2, 'wood'],
        [4.4, -1.7, 0.9, 0.3, 3, 'steel'],
        [4.4, 1.7, 0.9, 0.3, 3, 'steel'],
      ],
    },
  });
  assert.deepEqual(HAZARDS, {
    crossfire: [
      { kind: 'ramp', x: -1.2, z: 1.15, radius: 0.58, angle: 0 },
      { kind: 'water', x: 2, z: -1.65, radius: 0.65 },
      { kind: 'smoke', x: -4.4, z: -1.2, radius: 0.5 },
    ],
    fortress: [
      { kind: 'electric', x: -1.1, z: -1.45, radius: 0.55 },
      { kind: 'electric', x: 4.7, z: 0.85, radius: 0.45 },
      { kind: 'water', x: -3.9, z: 1.05, radius: 0.75 },
      { kind: 'smoke', x: 1.9, z: 1.15, radius: 0.55 },
      { kind: 'ramp', x: -0.6, z: 1.25, radius: 0.52, angle: 0 },
    ],
    gauntlet: [
      { kind: 'slime', x: -2.9, z: 1.5, radius: 0.65 },
      { kind: 'smoke', x: 2.6, z: -1.15, radius: 0.6 },
      { kind: 'electric', x: 0.1, z: -1.45, radius: 0.45 },
    ],
    riptide: [
      { kind: 'water', x: -1.0, z: 0, radius: 0.7 },
      { kind: 'slime', x: 1.4, z: -1.8, radius: 0.6 },
      { kind: 'ramp', x: -3.9, z: 1.4, radius: 0.55, angle: 0 },
    ],
    livewire: [
      { kind: 'electric', x: 0, z: -1.5, radius: 0.5 },
      { kind: 'electric', x: 0, z: 1.5, radius: 0.5 },
      { kind: 'ramp', x: -2.5, z: 0, radius: 0.5, angle: 0 },
    ],
    blackout: [
      { kind: 'smoke', x: -2.0, z: -1.6, radius: 0.6 },
      { kind: 'smoke', x: 2.6, z: 1.6, radius: 0.6 },
      { kind: 'electric', x: 0, z: 0, radius: 0.45 },
    ],
  });
});
