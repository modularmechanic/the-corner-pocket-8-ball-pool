import * as THREE from 'three';

const patched = new WeakSet<THREE.Material>();
const directCall = /\bRE_Direct\( directLight,[^;]+;/g;
/** Three already computes visibility from each point/spot light's attenuation. Avoid
 * evaluating the physical BRDF (including clearcoat/sheen) when that contribution is zero. */
export const boundedLightingChunk = THREE.ShaderChunk.lights_fragment_begin.replace(
  directCall,
  (call) => `if ( directLight.visible ) { ${call} }`,
);

/** Compose with material-specific hooks, including the cloth's normal + height shader. */
export function useBoundedLighting(material: THREE.Material): void {
  if (!(material instanceof THREE.MeshStandardMaterial) || patched.has(material)) return;
  patched.add(material);
  const compile = material.onBeforeCompile,
    cacheKey = material.customProgramCacheKey,
    defaultKey = cacheKey === THREE.Material.prototype.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    compile.call(this, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', boundedLightingChunk);
  };
  material.customProgramCacheKey = function () {
    return `${defaultKey ? compile.toString() : cacheKey.call(this)}:bounded-direct-light-v1`;
  };
  material.needsUpdate = true;
}
