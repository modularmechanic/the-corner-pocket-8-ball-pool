import * as THREE from 'three';
import { TABLE } from '../simulation/types';
import { nosesOf } from '../simulation/table-geometry';
import { EIGHT_BALL_TABLE, type TablePoint, type TableSpec } from '../simulation/modes/table';
import type { TableSurfaces } from './table-surfaces';

// The visible aperture is slightly wider than the simulated capture circle.
// No trim crosses this radius; the only cap sits below the full pocket throat.
export const apertureOf = (spec: TableSpec) => spec.pocketRadius + 0.012;
export const POCKET_APERTURE = apertureOf(EIGHT_BALL_TABLE);
/** Every piece of pocket hardware is a pool-table measurement times the mode's mouth scale, so a tighter
 * snooker pocket takes its whole casting in with it. One for the eight-ball table, hence unchanged there. */
const mouthScale = (spec: TableSpec) => spec.pocketRadius / TABLE.pocketRadius;
const THROAT_CLEARANCE = 0.342;
type PocketMaterials = Pick<TableSurfaces, 'brass' | 'leather' | 'rubber' | 'pocketVoid'>;

function roundedOutline(width: number, depth: number, radius: number): THREE.Shape {
  const shape = new THREE.Shape(),
    x = width / 2,
    z = depth / 2,
    r = Math.min(radius, x, z);
  shape.moveTo(-x + r, -z);
  shape.lineTo(x - r, -z);
  shape.quadraticCurveTo(x, -z, x, -z + r);
  shape.lineTo(x, z - r);
  shape.quadraticCurveTo(x, z, x - r, z);
  shape.lineTo(-x + r, z);
  shape.quadraticCurveTo(-x, z, -x, z - r);
  shape.lineTo(-x, -z + r);
  shape.quadraticCurveTo(-x, -z, -x + r, -z);
  shape.closePath();
  return shape;
}

