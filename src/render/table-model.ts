import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TABLE } from '../simulation/types';
import { HEAD_STRING_X, TABLE_RAILS, TABLE_NOSES } from '../simulation/table-geometry';
import { canvasTexture } from './materials';
import {
  buildPocketDetails,
  createPocketedSlabGeometry,
  createPocketedPanelGeometry,
  createPocketedClothGeometry,
} from './pocket-details';
import { TableDetails, drawTableDetailTextures, type TableDetailTextures } from './table-details';
import type { TableSurfaces } from './table-surfaces';

// Table-only shadow casters keep the three practical lights from redrawing the entire pub.
export const TABLE_SHADOW_LAYER = 1;
export function enableTableShadows(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) child.layers.enable(TABLE_SHADOW_LAYER);
  });
}
// Cushion noses stand on the playing edge (TABLE_RAILS); the cloth runs a ball radius beneath them.
export const CLOTH_HALF_WIDTH = TABLE.halfWidth + TABLE.radius,
  CLOTH_HALF_DEPTH = TABLE.halfDepth + TABLE.radius;
// Wooden rail caps begin just beyond the cloth and cover the cushion backs.
const SIDE_CAP_Z = CLOTH_HALF_DEPTH + 0.26,
  END_CAP_X = CLOTH_HALF_WIDTH + 0.23;

export type TableModelSurfaces = Pick<
  TableSurfaces,
  'walnut' | 'sideWood' | 'darkWood' | 'brass' | 'cloth' | 'cushion' | 'leather' | 'rubber' | 'pocketVoid'
>;
export interface TableTextures extends TableDetailTextures {
  plaque: THREE.Texture;
}
/** Canvas-drawn, so browser only. */
export function drawTableTextures(balls: readonly THREE.Texture[]): TableTextures {
  return {
    ...drawTableDetailTextures(balls),
    plaque: canvasTexture(1024, 128, (ctx) => {
      ctx.fillStyle = '#bd9d5f';
      ctx.fillRect(0, 0, 1024, 128);
      ctx.fillStyle = '#392e1c';
      ctx.textAlign = 'center';
      ctx.font = '42px Georgia';
      ctx.fillText('T H E   C O R N E R   P O C K E T', 512, 80);
    }),
  };
}

