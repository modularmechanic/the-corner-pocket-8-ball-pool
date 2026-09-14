import * as THREE from 'three';
import { batchPubStatic } from './pub-batching';
import { canvasTexture } from './materials';
import { seededRandom } from '../simulation/types';
import { PUB_LAYOUT, pubBackZ, pubFrontZ, pubSideX } from './pub-layout';
import type { PropInstaller } from './asset-installer';

export const PUB_BOUNDS = PUB_LAYOUT.bounds;
/** Prop paths relative to public/. */
export const PUB_BRICK_MAPS = [
  ['map', 'textures/pub/brick-color.webp'],
  ['normalMap', 'textures/pub/brick-normal.webp'],
  ['roughnessMap', 'textures/pub/brick-roughness.webp'],
] as const;
export function pubCutaway(camera: { x: number; y: number; z: number }) {
  return {
    left: camera.x > PUB_BOUNDS.left + 0.45,
    right: camera.x < PUB_BOUNDS.right - 0.45,
    back: camera.z > PUB_BOUNDS.back + 0.45,
    front: camera.z < PUB_BOUNDS.front - 0.45,
    ceiling: camera.y < PUB_BOUNDS.ceiling - 0.65,
  };
}

/** Keep the hanging fixture in oblique views, but remove its silhouette before it covers the table. */
export function billiardFixtureVisible(camera: THREE.Camera): boolean {
  if (camera instanceof THREE.OrthographicCamera) return false;
  const table = new THREE.Box2(),
    fixture = new THREE.Box2();
  for (const x of [-6.45, 6.45])
    for (const z of [-3.5, 3.5]) {
      const p = new THREE.Vector3(x, 0.4, z).project(camera);
      table.expandByPoint(new THREE.Vector2(p.x, p.y));
    }
  for (const x of [-3, 3])
    for (const y of [3.75, 6.25])
      for (const z of [-0.86, 0.86]) {
        const p = new THREE.Vector3(x, y, z).project(camera);
        fixture.expandByPoint(new THREE.Vector2(p.x, p.y));
      }
  table.expandByScalar(0.012);
  return !table.intersectsBox(fixture);
}
const fixtureViews = new WeakMap<THREE.Group, { view: THREE.Matrix4; projection: THREE.Matrix4 }>();
export function updateBilliardFixture(group: THREE.Group, camera: THREE.Camera): void {
  const last = fixtureViews.get(group);
  if (last && last.view.equals(camera.matrixWorldInverse) && last.projection.equals(camera.projectionMatrix)) return;
  group.visible = billiardFixtureVisible(camera);
  if (last) {
    last.view.copy(camera.matrixWorldInverse);
    last.projection.copy(camera.projectionMatrix);
  } else
    fixtureViews.set(group, { view: camera.matrixWorldInverse.clone(), projection: camera.projectionMatrix.clone() });
}