function insidePolygon(point: THREE.Vector2, polygon: THREE.Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

/** Every sub-segment of the polygon, cut at the circle, with the ones inside it flagged. */
function splitAtCircle(polygon: THREE.Vector2[], center: THREE.Vector2, radiusSquared: number) {
  const pieces: { from: THREE.Vector2; to: THREE.Vector2; inside: boolean }[] = [];
  for (let index = 0; index < polygon.length; index++) {
    const from = polygon[index],
      to = polygon[(index + 1) % polygon.length],
      direction = to.clone().sub(from),
      offset = from.clone().sub(center);
    const a = direction.lengthSq(),
      b = 2 * offset.dot(direction),
      c = offset.lengthSq() - radiusSquared;
    const discriminant = b * b - 4 * a * c,
      splits = [0, 1];
    if (discriminant > 1e-12 && a > 1e-12) {
      const root = Math.sqrt(discriminant);
      for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) if (t > 1e-8 && t < 1 - 1e-8) splits.push(t);
    }
    splits.sort((left, right) => left - right);
    for (let i = 1; i < splits.length; i++)
      pieces.push({
        from: from.clone().addScaledVector(direction, splits[i - 1]),
        to: from.clone().addScaledVector(direction, splits[i]),
        inside:
          from
            .clone()
            .addScaledVector(direction, (splits[i - 1] + splits[i]) / 2)
            .distanceToSquared(center) <
          radiusSquared - 1e-10,
      });
  }
  return pieces;
}
/** Drops points repeated back to back, including across the closing seam. */
function tidy(points: THREE.Vector2[]): THREE.Vector2[] {
  const outline = points.filter(
    (point, index) => index === 0 || point.distanceToSquared(points[index - 1]) > 1e-16,
  );
  if (outline.length > 1 && outline[0].distanceToSquared(outline[outline.length - 1]) < 1e-16) outline.pop();
  return outline;
}
const area = (polygon: THREE.Vector2[]) =>
  Math.abs(
    polygon.reduce((sum, point, index) => {
      const next = polygon[(index + 1) % polygon.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0),
  );

/** Subtract an aperture touching an outline edge. A Three Shape hole must be wholly inside its outer contour;
 * edge openings instead belong to that contour. A mouth that cuts two edges without swallowing the corner
 * between them (a tighter snooker pocket near a cloth corner) leaves a scrap of panel beyond it, which is
 * dropped: what stays is the largest piece, as on a real table where the pocket opens the corner. */
function notchCircle(
  polygon: THREE.Vector2[],
  center: THREE.Vector2,
  radius: number,
): { outline: THREE.Vector2[]; hole: boolean } {
  const radiusSquared = radius * radius;
  const start = polygon.findIndex((point) => point.distanceToSquared(center) > radiusSquared + 1e-9);
  if (start < 0) return { outline: [], hole: false };
  const segments = splitAtCircle(polygon, center, radiusSquared);
  const angleAt = (point: THREE.Vector2) => Math.atan2(point.y - center.y, point.x - center.x);
  // Where the outline crosses the circle. An arc between two of them may not jump over a third.
  const crossings = segments
    .filter((segment, index) => segment.inside !== segments[(index + 1) % segments.length].inside)
    .map((segment) => angleAt(segment.to));
  if (!crossings.length)
    return {
      outline: tidy([...polygon.slice(start), ...polygon.slice(0, start)].map((point) => point.clone())),
      hole: insidePolygon(center, polygon),
    };
  /** The arc from `entry` back round to the run's start: the one that stays inside the panel. */
  const arc = (entry: THREE.Vector2, exit: THREE.Vector2) => {
    const beginAngle = angleAt(entry),
      endAngle = angleAt(exit);
    const turn = (angle: number, negative: boolean) => {
      let value = angle - beginAngle;
      while (value >= (negative ? 0 : Math.PI * 2)) value -= Math.PI * 2;
      while (value < (negative ? -Math.PI * 2 : 0)) value += Math.PI * 2;
      return value;
    };
    const clear = (sweep: number) =>
      !crossings.some((angle) => {
        const offset = turn(angle, sweep < 0);
        return Math.abs(offset) > 1e-9 && Math.abs(offset) < Math.abs(sweep) - 1e-9;
      });
    const clockwise = turn(endAngle, true),
      counter = clockwise + Math.PI * 2;
    let sweep = clockwise;
    if (clear(clockwise) !== clear(counter)) sweep = clear(clockwise) ? clockwise : counter;
    else if (
      !insidePolygon(
        new THREE.Vector2(
          center.x + Math.cos(beginAngle + clockwise / 2) * radius,
          center.y + Math.sin(beginAngle + clockwise / 2) * radius,
        ),
        polygon,
      )
    )
      sweep = counter;
    const steps = Math.max(2, Math.ceil((Math.abs(sweep) / (Math.PI * 2)) * 128));
    return Array.from(
      { length: steps },
      (_, step) =>
        new THREE.Vector2(
          center.x + Math.cos(beginAngle + (sweep * (step + 1)) / steps) * radius,
          center.y + Math.sin(beginAngle + (sweep * (step + 1)) / steps) * radius,
        ),
    );
  };
  // Each run of outline still outside the circle closes into its own piece.
  const first = segments.findIndex(
    (segment, index) => !segment.inside && segments[(index + segments.length - 1) % segments.length].inside,
  );
  const pieces: THREE.Vector2[][] = [];
  let run: THREE.Vector2[] | null = null;
  const push = (point: THREE.Vector2) => {
    if (!run!.length || run![run!.length - 1].distanceToSquared(point) > 1e-16) run!.push(point.clone());
  };
  for (let step = 0; step < segments.length; step++) {
    const segment = segments[(first + step) % segments.length];
    if (!segment.inside) {
      run ??= [];
      push(segment.from);
      push(segment.to);
    } else if (run) {
      for (const point of arc(run[run.length - 1], run[0])) push(point);
      pieces.push(run);
      run = null;
    }
  }
  if (run) {
    for (const point of arc(run[run.length - 1], run[0])) push(point);
    pieces.push(run);
  }
  const outline = pieces.sort((left, right) => area(right) - area(left))[0] ?? [];
  // Keep the historic starting vertex so an unsplit panel comes out point for point as it always did.
  const rotation = outline.findIndex((point) => point.distanceToSquared(polygon[start]) < 1e-16);
  if (rotation > 0) outline.push(...outline.splice(0, rotation));
  return { outline: tidy(outline), hole: false };
}

function pocketedOutline(
  width: number,
  depth: number,
  x: number,
  z: number,
  rounding: number,
  aperture: number,
  pockets: readonly TablePoint[],
): THREE.Shape {
  let outline = roundedOutline(width, depth, rounding).getPoints(8);
  outline.pop();
  const holes: THREE.Path[] = [];
  for (const pocket of pockets) {
    const center = new THREE.Vector2(pocket.x - x, z - pocket.z);
    const cut = notchCircle(outline, center, aperture);
    outline = cut.outline;
    if (cut.hole) {
      const hole = new THREE.Path();
      hole.absarc(center.x, center.y, aperture, 0, Math.PI * 2, true);
      holes.push(hole);
    }
  }
  const shape = new THREE.Shape(outline);
  shape.closePath();
  shape.holes = holes;
  return shape;
}

/** Replaces opaque foundation boxes so the pocket has a real, visible depth.
 * The returned slab is centered at y=0, matching BoxGeometry placement. */
export function createPocketedSlabGeometry(
  width: number,
  depth: number,
  thickness: number,
  rounding = 0.12,
  spec: TableSpec = EIGHT_BALL_TABLE,
): THREE.ExtrudeGeometry {
  return createPocketedPanelGeometry(width, depth, thickness, 0, 0, rounding, 'throat', spec);
}

/** A cap or apron panel, with edge notches where the circular pocket meets it. */
export function createPocketedPanelGeometry(
  width: number,
  depth: number,
  thickness: number,
  x: number,
  z: number,
  rounding = 0.04,
  opening: 'mouth' | 'throat' = 'mouth',
  spec: TableSpec = EIGHT_BALL_TABLE,
): THREE.ExtrudeGeometry {
  // Below the bed, leave room for the thickness of the leather/rubber sleeve;
  // otherwise a slab's inner wooden wall sits in front of the leather lining.
  const shape = pocketedOutline(
    width,
    depth,
    x,
    z,
    rounding,
    opening === 'throat' ? THROAT_CLEARANCE * mouthScale(spec) : apertureOf(spec),
    spec.pockets,
  );
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    steps: 1,
    curveSegments: 32,
    bevelEnabled: false,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -thickness / 2, 0);
  geometry.computeVertexNormals();
  // Preserve box-like timber UV density after replacing boxes with contours.
  const positions = geometry.attributes.position,
    normals = geometry.attributes.normal,
    uv = geometry.attributes.uv;
  for (let i = 0; i < positions.count; i++) {
    if (Math.abs(normals.getY(i)) > 0.5) uv.setXY(i, positions.getX(i) / width + 0.5, positions.getZ(i) / depth + 0.5);
    else
      uv.setXY(
        i,
        Math.abs(normals.getX(i)) > 0.5 ? positions.getZ(i) / depth + 0.5 : positions.getX(i) / width + 0.5,
        positions.getY(i) / thickness + 0.5,
      );
  }
  return geometry;
}

export function createPocketedClothGeometry(
  width: number,
  depth: number,
  spec: TableSpec = EIGHT_BALL_TABLE,
): THREE.ShapeGeometry {
  const geometry = new THREE.ShapeGeometry(pocketedOutline(width, depth, 0, 0, 0, apertureOf(spec), spec.pockets), 40);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function annulus(inner: number, outer: number, start: number, length: number, height: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, start, start + length, false);
  shape.absarc(0, 0, inner, start + length, start, true);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    steps: 1,
    curveSegments: 40,
    bevelEnabled: false,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/** Six open pocket assemblies. Geometry is owned here, surface materials remain
 * owned by createTableSurfaces. Parent may enable its table-shadow layer on group. */
export function buildPocketDetails(
  scene: THREE.Scene,
  surfaces: PocketMaterials,
  spec: TableSpec = EIGHT_BALL_TABLE,
) {
  const aperture = apertureOf(spec),
    k = mouthScale(spec),
    noses = nosesOf(spec);
  const group = new THREE.Group();
  group.name = 'Leather-lined pocket castings';
  scene.add(group);
  const geometries = new Set<THREE.BufferGeometry>();
  const own = <T extends THREE.BufferGeometry>(geometry: T) => {
    geometries.add(geometry);
    return geometry;
  };
  const add = (
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    y: number,
    name: string,
  ) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = y;
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  // LatheGeometry is open: the leather sleeve and metal socket do not cap it.
  const throat = own(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.278 * k, -0.82),
        new THREE.Vector2(0.287 * k, -0.66),
        new THREE.Vector2(0.3 * k, -0.43),
        new THREE.Vector2(0.316 * k, -0.23),
        new THREE.Vector2(aperture, -0.06),
        new THREE.Vector2(aperture, -0.014),
      ],
      64,
    ),
  );
  const sleeve = own(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.298 * k, -0.85),
        new THREE.Vector2(0.324 * k, -0.39),
        new THREE.Vector2(0.334 * k, -0.12),
      ],
      64,
    ),
  );
  const voidGeometry = own(new THREE.CircleGeometry(0.283 * k, 48));
  voidGeometry.rotateX(-Math.PI / 2);
  const rubberLip = own(new THREE.TorusGeometry(aperture + 0.012 * k, 0.011 * k, 8, 64));
  rubberLip.rotateX(-Math.PI / 2);
  const rivetGeometry = own(new THREE.SphereGeometry(0.012, 10, 8));
  rivetGeometry.scale(1, 0.42, 1);
  const stitchGeometry = own(new THREE.CylinderGeometry(0.0018, 0.0018, 0.012, 4));
  stitchGeometry.rotateZ(Math.PI / 2);
  const cornerCasting = own(annulus(0.385 * k, 0.565 * k, -Math.PI * 0.45, Math.PI * 0.9, 0.06));
  const cornerLeather = own(annulus(aperture + 0.013 * k, 0.413 * k, -Math.PI * 0.53, Math.PI * 1.06, 0.022));
  const middleCasting = own(annulus(0.37 * k, 0.505 * k, -Math.PI * 0.51, Math.PI * 1.02, 0.05));
  const middleLeather = own(annulus(aperture + 0.013 * k, 0.405 * k, -Math.PI * 0.56, Math.PI * 1.12, 0.021));
  // The inside of the raised rear jaw is rubber, not the cut wooden rail.
  // Keep the cloth-facing half open so the ball has an unobstructed entry.
  const rearFacing = own(annulus(aperture, 0.345 * k, -Math.PI * 0.5, Math.PI, 0.215));
  const jawSeam = own(new THREE.TorusGeometry(noses[0].radius + 0.001, 0.0024, 4, 16, Math.PI * 0.72));
  jawSeam.rotateX(-Math.PI / 2);
  const stitches: THREE.Matrix4[] = [],
    rivets: THREE.Matrix4[] = [];
  const transform = new THREE.Object3D();
  const capTop = 0.1 + 0.23 / 2;
  // Shared noses define the hardware's seam endpoints. It never
  // supplies new colliders or moves a jaw away from the shared table geometry.
  for (const [index, pocket] of spec.pockets.entries()) {
    const corner = Math.abs(pocket.x) > spec.halfWidth / 2;
    const side = Math.sign(pocket.z),
      outward = corner ? Math.atan2(side, Math.sign(pocket.x)) : (side * Math.PI) / 2;
    const assembly = new THREE.Group();
    assembly.position.set(pocket.x, 0, pocket.z);
    assembly.name = `${corner ? 'Corner' : 'Middle'} pocket ${index + 1}`;
    group.add(assembly);
    add(assembly, throat, surfaces.leather, 0, 'Open leather drop throat');
    add(assembly, sleeve, surfaces.rubber, 0, 'Recessed rubber collector');
    add(assembly, voidGeometry, surfaces.pocketVoid, -0.86, 'Deep unlit pocket bottom').castShadow = false;
    add(assembly, rubberLip, surfaces.rubber, -0.008, 'Flush rolled rubber mouth');
    // Local +X points outward. Extruded XY shapes rotate into XZ with their
    // angle reversed, hence rotation.y=-outward for consistent front/back trim.
    const hardware = new THREE.Group();
    hardware.rotation.y = -outward;
    assembly.add(hardware);
    add(hardware, rearFacing, surfaces.rubber, 0.001, 'Rubber rear pocket facing');
    add(
      hardware,
      corner ? cornerCasting : middleCasting,
      surfaces.brass,
      capTop - 0.002,
      corner ? 'Cast corner brass saddle' : 'Recessed side-pocket brass saddle',
    );
    add(
      hardware,
      corner ? cornerLeather : middleLeather,
      surfaces.leather,
      capTop - 0.001,
      'Replaceable leather facing',
    );
    const stitchCount = corner ? 29 : 31;
    for (let i = 0; i < stitchCount; i++) {
      const angle = outward - Math.PI * 0.5 + ((i + 0.5) / stitchCount) * Math.PI;
      transform.position.set(
        pocket.x + Math.cos(angle) * 0.362 * k,
        capTop + 0.025,
        pocket.z + Math.sin(angle) * 0.362 * k,
      );
      transform.rotation.set(0, -angle - Math.PI / 2, 0);
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      stitches.push(transform.matrix.clone());
    }
    for (const offset of [-0.85, 0, 0.85]) {
      const angle = outward + offset;
      transform.position.set(
        pocket.x + Math.cos(angle) * (corner ? 0.49 : 0.452) * k,
        capTop + (corner ? 0.061 : 0.051),
        pocket.z + Math.sin(angle) * (corner ? 0.49 : 0.452) * k,
      );
      transform.rotation.set(0, 0, 0);
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      rivets.push(transform.matrix.clone());
    }
    // Dark seam lines behind the physical noses reveal separate cushion pieces.
    // A jaw belongs to a corner pocket when it stands on the outer half of the end rail, to a middle otherwise.
    const jaws = noses.filter(
      (jaw) =>
        Math.sign(jaw.z) === side &&
        (corner
          ? Math.abs(jaw.x) > spec.halfWidth / 2 && Math.sign(jaw.x) === Math.sign(pocket.x)
          : Math.abs(jaw.x) < spec.halfWidth / 2),
    );
    for (const jaw of jaws) {
      const seam = add(group, jawSeam, surfaces.rubber, jaw.y, 'Cushion facing seam');
      seam.position.x = jaw.x;
      seam.position.z = jaw.z;
      seam.rotation.y = -Math.atan2(pocket.z - jaw.z, pocket.x - jaw.x) - Math.PI * 0.36;
    }
  }
  // Shared instanced details cost two draws across all six pocket assemblies.
  const stitching = new THREE.InstancedMesh(stitchGeometry, surfaces.brass, stitches.length);
  stitching.name = 'Pocket saddle stitching';
  stitches.forEach((matrix, index) => stitching.setMatrixAt(index, matrix));
  stitching.instanceMatrix.needsUpdate = true;
  group.add(stitching);
  const fasteners = new THREE.InstancedMesh(rivetGeometry, surfaces.brass, rivets.length);
  fasteners.name = 'Brass saddle fasteners';
  rivets.forEach((matrix, index) => fasteners.setMatrixAt(index, matrix));
  fasteners.instanceMatrix.needsUpdate = true;
  fasteners.castShadow = true;
  group.add(fasteners);
  // This group is static; all animation belongs to the existing pocketed balls.
  group.updateMatrixWorld(true);
  let disposed = false;
  return {
    group,
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      stitching.dispose();
      fasteners.dispose();
    },
  };
}
