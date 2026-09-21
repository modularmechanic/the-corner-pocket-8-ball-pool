import test from 'node:test';
import assert from 'node:assert/strict';
import { WALL_COURSES } from '../src/render/pub-dressing';
import {
  WALL_EXTENT,
  WALL_OBSTACLES,
  clearSpans,
  type HungPlacement,
  type Obstacle,
} from '../src/render/pub-wall-art';
import { pubSideX } from '../src/render/pub-layout';

/** Every wall's own obstacles, keyed the same way the dressing hangs them. */
const DARTBOARD = { x: pubSideX(-4.82), width: 2.34 * 1.33 };
const TELEVISIONS = [
  { z: -7.98, y: 2.1, height: 2.3 },
  { z: 8.85, y: 2.1, height: 2.3 },
];
const walls: Record<string, { course: HungPlacement[]; obstacles: Obstacle[] }> = {
  entrance: {
    course: WALL_COURSES.entrance,
    obstacles: WALL_OBSTACLES.entrance(DARTBOARD.x, DARTBOARD.width),
  },
  left: { course: WALL_COURSES.left, obstacles: WALL_OBSTACLES.left(8.85, 3.25, 2.3) },
  right: { course: WALL_COURSES.right, obstacles: WALL_OBSTACLES.right(TELEVISIONS) },
  barWall: { course: WALL_COURSES.barWall, obstacles: WALL_OBSTACLES.barWall() },
  chimney: { course: WALL_COURSES.chimney, obstacles: [] },
};

const footprint = (piece: HungPlacement) => ({
  from: piece.along - piece.width / 2,
  to: piece.along + piece.width / 2,
  bottom: piece.courseBottom,
  top: piece.courseBottom + piece.height!,
});
const overlaps = (a: ReturnType<typeof footprint>, b: { from: number; to: number; bottom: number; top: number }) =>
  a.to > b.from + 1e-6 && b.to > a.from + 1e-6 && a.top > b.bottom + 1e-6 && b.top > a.bottom + 1e-6;

test('no two hung pictures overlap, on any wall', () => {
  for (const [name, { course }] of Object.entries(walls)) {
    for (let i = 0; i < course.length; i++)
      for (let j = i + 1; j < course.length; j++) {
        const a = footprint(course[i]),
          b = footprint(course[j]);
        assert.ok(
          !overlaps(a, b),
          `${name}: ${course[i].kind} at ${course[i].along} overlaps ${course[j].kind} at ${course[j].along}`,
        );
      }
  }
});

test('no hung picture covers a window, screen, sconce, doorway or the darts cabinet', () => {
  for (const [name, { course, obstacles }] of Object.entries(walls))
    for (const piece of course) {
      const box = footprint(piece);
      for (const obstacle of obstacles)
        assert.ok(
          !overlaps(box, obstacle),
          `${name}: ${piece.kind} at ${piece.along} covers ${obstacle.what}`,
        );
    }
});

test('every hung picture stays inside its wall', () => {
  const extents = {
    entrance: WALL_EXTENT.entrance,
    left: WALL_EXTENT.side,
    right: WALL_EXTENT.side,
    barWall: WALL_EXTENT.barWall,
    chimney: WALL_EXTENT.chimney,
  };
  for (const [name, { course }] of Object.entries(walls)) {
    const extent = extents[name as keyof typeof extents];
    for (const piece of course) {
      const box = footprint(piece);
      assert.ok(box.from >= extent.from - 1e-6, `${name}: ${piece.kind} runs off the near end`);
      assert.ok(box.to <= extent.to + 1e-6, `${name}: ${piece.kind} runs off the far end`);
    }
  }
});

test('the walls carry a picture in every stretch wide enough to hold one', () => {
  // The dressing is only worth having if it actually fills the walls: each one should hang several.
  for (const [name, { course }] of Object.entries(walls))
    assert.ok(course.length >= 2, `${name} carries only ${course.length} pictures`);
  const total = Object.values(walls).reduce((sum, wall) => sum + wall.course.length, 0);
  assert.ok(total >= 18, `the room carries only ${total} pictures`);
});

test('clearing a span around an obstacle leaves the stretches either side', () => {
  const runs = clearSpans({ from: 0, to: 10 }, [{ from: 4, to: 6 }]);
  assert.deepEqual(runs, [
    { from: 0, to: 4 },
    { from: 6, to: 10 },
  ]);
});
