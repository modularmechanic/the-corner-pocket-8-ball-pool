import * as THREE from 'three';
import { useWood } from './pub-wood';
import { PUB_LAYOUT } from './pub-layout';
import { PUB_PROPS } from './pub-props';
import { FLOOR, type PubBuildKit } from './pub-build-kit';

/** A curved, illuminated cabinet places a recognisable jukebox beside the table. */
export function buildPubJukebox(kit: PubBuildKit, room: THREE.Group, brass: THREE.MeshStandardMaterial) {
  // The carcase takes the scanned walnut, like the room's other joinery.
  const jukeboxWalnut = new THREE.MeshPhysicalMaterial({ color: '#9a7452', roughness: 0.32, clearcoat: 0.6 });
  useWood(jukeboxWalnut, 'walnut', 1.1, 1.1);
  const { box, cylinder, neon, installModel } = kit;
  const jukebox = new THREE.Group();
  jukebox.position.set(PUB_LAYOUT.jukebox.x - 0.1, FLOOR, PUB_LAYOUT.jukebox.z);
  jukebox.rotation.y = PUB_LAYOUT.jukebox.rotation;
  room.add(jukebox);
  const outline = new THREE.Shape();
  outline.moveTo(-1.07, 0);
  outline.lineTo(1.07, 0);
  outline.lineTo(1.07, 2.65);
  outline.absarc(0, 2.65, 1.07, 0, Math.PI, false);
  outline.lineTo(-1.07, 0);
  const shell = new THREE.Mesh(
    new THREE.ExtrudeGeometry(outline, {
      depth: 0.76,
      bevelEnabled: true,
      bevelSize: 0.06,
      bevelThickness: 0.06,
      bevelSegments: 3,
      steps: 1,
    }),
    jukeboxWalnut,
  );
  shell.position.z = -0.38;
  shell.castShadow = true;
  jukebox.add(shell);
  for (let layer = 0; layer < 3; layer++) {
    const r = 1.01 - layer * 0.105,
      points = [new THREE.Vector3(-r, 0.12, 0.46), new THREE.Vector3(-r, 2.65, 0.46)];
    for (let i = 0; i <= 40; i++) {
      const angle = Math.PI - (i / 40) * Math.PI;
      points.push(new THREE.Vector3(Math.cos(angle) * r, 2.65 + Math.sin(angle) * r, 0.46));
    }
    points.push(new THREE.Vector3(r, 0.12, 0.46));
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 96, 0.026, 8, false),
      neon(['#ffc071', '#65ccbd', '#f59177'][layer], 1.7),
    );
    jukebox.add(tube);
  }
  box(
    1.52,
    1.05,
    0.06,
    new THREE.MeshStandardMaterial({ color: '#172520', roughness: 0.75 }),
    0,
    0.83,
    0.43,
    0.05,
    jukebox,
  );
  for (let x = -0.67; x <= 0.68; x += 0.135) box(0.025, 0.92, 0.045, brass, x, 0.83, 0.48, 0.009, jukebox);
  const record = cylinder(
    0.54,
    0.54,
    0.035,
    new THREE.MeshStandardMaterial({ color: '#171a16', roughness: 0.24 }),
    0,
    2.38,
    0.47,
    jukebox,
  );
  record.rotation.x = Math.PI / 2;
  const recordLabel = cylinder(
    0.15,
    0.15,
    0.04,
    new THREE.MeshStandardMaterial({ color: '#c39a59', roughness: 0.55 }),
    0,
    2.38,
    0.48,
    jukebox,
  );
  recordLabel.rotation.x = Math.PI / 2;
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(1.41, 1.35),
    new THREE.MeshPhysicalMaterial({
      color: '#bddacf',
      transparent: true,
      opacity: 0.13,
      roughness: 0.06,
      metalness: 0.3,
      depthWrite: false,
    }),
  );
  glass.position.set(0, 2.4, 0.53);
  jukebox.add(glass);
  for (let i = 0; i < 7; i++)
    box(
      0.12,
      0.095,
      0.045,
      new THREE.MeshStandardMaterial({ color: i % 2 ? '#eee0b9' : '#e5a662', roughness: 0.25 }),
      -0.51 + i * 0.17,
      1.47,
      0.53,
      0.02,
      jukebox,
    );
  const jukeboxLight = new THREE.PointLight('#eaa56a', 3, 5, 2);
  jukeboxLight.position.set(PUB_LAYOUT.jukebox.x + 0.9, -0.45, PUB_LAYOUT.jukebox.z);
  room.add(jukeboxLight);
  installModel(PUB_PROPS.jukebox, [{ ...PUB_LAYOUT.jukebox }], [jukebox]);
}
