import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { disposePubObject, instancePubModel, pubResources, type PubPlacement } from './pub-models';

/** One value for every prop texture; the renderer clamps it to the device maximum. */
export const PROP_ANISOTROPY = 8;

/** Parses prop files. The browser uses three's loaders; Node tests pass an in-memory fake. */
export interface PropLoader {
  model(url: string): Promise<THREE.Object3D>;
  texture(url: string): Promise<THREE.Texture>;
}

/** Every requested prop path has either arrived or failed. A path with any failed request is only in `failed`. */
export interface SettledProps {
  loaded: string[];
  failed: string[];
}

type Placeholder = THREE.Object3D | THREE.Texture;
interface PropRequest<Source> {
  /** Stays visible until the prop arrives, then is removed and freed. Kept if the prop fails. */
  placeholder?: Placeholder | readonly Placeholder[];
  /** Runs once per path on the shared parsed source. The first request's callback wins.
   * Sources are shared until the next settle, then released. */
  prepare?: (source: Source) => void;
}
/** Instance `placements` (or add one clone) under `parent`, or attach it yourself with `use`. */
export type ModelRequest = PropRequest<THREE.Object3D> &
  ({ parent: THREE.Object3D; placements?: readonly PubPlacement[] } | { use: (source: THREE.Object3D) => void });
/** `use` binds the shared texture; clone it before changing its transform. */
export type TextureRequest = PropRequest<THREE.Texture> & { use: (texture: THREE.Texture) => void };

export interface PropInstaller {
  /** Paths are relative to `public/`, without a leading slash. */
  model(path: string, request: ModelRequest): void;
  texture(path: string, request: TextureRequest): void;
  /** Bumped once per successful request, so a path requested four times bumps it four times. */
  readonly revision: number;
  /** Resolves the next time no prop is pending, including props requested while others attach. */
  settled(): Promise<SettledProps>;
  /** Props arriving later are freed and never attached. Attached props belong to their parent or material. */
  dispose(): void;
}

export function browserPropLoader(): PropLoader {
  const models = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),
    textures = new THREE.TextureLoader();
  return {
    model: (url) => models.loadAsync(url).then((gltf) => gltf.scene),
    texture: (url) => textures.loadAsync(url),
  };
}

/** Sorted transparency and one anisotropy for every GLB, after its own preparation. */
function applyModelFixups(scene: THREE.Object3D) {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material.transparent) material.depthWrite = false;
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) value.anisotropy = PROP_ANISOTROPY;
    }
  });
}

/** Hidden, then removed. Resources still drawn by the rest of the scene stay allocated,
 * so a placeholder sharing materials with the bar or another placeholder is safe to free.
 * A texture-only request has no scene to search: its placeholder texture must be drawn
 * only by the materials its `use` rebinds. */
function freePlaceholders(placeholders: readonly Placeholder[]) {
  const retired = new THREE.Group(),
    roots = new Set<THREE.Object3D>(),
    textures: THREE.Texture[] = [];
  for (const placeholder of placeholders) {
    if (placeholder instanceof THREE.Texture) {
      textures.push(placeholder);
      continue;
    }
    let root = placeholder;
    while (root.parent) root = root.parent;
    if (root !== placeholder) roots.add(root);
    retired.add(placeholder);
  }
  // ponytail: walks the whole scene once per swap (about 30 walks while the pub loads, each
  // well under a millisecond). If swaps become frequent, reference-count resources per placeholder instead.
  const drawn = new Set<object>();
  for (const root of roots) for (const resource of pubResources(root)) drawn.add(resource);
  disposePubObject(retired, drawn);
  retired.clear();
  for (const texture of textures) if (!drawn.has(texture)) texture.dispose();
}

export function createPropInstaller(loader: PropLoader = browserPropLoader()): PropInstaller {
  const base = import.meta.env?.BASE_URL ?? '/';
  const models = new Map<string, Promise<THREE.Object3D>>(),
    textures = new Map<string, Promise<THREE.Texture>>();
  const loaded = new Set<string>(),
    failed = new Set<string>();
  let waiters: Array<(result: SettledProps) => void> = [];
  let pending = 0,
    revision = 0,
    disposed = false;

  /** Parse and prepare each path once. A result arriving after dispose, or failing
   * its preparation, is freed here exactly once however many requests share it. */
  const source = <T>(
    cache: Map<string, Promise<T>>,
    path: string,
    parse: (url: string) => Promise<T>,
    prepare: (value: T) => void,
    free: (value: T) => void,
  ) => {
    let prepared = cache.get(path);
    if (!prepared) {
      prepared = parse(base + path).then((value) => {
        if (disposed) {
          free(value);
          return value;
        }
        try {
          prepare(value);
          return value;
        } catch (error) {
          free(value);
          throw error;
        }
      });
      cache.set(path, prepared);
    }
    return prepared;
  };

  const install = <T>(
    path: string,
    prepared: Promise<T>,
    attach: (value: T) => void,
    placeholder: PropRequest<T>['placeholder'],
  ) => {
    const placeholders =
      placeholder === undefined
        ? []
        : Array.isArray(placeholder)
          ? (placeholder as readonly Placeholder[])
          : [placeholder as Placeholder];
    const objects = placeholders.filter((item): item is THREE.Object3D => item instanceof THREE.Object3D);
    pending++;
    prepared
      .then((value) => {
        if (disposed) return;
        // Hidden first, so a caller batching its section never merges the placeholder.
        const visibility = objects.map((object) => object.visible);
        for (const object of objects) object.visible = false;
        try {
          attach(value);
        } catch (error) {
          objects.forEach((object, index) => (object.visible = visibility[index]));
          throw error;
        }
        freePlaceholders(placeholders);
        if (!failed.has(path)) loaded.add(path);
        revision++;
      })
      .catch((error) => {
        if (disposed) return;
        if (!failed.has(path)) console.warn(`Prop unavailable, keeping its placeholder: ${base + path}`, error);
        loaded.delete(path);
        failed.add(path);
      })
      .finally(() => {
        if (--pending) return;
        // Settled: every parse has attached or failed, so drop the parsed sources. Attached props
        // keep their own references; an atlas a `use` drew and disposed can now be collected.
        // A later request for the same path parses it again.
        models.clear();
        textures.clear();
        const result = { loaded: [...loaded], failed: [...failed] },
          resolved = waiters;
        waiters = [];
        for (const resolve of resolved) resolve(result);
      });
  };

  return {
    model(path, request) {
      if (disposed) return;
      const prepared = source(
        models,
        path,
        (url) => loader.model(url),
        (scene) => {
          request.prepare?.(scene);
          applyModelFixups(scene);
        },
        (scene) => disposePubObject(scene),
      );
      install(
        path,
        prepared,
        (scene) => {
          if ('use' in request) {
            request.use(scene);
            return;
          }
          const prop = request.placements ? instancePubModel(scene, request.placements) : scene.clone(true);
          prop.name = path;
          request.parent.add(prop);
        },
        request.placeholder,
      );
    },
    texture(path, request) {
      if (disposed) return;
      const prepared = source(
        textures,
        path,
        (url) => loader.texture(url),
        (texture) => {
          texture.anisotropy = PROP_ANISOTROPY;
          request.prepare?.(texture);
        },
        (texture) => texture.dispose(),
      );
      install(path, prepared, request.use, request.placeholder);
    },
    get revision() {
      return revision;
    },
    settled() {
      return new Promise((resolve) =>
        pending ? waiters.push(resolve) : resolve({ loaded: [...loaded], failed: [...failed] }),
      );
    },
    dispose() {
      disposed = true;
    },
  };
}
