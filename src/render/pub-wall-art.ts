import { PUB_LAYOUT, pubFrontZ } from './pub-layout';
import type { PubPlacement } from './pub-models';

/** Hanging pictures by hand is how frames end up on top of each other: a frame is about 1.3 times
 * wider than it is tall, so a list of positions that looks evenly spaced in the source overlaps once
 * the models load. Everything here works from real footprints instead.
 *
 * A wall is described by what is already on it — openings, screens, sconces, the darts cabinet — and
 * the courses are fitted into what is left. `tests/pub-wall-art.test.ts` asserts that nothing the
 * layout produces overlaps anything else, on any wall. */

export interface Span {
  from: number;
  to: number;
}
/** Something already on the wall: a span along it, over a height band. */
export interface Obstacle extends Span {
  bottom: number;
  top: number;
  what: string;
}

/** Width as a multiple of height, measured from the loaded models: all three memorabilia pieces are
 * the same 0.9 x 0.7 plate, so they all lay out at the same width. Guessing these is what put frames
 * on top of each other before — the layout believed two of them were up to a fifth narrower. */
export const FRAME_ASPECT = { frame: 1.286, stout: 1.286, darts: 1.286 } as const;
export type FrameKind = keyof typeof FRAME_ASPECT;
const KINDS = ['frame', 'stout', 'darts'] as const;

export interface HungPiece {
  kind: FrameKind;
  along: number;
  width: number;
}

/** What is left of `extent` once every blocking span is removed. */
export function clearSpans(extent: Span, blocked: readonly Span[]): Span[] {
  let runs: Span[] = [extent];
  for (const block of blocked) {
    const next: Span[] = [];
    for (const run of runs) {
      if (block.to <= run.from || block.from >= run.to) {
        next.push(run);
        continue;
      }
      if (block.from > run.from) next.push({ from: run.from, to: block.from });
      if (block.to < run.to) next.push({ from: block.to, to: run.to });
    }
    runs = next;
  }
  return runs.filter((run) => run.to - run.from > 0.01);
}

/** Obstacles that reach into a course's height band, as spans along the wall. */
export function blockingAt(obstacles: readonly Obstacle[], bottom: number, top: number): Span[] {
  return obstacles.filter((o) => o.top > bottom && o.bottom < top).map(({ from, to }) => ({ from, to }));
}

export interface Course {
  /** Centre height of the course; every piece in it shares a height so tops and bottoms line up. */
  centre: number;
  height: number;
  /** Clear space between neighbours and at the ends of a run. */
  gap: number;
}

/** Fit as many pieces as each clear run holds, centred in it, never closer than `gap`.
 * A run too short for one piece yields nothing rather than something overlapping. */
export function hangCourse(runs: readonly Span[], course: Course, startAt = 0): HungPiece[] {
  const hung: HungPiece[] = [];
  let cycle = startAt;
  for (const run of runs) {
    const span = run.to - run.from - course.gap * 2;
    if (span <= 0) continue;
    const fitted: FrameKind[] = [];
    let used = -course.gap;
    for (let i = 0; ; i++) {
      const kind = KINDS[(cycle + i) % KINDS.length];
      const width = FRAME_ASPECT[kind] * course.height;
      if (used + course.gap + width > span) break;
      used += course.gap + width;
      fitted.push(kind);
    }
    if (!fitted.length) continue;
    let cursor = run.from + course.gap + (span - used) / 2;
    for (const kind of fitted) {
      const width = FRAME_ASPECT[kind] * course.height;
      hung.push({ kind, along: +(cursor + width / 2).toFixed(3), width: +width.toFixed(3) });
      cursor += width + course.gap;
    }
    cycle += fitted.length;
  }
  return hung;
}

export interface HungPlacement extends PubPlacement {
  kind: FrameKind;
  /** Kept so the overlap test can reason about footprints without loading the models. */
  width: number;
  /** Position along the wall, and the bottom of the course, for the same reason. */
  along: number;
  courseBottom: number;
}

/** Hang every course a wall can take, skipping whatever is already on it. */
export function dressWall(
  extent: Span,
  obstacles: readonly Obstacle[],
  courses: readonly Course[],
  toPlacement: (piece: HungPiece, course: Course) => Omit<HungPlacement, 'along' | 'courseBottom'>,
): HungPlacement[] {
  const out: HungPlacement[] = [];
  let cycle = 0;
  for (const course of courses) {
    const bottom = course.centre - course.height / 2,
      top = course.centre + course.height / 2;
    // Courses must clear each other as well as the fittings, so each one is hung against the
    // footprints of the courses already up.
    const hungSoFar: Obstacle[] = out.map((p) => ({
      from: p.along - p.width / 2,
      to: p.along + p.width / 2,
      bottom: p.courseBottom,
      top: p.courseBottom + p.height!,
      what: 'hung course',
    }));
    const blocked = blockingAt([...obstacles, ...hungSoFar], bottom, top);
    const hung = hangCourse(clearSpans(extent, blocked), course, cycle);
    cycle += hung.length;
    for (const piece of hung) out.push({ ...toPlacement(piece, course), along: piece.along, courseBottom: bottom });
  }
  return out;
}

