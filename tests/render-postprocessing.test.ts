import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { prewarmPrograms } from '../src/render/postprocessing';

function fakeRenderer(){
  const previous=new THREE.WebGLRenderTarget(4,4),compiled:(THREE.WebGLRenderTarget|null)[]=[];
  let bound:THREE.WebGLRenderTarget|null=previous;
  const renderer={getRenderTarget:()=>bound,setRenderTarget:(target:THREE.WebGLRenderTarget|null)=>{bound=target;},compile:()=>{compiled.push(bound);return new Set();}} as unknown as THREE.WebGLRenderer;
  return {renderer,previous,compiled,bound:()=>bound};
}

test('program prewarm compiles the composer (render target) and canvas variants, then restores the bound target',()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
  const bloom=fakeRenderer();prewarmPrograms(bloom.renderer,scene,camera,true);
  assert.equal(bloom.compiled.length,2);
  assert.ok(bloom.compiled[0]?.isRenderTarget&&!(bloom.compiled[0] as {isXRRenderTarget?:boolean}).isXRRenderTarget,'linear, untone-mapped variant');
  assert.equal(bloom.compiled[1],null,'ACES + sRGB canvas variant');
  assert.equal(bloom.bound(),bloom.previous);
  const direct=fakeRenderer();prewarmPrograms(direct.renderer,scene,camera,false);
  assert.deepEqual(direct.compiled,[null],'without float targets only the canvas variant exists');assert.equal(direct.bound(),direct.previous);
});
