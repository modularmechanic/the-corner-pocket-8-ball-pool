import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPropInstaller, type ModelRequest, type PropInstaller } from '../src/render/asset-installer';
import { buildPub, PUB_PROPS } from '../src/render/pub';
import { createTableSurfaces, WOOD_SCAN_MAPS } from '../src/render/table-surfaces';

/** Inert canvases: the pub draws its signs and screens, which need no pixels here.
 * Node runs each test file in its own process, so this global never reaches other tests. */
function stubCanvasDocument() {
  const gradient = { addColorStop() {} };
  const canvas = () => {
    const element = { width: 1, height: 1, getContext: () => context };
    const context: Record<string, unknown> = new Proxy({ canvas: element, createLinearGradient: () => gradient, createRadialGradient: () => gradient, measureText: (text: string) => ({ width: text.length * 8 }) },
      { get: (target, key) => Reflect.get(target, key) ?? (() => {}) });
    return element;
  };
  Object.defineProperty(globalThis, 'document', { value: { createElement: canvas }, configurable: true });
}

test('the table and the pub request the wood scans once, and bottle placeholders share their models\' parent', () => {
  stubCanvasDocument();
  const parses = new Map<string, number>(), hanging = <T>(url: string) => { parses.set(url, (parses.get(url) ?? 0) + 1); return new Promise<T>(() => {}); };
  const installer = createPropInstaller({ model: hanging, texture: hanging });
  const requests: [string, ModelRequest][] = [];
  const recording: PropInstaller = { ...installer, model: (path, request) => { requests.push([path, request]); installer.model(path, request); } };
  const surfaces = createTableSurfaces(recording), pub = buildPub(new THREE.Scene(), recording);
  try {
    for (const [, path] of WOOD_SCAN_MAPS) assert.equal(parses.get(`/${path}`), 1, `${path} is parsed once for both`);
    assert.equal(parses.get(`/${PUB_PROPS.wallPanel}`), 1);
    for (const path of PUB_PROPS.bottles) {
      const [, request] = requests.find(([requested]) => requested === path)!;
      assert.ok('parent' in request && request.placeholder instanceof Array);
      const [placeholder] = request.placeholder as THREE.Object3D[];
      assert.ok(placeholder.parent === request.parent, `${path} placeholder follows the rear-wall cutaway with its model`);
      assert.equal(request.parent.parent?.name, 'pub-rear-bar');
    }
  } finally { installer.dispose(); pub.dispose(); surfaces.dispose(); }
});
