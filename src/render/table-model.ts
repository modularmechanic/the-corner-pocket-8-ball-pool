import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TABLE } from '../simulation/types';
import { nosesOf, railsOf } from '../simulation/table-geometry';
import { EIGHT_BALL_TABLE, type TableSpec } from '../simulation/modes/table';
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
/** Every cabinet measurement below is a pub-table one scaled onto the mode's slate: the cloth reaches a ball radius
 * past the cushion faces, and the timber around it keeps the same proportions. Both scales are exactly 1 on the
 * eight-ball table, so it is drawn from the identical numbers it always was. */
function cabinetOf(spec: TableSpec) {
  return {
    clothHalfWidth: spec.halfWidth + spec.radius,
    clothHalfDepth: spec.halfDepth + spec.radius,
    sx: spec.halfWidth / TABLE.halfWidth,
    sz: spec.halfDepth / TABLE.halfDepth,
  };
}

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
  chalkControls: THREE.Object3D[] = [];
  pocketDetails!: ReturnType<typeof buildPocketDetails>;
  details!: TableDetails;
  private spec!: TableSpec;
  constructor(
    private readonly scene: THREE.Scene,
    private readonly surfaces: TableModelSurfaces,
    private readonly textures: TableTextures,
    spec: TableSpec = EIGHT_BALL_TABLE,
  ) {
    this.build(spec);
  }
  /** Redraw for a mode whose slate differs; the same table is left alone. */
  sync(spec: TableSpec): void {
    if (spec === this.spec) return;
    this.clear();
    this.build(spec);
  }
  /** Drops the drawn table. Materials and textures belong to the caller and outlive it. */
  private clear(): void {
    this.details.dispose();
    this.pocketDetails.dispose();
    for (const object of this.occluders) {
      object.removeFromParent();
      object.traverse((child) => {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      });
    }
    this.occluders.length = 0;
  }
  private build(spec: TableSpec) {
    this.spec = spec;
    const { scene, surfaces, textures } = this;
    const { clothHalfWidth, clothHalfDepth, sx, sz } = cabinetOf(spec);
    // Wooden rail caps begin just beyond the cloth and cover the cushion backs.
    const sideCapZ = clothHalfDepth + 0.26 * sz,
      endCapX = clothHalfWidth + 0.23 * sx;
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
      solid(createPocketedSlabGeometry(width, depth, thickness, round, spec), material).position.y = y;
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
        createPocketedPanelGeometry(width, depth, height, x, z, round, y + height / 2 < 0 ? 'throat' : 'mouth', spec),
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
    slab(12.98 * sx, 0.5, 7.23 * sz, darkWood, -0.42, 0.22 * sx);
    slab(12.9 * sx, 0.055, 7.16 * sz, brass, -0.22, 0.2 * sx);
    slab(12.84 * sx, 0.27, 7.1 * sz, walnut, -0.18, 0.18 * sx);
    // Separate shell panels leave a real opening into the return mechanism.
    notchedPanel(12.42 * sx, 1.04, 0.32 * sz, sideWood, 0, -0.88, -3.165 * sz, 0.06 * sx);
    for (const x of [-6.05, 6.05]) notchedPanel(0.32 * sx, 1.04, 6.33 * sz, sideWood, x * sx, -0.88, 0, 0.06 * sx);
    notchedPanel(12.42 * sx, 0.3, 0.32 * sz, sideWood, 0, -0.51, 3.165 * sz, 0.04 * sx);
    box(12.42 * sx, 0.2, 0.32 * sz, sideWood, 0, -1.3, 3.165 * sz, 0.04 * sx);
    notchedPanel(2.39 * sx, 0.54, 0.32 * sz, sideWood, -5.015 * sx, -0.94, 3.165 * sz, 0.025 * sx);
    notchedPanel(3.89 * sx, 0.54, 0.32 * sz, sideWood, 4.265 * sx, -0.94, 3.165 * sz, 0.025 * sx);
    slab(12.46 * sx, 0.055, 6.69 * sz, brass, -1.3, 0.07 * sx);
    for (const sign of [-1, 1]) {
      for (const x of sign > 0 ? [-4.8, 4.8] : [-4.8, -2.4, 0, 2.4, 4.8])
        box((sign > 0 && x < 0 ? 1.94 : 2.16) * sx, 0.61, 0.04 * sz, darkWood, x * sx, -0.91, sign * 3.337 * sz, 0.055 * sx);
      box(11.94 * sx, 0.025, 0.03 * sz, brass, 0, -0.55, sign * 3.364 * sz, 0.008 * sx);
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
    ].map(([radius, y]) => new THREE.Vector2(radius * sx, y));
    const legGeometry = new THREE.LatheGeometry(legProfile, 48);
    for (const x of [-4.68, 4.68])
      for (const z of [-2.35, 2.35]) {
        solid(legGeometry, walnut).position.set(x * sx, -3.5, z * sz);
        const foot = add(new THREE.Mesh(new THREE.CylinderGeometry(0.43 * sx, 0.47 * sx, 0.1, 40), brass));
        foot.position.set(x * sx, -3.55, z * sz);
        foot.castShadow = true;
        const collar = add(new THREE.Mesh(new THREE.TorusGeometry(0.355 * sx, 0.022 * sx, 8, 40), brass));
        collar.rotation.x = -Math.PI / 2;
        collar.position.set(x * sx, -1.68, z * sz);
      }
    for (const z of [-2.35, 2.35]) box(9.3 * sx, 0.18, 0.23 * sz, walnut, 0, -2.55, z * sz, 0.04 * sx);
    for (const x of [-4.68, 4.68]) box(0.23 * sx, 0.18, 4.7 * sz, walnut, x * sx, -2.55, 0, 0.04 * sx);
    // A shaped cloth surface leaves actual openings at the pockets.
    const bedGeo = createPocketedClothGeometry(clothHalfWidth * 2, clothHalfDepth * 2, spec);
    const uv = bedGeo.attributes.uv,
      pos = bedGeo.attributes.position;
    for (let i = 0; i < uv.count; i++)
      uv.setXY(
        i,
        (pos.getX(i) + clothHalfWidth) / (clothHalfWidth * 2),
        (pos.getZ(i) + clothHalfDepth) / (clothHalfDepth * 2),
      );
    const bed = add(new THREE.Mesh(bedGeo, cloth));
    bed.name = 'Cloth bed';
    bed.receiveShadow = true;
    for (const sign of [-1, 1]) {
      notchedPanel(clothHalfWidth * 2 + 0.04 * sx, 0.23, 0.4 * sz, walnut, 0, 0.1, sign * sideCapZ, 0.065 * sx).name =
        'Rail cap';
      notchedPanel(0.42 * sx, 0.23, clothHalfDepth * 2 + 0.06 * sz, walnut, sign * endCapX, 0.1, 0, 0.065 * sx).name =
        'Rail cap';
      box(clothHalfWidth * 2 - 0.04 * sx, 0.012, 0.016 * sz, brass, 0, 0.222, sign * (sideCapZ + 0.14 * sz), 0.005);
      box(0.016 * sx, 0.012, clothHalfDepth * 2 - 0.2 * sz, brass, sign * (endCapX + 0.15 * sx), 0.222, 0, 0.005);
      for (const x of [-4.28, -2.85, -1.42, 1.42, 2.85, 4.28]) diamond(x * sx, sign * (sideCapZ + 0.02 * sz));
      for (const z of [-1.45, 0, 1.45]) diamond(sign * (endCapX - 0.01 * sx), z * sz);
    }
    for (const rail of railsOf(spec))
      box(rail.halfWidth * 2, 0.16, rail.halfDepth * 2, cushion, rail.x, 0.073, rail.z, 0.075).name = 'Cushion';
    for (const jaw of nosesOf(spec)) {
      const geometry = new THREE.SphereGeometry(jaw.radius, 24, 16);
      geometry.scale(1, 0.7, 1);
      solid(geometry, cushion).position.set(jaw.x, jaw.y - 0.03, jaw.z);
    }
    this.pocketDetails = buildPocketDetails(scene, surfaces, spec);
    this.occluders.push(this.pocketDetails.group);
    // A subtle head string and the traditional baulk semicircle. Snooker's D has its own radius (WPBSA 1.2).
    const headStringX = spec.placement.headStringX,
      dRadius = spec.placement.dRadius ?? 0.93 * sx;
    const lineMat = new THREE.LineBasicMaterial({ color: '#c1d3ab', transparent: true, opacity: 0.2 });
    add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(headStringX, 0.008, -spec.halfDepth + 0.03 * sz),
          new THREE.Vector3(headStringX, 0.008, spec.halfDepth - 0.03 * sz),
        ]),
        lineMat,
      ),
    );
    const arc: THREE.Vector3[] = [];
    for (let i = 0; i <= 60; i++) {
      const a = Math.PI / 2 + (i / 60) * Math.PI;
      arc.push(new THREE.Vector3(headStringX + Math.cos(a) * dRadius, 0.008, Math.sin(a) * dRadius));
    }
    add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(arc), lineMat));
    for (const x of [headStringX, 2.55 * sx]) {
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
        new THREE.PlaneGeometry(1.28 * sx, 0.16 * sz),
        new THREE.MeshStandardMaterial({ map: textures.plaque, metalness: 0.45, roughness: 0.4 }),
      ),
    );
    plaque.rotation.x = -Math.PI / 2;
    plaque.position.set(2.17 * sx, 0.23, sideCapZ + 0.03 * sz);
    // Chalk rests on the rail, away from the shot surface.
    const chalk = box(
      0.23,
      0.18,
      0.23,
      new THREE.MeshStandardMaterial({ color: '#bfa975', roughness: 0.9 }),
      -4.78 * sx,
      0.32,
      sideCapZ - 0.02 * sz,
      0.012,
    );
    const chalkTop = box(
      0.19,
      0.014,
      0.19,
      new THREE.MeshStandardMaterial({ color: '#457e88', roughness: 1 }),
      -4.78 * sx,
      0.417,
      sideCapZ - 0.02 * sz,
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
