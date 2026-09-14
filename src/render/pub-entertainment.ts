import * as THREE from 'three';
import { PUB_LAYOUT } from './pub-layout';
import { disposePubObject } from './pub-models';
import { batchPubStatic } from './pub-batching';
import type { PropInstaller } from './asset-installer';

export type PubSport = 'soccer' | 'rugby';
export const PUB_ENTERTAINMENT = {
  slots: [2.7, 5.5, 8.3].map((z) => ({
    x: PUB_LAYOUT.bounds.left + 1.176,
    y: PUB_LAYOUT.floor,
    z,
    height: 4.45,
    rotation: Math.PI / 2,
  })),
  televisions: [-9, 9.3].map((z) => ({
    x: PUB_LAYOUT.bounds.right - 0.535 * (3.1 / 1.06) - 0.03,
    y: 1.9,
    z,
    height: 3.1,
    rotation: -Math.PI / 2,
  })),
};
/** Prop paths relative to public/. */
export const PUB_ENTERTAINMENT_PROPS = { slot: 'models/pub/slot-cabinet.glb', tv: 'models/pub/sports-tv.glb' } as const;
interface Screen {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  material: THREE.MeshBasicMaterial;
  mesh: THREE.Mesh;
  anchor: THREE.Group;
  tick: number;
  kind: 'slot' | PubSport;
  index: number;
}
const soccerRoute = [
  [0.15, 0.55],
  [0.3, 0.67],
  [0.45, 0.5],
  [0.6, 0.31],
  [0.72, 0.42],
  [0.88, 0.56],
  [0.97, 0.5],
  [0.55, 0.47],
];
const rugbyRoute = [
  [0.28, 0.52],
  [0.36, 0.66],
  [0.44, 0.41],
  [0.53, 0.35],
  [0.66, 0.47],
  [0.79, 0.54],
  [0.92, 0.46],
  [0.45, 0.49],
];

/** Deterministic fictional match action, bounded to each television's playing field. */
export function pubBroadcastFrame(sport: PubSport, time: number) {
  const t = Math.max(0, Number.isFinite(time) ? time : 0),
    route = sport === 'soccer' ? soccerRoute : rugbyRoute;
  const phase = ((t % (sport === 'soccer' ? 28 : 24)) / (sport === 'soccer' ? 28 : 24)) * route.length;
  const index = Math.floor(phase),
    from = route[index],
    to = route[(index + 1) % route.length],
    u = phase - index;
  const ball = {
    x: from[0] + (to[0] - from[0]) * u,
    y: from[1] + (to[1] - from[1]) * u,
    angle: Math.atan2(to[1] - from[1], to[0] - from[0]),
  };
  const count = sport === 'soccer' ? 11 : 15;
  const players = Array.from({ length: count * 2 }, (_, i) => {
    const team = i < count ? 0 : 1,
      n = i % count;
    const baseX =
      sport === 'soccer' ? (n === 0 ? 0.045 : 0.19 + Math.floor((n - 1) / 4) * 0.17) : 0.26 + Math.floor(n / 5) * 0.12;
    const baseY = sport === 'soccer' ? (n === 0 ? 0.5 : 0.17 + ((n - 1) % 4) * 0.22) : 0.13 + (n % 5) * 0.185;
    return {
      team,
      x: THREE.MathUtils.clamp((team ? 1 - baseX : baseX) + Math.sin(t * 0.48 + n * 1.9 + team) * 0.045, 0.025, 0.975),
      y: THREE.MathUtils.clamp(baseY + Math.sin(t * 0.72 + n * 2.3 + team) * 0.055, 0.035, 0.965),
    };
  });
  const runner = players[sport === 'soccer' ? 9 : 12];
  runner.x = THREE.MathUtils.clamp(ball.x - 0.022, 0.025, 0.975);
  runner.y = THREE.MathUtils.clamp(ball.y + 0.014, 0.035, 0.965);
  const seconds = Math.floor(t * 2.4) + (sport === 'soccer' ? 27 * 60 + 14 : 43 * 60 + 6);
  return {
    ball,
    players,
    clock: `${String(Math.floor(seconds / 60) % 90).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`,
  };
}

