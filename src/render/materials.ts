import * as THREE from 'three';
import { seededRandom } from '../simulation/types';
export const BALL_COLORS = ['#fff9e9', '#ffc400', '#185bd1', '#dd2920', '#792f9e', '#f4770b', '#008363', '#a12638', '#07090b', '#ffc400', '#185bd1', '#dd2920', '#792f9e', '#f4770b', '#008363', '#a12638'];
export function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  draw(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  return texture;
}
// Clones share Three's texture Source (and GPU storage for equal samplers),
// while each owning material may still set repeat/wrap and dispose its texture.
let walnutSource: THREE.CanvasTexture | undefined;
export function woodTexture() {
  if (walnutSource) return walnutSource.clone();
  const random = seededRandom('walnut-cut');
  walnutSource = canvasTexture(2048, 512, ctx => {
    ctx.fillStyle = '#4c2c1c'; ctx.fillRect(0, 0, 2048, 512);
    for (let i = 0; i < 1900; i++) {
      const y = random() * 512, alpha = .04 + random() * .15;
      ctx.strokeStyle = random() > .5 ? `rgba(221,153,81,${alpha})` : `rgba(9,4,2,${alpha * 1.5})`;
      ctx.lineWidth = random() * 2 + .3; ctx.beginPath(); ctx.moveTo(0, y);
      for (let x = 0; x <= 2048; x += 32) ctx.lineTo(x, y + Math.sin(x * .004 + y * .08) * (2 + random() * 2));
      ctx.stroke();
    }
    const glow = ctx.createLinearGradient(0, 0, 0, 512); glow.addColorStop(0, '#ffffff18'); glow.addColorStop(.4, '#ffffff00'); glow.addColorStop(1, '#00000044'); ctx.fillStyle = glow; ctx.fillRect(0, 0, 2048, 512);
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#ab673d'; ctx.fillRect(0, 0, 2048, 512);
  });
  return walnutSource.clone();
}
export function feltTexture() {
  const random = seededRandom('tournament-felt');
  const texture = canvasTexture(1024, 1024, ctx => {
    ctx.fillStyle = '#216a28'; ctx.fillRect(0, 0, 1024, 1024);
    const pixels = ctx.getImageData(0, 0, 1024, 1024);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const n = (random() - .5) * 9;
      pixels.data[i] += n * .5; pixels.data[i + 1] += n; pixels.data[i + 2] += n * .8;
    }
    ctx.putImageData(pixels, 0, 0);
    ctx.globalAlpha = .018;
    for (let i = 0; i < 1024; i += 2) { ctx.fillStyle = i % 4 ? '#000' : '#fff'; ctx.fillRect(i, 0, 1, 1024); ctx.fillRect(0, i, 1024, 1); }
  }); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(4, 2); return texture;
}
export function floorTexture() {
  const random = seededRandom('club-floor');
  return canvasTexture(2048, 2048, ctx => {
    ctx.fillStyle = '#201b16'; ctx.fillRect(0, 0, 2048, 2048);
    const w = 85, len = 340;
    ctx.translate(1024, 1024); ctx.rotate(Math.PI / 4); ctx.translate(-1024, -1024);
    for (let row = -14; row < 35; row++) for (let col = -6; col < 12; col++) {
      const x = col * (len + w) + ((row % 5 + 5) % 5) * w, y = row * w;
      const tone = 24 + random() * 19;
      ctx.fillStyle = `rgb(${tone * 1.28},${tone},${tone * .74})`; ctx.fillRect(x + 1, y + 1, len - 2, w - 2);
      ctx.fillStyle = `rgb(${tone * 1.2},${tone * .92},${tone * .69})`; ctx.fillRect(x + len + 1, y + 1, w - 2, len - 2);
      for (let n = 0; n < 16; n++) {
        ctx.strokeStyle = `rgba(${random() > .5 ? '157,113,71' : '0,0,0'},.12)`; ctx.lineWidth = random() + .3;
        const lineY = y + random() * w; ctx.beginPath(); ctx.moveTo(x, lineY); ctx.bezierCurveTo(x + 80, lineY - 3, x + 200, lineY + 2, x + len, lineY); ctx.stroke();
      }
      ctx.strokeStyle = '#77604520'; ctx.lineWidth = 1; ctx.strokeRect(x + 2, y + 2, len - 4, w - 4);
    }
  });
}
export function ballTexture(id: number) {
  // The unmarked cue ball has a uniform albedo: extra texels add no detail.
  if (id === 0) return canvasTexture(8, 4, ctx => { ctx.fillStyle = BALL_COLORS[0]; ctx.fillRect(0, 0, 8, 4); });
  return canvasTexture(1024, 512, ctx => {
    ctx.fillStyle = id > 8 ? '#f4efdf' : BALL_COLORS[id]; ctx.fillRect(0, 0, 1024, 512);
    if (id > 8) { ctx.fillStyle = BALL_COLORS[id]; ctx.fillRect(0, 136, 1024, 240); }
    if (id === 0) return;
    for (const x of [256, 768]) {
      ctx.fillStyle = '#fffbed'; ctx.beginPath(); ctx.ellipse(x, 256, 80, 82, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#101510'; ctx.font = `700 ${id > 9 ? 92 : 110}px Arial`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(id), x, 263);
    }
  });
}

export function clubLightingTexture() {
  const texture = canvasTexture(2048, 1024, ctx => {
    const background = ctx.createLinearGradient(0, 0, 0, 1024);
    background.addColorStop(0, '#8c988b'); background.addColorStop(.48, '#28332d'); background.addColorStop(1, '#0d0b08');
    ctx.fillStyle = background; ctx.fillRect(0, 0, 2048, 1024);
    // Two broad overhead fixtures produce clean reflections on polished resin.
    for (const x of [420, 1400]) {
      const halo = ctx.createRadialGradient(x, 255, 20, x, 255, 250); halo.addColorStop(0, '#fff4dbaa'); halo.addColorStop(1, '#fff4db00'); ctx.fillStyle = halo; ctx.fillRect(x - 250, 5, 500, 500);
      ctx.fillStyle = '#fff9e9'; ctx.beginPath(); ctx.roundRect(x - 155, 180, 310, 78, 38); ctx.fill();
    }
  });
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}
