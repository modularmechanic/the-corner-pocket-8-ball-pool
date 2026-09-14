import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { GameState } from '../simulation/types';
import { canvasTexture } from './materials';

/** `balls` are indexed by ball id and shared with the playing balls. */
export interface TableDetailTextures {
  brushedSteel: THREE.Texture;
  coinFace: THREE.Texture;
  balls: readonly THREE.Texture[];
}
/** Canvas-drawn, so browser only. */
export function drawTableDetailTextures(balls: readonly THREE.Texture[]): TableDetailTextures {
  const brushedSteel = canvasTexture(512, 512, (ctx) => {
    ctx.fillStyle = '#a7ada9';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 1700; i++) {
      const value = 130 + Math.floor(Math.random() * 70);
      ctx.strokeStyle = `rgba(${value},${value},${value},.16)`;
      ctx.beginPath();
      const y = Math.random() * 512;
      ctx.moveTo(0, y);
      ctx.lineTo(512, y);
      ctx.stroke();
    }
    ctx.fillStyle = '#313934';
    ctx.textAlign = 'center';
    ctx.font = 'bold 26px Arial';
    ctx.fillText('PUSH TO RELEASE', 256, 462);
    ctx.font = '16px Arial';
    ctx.fillText('CORNER POCKET  •  TOKEN PLAY', 256, 35);
  });
  const coinFace = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#c4a456';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#806634';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(128, 128, 110, 0, Math.PI * 2);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#775c2d';
    ctx.font = 'bold 111px Georgia';
    ctx.fillText('8', 128, 166);
    ctx.font = '17px Arial';
    ctx.fillText('CORNER POCKET', 128, 62);
  });
  return { brushedSteel, coinFace, balls };
}
const TOKEN_FROM = new THREE.Vector3(3.31, 0.28, 3.34),
  TOKEN_TO = new THREE.Vector3(3.84, -0.87, 3.445);
