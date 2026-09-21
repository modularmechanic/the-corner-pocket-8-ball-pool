import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { boundedLightingChunk, useBoundedLighting } from '../src/render/lighting-shader';

test('all built-in direct-light loops skip BRDF work when attenuation contributes nothing', () => {
  const original = THREE.ShaderChunk.lights_fragment_begin;
  assert.equal(original.match(/\bRE_Direct\(/g)?.length, 3, 'review the patch if Three changes its light chunk');
  assert.equal(boundedLightingChunk.match(/if \( directLight.visible \) \{ RE_Direct\(/g)?.length, 3);
  assert.equal(
    boundedLightingChunk.replace(/if \( directLight.visible \) \{ (RE_Direct\([^;]+;) \}/g, '$1'),
    original,
    'shadow, area-light and indirect-light calculations remain intact',
  );
});

test('bounded lighting composes with existing material hooks and their program cache keys', () => {
  const material = new THREE.MeshPhysicalMaterial();
  const renderer = {} as THREE.WebGLRenderer;
  let calls = 0;
  material.onBeforeCompile = function (shader, receivedRenderer) {
    assert.equal(this, material);
    assert.equal(receivedRenderer, renderer);
    calls++;
    shader.fragmentShader = shader.fragmentShader.replace('cloth_hook', 'cloth_normal_plus_height');
  };
  material.customProgramCacheKey = () => 'cloth-v2';
  useBoundedLighting(material);
  const version = material.version;
  useBoundedLighting(material);
  assert.equal(material.version, version, 'shared materials install only once');
  assert.equal(material.customProgramCacheKey(), 'cloth-v2:bounded-direct-light-v1');
  const shader = { fragmentShader: 'cloth_hook\n#include <lights_fragment_begin>' } as Parameters<
    typeof material.onBeforeCompile
  >[0];
  material.onBeforeCompile(shader, renderer);
  assert.equal(calls, 1);
  assert.ok(shader.fragmentShader.startsWith('cloth_normal_plus_height\n'));
  assert.ok(shader.fragmentShader.includes(boundedLightingChunk));
});

test('distinct default compile hooks keep distinct cache keys after wrapping', () => {
  const a = new THREE.MeshStandardMaterial(),
    b = new THREE.MeshStandardMaterial();
  a.onBeforeCompile = (shader) => {
    shader.fragmentShader += '\n// a';
  };
  b.onBeforeCompile = (shader) => {
    shader.fragmentShader += '\n// b';
  };
  useBoundedLighting(a);
  useBoundedLighting(b);
  assert.notEqual(a.customProgramCacheKey(), b.customProgramCacheKey());
});
