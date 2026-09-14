import * as THREE from 'three';
import { POCKETS, TABLE } from '../simulation/types';
import { TABLE_NOSES } from '../simulation/table-geometry';
import type { TableSurfaces } from './table-surfaces';

// The visible aperture is slightly wider than the simulated capture circle.
// No trim crosses this radius; the only cap sits below the full pocket throat.
export const POCKET_APERTURE = TABLE.pocketRadius + .012;
const THROAT_CLEARANCE = .342;
type PocketMaterials = Pick<TableSurfaces, 'brass' | 'leather' | 'rubber' | 'pocketVoid'>;

function roundedOutline(width: number, depth: number, radius: number): THREE.Shape {
  const shape = new THREE.Shape(), x = width / 2, z = depth / 2, r = Math.min(radius, x, z);
  shape.moveTo(-x + r, -z); shape.lineTo(x - r, -z); shape.quadraticCurveTo(x, -z, x, -z + r);
  shape.lineTo(x, z - r); shape.quadraticCurveTo(x, z, x - r, z);
  shape.lineTo(-x + r, z); shape.quadraticCurveTo(-x, z, -x, z - r);
  shape.lineTo(-x, -z + r); shape.quadraticCurveTo(-x, -z, -x + r, -z); shape.closePath();
  return shape;
}

function insidePolygon(point: THREE.Vector2, polygon: THREE.Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Subtract an aperture touching an outline edge. A Three Shape hole must be
 * wholly inside its outer contour; edge openings instead belong to that contour.
 * Current table panels have one connected piece after each circular notch. */
function notchCircle(polygon: THREE.Vector2[], center: THREE.Vector2, radius: number): { outline: THREE.Vector2[]; hole: boolean } {
  const radiusSquared = radius * radius;
  const start = polygon.findIndex(point => point.distanceToSquared(center) > radiusSquared + 1e-9);
  if (start < 0) return { outline: [], hole: false };
  const points = [...polygon.slice(start), ...polygon.slice(0, start)];
  const outline: THREE.Vector2[] = [], push = (point: THREE.Vector2) => {
    if (!outline.length || outline[outline.length - 1].distanceToSquared(point) > 1e-16) outline.push(point.clone());
  };
  let entered: THREE.Vector2 | null = null, crossings = 0;
  for (let index = 0; index < points.length; index++) {
    const from = points[index], to = points[(index + 1) % points.length], direction = to.clone().sub(from), offset = from.clone().sub(center);
    const a = direction.lengthSq(), b = 2 * offset.dot(direction), c = offset.lengthSq() - radiusSquared;
    const discriminant = b * b - 4 * a * c, splits = [0, 1];
    if (discriminant > 1e-12 && a > 1e-12) {
      const root = Math.sqrt(discriminant);
      for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) if (t > 1e-8 && t < 1 - 1e-8) { splits.push(t); crossings++; }
    }
    splits.sort((left, right) => left - right);
    for (let i = 1; i < splits.length; i++) {
      const begin = from.clone().addScaledVector(direction, splits[i - 1]), end = from.clone().addScaledVector(direction, splits[i]);
      const middle = from.clone().addScaledVector(direction, (splits[i - 1] + splits[i]) / 2);
      if (middle.distanceToSquared(center) < radiusSquared - 1e-10) { entered ??= begin; continue; }
      if (entered) {
        const beginAngle = Math.atan2(entered.y - center.y, entered.x - center.x), endAngle = Math.atan2(begin.y - center.y, begin.x - center.x);
        let sweep = endAngle - beginAngle; while (sweep >= 0) sweep -= Math.PI * 2;
        const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI * 2) * 128));
        push(entered);
        for (let step = 1; step <= steps; step++) {
          const angle = beginAngle + sweep * step / steps; push(new THREE.Vector2(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius));
        }
        entered = null;
      }
      push(begin); push(end);
    }
  }
  if (outline.length > 1 && outline[0].distanceToSquared(outline[outline.length - 1]) < 1e-16) outline.pop();
  return { outline, hole: crossings === 0 && insidePolygon(center, polygon) };
}

function pocketedOutline(width: number, depth: number, x: number, z: number, rounding: number, aperture = POCKET_APERTURE): THREE.Shape {
  let outline = roundedOutline(width, depth, rounding).getPoints(8);
  outline.pop();
  const holes: THREE.Path[] = [];
  for (const pocket of POCKETS) {
    const center = new THREE.Vector2(pocket.x - x, z - pocket.z);
    const cut = notchCircle(outline, center, aperture); outline = cut.outline;
    if (cut.hole) { const hole = new THREE.Path(); hole.absarc(center.x, center.y, aperture, 0, Math.PI * 2, true); holes.push(hole); }
  }
  const shape = new THREE.Shape(outline); shape.closePath(); shape.holes = holes;
  return shape;
}

