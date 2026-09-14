/** Node stand-ins for the browser while the real pub builds: inert canvases and images, and
 * GLTFLoader parsing the actual files under public/ (the installer's MeshoptDecoder included).
 * Returns the list that collects load errors. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));

export function installHeadlessPubAssets(): string[] {
  const errors: string[] = [];
  const gradient = { addColorStop() {} };
  const canvas = () => {
    const result = { width: 1, height: 1, getContext: (_type: string) => context, toDataURL: () => '' };
    const context = new Proxy<Record<string, unknown>>({ canvas: result,
      getImageData: (_x: number, _y: number, width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
      createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
      createLinearGradient: () => gradient, createRadialGradient: () => gradient, createPattern: () => ({}), measureText: (text: string) => ({ width: text.length * 8 }),
    }, { get(target, key) { return Reflect.get(target, key) ?? (() => {}); } });
    return result;
  };
  Object.defineProperty(globalThis, 'document', { value: { createElement: () => canvas() }, configurable: true });
  Object.defineProperty(globalThis, 'ProgressEvent', { value: class { constructor(public type: string, public init?: unknown) {} }, configurable: true });
  THREE.TextureLoader.prototype.load = function (url, onLoad) {
    const texture = new THREE.Texture(); texture.name = url; texture.image = { width: 1024, height: 1024 };
    if (onLoad) queueMicrotask(() => onLoad(texture));
    return texture;
  };
  GLTFLoader.prototype.load = function (url, onLoad, _onProgress, onError) {
    void (async () => {
      const file = path.join(publicDir, url), bytes = await fs.readFile(file);
      let data: string | ArrayBuffer;
      if (url.endsWith('.gltf')) {
        const json = JSON.parse(bytes.toString());
        for (const buffer of json.buffers ?? []) if (buffer.uri && !buffer.uri.startsWith('data:')) buffer.uri = `data:application/octet-stream;base64,${(await fs.readFile(path.join(path.dirname(file), buffer.uri))).toString('base64')}`;
        data = JSON.stringify(json);
      } else data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      // Override WebP's image decoder while retaining the authored material graph.
      this.register(parser => ({ name: 'EXT_texture_webp', loadTexture(index: number) {
        const texture = new THREE.Texture(); texture.image = { width: 1024, height: 1024 }; texture.name = parser.json.textures[index].name ?? `image-${index}`;
        return Promise.resolve(texture);
      } }));
      onLoad(await this.parseAsync(data, ''));
    })().catch(error => { errors.push(`${url}: ${error.message}`); onError?.(error); });
  };
  return errors;
}
