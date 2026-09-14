import express from 'express';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { initPhysics } from '../src/simulation/game';
import { attachRooms } from './rooms';
await initPhysics();
const app = express();
const http = createServer(app);
const multiplayer = attachRooms(http);
app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: multiplayer.rooms.size }));
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  // The development page talks to this process's rooms unless told otherwise.
  process.env.VITE_ROOM_SERVER_URL ??= 'same-origin';
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ server: { middlewareMode: true, hmr: { server: http } }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT) || 3000;
http.listen(port, '0.0.0.0', () => console.log(`The Corner Pocket is open at http://localhost:${port}`));
process.on('SIGTERM', async () => { await multiplayer.close(); http.close(); process.exit(0); });