export function stoneTexture() {
  const random = seededRandom('corner-pocket-flagstones');
  const texture = canvasTexture(1024, 1024, (ctx) => {
    ctx.fillStyle = '#51483c';
    ctx.fillRect(0, 0, 1024, 1024);
    for (let row = 0; row < 8; row++)
      for (let col = -1; col < 5; col++) {
        const x = col * 256 + (row % 2) * 128,
          y = row * 128,
          tone = 88 + random() * 34;
        ctx.fillStyle = `rgb(${tone * 1.1},${tone},${tone * 0.83})`;
        ctx.fillRect(x + 3, y + 3, 250, 122);
        for (let n = 0; n < 180; n++) {
          const px = x + random() * 256,
            py = y + random() * 128;
          ctx.fillStyle = random() > 0.4 ? '#c9c1a409' : '#211d1812';
          ctx.beginPath();
          ctx.ellipse(px, py, random() * 22 + 1, random() * 9 + 1, random() * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = '#d0c3a62c';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 6, y + 6, 244, 116);
        if (random() > 0.4) {
          ctx.strokeStyle = '#211f1933';
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(x + 110, y + 4);
          ctx.lineTo(x + 119, y + 25);
          ctx.lineTo(x + 115, y + 52);
          ctx.lineTo(x + 129, y + 65);
          ctx.stroke();
        }
      }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** A complete interior, with separate walls so exterior game cameras can cut away the nearest face. */
export function buildPubInterior(
  room: THREE.Group,
  installer: PropInstaller,
  materials: { wood: THREE.Material; brass: THREE.Material; wall: THREE.Material; metal: THREE.Material },
) {
  const walls = {
    left: new THREE.Group(),
    right: new THREE.Group(),
    back: new THREE.Group(),
    front: new THREE.Group(),
    ceiling: new THREE.Group(),
  };
  for (const [name, group] of Object.entries(walls)) {
    group.name = `pub-room-${name}`;
    room.add(group);
  }
  const props = new THREE.Group();
  props.name = 'pub-room-details';
  room.add(props);
  const floor = PUB_LAYOUT.floor,
    top = PUB_BOUNDS.ceiling,
    cream = materials.wall,
    wood = materials.wood,
    brass = materials.brass,
    metal = materials.metal;
  const width = PUB_BOUNDS.right - PUB_BOUNDS.left,
    depth = PUB_BOUNDS.front - PUB_BOUNDS.back,
    centreZ = (PUB_BOUNDS.back + PUB_BOUNDS.front) / 2;
  const box = (
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    parent: THREE.Group = props,
  ) => {
    const geometry = new THREE.BoxGeometry(w, h, d);
    if (material === wood && (w > 29.6 || d > 23.4)) {
      const uv = geometry.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * PUB_LAYOUT.expansion);
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const cylinder = (
    r: number,
    h: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    parent: THREE.Group = props,
  ) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 16), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const warmGlass = new THREE.MeshStandardMaterial({
    color: '#fff0c1',
    emissive: '#ffd597',
    emissiveIntensity: 1.25,
    roughness: 0.35,
  });
  const frameMat = new THREE.MeshStandardMaterial({ color: '#eee0b3', roughness: 0.69 });
  const curtainTex = canvasTexture(128, 256, (ctx) => {
    ctx.fillStyle = '#762b2d';
    ctx.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 128; i++) {
      const t = Math.sin(i * 0.28);
      ctx.fillStyle = `rgba(${t > 0 ? '245,192,123' : '20,7,8'},${Math.abs(t) * 0.22})`;
      ctx.fillRect(i, 0, 1, 256);
    }
    for (let y = 3; y < 256; y += 8) {
      ctx.fillStyle = '#edc78b15';
      ctx.fillRect(0, y, 128, 1);
    }
  });
  const curtain = new THREE.MeshStandardMaterial({ map: curtainTex, roughness: 0.96, side: THREE.DoubleSide });
  const windowTex = canvasTexture(512, 512, (ctx) => {
    const sky = ctx.createLinearGradient(0, 0, 0, 512);
    sky.addColorStop(0, '#101823');
    sky.addColorStop(1, '#283039');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 512, 512);
    const random = seededRandom('pub-street');
    for (let i = 0; i < 7; i++) {
      const x = i * 87 - 20,
        h = 100 + random() * 160;
      ctx.fillStyle = i % 2 ? '#6b736b' : '#6e6b5a';
      ctx.fillRect(x, 512 - h, 78, h);
      ctx.fillStyle = '#d1ba7b';
      for (let y = 530 - h; y < 470; y += 48) for (let xx = x + 13; xx < x + 70; xx += 28) ctx.fillRect(xx, y, 11, 21);
    }
    for (let i = 0; i < 450; i++) {
      ctx.strokeStyle = '#eff6dd2b';
      ctx.lineWidth = 1;
      const x = random() * 512,
        y = random() * 512;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 3, y + 8 + random() * 18);
      ctx.stroke();
    }
  });
  const glazing = new THREE.MeshPhysicalMaterial({
    map: windowTex,
    color: '#60717d',
    roughness: 0.24,
    metalness: 0.05,
    clearcoat: 0.7,
    emissiveMap: windowTex,
    emissive: '#8194a6',
    emissiveIntensity: 0.035,
  });
  // Two inward-facing masonry bays replace the central right windows, like the reference pub gallery.
  const brick = new THREE.MeshStandardMaterial({
    normalScale: new THREE.Vector2(0.55, 0.55),
    color: '#d8c6ad',
    roughness: 0.95,
  });
  for (const [slot, path] of PUB_BRICK_MAPS)
    installer.texture(path, {
      prepare: (texture) => {
        if (slot === 'map') texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(4.55 / 7.5, 4.65 / 7.5);
      },
      use: (texture) => {
        brick[slot] = texture;
        brick.needsUpdate = true;
      },
    });
  // Window and brick openings keep their original dimensions; new masonry piers fill the wider spacing.
  const bays = [-8.4, -2.6, 3.2, 9].map((z) => z * PUB_LAYOUT.expansion);
  for (const side of [-1, 1]) {
    const parent = side < 0 ? walls.left : walls.right,
      x = side * PUB_BOUNDS.right;
    box(0.24, 2.2, depth, wood, x, floor + 1.1, centreZ, parent);
    box(0.24, 0.8, depth, cream, x, -1, centreZ, parent);
    box(0.24, 2.38, depth, cream, x, 5.21, centreZ, parent);
    let edge = PUB_BOUNDS.back;
    for (const centre of [...bays, PUB_BOUNDS.front + 2.275]) {
      const start = centre - 2.275;
      if (start > edge) box(0.24, 4.65, start - edge, cream, x, 1.7, (start + edge) / 2, parent);
      edge = centre + 2.275;
    }
    for (let index = 0; index < bays.length; index++) {
      const z = bays[index];
      if (side > 0 && (index === 1 || index === 2)) {
        box(0.24, 4.65, 4.55, brick, x, 1.7, z, parent);
        continue;
      }
      const window = new THREE.Group();
      window.position.set(x - side * 0.15, 1.7, z);
      window.rotation.y = (-side * Math.PI) / 2;
      parent.add(window);
      box(4.55, 4.65, 0.11, frameMat, 0, 0, 0, window);
      box(4.17, 4.26, 0.08, glazing, 0, 0, 0.075, window);
      for (const vx of [-2.16, 0, 2.16]) box(0.09, 4.4, 0.13, wood, vx, 0, 0.17, window);
      for (const yy of [-2.18, -0.15, 2.18]) box(4.4, 0.1, 0.13, wood, 0, yy, 0.17, window);
      box(4.9, 0.16, 0.44, wood, 0, -2.37, 0.14, window);
      box(5, 0.12, 0.15, brass, 0, 2.55, 0.35, window);
      for (const sign of [-1, 1]) {
        const drape = box(0.66, 4.7, 0.16, curtain, sign * 2.03, 0, 0.33, window);
        drape.rotation.z = sign * 0.015;
        box(0.7, 0.075, 0.18, brass, sign * 2.03, -0.65, 0.45, window);
      }
    }
    box(0.32, 0.15, depth, wood, x - side * 0.03, floor + 2.25, centreZ, parent);
    box(0.36, 0.22, depth, wood, x - side * 0.08, 6.21, centreZ, parent);
    box(0.3, 0.19, depth, wood, x - side * 0.08, floor + 0.13, centreZ, parent);
  }
  box(width, 10, 0.24, cream, 0, 1.4, PUB_BOUNDS.back, walls.back);
  // The previously empty front is now an entrance wall, with sidelights and two snug seating bays.
  const burgundy = new THREE.MeshStandardMaterial({ color: '#803c37', roughness: 0.94 });
  for (const side of [-1, 1]) {
    const bayWidth = PUB_BOUNDS.right - 3.5,
      x = side * (3.5 + bayWidth / 2);
    box(bayWidth, 10, 0.24, burgundy, x, 1.4, PUB_BOUNDS.front, walls.front);
    box(bayWidth, 2.2, 0.3, wood, x, floor + 1.1, PUB_BOUNDS.front - 0.17, walls.front);
  }
  box(7, 3, 0.24, cream, 0, 4.9, PUB_BOUNDS.front, walls.front);
  const door = new THREE.Group();
  door.position.set(0, floor, pubFrontZ(11.82));
  door.rotation.y = Math.PI;
  walls.front.add(door);
  box(2.7, 6.9, 0.26, wood, 0, 3.45, 0, door);
  box(2.12, 3.8, 0.07, glazing, 0, 4.44, 0.17, door);
  for (const x of [-1.16, 0, 1.16]) box(0.095, 4, 0.12, wood, x, 4.4, 0.25, door);
  for (const y of [2.47, 4.4, 6.36]) box(2.37, 0.1, 0.12, wood, 0, y, 0.25, door);
  box(1.96, 1.64, 0.1, cream, 0, 1.25, 0.19, door);
  box(0.08, 0.65, 0.15, brass, -0.89, 2.2, 0.29, door);
  for (const x of [-2.27, 2.27]) {
    box(1.35, 6.8, 0.17, frameMat, x, 3.4, 0, door);
    box(1.08, 5.75, 0.05, glazing, x, 3.62, 0.13, door);
    for (const y of [1.3, 3.5, 5.7]) box(1.12, 0.065, 0.1, wood, x, y, 0.2, door);
  }
  box(7.1, 0.22, 0.43, wood, 0, 6.99, 0, door);
  const exitTex = canvasTexture(256, 64, (ctx) => {
    ctx.fillStyle = '#2c583b';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#e3f1cb';
    ctx.textAlign = 'center';
    ctx.font = 'bold 42px Arial';
    ctx.fillText('EXIT  →', 128, 48);
  });
  box(
    1.1,
    0.3,
    0.08,
    new THREE.MeshStandardMaterial({ map: exitTex, emissive: '#a1d28e', emissiveIntensity: 0.3 }),
    0,
    7.33,
    0.23,
    door,
  );
  const matTex = canvasTexture(512, 256, (ctx) => {
    ctx.fillStyle = '#544638';
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = '#b49d71';
    ctx.lineWidth = 8;
    ctx.strokeRect(16, 16, 480, 224);
    ctx.fillStyle = '#b49d71';
    ctx.textAlign = 'center';
    ctx.font = 'bold 35px Georgia';
    ctx.fillText('THE CORNER POCKET', 256, 141);
  });
  const doormat = new THREE.Mesh(
    new THREE.PlaneGeometry(3.7, 1.65),
    new THREE.MeshStandardMaterial({ map: matTex, roughness: 1 }),
  );
  doormat.rotation.x = -Math.PI / 2;
  doormat.position.set(0, floor + 0.018, pubFrontZ(10.6));
  props.add(doormat);
  box(width, 0.22, 0.38, wood, 0, 6.21, pubFrontZ(11.8), walls.front);
  // Cream ceiling, exposed dark beams and a traditional three-shade billiard light.
  box(
    width,
    0.16,
    depth,
    new THREE.MeshStandardMaterial({ color: '#dccca8', roughness: 0.95 }),
    0,
    top + 0.08,
    centreZ,
    walls.ceiling,
  );
  for (const z of [-8, -1, 6]) box(width, 0.45, 0.42, wood, 0, 6.09, z * PUB_LAYOUT.expansion, walls.ceiling);
  for (const x of [-10, 10]) box(0.38, 0.32, depth, wood, pubSideX(x), 6.15, centreZ, walls.ceiling);
  // The detailed Blender-authored billiard pendant is installed by buildPub.
  for (const oldX of [-10.5, 10.5])
    for (const oldZ of [-3.1, 7.4]) {
      const x = pubSideX(oldX),
        z = oldZ > 5 ? pubFrontZ(oldZ) : oldZ;
      cylinder(0.024, 1.15, brass, x, 5.63, z, walls.ceiling);
      const shade = new THREE.Mesh(
        new THREE.ConeGeometry(0.55, 0.53, 24, 1, true),
        new THREE.MeshStandardMaterial({ color: '#efe2b7', side: THREE.DoubleSide, roughness: 0.65 }),
      );
      shade.position.set(x, 4.88, z);
      walls.ceiling.add(shade);
      cylinder(0.32, 0.025, warmGlass, x, 4.63, z, walls.ceiling);
    }
  // A warm stone pier separates the music corner from the bar without narrowing the cue aisle.
  const stone = stoneTexture();
  stone.repeat.set(1, 2.2);
  const stoneMaterial = new THREE.MeshStandardMaterial({
    map: stone,
    bumpMap: stone,
    bumpScale: 0.055,
    roughness: 0.94,
    color: '#c8b792',
  });
  box(1.13, 9.75, 1.08, stoneMaterial, pubSideX(-8.4), 1.275, pubBackZ(-6.0));
  box(1.38, 0.24, 1.33, wood, pubSideX(-8.4), 6.1, pubBackZ(-6.0));
  box(1.27, 0.21, 1.2, stoneMaterial, pubSideX(-8.4), floor + 0.12, pubBackZ(-6.0));
  // Radiators and cast-iron feet beneath the side windows.
  const radiator = new THREE.MeshStandardMaterial({ color: '#a09b83', metalness: 0.38, roughness: 0.65 });
  for (const side of [-1, 1])
    for (const oldZ of [-1.3, 7.8]) {
      const z = oldZ * PUB_LAYOUT.expansion;
      const parent = side < 0 ? walls.left : walls.right;
      for (let rib = 0; rib < 11; rib++)
        box(0.26, 1.06, 0.12, radiator, side * (PUB_BOUNDS.right - 0.5), floor + 0.78, z + (rib - 5) * 0.17, parent);
      for (const y of [floor + 0.35, floor + 1.19])
        box(0.24, 0.09, 1.87, radiator, side * (PUB_BOUNDS.right - 0.5), y, z, parent);
      cylinder(0.035, 0.85, brass, side * (PUB_BOUNDS.right - 0.5), floor + 0.48, z + 1.06, parent);
    }
  // Dartboard, surround and hand-written scoreboard in the front-left snug.
  const darts = canvasTexture(512, 512, (ctx) => {
    ctx.fillStyle = '#27241f';
    ctx.fillRect(0, 0, 512, 512);
    const nums = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
    for (let i = 0; i < 20; i++) {
      const a = ((i - 0.5) / 20) * Math.PI * 2 - Math.PI / 2,
        b = ((i + 0.5) / 20) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(256, 256);
      ctx.arc(256, 256, 192, a, b);
      ctx.closePath();
      ctx.fillStyle = i % 2 ? '#d9caa5' : '#262920';
      ctx.fill();
      for (const [r, w] of [
        [178, 13],
        [111, 11],
      ]) {
        ctx.beginPath();
        ctx.arc(256, 256, r, a, b);
        ctx.strokeStyle = i % 2 ? '#37684e' : '#923f37';
        ctx.lineWidth = w;
        ctx.stroke();
      }
      ctx.fillStyle = '#ded4b6';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '23px Georgia';
      const mid = (a + b) / 2;
      ctx.fillText(String(nums[i]), 256 + Math.cos(mid) * 216, 256 + Math.sin(mid) * 216);
    }
    ctx.beginPath();
    ctx.arc(256, 256, 16, 0, Math.PI * 2);
    ctx.fillStyle = '#37684e';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(256, 256, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#923f37';
    ctx.fill();
  });
  box(2.95, 3.15, 0.14, wood, pubSideX(-4.82), 1.66, pubFrontZ(11.74), walls.front);
  const board = new THREE.Mesh(
    new THREE.CircleGeometry(1.27, 64),
    new THREE.MeshStandardMaterial({ map: darts, roughness: 0.94 }),
  );
  board.rotation.y = Math.PI;
  board.position.set(pubSideX(-4.82), 1.65, pubFrontZ(11.64));
  walls.front.add(board);
  // Practical wall sconces and broad fills reveal details in the entire room.
  for (const [oldX, oldZ] of [
    [-13.8, 3.4],
    [13.8, 3.4],
    [-10.45, 11.2],
    [7.9, 11.2],
  ]) {
    const x = pubSideX(oldX),
      z = oldZ > 10 ? pubFrontZ(oldZ) : oldZ;
    const parent = z > 10 ? walls.front : x < 0 ? walls.left : walls.right;
    box(0.18, 0.65, 0.18, brass, x, 3.45, z, parent);
    cylinder(0.19, 0.43, warmGlass, x, 3.9, z, parent);
    const light = new THREE.PointLight('#ffc17b', 10, 7, 2);
    light.position.set(x * 0.92, 3.65, z * 0.93);
    room.add(light);
  }
  const fill = new THREE.PointLight('#eeb97e', 6, 10, 2);
  fill.position.set(0, 5.45, pubFrontZ(6.8));
  room.add(fill);
  // Static trim, glazing and furniture details are merged by material per cutaway section.
  for (const group of [...Object.values(walls), props]) batchPubStatic(group, 'subtree');
  return {
    walls,
    update(camera: THREE.Camera) {
      const flags = pubCutaway(camera.position);
      for (const name of Object.keys(walls) as (keyof typeof walls)[]) walls[name].visible = flags[name];
    },
  };
}
