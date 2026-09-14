import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { RenderBudget } from './performance';

/** Three keys programs on the bound target: the canvas gets ACES + sRGB, any render
 * target gets NoToneMapping + linear (WebGLPrograms.js getParameters). Bloom toggles
 * therefore swap every lit material's program, and hidden meshes compile on first
 * show. Compile both variants at an idle moment (renderer.compile includes invisible
 * objects) so neither happens mid-shot. */
export function prewarmPrograms(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, composer: boolean) {
  const previous = renderer.getRenderTarget(), target = composer ? new THREE.WebGLRenderTarget(1, 1) : null;
  try {
    if (target) { renderer.setRenderTarget(target); renderer.compile(scene, camera); }
    renderer.setRenderTarget(null); renderer.compile(scene, camera);
  } finally { renderer.setRenderTarget(previous); target?.dispose(); }
}

/** Official GLSL passes, with HDR glow confined to the pub's brightest practical lights. */
export class PoolPostprocessing {
  private composer?: EffectComposer;
  private scenePass?: RenderPass;
  private bloom?: UnrealBloomPass;
  private output?: OutputPass;
  private enabled = false;
  private sizeKey = '';
  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.Camera) {}
  private initialize() {
    if(this.composer)return;
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2 });
    this.composer = new EffectComposer(this.renderer, target);
    this.scenePass = new RenderPass(this.scene, this.camera);
    // Preserve colored glass and metal detail; only the hottest practicals bloom.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .12, .32, 1.5);
    this.output = new OutputPass();
    this.composer.addPass(this.scenePass); this.composer.addPass(this.bloom); this.composer.addPass(this.output);
  }
  resize(width: number, height: number, budget: RenderBudget) {
    this.enabled = budget.bloom;
    const ratio=this.renderer.getPixelRatio(),key=this.enabled?`${width}:${height}:${ratio}`:'off';
    if(key===this.sizeKey)return;this.sizeKey=key;
    if (!this.enabled) {
      // Release large HDR targets while direct rendering uses the canvas's MSAA.
      this.composer?.setPixelRatio(1); this.composer?.setSize(1, 1); return;
    }
    this.initialize();
    // Match the actual canvas exactly: a second hidden resolution cap would
    // make the quality telemetry misleading and blur the output upsample.
    this.composer!.setPixelRatio(ratio);this.composer!.setSize(width,height);
  }
  render(scene: THREE.Scene, camera: THREE.Camera, dt: number) {
    if (!this.enabled||!this.composer||!this.scenePass) { this.renderer.render(scene, camera); return; }
    this.scenePass.camera = camera; this.composer.render(dt);
  }
  dispose() { this.bloom?.dispose(); this.output?.dispose(); this.composer?.dispose(); }
}
