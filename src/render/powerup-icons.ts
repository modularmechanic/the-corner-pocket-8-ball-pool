import * as THREE from 'three';
import type { PowerUp } from '../simulation/types';
import { effectDefinition } from '../presentation/effects';

/** How a power carries itself on the cloth. One glow vocabulary, five readings of it: overdrive burns,
 * frost sits still and cold, ward breathes behind its dome, focus snaps, portal churns. */
export interface PowerCharacter {
  color: string;
  /** Bob cycles a second, and how far it travels. */
  bob: number;
  lift: number;
  /** Spin rate; negative turns against the eye. `snap` quantises it into eight hard steps. */
  spin: number;
  snap?: boolean;
  /** Emissive breathing rate and depth. */
  pulse: number;
  depth: number;
  /** Fast unsteady flicker on top of the pulse, 0 for the cold powers. */
  flicker: number;
  /** Aura sprite size and its swirl, plus the protective shell ward alone wears. */
  aura: number;
  swirl: number;
  shell?: boolean;
}

export const POWER_CHARACTER: Record<PowerUp, PowerCharacter> = {
  overdrive: {
    color: '#ffb754',
    bob: 3.4,
    lift: 0.03,
    spin: 1.1,
    pulse: 7.5,
    depth: 0.7,
    flicker: 0.55,
    aura: 1.35,
    swirl: 0.6,
  },
  frost: {
    color: '#89dcff',
    bob: 1.1,
    lift: 0.014,
    spin: -0.35,
    pulse: 1.6,
    depth: 0.22,
    flicker: 0,
    aura: 1,
    swirl: 0,
  },
  ward: {
    color: '#65dc99',
    bob: 1.6,
    lift: 0.02,
    spin: 0.5,
    pulse: 2.3,
    depth: 0.35,
    flicker: 0,
    aura: 0.86,
    swirl: 0,
    shell: true,
  },
  focus: {
    color: '#f3d175',
    bob: 2.2,
    lift: 0.012,
    spin: 1.6,
    snap: true,
    pulse: 9,
    depth: 0.85,
    flicker: 0.15,
    aura: 0.78,
    swirl: 0,
  },
  portal: {
    color: '#b887ff',
    bob: 1.9,
    lift: 0.026,
    spin: 0.9,
    pulse: 3.2,
    depth: 0.45,
    flicker: 0.2,
    aura: 1.15,
    swirl: 1.4,
  },
};

export const powerCharacter = (power: PowerUp | undefined): PowerCharacter =>
  POWER_CHARACTER[power as PowerUp] || { ...POWER_CHARACTER.focus, color: effectDefinition('focus').color };

/** The five icons, drawn around the origin so the glow can be hung off the same point.
 * `material` is the shared emissive body; accent materials belong to the returned group. */
export function buildPowerIcon(power: PowerUp, material: THREE.MeshPhysicalMaterial): THREE.Group {
  const icon = new THREE.Group();
  const add = (geometry: THREE.BufferGeometry, x = 0, y = 0, z = 0, mat: THREE.Material = material) => {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    icon.add(mesh);
    return mesh;
  };
  const accent = (color: string, emissive: string, intensity: number) =>
    new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: intensity });
  const relief = {
    depth: 0.07,
    bevelEnabled: true,
    bevelSize: 0.012,
    bevelThickness: 0.014,
    bevelSegments: 2,
    steps: 1,
  };

  if (power === 'overdrive') {
    const flame = new THREE.Shape();
    flame.moveTo(0, -0.13);
    flame.bezierCurveTo(-0.2, -0.1, -0.17, 0.075, -0.07, 0.12);
    flame.bezierCurveTo(-0.055, 0.035, 0.025, 0.03, 0.015, 0.26);
    flame.bezierCurveTo(0.22, 0.09, 0.2, -0.07, 0, -0.13);
    add(new THREE.ExtrudeGeometry(flame, relief), 0, 0, -0.035).rotation.x = -0.38;
    add(new THREE.ConeGeometry(0.06, 0.2, 7), 0.015, -0.005, 0.06, accent('#ffe49a', '#ffd473', 1.4)).rotation.z =
      -0.16;
  } else if (power === 'frost') {
    add(new THREE.IcosahedronGeometry(0.125, 0));
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      const crystal = add(
        new THREE.OctahedronGeometry(0.085, 0),
        Math.cos(angle) * 0.075,
        0.015,
        Math.sin(angle) * 0.075,
      );
      crystal.scale.set(0.48, 2.1, 0.48);
      crystal.rotation.z = Math.cos(angle) * 0.38;
      crystal.rotation.x = Math.sin(angle) * 0.38;
    }
  } else if (power === 'ward') {
    const shield = new THREE.Shape();
    shield.moveTo(-0.16, 0.13);
    shield.lineTo(0.16, 0.13);
    shield.lineTo(0.145, -0.035);
    shield.quadraticCurveTo(0.11, -0.14, 0, -0.23);
    shield.quadraticCurveTo(-0.11, -0.14, -0.145, -0.035);
    shield.closePath();
    add(new THREE.ExtrudeGeometry(shield, { ...relief, depth: 0.065 }), 0, 0.05, -0.03).rotation.x = -0.36;
    const crest = accent('#e0ffe8', '#c8efcb', 0.35);
    add(new THREE.BoxGeometry(0.16, 0.028, 0.02), 0, 0.015, 0.059, crest).rotation.x = -0.36;
    add(new THREE.BoxGeometry(0.028, 0.16, 0.02), 0, 0.01, 0.07, crest);
  } else if (power === 'focus') {
    add(new THREE.TorusGeometry(0.13, 0.018, 8, 40)).rotation.x = Math.PI / 2;
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const mark = add(new THREE.BoxGeometry(0.095, 0.035, 0.025), Math.cos(angle) * 0.16, 0, Math.sin(angle) * 0.16);
      mark.rotation.y = -angle;
    }
    add(new THREE.SphereGeometry(0.035, 16, 12));
  } else {
    add(new THREE.TorusGeometry(0.14, 0.025, 10, 48)).rotation.x = 0.35;
    const second = add(new THREE.TorusGeometry(0.1, 0.013, 8, 36));
    second.rotation.y = Math.PI / 2;
    second.rotation.z = 0.4;
    add(
      new THREE.IcosahedronGeometry(0.067, 1),
      0,
      0,
      0,
      new THREE.MeshPhysicalMaterial({
        color: '#e0c4ff',
        emissive: '#b684ff',
        emissiveIntensity: 1.2,
        transparent: true,
        opacity: 0.65,
        roughness: 0.08,
      }),
    );
  }
  return icon;
}