/** Replaces opaque foundation boxes so the pocket has a real, visible depth.
 * The returned slab is centered at y=0, matching BoxGeometry placement. */
export function createPocketedSlabGeometry(width: number, depth: number, thickness: number, rounding = .12): THREE.ExtrudeGeometry {
  return createPocketedPanelGeometry(width, depth, thickness, 0, 0, rounding, 'throat');
}

/** A cap or apron panel, with edge notches where the circular pocket meets it. */
export function createPocketedPanelGeometry(width: number, depth: number, thickness: number, x: number, z: number, rounding = .04, opening: 'mouth' | 'throat' = 'mouth'): THREE.ExtrudeGeometry {
  // Below the bed, leave room for the thickness of the leather/rubber sleeve;
  // otherwise a slab's inner wooden wall sits in front of the leather lining.
  const shape = pocketedOutline(width, depth, x, z, rounding, opening === 'throat' ? THROAT_CLEARANCE : POCKET_APERTURE);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, steps: 1, curveSegments: 32, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2); geometry.translate(0, -thickness / 2, 0);
  geometry.computeVertexNormals();
  // Preserve box-like timber UV density after replacing boxes with contours.
  const positions = geometry.attributes.position, normals = geometry.attributes.normal, uv = geometry.attributes.uv;
  for (let i = 0; i < positions.count; i++) {
    if (Math.abs(normals.getY(i)) > .5) uv.setXY(i, positions.getX(i) / width + .5, positions.getZ(i) / depth + .5);
    else uv.setXY(i, Math.abs(normals.getX(i)) > .5 ? positions.getZ(i) / depth + .5 : positions.getX(i) / width + .5, positions.getY(i) / thickness + .5);
  }
  return geometry;
}

export function createPocketedClothGeometry(width: number, depth: number): THREE.ShapeGeometry {
  const geometry = new THREE.ShapeGeometry(pocketedOutline(width, depth, 0, 0, 0), 40); geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function annulus(inner: number, outer: number, start: number, length: number, height: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, start, start + length, false);
  shape.absarc(0, 0, inner, start + length, start, true); shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, steps: 1, curveSegments: 40, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2); geometry.computeVertexNormals();
  return geometry;
}

/** Six open pocket assemblies. Geometry is owned here, surface materials remain
 * owned by createTableSurfaces. Parent may enable its table-shadow layer on group. */