function drawBroadcast(ctx: CanvasRenderingContext2D, sport: PubSport, time: number) {
  const w = ctx.canvas.width,
    h = ctx.canvas.height,
    field = { x: 27, y: 70, w: w - 54, h: h - 97 };
  ctx.fillStyle = '#142229';
  ctx.fillRect(0, 0, w, h);
  // The stadium seats and alternating mowing bands move only through match action.
  for (let i = 0; i < 128; i++) {
    ctx.fillStyle = ['#6a786f', '#a7a794', '#2d454f', '#b1a68c'][i % 4];
    ctx.fillRect(i * 6, 49 + (i % 3) * 4, 3, 3);
  }
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = i % 2 ? '#397a42' : '#43874b';
    ctx.fillRect(field.x + (i * field.w) / 12, field.y, field.w / 12 + 0.5, field.h);
  }
  ctx.strokeStyle = '#e6efdc';
  ctx.lineWidth = 1.6;
  ctx.strokeRect(field.x, field.y, field.w, field.h);
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath();
    ctx.moveTo(field.x + x1 * field.w, field.y + y1 * field.h);
    ctx.lineTo(field.x + x2 * field.w, field.y + y2 * field.h);
    ctx.stroke();
  };
  line(0.5, 0, 0.5, 1);
  if (sport === 'soccer') {
    ctx.beginPath();
    ctx.ellipse(field.x + field.w / 2, field.y + field.h / 2, field.w * 0.076, field.h * 0.19, 0, 0, Math.PI * 2);
    ctx.stroke();
    for (const side of [0, 1]) {
      const x = side ? field.x + field.w - field.w * 0.16 : field.x;
      ctx.strokeRect(x, field.y + field.h * 0.23, field.w * 0.16, field.h * 0.54);
      ctx.strokeRect(
        side ? field.x + field.w - field.w * 0.055 : field.x,
        field.y + field.h * 0.37,
        field.w * 0.055,
        field.h * 0.26,
      );
      ctx.strokeRect(side ? field.x + field.w : field.x - 9, field.y + field.h * 0.42, 9, field.h * 0.16);
    }
  } else {
    for (const x of [0.08, 0.22, 0.78, 0.92]) line(x, 0, x, 1);
    ctx.setLineDash([5, 5]);
    for (const x of [0.32, 0.4, 0.6, 0.68]) line(x, 0.06, x, 0.94);
    ctx.setLineDash([]);
    for (const side of [0.035, 0.965]) {
      line(side, 0.39, side, 0.61);
      line(side, 0.39, side - 0.012, 0.33);
      line(side, 0.61, side - 0.012, 0.67);
      ctx.fillStyle = '#f0efe1';
      ctx.font = '12px Arial';
      ctx.fillText('22', field.x + (side < 0.5 ? 0.23 : 0.74) * field.w, field.y + 18);
    }
  }
  const frame = pubBroadcastFrame(sport, time);
  for (let i = 0; i < frame.players.length; i++) {
    const player = frame.players[i],
      x = field.x + player.x * field.w,
      y = field.y + player.y * field.h;
    ctx.fillStyle = '#143c2866';
    ctx.beginPath();
    ctx.ellipse(x + 3, y + 5, 5.5, 2.7, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = player.team
      ? sport === 'soccer'
        ? '#f0e4bb'
        : '#d8e8db'
      : sport === 'soccer'
        ? '#2fbed2'
        : '#942b46';
    ctx.beginPath();
    ctx.ellipse(x, y, 4, 5.4, Math.sin(time * 4 + i) * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d2ac81';
    ctx.beginPath();
    ctx.arc(x, y - 4.8, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = player.team ? '#283148' : '#15262e';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x - 1, y + 4);
    ctx.lineTo(x - 2 + Math.sin(time * 9 + i) * 2, y + 8);
    ctx.moveTo(x + 1, y + 4);
    ctx.lineTo(x + 2 - Math.sin(time * 9 + i) * 2, y + 8);
    ctx.stroke();
  }
  const bx = field.x + frame.ball.x * field.w,
    by = field.y + frame.ball.y * field.h;
  ctx.fillStyle = '#122c2755';
  ctx.beginPath();
  ctx.ellipse(bx + 3, by + 4, 4, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(frame.ball.angle + time * (sport === 'rugby' ? 2 : 0));
  ctx.fillStyle = '#fff9e8';
  ctx.strokeStyle = '#333a3a';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(0, 0, sport === 'rugby' ? 4.4 : 3, sport === 'rugby' ? 2.4 : 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#343b40';
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
  // Fictional local club channels, with a broadcast score bug rather than app UI.
  ctx.fillStyle = '#102535';
  ctx.fillRect(26, 17, 319, 31);
  ctx.fillStyle = sport === 'soccer' ? '#25c7d1' : '#ba4665';
  ctx.fillRect(26, 17, 5, 31);
  ctx.fillStyle = '#e8f1ec';
  ctx.font = 'bold 16px Arial';
  ctx.fillText(sport === 'soccer' ? 'NORTHBRIDGE  1 : 0  EASTVALE' : 'HARBOR  18 : 15  RIDGE', 40, 38);
  ctx.fillStyle = '#f4de94';
  ctx.fillRect(345, 17, 74, 31);
  ctx.fillStyle = '#13242e';
  ctx.fillText(frame.clock, 357, 38);
  ctx.fillStyle = '#f3efe2';
  ctx.font = 'bold 19px Arial';
  ctx.textAlign = 'right';
  ctx.fillText(sport === 'soccer' ? 'CP FOOTBALL' : 'CP RUGBY', w - 27, 30);
  ctx.font = '11px Arial';
  ctx.fillStyle = '#72d9c1';
  ctx.fillText('CLUB SPORTS', w - 27, 45);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#111f29';
  ctx.fillRect(0, h - 22, w, 22);
  ctx.fillStyle = '#d9dfd5';
  ctx.font = '12px Arial';
  ctx.fillText(
    sport === 'soccer'
      ? 'SATURDAY NIGHT FOOTBALL   •   CORNER POCKET SPORTS'
      : 'RUGBY CLUB SHOWCASE   •   CORNER POCKET SPORTS',
    27,
    h - 7,
  );
}

function drawReelSymbol(ctx: CanvasRenderingContext2D, symbol: number, x: number, y: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (symbol === 0) {
    ctx.fillStyle = '#bb2636';
    ctx.font = 'bold italic 77px Georgia';
    ctx.fillText('7', 0, 0);
    ctx.strokeStyle = '#eab95c';
    ctx.lineWidth = 2;
    ctx.strokeText('7', 0, 0);
  } else if (symbol === 1) {
    ctx.strokeStyle = '#3b7139';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-15, 8);
    ctx.quadraticCurveTo(0, -12, 14, -25);
    ctx.lineTo(18, 9);
    ctx.stroke();
    ctx.fillStyle = '#c22c42';
    for (const cx of [-17, 18]) {
      ctx.beginPath();
      ctx.arc(cx, 14, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ec6170';
      ctx.beginPath();
      ctx.arc(cx - 5, 8, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c22c42';
    }
  } else if (symbol === 2) {
    ctx.fillStyle = '#193746';
    ctx.fillRect(-42, -22, 84, 44);
    ctx.fillStyle = '#efda99';
    ctx.font = 'bold 32px Arial';
    ctx.fillText('BAR', 0, 0);
  } else {
    ctx.fillStyle = '#249ca7';
    ctx.beginPath();
    ctx.moveTo(0, -35);
    ctx.lineTo(33, 0);
    ctx.lineTo(0, 35);
    ctx.lineTo(-33, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#a2e7df';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.restore();
}
function drawSlot(ctx: CanvasRenderingContext2D, time: number, machine: number) {
  const w = ctx.canvas.width,
    h = ctx.canvas.height,
    t = time + machine * 1.7,
    cycle = Math.floor(t / 8),
    phase = t % 8;
  const colors = ['#86d9dd', '#e9ba65', '#ca9fea'];
  ctx.fillStyle = '#11232d';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = colors[machine];
  ctx.lineWidth = 4;
  ctx.strokeRect(7, 7, w - 14, h - 14);
  ctx.fillStyle = colors[machine];
  ctx.font = 'bold 27px Georgia';
  ctx.textAlign = 'center';
  ctx.fillText(['LUCKY BREAK', 'CLUB CLASSICS', 'MIDNIGHT SEVENS'][machine], w / 2, 42);
  for (let reel = 0; reel < 3; reel++) {
    const x = 21 + reel * 157,
      top = 72,
      height = 250;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, top, 145, height);
    ctx.clip();
    ctx.fillStyle = '#e8e2c5';
    ctx.fillRect(x, top, 145, height);
    const spin = Math.min(1, phase / (1.4 + reel * 0.32)),
      offset = (cycle + machine + reel + 12 * (1 - (1 - spin) ** 3)) * 96;
    for (let row = -1; row < 5; row++) {
      const index = Math.floor(offset / 96) + row;
      drawReelSymbol(ctx, ((index % 4) + 4) % 4, x + 72, top + row * 96 - (offset % 96) + 46);
    }
    const shade = ctx.createLinearGradient(0, top, 0, top + height);
    shade.addColorStop(0, '#17252ab5');
    shade.addColorStop(0.22, '#17252a00');
    shade.addColorStop(0.78, '#17252a00');
    shade.addColorStop(1, '#17252ab5');
    ctx.fillStyle = shade;
    ctx.fillRect(x, top, 145, height);
    ctx.restore();
    ctx.strokeStyle = '#a99a6f';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, top, 145, height);
  }
  ctx.strokeStyle = colors[machine];
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(14, 198);
  ctx.lineTo(w - 14, 198);
  ctx.stroke();
  ctx.font = 'bold 18px Arial';
  ctx.fillStyle = '#ebddb6';
  ctx.textAlign = 'center';
  ctx.fillText(phase < 2.1 ? 'THE CLUB IS OPEN' : '★  THE CORNER POCKET  ★', w / 2, h - 29);
}

/** Three decorative attract-mode cabinets and two fictional, animated sports channels. */
export function buildPubEntertainment(
  room: THREE.Group,
  installer: PropInstaller,
  walls: { left: THREE.Group; right: THREE.Group },
) {
  const left = new THREE.Group(),
    right = new THREE.Group();
  left.name = 'pub-slot-machines';
  right.name = 'pub-sports-televisions';
  walls.left.add(left);
  walls.right.add(right);
  const screens: Screen[] = [],
    ownedRoots = [left, right];
  const cabinetMaterial = new THREE.MeshStandardMaterial({ color: '#263139', metalness: 0.36, roughness: 0.38 });
  const trimMaterial = new THREE.MeshStandardMaterial({ color: '#bb9a65', metalness: 0.7, roughness: 0.34 });
  const bodyGeometry = new THREE.BoxGeometry(0.8, 1.96, 0.62),
    tvGeometry = new THREE.BoxGeometry(1.79, 1.06, 0.12);
  const makeScreen = (
    anchor: THREE.Group,
    kind: Screen['kind'],
    index: number,
    dimensions: { w: number; h: number; y: number; z: number },
  ) => {
    const canvas = document.createElement('canvas');
    canvas.width = kind === 'slot' ? 512 : 768;
    canvas.height = kind === 'slot' ? 400 : 432;
    const context = canvas.getContext('2d')!;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
    const geometry = new THREE.PlaneGeometry(dimensions.w, dimensions.h),
      uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.pubDynamic = true;
    mesh.position.set(0, dimensions.y, dimensions.z);
    anchor.add(mesh);
    const item: Screen = { canvas, context, texture, material, mesh, anchor, tick: -1, kind, index };
    screens.push(item);
    return item;
  };
  const makeProps = (kind: 'slot' | 'tv') => {
    const placements = kind === 'slot' ? PUB_ENTERTAINMENT.slots : PUB_ENTERTAINMENT.televisions;
    const props = placements.map((placement, index) => {
      const anchor = new THREE.Group();
      anchor.position.set(placement.x, placement.y, placement.z);
      anchor.rotation.y = placement.rotation;
      anchor.scale.setScalar(placement.height / (kind === 'slot' ? 1.96 : 1.06));
      (kind === 'slot' ? left : right).add(anchor);
      const placeholder = new THREE.Group();
      anchor.add(placeholder);
      const body = new THREE.Mesh(
        kind === 'slot' ? bodyGeometry : tvGeometry,
        kind === 'slot' ? cabinetMaterial : trimMaterial,
      );
      body.position.y = kind === 'slot' ? 0.98 : 0.53;
      body.castShadow = true;
      body.receiveShadow = true;
      placeholder.add(body);
      const screen = makeScreen(
        anchor,
        kind === 'slot' ? 'slot' : index === 0 ? 'soccer' : 'rugby',
        index,
        kind === 'slot' ? { w: 0.632, h: 0.498, y: 1.36, z: 0.367 } : { w: 1.694, h: 0.953, y: 0.548, z: 0.064 },
      );
      return { anchor, placeholder, screen };
    });
    const isScreen = (material: THREE.Material) =>
      material.name.replace(/\.\d+$/, '') === `${kind === 'slot' ? 'Slot' : 'TV'} screen`;
    installer.model(PUB_ENTERTAINMENT_PROPS[kind], {
      placeholder: props.map((prop) => prop.placeholder),
      prepare: (source) => {
        let screenMaterials = 0;
        source.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            if (!isScreen(material)) continue;
            screenMaterials++;
            // Older optimized exports can omit unreferenced UVs. These are
            // explicit upright front planes, so their UVs can be recovered safely.
            const uv = object.geometry.getAttribute('uv');
            let minU = Infinity,
              maxU = -Infinity,
              minV = Infinity,
              maxV = -Infinity;
            if (uv)
              for (let i = 0; i < uv.count; i++) {
                minU = Math.min(minU, uv.getX(i));
                maxU = Math.max(maxU, uv.getX(i));
                minV = Math.min(minV, uv.getY(i));
                maxV = Math.max(maxV, uv.getY(i));
              }
            if (!uv || maxU - minU < 0.5 || maxV - minV < 0.5) {
              object.geometry.computeBoundingBox();
              const bounds = object.geometry.boundingBox!,
                positions = object.geometry.getAttribute('position'),
                uvs = [];
              for (let i = 0; i < positions.count; i++)
                uvs.push(
                  (positions.getX(i) - bounds.min.x) / (bounds.max.x - bounds.min.x),
                  1 - (positions.getY(i) - bounds.min.y) / (bounds.max.y - bounds.min.y),
                );
              object.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
            }
          }
        });
        // Without a screen to drive, the placeholder cabinets and their animated displays stay.
        if (!screenMaterials) throw new Error(`${PUB_ENTERTAINMENT_PROPS[kind]} has no screen material`);
      },
      use: (source) => {
        // Found by name, not from prepare, so every request for the shared source can bind its own screens.
        const originalScreens = new Set<THREE.Material>();
        for (const { anchor, screen } of props) {
          const model = source.clone(true);
          model.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            object.castShadow = true;
            object.receiveShadow = true;
            const replace = (material: THREE.Material) => {
              if (!isScreen(material)) return material;
              originalScreens.add(material);
              screen.mesh = object;
              object.userData.pubDynamic = true;
              object.castShadow = false;
              object.receiveShadow = false;
              return screen.material;
            };
            object.material = Array.isArray(object.material) ? object.material.map(replace) : replace(object.material);
          });
          const old = anchor.children.find(
            (child) => child instanceof THREE.Mesh && child.material === screen.material,
          ) as THREE.Mesh | undefined;
          if (old) {
            old.removeFromParent();
            old.geometry.dispose();
          }
          anchor.add(model);
        }
        // Only shells are static. Each display remains attached to its original
        // anchor for canvas updates and screen-specific frustum checks.
        batchPubStatic(kind === 'slot' ? left : right, 'subtree');
        for (const material of originalScreens) {
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
          material.dispose();
        }
      },
    });
  };
  makeProps('slot');
  makeProps('tv');
  const glow = new THREE.PointLight('#8dc9dd', 2.4, 5, 2);
  glow.position.set(PUB_LAYOUT.bounds.left + 2.2, -1.3, 5.5);
  left.add(glow);
  const frustum = new THREE.Frustum(),
    projection = new THREE.Matrix4();
  const visible = (item: Screen, camera?: THREE.Camera) => {
    for (let parent: THREE.Object3D | null = item.anchor; parent; parent = parent.parent)
      if (!parent.visible) return false;
    if (!camera) return true;
    item.mesh.updateWorldMatrix(true, false);
    return frustum.intersectsObject(item.mesh);
  };
  return {
    update(time: number, camera?: THREE.Camera) {
      if (camera)
        frustum.setFromProjectionMatrix(
          projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
        );
      const tick = Math.floor(time * 12);
      for (const screen of screens) {
        if (screen.tick === tick || !visible(screen, camera)) continue;
        screen.tick = tick;
        if (screen.kind === 'slot') drawSlot(screen.context, time, screen.index);
        else drawBroadcast(screen.context, screen.kind, time);
        screen.texture.needsUpdate = true;
      }
    },
    dispose() {
      const resources = new THREE.Group();
      for (const root of ownedRoots) {
        root.removeFromParent();
        resources.add(root);
      }
      disposePubObject(resources);
    },
  };
}
