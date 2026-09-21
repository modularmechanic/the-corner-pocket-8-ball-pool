import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/** Only glow extraction and blurs shrink; the scene and output remain at the preset resolution. */
export class BudgetBloomPass extends UnrealBloomPass {
  resolutionScale = 0.5;

  constructor() {
    super(new THREE.Vector2(1, 1), 0.12, 0.32, 1.5);
  }

  override setSize(width: number, height: number): void {
    super.setSize(
      Math.max(1, Math.floor(width * this.resolutionScale)),
      Math.max(1, Math.floor(height * this.resolutionScale)),
    );
  }
}
