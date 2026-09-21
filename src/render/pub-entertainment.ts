import * as THREE from 'three';
import { PUB_LAYOUT } from './pub-layout';
import { disposePubObject } from './pub-models';
import { batchPubStatic } from './pub-batching';
import type { PropInstaller } from './asset-installer';
import { drawBroadcast, pubBroadcastFrame, type PubSport } from './pub-broadcast-screen';
import { drawSlot } from './pub-slot-screen';
import { PUB_SPORTS_STOOL_PLACEMENTS } from './pub-sports-props';

export { pubBroadcastFrame, type PubSport };
export const PUB_ENTERTAINMENT = {
  slots: [2.7, 5.5, 8.3].map((z) => ({
    x: PUB_LAYOUT.bounds.left + 1.176,
    y: PUB_LAYOUT.floor,
    z,
    height: 4.45,
    rotation: Math.PI / 2,
  })),
  // Screens hang on the piers between the window bays. The bays sit at z -12.18, -3.77, 4.64 and
  // 13.05 and are 4.55 wide, which leaves piers 3.86 wide centred at -7.98, 0.44 and 8.85: a set
  // at the old 3.1 height measured 4.95 across and could only ever overlap a window.
  televisions: [-7.98, 8.85].map((z) => ({
    x: PUB_LAYOUT.bounds.right - 0.535 * (2.3 / 1.06) - 0.03,
    y: 2.1,
    z,
    height: 2.3,
    rotation: -Math.PI / 2,
  })),
  /** A stool at each machine, facing it. */
  slotStools: [2.7, 5.5, 8.3].map((z) => ({
    x: PUB_LAYOUT.bounds.left + 3.15,
    y: PUB_LAYOUT.floor,
    z,
    height: 2.99,
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
  // A stool at each machine, the same generated model the bar uses; handed over to be installed
  // with the other generated props.
  PUB_SPORTS_STOOL_PLACEMENTS.push(...PUB_ENTERTAINMENT.slotStools);
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