/** The static pool table: cabinet, cloth, rails, cushions, pockets, markings and coin return. */
export class TableModel {
  /** Every scene child this model added: the only objects that may block the table controls. */
  readonly occluders: THREE.Object3D[] = [];
  readonly chalkControls: THREE.Object3D[];
  readonly pocketDetails: ReturnType<typeof buildPocketDetails>;
  readonly details: TableDetails;
  constructor(scene: THREE.Scene, surfaces: TableModelSurfaces, textures: TableTextures) {
    const { walnut, sideWood, darkWood, brass, cloth, cushion } = surfaces;
    const add = <T extends THREE.Object3D>(object: T) => {
      scene.add(object);
      this.occluders.push(object);
      return object;
    };
    const solid = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
      const mesh = add(new THREE.Mesh(geometry, material));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    };
    const box = (
      w: number,
      h: number,
      d: number,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      round = 0.04,
    ) => {
      const mesh = solid(new RoundedBoxGeometry(w, h, d, 3, round), mat);
      mesh.position.set(x, y, z);
      return mesh;
    };
    const slab = (
      width: number,
      thickness: number,
      depth: number,
      material: THREE.Material,
      y: number,
      round: number,
    ) => {
      solid(createPocketedSlabGeometry(width, depth, thickness, round), material).position.y = y;
    };
    const notchedPanel = (
      width: number,
      height: number,
      depth: number,
      material: THREE.Material,
      x: number,
      y: number,
      z: number,
      round: number,
    ) => {
      const mesh = solid(
        createPocketedPanelGeometry(width, depth, height, x, z, round, y + height / 2 < 0 ? 'throat' : 'mouth'),
        material,
      );
      mesh.position.set(x, y, z);
      return mesh;
    };
    const diamond = (x: number, z: number) => {
      const mesh = add(new THREE.Mesh(new THREE.OctahedronGeometry(0.046), brass));
      mesh.scale.set(0.8, 0.18, 1.5);
      mesh.position.set(x, 0.232, z);
    };
    slab(12.98, 0.5, 7.23, darkWood, -0.42, 0.22);
    slab(12.9, 0.055, 7.16, brass, -0.22, 0.2);
    slab(12.84, 0.27, 7.1, walnut, -0.18, 0.18);
    // Separate shell panels leave a real opening into the return mechanism.
    notchedPanel(12.42, 1.04, 0.32, sideWood, 0, -0.88, -3.165, 0.06);
    for (const x of [-6.05, 6.05]) notchedPanel(0.32, 1.04, 6.33, sideWood, x, -0.88, 0, 0.06);
    notchedPanel(12.42, 0.3, 0.32, sideWood, 0, -0.51, 3.165, 0.04);
    box(12.42, 0.2, 0.32, sideWood, 0, -1.3, 3.165, 0.04);
    notchedPanel(2.39, 0.54, 0.32, sideWood, -5.015, -0.94, 3.165, 0.025);
    notchedPanel(3.89, 0.54, 0.32, sideWood, 4.265, -0.94, 3.165, 0.025);
    slab(12.46, 0.055, 6.69, brass, -1.3, 0.07);
    for (const sign of [-1, 1]) {
      for (const x of sign > 0 ? [-4.8, 4.8] : [-4.8, -2.4, 0, 2.4, 4.8])
        box(sign > 0 && x < 0 ? 1.94 : 2.16, 0.61, 0.04, darkWood, x, -0.91, sign * 3.337, 0.055);
      box(11.94, 0.025, 0.03, brass, 0, -0.55, sign * 3.364, 0.008);
    }
    const legProfile = [
      [0.43, 0],
      [0.43, 0.11],
      [0.32, 0.2],
      [0.27, 0.55],
      [0.25, 0.86],
      [0.29, 1.39],
      [0.36, 1.91],
      [0.46, 2.16],
      [0.46, 2.28],
    ].map(([radius, y]) => new THREE.Vector2(radius, y));
    const legGeometry = new THREE.LatheGeometry(legProfile, 48);
    for (const x of [-4.68, 4.68])
      for (const z of [-2.35, 2.35]) {
        solid(legGeometry, walnut).position.set(x, -3.5, z);
        const foot = add(new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.47, 0.1, 40), brass));
        foot.position.set(x, -3.55, z);
        foot.castShadow = true;
        const collar = add(new THREE.Mesh(new THREE.TorusGeometry(0.355, 0.022, 8, 40), brass));
        collar.rotation.x = -Math.PI / 2;
        collar.position.set(x, -1.68, z);
      }
    for (const z of [-2.35, 2.35]) box(9.3, 0.18, 0.23, walnut, 0, -2.55, z, 0.04);
    for (const x of [-4.68, 4.68]) box(0.23, 0.18, 4.7, walnut, x, -2.55, 0, 0.04);
    // A shaped cloth surface leaves actual openings at the pockets.
    const bedGeo = createPocketedClothGeometry(CLOTH_HALF_WIDTH * 2, CLOTH_HALF_DEPTH * 2);
    const uv = bedGeo.attributes.uv,
      pos = bedGeo.attributes.position;
    for (let i = 0; i < uv.count; i++)
      uv.setXY(
        i,
        (pos.getX(i) + CLOTH_HALF_WIDTH) / (CLOTH_HALF_WIDTH * 2),
        (pos.getZ(i) + CLOTH_HALF_DEPTH) / (CLOTH_HALF_DEPTH * 2),
      );
    const bed = add(new THREE.Mesh(bedGeo, cloth));
    bed.name = 'Cloth bed';
    bed.receiveShadow = true;
    for (const sign of [-1, 1]) {
      notchedPanel(CLOTH_HALF_WIDTH * 2 + 0.04, 0.23, 0.4, walnut, 0, 0.1, sign * SIDE_CAP_Z, 0.065).name = 'Rail cap';
      notchedPanel(0.42, 0.23, CLOTH_HALF_DEPTH * 2 + 0.06, walnut, sign * END_CAP_X, 0.1, 0, 0.065).name = 'Rail cap';
      box(CLOTH_HALF_WIDTH * 2 - 0.04, 0.012, 0.016, brass, 0, 0.222, sign * (SIDE_CAP_Z + 0.14), 0.005);
      box(0.016, 0.012, CLOTH_HALF_DEPTH * 2 - 0.2, brass, sign * (END_CAP_X + 0.15), 0.222, 0, 0.005);
      for (const x of [-4.28, -2.85, -1.42, 1.42, 2.85, 4.28]) diamond(x, sign * (SIDE_CAP_Z + 0.02));
      for (const z of [-1.45, 0, 1.45]) diamond(sign * (END_CAP_X - 0.01), z);
    }
    for (const rail of TABLE_RAILS)
      box(rail.halfWidth * 2, 0.16, rail.halfDepth * 2, cushion, rail.x, 0.073, rail.z, 0.075).name = 'Cushion';
    for (const jaw of TABLE_NOSES) {
      const geometry = new THREE.SphereGeometry(jaw.radius, 24, 16);
      geometry.scale(1, 0.7, 1);
      solid(geometry, cushion).position.set(jaw.x, jaw.y - 0.03, jaw.z);
    }
    this.pocketDetails = buildPocketDetails(scene, surfaces);
    this.occluders.push(this.pocketDetails.group);
    // A subtle head string and the traditional baulk semicircle.
    const lineMat = new THREE.LineBasicMaterial({ color: '#c1d3ab', transparent: true, opacity: 0.2 });
    add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(HEAD_STRING_X, 0.008, -TABLE.halfDepth + 0.03),
          new THREE.Vector3(HEAD_STRING_X, 0.008, TABLE.halfDepth - 0.03),
        ]),
        lineMat,
      ),
    );
    const arc: THREE.Vector3[] = [];
    for (let i = 0; i <= 60; i++) {
      const a = Math.PI / 2 + (i / 60) * Math.PI;
      arc.push(new THREE.Vector3(HEAD_STRING_X + Math.cos(a) * 0.93, 0.008, Math.sin(a) * 0.93));
    }
    add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(arc), lineMat));
    for (const x of [HEAD_STRING_X, 2.55]) {
      const spot = add(
        new THREE.Mesh(
          new THREE.CircleGeometry(0.023, 16),
          new THREE.MeshBasicMaterial({ color: '#c9cdb2', transparent: true, opacity: 0.4 }),
        ),
      );
      spot.rotation.x = -Math.PI / 2;
      spot.position.set(x, 0.01, 0);
    }
    const plaque = add(
      new THREE.Mesh(
        new THREE.PlaneGeometry(1.28, 0.16),
        new THREE.MeshStandardMaterial({ map: textures.plaque, metalness: 0.45, roughness: 0.4 }),
      ),
    );
    plaque.rotation.x = -Math.PI / 2;
    plaque.position.set(2.17, 0.23, SIDE_CAP_Z + 0.03);
    // Chalk rests on the rail, away from the shot surface.
    const chalk = box(
      0.23,
      0.18,
      0.23,
      new THREE.MeshStandardMaterial({ color: '#bfa975', roughness: 0.9 }),
      -4.78,
      0.32,
      SIDE_CAP_Z - 0.02,
      0.012,
    );
    const chalkTop = box(
      0.19,
      0.014,
      0.19,
      new THREE.MeshStandardMaterial({ color: '#457e88', roughness: 1 }),
      -4.78,
      0.417,
      SIDE_CAP_Z - 0.02,
      0.006,
    );
    chalk.userData.tableControl = 'chalk';
    chalkTop.userData.tableControl = 'chalk';
    this.chalkControls = [chalk, chalkTop];
    this.details = new TableDetails(scene, textures);
    this.occluders.push(this.details.group);
    for (const object of this.occluders) enableTableShadows(object);
  }
}
