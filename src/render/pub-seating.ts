import * as THREE from 'three';
import { canvasTexture } from './materials';
import { PUB_LAYOUT, pubBackZ, pubFrontZ, pubSideX } from './pub-layout';
import { FLOOR, type PubBuildKit } from './pub-build-kit';
import type { PubPlacement } from './pub-models';

/** Booth benches, pub tables, chairs and the pints standing on them. */
export function buildPubSeating(
  kit: PubBuildKit,
  room: THREE.Group,
  materials: {
    walnut: THREE.MeshStandardMaterial;
    brass: THREE.MeshStandardMaterial;
    blackMetal: THREE.MeshStandardMaterial;
    leather: THREE.MeshPhysicalMaterial;
    countertop: THREE.MeshPhysicalMaterial;
  },
) {
  const { box, cylinder } = kit;
  const { walnut, brass, blackMetal, leather, countertop } = materials;
  // Blender-authored furniture replaces complete fallback groups after loading.
  const fallbackBenches = new THREE.Group(),
    fallbackTables = new THREE.Group(),
    fallbackPints = new THREE.Group(),
    fallbackChairs = new THREE.Group(),
    fallbackTaps = new THREE.Group();
  room.add(fallbackBenches, fallbackTables, fallbackPints, fallbackChairs, fallbackTaps);
  const benchPlacements: PubPlacement[] = [],
    tablePlacements: PubPlacement[] = [],
    pintPlacements: PubPlacement[] = [],
    chairPlacements: PubPlacement[] = [];
  const boothTablePlacements: PubPlacement[] = [],
    looseTablePlacements: PubPlacement[] = [];
  const addTable = (x: number, z: number, rotation = 0, kind: 'booth' | 'loose' = 'loose') => {
    box(2.62, 0.14, 1.48, countertop, x, FLOOR + 2.35, z, 0.11, fallbackTables);
    cylinder(0.16, 0.2, 2.18, blackMetal, x, FLOOR + 1.11, z, fallbackTables);
    cylinder(0.67, 0.67, 0.06, blackMetal, x, FLOOR + 0.04, z, fallbackTables);
    const placement = { x, y: FLOOR, z, height: 2.42, rotation };
    tablePlacements.push(placement);
    (kind === 'booth' ? boothTablePlacements : looseTablePlacements).push(placement);
  };
  const addPint = (x: number, y: number, z: number, rotation = 0) => {
    cylinder(
      0.13,
      0.09,
      0.41,
      new THREE.MeshPhysicalMaterial({ color: '#b28430', roughness: 0.13, metalness: 0.2, clearcoat: 1 }),
      x,
      y + 0.215,
      z,
      fallbackPints,
    );
    cylinder(
      0.18,
      0.18,
      0.02,
      new THREE.MeshStandardMaterial({ color: '#b49c74', roughness: 0.95 }),
      x,
      y + 0.01,
      z,
      fallbackPints,
    );
    pintPlacements.push({ x, y, z, height: 0.46, rotation });
  };
  /** One booth bay: two opposed benches, the table between them, drinks on it and its own wall lamp.
   * `side` is -1 for the left run of the room and 1 for the right, which mirrors the lamp outboard. */
  const addBoothBay = (side: -1 | 1, z: number, offset = 10.55) => {
    const x = pubSideX(side * offset);
    for (const sign of [-1, 1]) {
      box(3.05, 0.52, 0.89, leather, x, FLOOR + 1.31, z + sign * 1.37, 0.16, fallbackBenches);
      box(3.15, 1.58, 0.24, leather, x, FLOOR + 2.0, z + sign * 1.82, 0.13, fallbackBenches);
      box(3.0, 0.93, 0.67, walnut, x, FLOOR + 0.61, z + sign * 1.37, 0.035, fallbackBenches);
      for (const offset of [-1.15, -0.37, 0.4, 1.15]) {
        const button = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), brass);
        button.position.set(x + offset, FLOOR + 2.15, z + sign * 1.675);
        fallbackBenches.add(button);
      }
      benchPlacements.push({ x, y: FLOOR, z: z + sign * 1.55, rotation: sign < 0 ? 0 : Math.PI, height: 2.7 });
    }
    addTable(x, z, 0, 'booth');
    addPint(x - side * 0.45, FLOOR + 2.42, z - 0.22, 0.15);
    addPint(x + side * 0.25, FLOOR + 2.42, z + 0.31, -0.5);
    const lampX = pubSideX(side * (offset + 0.85));
    const lampShade = cylinder(
      0.32,
      0.48,
      0.4,
      new THREE.MeshStandardMaterial({ color: '#b69457', roughness: 0.7 }),
      lampX,
      FLOOR + 3.05,
      z,
    );
    lampShade.castShadow = false;
    cylinder(0.045, 0.11, 0.55, brass, lampX, FLOOR + 2.67, z);
    const light = new THREE.PointLight('#eeba77', 15, 6, 2);
    light.position.set(lampX, FLOOR + 3.1, z);
    room.add(light);
  };
  // Booth runs down both long walls. The left run replaces the loose tables that stood beside the
  // slot machines; the aisle between the two runs is what keeps the cue clear of the playing table.
  // Four bays on the right. The fourth is at the bar end, NOT the front corner: that corner is the
  // chimney breast, and a bay there sits in the mouth of the fire.
  for (const z of [-9.5, -3.25, 3.0, 9.25]) addBoothBay(1, z);
  // The left run sits further inboard: that wall carries the slot cabinets, which stand 2.3 units
  // proud of it, so a bay on the same offset as the right run would be jammed against them.
  // Shifted down the room from the right run, because the cellar stack stands at the bar end of this
  // wall, and further inboard than the right run, to leave the slot machines their stools.
  for (const z of [0, 5.6, 11.2]) addBoothBay(-1, z, 8.2);

  // Loose tables: the pair flanking the entrance, plus two more across the front of the room.
  for (const [x, z] of [
    [-5.25, pubFrontZ(8.35)],
    [5.25, pubFrontZ(8.35)],
    [-10.4, pubFrontZ(8.35)],
    [10.4, pubFrontZ(8.35)],
  ]) {
    addTable(x, z);
    addPint(x - 0.53, FLOOR + 2.42, z - 0.1, 0.35);
    addPint(x + 0.48, FLOOR + 2.42, z + 0.14, -0.8);
    for (const sign of [-1, 1]) {
      const chair = new THREE.Group();
      chair.position.set(x, FLOOR, z + sign * 1.45);
      chair.rotation.y = sign < 0 ? 0 : Math.PI;
      fallbackChairs.add(chair);
      box(1.02, 0.17, 0.94, leather, 0, 1.31, 0, 0.08, chair);
      box(1.02, 1.34, 0.15, walnut, 0, 2.01, -0.39, 0.04, chair);
      for (const cx of [-0.4, 0.4])
        for (const cz of [-0.35, 0.35]) box(0.095, 1.27, 0.095, walnut, cx, 0.635, cz, 0.018, chair);
      chairPlacements.push({ x, y: FLOOR, z: z + sign * 1.45, rotation: chair.rotation.y, height: 2.76 });
    }
  }
  return {
    addPint,
    benchPlacements,
    tablePlacements,
    boothTablePlacements,
    looseTablePlacements,
    pintPlacements,
    chairPlacements,
    fallbackBenches,
    fallbackTables,
    fallbackPints,
    fallbackChairs,
    fallbackTaps,
  };
}