export function buildPocketDetails(scene: THREE.Scene, surfaces: PocketMaterials) {
  const group = new THREE.Group(); group.name = 'Leather-lined pocket castings'; scene.add(group);
  const geometries = new Set<THREE.BufferGeometry>();
  const own = <T extends THREE.BufferGeometry>(geometry: T) => { geometries.add(geometry); return geometry; };
  const add = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, y: number, name: string) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.y = y; mesh.name = name;
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  // LatheGeometry is open: the leather sleeve and metal socket do not cap it.
  const throat = own(new THREE.LatheGeometry([
    new THREE.Vector2(.278, -.82), new THREE.Vector2(.287, -.66), new THREE.Vector2(.30, -.43),
    new THREE.Vector2(.316, -.23), new THREE.Vector2(POCKET_APERTURE, -.06), new THREE.Vector2(POCKET_APERTURE, -.014),
  ], 64));
  const sleeve = own(new THREE.LatheGeometry([new THREE.Vector2(.298, -.85), new THREE.Vector2(.324, -.39), new THREE.Vector2(.334, -.12)], 64));
  const voidGeometry = own(new THREE.CircleGeometry(.283, 48)); voidGeometry.rotateX(-Math.PI / 2);
  const rubberLip = own(new THREE.TorusGeometry(POCKET_APERTURE + .012, .011, 8, 64)); rubberLip.rotateX(-Math.PI / 2);
  const rivetGeometry = own(new THREE.SphereGeometry(.012, 10, 8)); rivetGeometry.scale(1, .42, 1);
  const stitchGeometry = own(new THREE.CylinderGeometry(.0018, .0018, .012, 4)); stitchGeometry.rotateZ(Math.PI / 2);
  const cornerCasting = own(annulus(.385, .565, -Math.PI * .45, Math.PI * .9, .06));
  const cornerLeather = own(annulus(POCKET_APERTURE + .013, .413, -Math.PI * .53, Math.PI * 1.06, .022));
  const middleCasting = own(annulus(.37, .505, -Math.PI * .51, Math.PI * 1.02, .05));
  const middleLeather = own(annulus(POCKET_APERTURE + .013, .405, -Math.PI * .56, Math.PI * 1.12, .021));
  // The inside of the raised rear jaw is rubber, not the cut wooden rail.
  // Keep the cloth-facing half open so the ball has an unobstructed entry.
  const rearFacing = own(annulus(POCKET_APERTURE, .345, -Math.PI * .5, Math.PI, .215));
  const jawSeam = own(new THREE.TorusGeometry(TABLE_NOSES[0].radius + .001, .0024, 4, 16, Math.PI * .72)); jawSeam.rotateX(-Math.PI / 2);
  const stitches: THREE.Matrix4[] = [], rivets: THREE.Matrix4[] = [];
  const transform = new THREE.Object3D();
  const capTop = .1 + .23 / 2;
  // Shared noses define the hardware's seam endpoints. It never
  // supplies new colliders or moves a jaw away from the shared table geometry.
  for (const [index, pocket] of POCKETS.entries()) {
    const corner = Math.abs(pocket.x) > TABLE.halfWidth / 2;
    const side = Math.sign(pocket.z), outward = corner ? Math.atan2(side, Math.sign(pocket.x)) : side * Math.PI / 2;
    const assembly = new THREE.Group(); assembly.position.set(pocket.x, 0, pocket.z); assembly.name = `${corner ? 'Corner' : 'Middle'} pocket ${index + 1}`; group.add(assembly);
    add(assembly, throat, surfaces.leather, 0, 'Open leather drop throat');
    add(assembly, sleeve, surfaces.rubber, 0, 'Recessed rubber collector');
    add(assembly, voidGeometry, surfaces.pocketVoid, -.86, 'Deep unlit pocket bottom').castShadow = false;
    add(assembly, rubberLip, surfaces.rubber, -.008, 'Flush rolled rubber mouth');
    // Local +X points outward. Extruded XY shapes rotate into XZ with their
    // angle reversed, hence rotation.y=-outward for consistent front/back trim.
    const hardware = new THREE.Group(); hardware.rotation.y = -outward; assembly.add(hardware);
    add(hardware, rearFacing, surfaces.rubber, .001, 'Rubber rear pocket facing');
    add(hardware, corner ? cornerCasting : middleCasting, surfaces.brass, capTop - .002, corner ? 'Cast corner brass saddle' : 'Recessed side-pocket brass saddle');
    add(hardware, corner ? cornerLeather : middleLeather, surfaces.leather, capTop - .001, 'Replaceable leather facing');
    const stitchCount = corner ? 29 : 31;
    for (let i = 0; i < stitchCount; i++) {
      const angle = outward - Math.PI * .5 + (i + .5) / stitchCount * Math.PI;
      transform.position.set(pocket.x + Math.cos(angle) * .362, capTop + .025, pocket.z + Math.sin(angle) * .362);
      transform.rotation.set(0, -angle - Math.PI / 2, 0); transform.scale.set(1, 1, 1); transform.updateMatrix(); stitches.push(transform.matrix.clone());
    }
    for (const offset of [-.85, 0, .85]) {
      const angle = outward + offset;
      transform.position.set(pocket.x + Math.cos(angle) * (corner ? .49 : .452), capTop + (corner ? .061 : .051), pocket.z + Math.sin(angle) * (corner ? .49 : .452));
      transform.rotation.set(0, 0, 0); transform.scale.set(1, 1, 1); transform.updateMatrix(); rivets.push(transform.matrix.clone());
    }
    // Dark seam lines behind the physical noses reveal separate cushion pieces.
    const jaws = TABLE_NOSES.filter(jaw => Math.sign(jaw.z) === side && (corner ? Math.abs(jaw.x) > 5 && Math.sign(jaw.x) === Math.sign(pocket.x) : Math.abs(jaw.x) < 1));
    for (const jaw of jaws) {
      const seam = add(group, jawSeam, surfaces.rubber, jaw.y, 'Cushion facing seam');
      seam.position.x = jaw.x; seam.position.z = jaw.z;
      seam.rotation.y = -Math.atan2(pocket.z - jaw.z, pocket.x - jaw.x) - Math.PI * .36;
    }
  }
  // Shared instanced details cost two draws across all six pocket assemblies.
  const stitching = new THREE.InstancedMesh(stitchGeometry, surfaces.brass, stitches.length); stitching.name = 'Pocket saddle stitching';
  stitches.forEach((matrix, index) => stitching.setMatrixAt(index, matrix)); stitching.instanceMatrix.needsUpdate = true; group.add(stitching);
  const fasteners = new THREE.InstancedMesh(rivetGeometry, surfaces.brass, rivets.length); fasteners.name = 'Brass saddle fasteners';
  rivets.forEach((matrix, index) => fasteners.setMatrixAt(index, matrix)); fasteners.instanceMatrix.needsUpdate = true; fasteners.castShadow = true; group.add(fasteners);
  // This group is static; all animation belongs to the existing pocketed balls.
  group.updateMatrixWorld(true);
  let disposed = false;
  return { group, dispose() { if (disposed) return; disposed = true; group.removeFromParent(); for (const geometry of geometries) geometry.dispose(); stitching.dispose(); fasteners.dispose(); } };
}