/** The visible machinery beneath the playing surface; never part of ball collision simulation. */
export class TableDetails {
  readonly group = new THREE.Group();
  readonly coinControl = new THREE.Group();
  private lever = new THREE.Group();
  private token: THREE.Mesh;
  private returns = new Map<number, THREE.Mesh>();
  private order: number[] = [];
  private potted = new Set<number>();
  private arrivalAge = new Map<number, number>();
  private releaseOrder: number[] = [];
  private resetAge = Infinity;
  private seed = '';
  private indicator: THREE.MeshStandardMaterial;
  private sharedBallMaps: readonly THREE.Texture[];
  constructor(scene: THREE.Scene, textures: TableDetailTextures) {
    scene.add(this.group);
    this.sharedBallMaps = textures.balls;
    const steel = new THREE.MeshPhysicalMaterial({
      map: textures.brushedSteel,
      color: '#d0d6ce',
      metalness: 0.87,
      roughness: 0.28,
      clearcoat: 0.18,
    });
    const darkSteel = new THREE.MeshStandardMaterial({ color: '#232b29', metalness: 0.7, roughness: 0.4 });
    const brass = new THREE.MeshStandardMaterial({ color: '#c2a25e', metalness: 0.82, roughness: 0.28 });
    const box = (
      w: number,
      h: number,
      d: number,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      parent: THREE.Group = this.group,
    ) => {
      const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.014), mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    // All wood in front of this recess is omitted by TableModel.
    box(6.1, 0.54, 0.04, darkSteel, -0.75, -0.955, 2.76);
    box(6.1, 0.04, 0.61, darkSteel, -0.75, -1.205, 3.04);
    for (const x of [-3.82, 2.32]) box(0.055, 0.62, 0.11, brass, x, -0.955, 3.37);
    for (const y of [-0.645, -1.265]) box(6.19, 0.055, 0.11, brass, -0.75, y, 3.37);
    for (const z of [2.99, 3.19]) {
      const track = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 5.86, 24), steel);
      track.rotation.z = Math.PI / 2;
      track.position.set(-0.76, -1.175, z);
      this.group.add(track);
    }
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(6.08, 0.53, 0.014),
      new THREE.MeshPhysicalMaterial({
        color: '#b5d6d0',
        transparent: true,
        opacity: 0.14,
        metalness: 0.08,
        roughness: 0.04,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        depthWrite: false,
      }),
    );
    glass.position.set(-0.75, -0.955, 3.397);
    this.group.add(glass);
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(5.85, 0.018, 0.02),
      new THREE.MeshStandardMaterial({ color: '#f4dcaa', emissive: '#f4dcaa', emissiveIntensity: 1.2 }),
    );
    strip.position.set(-0.75, -0.679, 3.11);
    this.group.add(strip);
    const returnLight = new THREE.PointLight('#f7d9a5', 1.2, 2.5, 2);
    returnLight.position.set(-0.6, -0.82, 3.27);
    this.group.add(returnLight);
    for (let id = 1; id <= 15; id++) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.157, 32, 24),
        new THREE.MeshPhysicalMaterial({
          map: textures.balls[id],
          roughness: 0.18,
          clearcoat: 1,
          clearcoatRoughness: 0.12,
        }),
      );
      mesh.visible = false;
      mesh.position.set(2, -1.005, 3.08);
      mesh.rotation.x = 0.1;
      this.group.add(mesh);
      this.returns.set(id, mesh);
    }
    this.coinControl.position.set(4.13, -0.96, 3.38);
    this.coinControl.userData.tableControl = 'coin';
    this.group.add(this.coinControl);
    box(1.12, 0.76, 0.065, steel, 0, 0, 0, this.coinControl);
    for (const x of [-0.47, 0.47])
      for (const y of [-0.3, 0.3]) {
        const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 8), brass);
        screw.rotation.x = Math.PI / 2;
        screw.position.set(x, y, 0.045);
        this.coinControl.add(screw);
      }
    box(0.047, 0.255, 0.015, new THREE.MeshBasicMaterial({ color: '#080d0b' }), -0.29, 0.075, 0.042, this.coinControl);
    box(0.095, 0.012, 0.035, brass, -0.29, 0.208, 0.052, this.coinControl);
    this.coinControl.add(this.lever);
    this.lever.position.set(0.13, -0.04, 0.07);
    box(0.51, 0.095, 0.26, darkSteel, 0, 0, 0.07, this.lever);
    box(0.63, 0.125, 0.08, steel, 0, 0, 0.24, this.lever);
    box(0.4, 0.035, 0.015, brass, 0, 0.017, 0.286, this.lever);
    this.indicator = new THREE.MeshStandardMaterial({
      color: '#d8a654',
      emissive: '#e9bd67',
      emissiveIntensity: 1.5,
      roughness: 0.2,
    });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), this.indicator);
    lamp.position.set(0.32, 0.235, 0.05);
    this.coinControl.add(lamp);
    const coinMaterial = new THREE.MeshStandardMaterial({
      map: textures.coinFace,
      color: '#e5c779',
      metalness: 0.85,
      roughness: 0.3,
    });
    const coinGeometry = new THREE.CylinderGeometry(0.09, 0.09, 0.018, 48);
    for (const [x, z, count] of [
      [3.09, 3.28, 4],
      [3.31, 3.34, 2],
      [2.9, 3.36, 1],
      [3.55, 3.27, 1],
    ])
      for (let i = 0; i < count; i++) {
        const coin = new THREE.Mesh(coinGeometry, coinMaterial);
        coin.position.set(x, 0.232 + i * 0.019, z);
        coin.rotation.y = x + i * 0.7;
        coin.castShadow = true;
        this.group.add(coin);
      }
    this.token = new THREE.Mesh(coinGeometry, coinMaterial);
    this.token.visible = false;
    this.token.castShadow = true;
    this.group.add(this.token);
  }
  animateReset() {
    this.resetAge = 0;
    this.releaseOrder = [...this.order];
    return 1200;
  }
  /** Balls in `onTable` (such as those still fading out) have not reached the return yet. */
  update(state: GameState, dt: number, onTable: ReadonlyMap<number, unknown>) {
    if (state.seed !== this.seed) {
      this.seed = state.seed;
      this.order.length = 0;
      this.arrivalAge.clear();
    }
    const potted = this.potted;
    potted.clear();
    for (const ball of state.balls) if (ball.id > 0 && ball.pocketed && !onTable.has(ball.id)) potted.add(ball.id);
    let kept = 0;
    for (const id of this.order) if (potted.has(id)) this.order[kept++] = id;
    this.order.length = kept;
    for (const id of potted)
      if (!this.order.includes(id)) {
        this.order.push(id);
        this.arrivalAge.set(id, 0);
        this.returns.get(id)!.position.x = 2.08;
      }
    for (const id of this.order) this.arrivalAge.set(id, (this.arrivalAge.get(id) || 0) + dt);
    this.resetAge += dt;
    const resetting = this.resetAge < 1.2;
    const shown = resetting ? this.releaseOrder : this.order;
    this.indicator.emissiveIntensity = resetting ? 2.1 : 1.25;
    const press = Math.max(0, 1 - Math.abs(this.resetAge - 0.6) / 0.19);
    this.lever.position.z = 0.07 - press * 0.16;
    this.token.visible = this.resetAge < 0.45;
    if (this.token.visible) {
      const t = Math.min(1, this.resetAge / 0.45);
      this.token.position.lerpVectors(TOKEN_FROM, TOKEN_TO, t * t);
      this.token.rotation.x = (t * Math.PI) / 2;
    }
    for (const [id, mesh] of this.returns) {
      const index = shown.indexOf(id);
      mesh.visible = index >= 0 && (resetting || (this.arrivalAge.get(id) || 0) >= 0.4);
      if (!mesh.visible) continue;
      const oldX = mesh.position.x,
        target = -3.52 + index * 0.351;
      if (resetting && this.resetAge > 0.6) {
        const release = Math.max(0, (this.resetAge - 0.6 - index * 0.021) / 0.28);
        mesh.position.set(target + release * 2.5, -1.005 - release * release * 0.65, 3.08);
        mesh.visible = release < 1;
      } else {
        mesh.position.x = THREE.MathUtils.damp(mesh.position.x, target, 6, dt);
        mesh.position.y = -1.005;
      }
      mesh.rotateZ(-(mesh.position.x - oldX) / 0.157);
    }
  }
  dispose() {
    this.group.removeFromParent();
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>(),
      textures = new Set<THREE.Texture>();
    this.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) if (!this.sharedBallMaps.includes(texture)) texture.dispose();
  }
}
