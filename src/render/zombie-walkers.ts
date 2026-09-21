import * as THREE from 'three';
import { clone as cloneRigged } from 'three/addons/utils/SkeletonUtils.js';
import type { PropInstaller } from './asset-installer';
import { disposePubObject } from './pub-models';

/** The rigged walker, 0.5 units tall with its feet on the cloth, so it needs no scaling. */
export const ZOMBIE_MODEL = 'models/zombie/zombie.glb';
const SHAMBLE = 'Shamble';
/** A wave tops out at 15 bodies; one spare covers a body still attached while the next wave racks.
 * ponytail: a hard cap, not a budget — past it the crate keeps drawing, which is the loading look anyway. */
const MAX_CLONES = 16;

/** One live body. A `SkinnedMesh` cannot be instanced like the static pub props, so each gets its own
 * skeleton and mixer; geometry, materials and the clip stay shared with the source. */
export interface Walker {
  readonly root: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
}

/** The horde's bodies: one shared GLB, cloned per live zombie and recycled between waves.
 * Until the model arrives — or if it never does — `acquire` answers undefined and the caller keeps its placeholder. */
export class ZombieWalkers {
  private source?: THREE.Object3D;
  private clip?: THREE.AnimationClip;
  private created = 0;
  private idle: Walker[] = [];
  private live = new Set<Walker>();

  constructor(props: PropInstaller) {
    props.model(ZOMBIE_MODEL, {
      use: (source) => {
        const clip = THREE.AnimationClip.findByName(source.animations, SHAMBLE);
        // Thrown here, the installer keeps the caller's placeholder and logs the path, exactly as for a 404.
        if (!clip) throw new Error(`${ZOMBIE_MODEL} has no "${SHAMBLE}" clip`);
        source.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          object.castShadow = true;
          object.receiveShadow = true;
          // Skinned bodies leave their bind-pose bounds while they walk; the horde is 15 small meshes.
          object.frustumCulled = false;
        });
        this.source = source;
        this.clip = clip;
      },
    });
  }

  get ready(): boolean {
    return this.source !== undefined;
  }

  /** A body for this zombie id, or undefined while the model is missing or the cap is reached.
   * The clip starts at an offset drawn from the id, so the horde never shambles in lockstep. */
  acquire(id: number): Walker | undefined {
    const clip = this.clip;
    if (!this.source || !clip) return undefined;
    let walker = this.idle.pop();
    if (!walker) {
      if (this.created >= MAX_CLONES) return undefined;
      const root = cloneRigged(this.source),
        mixer = new THREE.AnimationMixer(root);
      mixer.clipAction(clip).play();
      walker = { root, mixer };
      this.created++;
    }
    // Golden-ratio spacing: consecutive ids land far apart in the loop, so neighbours never step together.
    const phase = (id * 0.618033988749895) % 1;
    walker.mixer.timeScale = 1;
    walker.mixer.setTime(phase * clip.duration);
    walker.mixer.timeScale = 0.85 + phase * 0.35;
    this.live.add(walker);
    return walker;
  }

  /** Back to the pool, detached and still rigged. Nothing is disposed: the next wave reuses it. */
  release(walker: Walker) {
    if (!this.live.delete(walker)) return;
    walker.root.removeFromParent();
    this.idle.push(walker);
  }

  /** Advances every live body by the render frame's delta. */
  update(dt: number) {
    for (const walker of this.live) walker.mixer.update(dt);
  }

  /** Frees every skeleton, then the shared geometry, materials and textures the clones drew. */
  dispose() {
    for (const walker of [...this.live, ...this.idle]) {
      walker.mixer.stopAllAction();
      walker.mixer.uncacheRoot(walker.root);
      walker.root.removeFromParent();
      walker.root.traverse((object) => {
        if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
      });
    }
    this.live.clear();
    this.idle.length = 0;
    this.created = 0;
    if (this.source) disposePubObject(this.source);
    this.source = undefined;
    this.clip = undefined;
  }
}
