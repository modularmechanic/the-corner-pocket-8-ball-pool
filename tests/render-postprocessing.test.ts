import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PoolPostprocessing, prewarmPrograms } from '../src/render/postprocessing';
import { graphicsBudget } from '../src/render/performance';
import { BudgetBloomPass } from '../src/render/bloom-pass';

function fakeRenderer() {
  const previous = new THREE.WebGLRenderTarget(4, 4),
    compiled: (THREE.WebGLRenderTarget | null)[] = [];
  let bound: THREE.WebGLRenderTarget | null = previous;
  const renderer = {
    getRenderTarget: () => bound,
    setRenderTarget: (target: THREE.WebGLRenderTarget | null) => {
      bound = target;
    },
    compile: () => {
      compiled.push(bound);
      return new Set();
    },
  } as unknown as THREE.WebGLRenderer;
  return { renderer, previous, compiled, bound: () => bound };
}

test('program prewarm compiles the composer (render target) and canvas variants, then restores the bound target', () => {
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera();
  const bloom = fakeRenderer();
  prewarmPrograms(bloom.renderer, scene, camera, true);
  assert.equal(bloom.compiled.length, 2);
  assert.ok(
    bloom.compiled[0]?.isRenderTarget && !(bloom.compiled[0] as { isXRRenderTarget?: boolean }).isXRRenderTarget,
    'linear, untone-mapped variant',
  );
  assert.equal(bloom.compiled[1], null, 'ACES + sRGB canvas variant');
  assert.equal(bloom.bound(), bloom.previous);
  const direct = fakeRenderer();
  prewarmPrograms(direct.renderer, scene, camera, false);
  assert.deepEqual(direct.compiled, [null], 'without float targets only the canvas variant exists');
  assert.equal(direct.bound(), direct.previous);
});

test('pass prewarm compiles every bloom and output program without drawing or sizing bloom targets', () => {
  const previous = new THREE.WebGLRenderTarget(4, 4),
    bound: (THREE.WebGLRenderTarget | null)[] = [],
    disposed: THREE.WebGLRenderTarget[] = [];
  const compiled: {
    material: THREE.Material;
    target: THREE.WebGLRenderTarget | null;
    defines: Record<string, unknown>;
  }[] = [];
  let current: THREE.WebGLRenderTarget | null = previous;
  // No render or clear methods: any real draw throws.
  const renderer = {
    getPixelRatio: () => 2,
    getSize: (size: THREE.Vector2) => size.set(1, 1),
    getRenderTarget: () => current,
    setRenderTarget: (target: THREE.WebGLRenderTarget | null) => {
      current = target;
      bound.push(target);
      target?.addEventListener('dispose', () => disposed.push(target));
    },
    compile: (object: THREE.Mesh) => {
      const material = object.material as THREE.Material;
      compiled.push({ material, target: current, defines: { ...(material as THREE.ShaderMaterial).defines } });
      return new Set();
    },
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1,
  } as unknown as THREE.WebGLRenderer;
  const post = new PoolPostprocessing(renderer, new THREE.Scene(), new THREE.PerspectiveCamera());
  for (const ceiling of [graphicsBudget('performance'), graphicsBudget('auto', 0, true)]) post.prewarm(ceiling);
  assert.deepEqual(
    [compiled.length, bound.length],
    [0, 0],
    'a ceiling that never allows bloom skips the pass programs',
  );
  post.prewarm(graphicsBudget('ultra'));
  const passes = compiled.filter((entry) => !(entry.material as THREE.RawShaderMaterial).isRawShaderMaterial),
    output = compiled.filter((entry) => (entry.material as THREE.RawShaderMaterial).isRawShaderMaterial);
  assert.equal(new Set(passes.map((entry) => entry.material)).size, 8, 'high pass, five blurs, composite and blend');
  assert.ok(
    passes.every((entry) => entry.target?.isRenderTarget && entry.target.width === 1 && entry.target.height === 1),
    'linear, untone-mapped variant against a 1×1 target',
  );
  assert.equal(output.length, 1);
  assert.equal(output[0].target, null);
  assert.deepEqual(
    output[0].defines,
    { SRGB_TRANSFER: '', ACES_FILMIC_TONE_MAPPING: '' },
    'the defines OutputPass derives from the renderer',
  );
  assert.ok(
    bound.every((target) => target === null || target === previous || (target.width === 1 && target.height === 1)),
    'no full-size target is bound',
  );
  assert.equal(current, previous);
  assert.equal(disposed.length, 1, 'the scratch target is released');
});

test('bloom downsamples only its effect targets and tracks preset changes', () => {
  const bloom = new BudgetBloomPass();
  bloom.setSize(2560, 1440);
  assert.equal(bloom.renderTargetBright.width, 640);
  assert.equal(bloom.renderTargetBright.height, 360);
  bloom.resolutionScale = 1;
  bloom.setSize(2560, 1440);
  assert.equal(bloom.renderTargetBright.width, 1280);
  assert.equal(bloom.renderTargetBright.height, 720);
  bloom.dispose();
});
