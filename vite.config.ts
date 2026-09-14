import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
export default defineConfig({
  server: { host: '0.0.0.0' },
  build: { target: 'es2022' },
  // Browser only: same Rapier 0.19.3 build as the compat package Node uses, but its .wasm ships as a separate streamed asset instead of inlined base64.
  resolve: { alias: [{ find: /^@dimforge\/rapier3d-compat$/, replacement: '@dimforge/rapier3d' }] },
  plugins: [wasm()],
});
