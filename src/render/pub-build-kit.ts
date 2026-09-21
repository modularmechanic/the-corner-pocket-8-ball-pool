import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PUB_LAYOUT } from './pub-layout';
import { preparePubModel } from './pub-props';
import type { PubPlacement } from './pub-models';
import type { PropInstaller } from './asset-installer';

export const FLOOR = PUB_LAYOUT.floor;
export type PubBuildKit = ReturnType<typeof pubBuildKit>;
/** The rounded boxes, cylinders, pulsing emissives and model installs every pub section is built from. */
export function pubBuildKit(propsParent: THREE.Group, glows: THREE.MeshStandardMaterial[], installer: PropInstaller) {
  const installModel = (
    path: string,
    placements: PubPlacement[],
    placeholder: THREE.Object3D[] = [],
    parent: THREE.Group = propsParent,
  ) => installer.model(path, { parent, placements, placeholder, prepare: preparePubModel(path) });
  const box = (
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    round = 0.035,
    parent: THREE.Group = propsParent,
  ) => {
    const geometry = new RoundedBoxGeometry(w, h, d, 2, round);
    if (w > 30) {
      const uv = geometry.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * PUB_LAYOUT.expansion);
    }
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const cylinder = (
    rt: number,
    rb: number,
    h: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    parent: THREE.Group = propsParent,
  ) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 32), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const neon = (color: string, intensity = 2) => {
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: intensity,
      roughness: 0.3,
    });
    glows.push(material);
    return material;
  };
  return { box, cylinder, neon, installModel };
}