/** Local ambient occlusion under feet grounds furniture without a room-wide shadow pass. */
export function buildPubContactShadows(
  room: THREE.Group,
  placements: {
    stoolPositions: readonly { x: number; z: number }[];
    tablePlacements: readonly PubPlacement[];
    benchPlacements: readonly PubPlacement[];
    chairPlacements: readonly PubPlacement[];
  },
) {
  const { stoolPositions, tablePlacements, benchPlacements, chairPlacements } = placements;
  const contactMap = canvasTexture(128, 128, (ctx) => {
    const gradient = ctx.createRadialGradient(64, 64, 8, 64, 64, 63);
    gradient.addColorStop(0, 'rgba(0,0,0,.65)');
    gradient.addColorStop(0.42, 'rgba(0,0,0,.38)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  });
  const contacts: Array<[number, number, number, number]> = [];
  for (const p of stoolPositions) contacts.push([p.x, pubBackZ(p.z), 1.6, 1.6]);
  for (const p of tablePlacements) contacts.push([p.x, p.z, 1.9, 1.65]);
  for (const p of benchPlacements) contacts.push([p.x, p.z, 3.4, 1.5]);
  for (const p of chairPlacements)
    for (const x of [-0.4, 0.4]) for (const z of [-0.4, 0.4]) contacts.push([p.x + x, p.z + z, 0.62, 0.62]);
  contacts.push(
    [PUB_LAYOUT.jukebox.x + 0.13, PUB_LAYOUT.jukebox.z, 1.55, 2.8],
    [pubSideX(-12.25), pubBackZ(-7.3), 4.1, 2.7],
  );
  const contactShadows = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: contactMap,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      opacity: 0.72,
    }),
    contacts.length,
  );
  const contactRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  contacts.forEach(([x, z, w, d], i) =>
    contactShadows.setMatrixAt(
      i,
      new THREE.Matrix4().compose(new THREE.Vector3(x, FLOOR + 0.012, z), contactRotation, new THREE.Vector3(w, d, 1)),
    ),
  );
  contactShadows.name = 'furniture-contact-occlusion';
  contactShadows.computeBoundingSphere();
  room.add(contactShadows);
}