/** Window bays sit at these z on both side walls and are 4.55 wide. */
export const BAY_Z = [-8.4, -2.6, 3.2, 9].map((z) => z * PUB_LAYOUT.expansion);
export const BAY_HALF = 2.275;
/** Wall sconces: brass lamps at 3.45 to 3.9, which a high course would otherwise hang through. */
export const SCONCE_Z = 3.4;
export const SCONCE_FRONT_X = [-10.45, 7.9].map((x) => x + Math.sign(x) * PUB_LAYOUT.sideShift);

/** The glazed opening itself: 4.65 tall centred at 1.7, so there is solid wall above and below it. */
const bays = (indices: readonly number[]): Obstacle[] =>
  indices.map((index) => ({
    from: BAY_Z[index] - BAY_HALF,
    to: BAY_Z[index] + BAY_HALF,
    bottom: -0.65,
    top: 4.05,
    what: `window bay ${index}`,
  }));

/** A screen of a given height centred on the wall at `along`, using the TV model's own proportions. */
export const screenObstacle = (along: number, centreY: number, height: number, what: string): Obstacle => {
  const width = height * 1.6;
  return {
    from: along - width / 2,
    to: along + width / 2,
    bottom: centreY - height / 2,
    top: centreY + height / 2,
    what,
  };
};

export const WALL_OBSTACLES = {
  /** Left wall: four window bays, a sconce, the slot machines and the generated screen. */
  left: (screenZ: number, screenY: number, screenHeight: number): Obstacle[] => [
    ...bays([0, 1, 2, 3]),
    { from: SCONCE_Z - 0.6, to: SCONCE_Z + 0.6, bottom: 3.3, top: 4.1, what: 'sconce' },
    screenObstacle(screenZ, screenY, screenHeight, 'generated screen'),
    { from: 1.6, to: 9.4, bottom: -3.6, top: 1.0, what: 'slot machines' },
    // The club display run: a 15.6-long cabinet of posters standing 3.5 proud of this wall, which
    // hides anything hung behind it. Measured in the built room.
    { from: -7.7, to: 8.3, bottom: 0.65, top: 4.95, what: 'club display run' },
  ],
  /** Right wall: bays 1 and 2 are brick, which takes a picture; the outer two are glazed. */
  right: (televisions: readonly { z: number; y: number; height: number }[]): Obstacle[] => [
    ...bays([0, 3]),
    { from: SCONCE_Z - 0.6, to: SCONCE_Z + 0.6, bottom: 3.3, top: 4.1, what: 'sconce' },
    ...televisions.map((tv, index) => screenObstacle(tv.z, tv.y + tv.height / 2, tv.height, `television ${index}`)),
    // The room's own right-hand gallery, from its placements: centres -4.97, -2.54 and 4.64, at
    // heights 1.52, 1.58 and 2.28, each 1.286 times as wide as it is tall.
    { from: -5.95, to: -3.99, bottom: 1.57, top: 3.09, what: 'club gallery 0' },
    { from: -3.56, to: -1.52, bottom: 0.82, top: 2.4, what: 'club gallery 1' },
    { from: 3.17, to: 6.11, bottom: 0.48, top: 2.76, what: 'club gallery 2' },
    // The decade photograph wall, measured in the built room.
    { from: -4.01, to: 5.01, bottom: 3.13, top: 5.8, what: 'pool history wall' },
  ],
  /** Entrance wall: the doorway, the darts cabinet, the chimney breast and a sconce. */
  entrance: (dartboardX: number, dartboardWidth: number): Obstacle[] => [
    { from: -3.4, to: 3.4, bottom: -3.6, top: 6, what: 'doorway and sidelights' },
    {
      from: dartboardX - dartboardWidth / 2 - 0.3,
      to: dartboardX + dartboardWidth / 2 + 0.3,
      bottom: 0.2,
      top: 3.1,
      what: 'darts cabinet',
    },
    { from: 11.2, to: 20.1, bottom: -3.6, top: 6, what: 'chimney breast' },
    { from: SCONCE_FRONT_X[0] - 0.6, to: SCONCE_FRONT_X[0] + 0.6, bottom: 3.3, top: 4.1, what: 'sconce' },
    // The authored team photographs and the decade display, measured in the built room.
    { from: -20.3, to: -17.15, bottom: -0.4, top: 5.4, what: 'team photographs 0' },
    { from: -16.7, to: -13.8, bottom: 0.05, top: 5.35, what: 'team photographs 1' },
    { from: -13.9, to: -11.95, bottom: 3.6, top: 5.1, what: 'team photographs 2' },
    { from: -6.5, to: 6.9, bottom: 0.05, top: 5.95, what: 'pool history display' },
  ],
  /** Bar wall: the house sign and the shelving below the clear band. */
  barWall: (): Obstacle[] => [
    { from: -4.8, to: 4.8, bottom: 3.4, top: 5.4, what: 'house sign' },
    { from: 10.6, to: 14.0, bottom: 3.6, top: 5.85, what: 'pool history display' },
    { from: -22, to: 22, bottom: -3.6, top: 3.6, what: 'back bar shelving' },
  ],
};

/** The long walls, inset so a frame never runs into the corner. */
export const WALL_EXTENT = {
  side: { from: PUB_LAYOUT.bounds.back + 1.2, to: pubFrontZ(11.2) },
  entrance: { from: PUB_LAYOUT.bounds.left + 1.2, to: PUB_LAYOUT.bounds.right - 1.2 },
  barWall: { from: PUB_LAYOUT.bounds.left + 2, to: PUB_LAYOUT.bounds.right - 2 },
  chimney: { from: 12.2, to: 19.1 },
};
