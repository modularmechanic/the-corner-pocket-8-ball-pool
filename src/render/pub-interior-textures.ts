import * as THREE from 'three';
import { canvasTexture } from './materials';
import { seededRandom } from '../simulation/types';

export function stoneTexture() {
  const random = seededRandom('corner-pocket-flagstones');
  const texture = canvasTexture(1024, 1024, (ctx) => {
    ctx.fillStyle = '#51483c';
    ctx.fillRect(0, 0, 1024, 1024);
    for (let row = 0; row < 8; row++)
      for (let col = -1; col < 5; col++) {
        const x = col * 256 + (row % 2) * 128,
          y = row * 128,
          tone = 88 + random() * 34;
        ctx.fillStyle = `rgb(${tone * 1.1},${tone},${tone * 0.83})`;
        ctx.fillRect(x + 3, y + 3, 250, 122);
        for (let n = 0; n < 180; n++) {
          const px = x + random() * 256,
            py = y + random() * 128;
          ctx.fillStyle = random() > 0.4 ? '#c9c1a409' : '#211d1812';
          ctx.beginPath();
          ctx.ellipse(px, py, random() * 22 + 1, random() * 9 + 1, random() * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = '#d0c3a62c';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 6, y + 6, 244, 116);
        if (random() > 0.4) {
          ctx.strokeStyle = '#211f1933';
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(x + 110, y + 4);
          ctx.lineTo(x + 119, y + 25);
          ctx.lineTo(x + 115, y + 52);
          ctx.lineTo(x + 129, y + 65);
          ctx.stroke();
        }
      }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export function pubCurtainTexture() {
  return canvasTexture(128, 256, (ctx) => {
    ctx.fillStyle = '#762b2d';
    ctx.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 128; i++) {
      const t = Math.sin(i * 0.28);
      ctx.fillStyle = `rgba(${t > 0 ? '245,192,123' : '20,7,8'},${Math.abs(t) * 0.22})`;
      ctx.fillRect(i, 0, 1, 256);
    }
    for (let y = 3; y < 256; y += 8) {
      ctx.fillStyle = '#edc78b15';
      ctx.fillRect(0, y, 128, 1);
    }
  });
}

export function pubStreetWindowTexture() {
  return canvasTexture(512, 512, (ctx) => {
    const sky = ctx.createLinearGradient(0, 0, 0, 512);
    sky.addColorStop(0, '#101823');
    sky.addColorStop(1, '#283039');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 512, 512);
    const random = seededRandom('pub-street');
    for (let i = 0; i < 7; i++) {
      const x = i * 87 - 20,
        h = 100 + random() * 160;
      ctx.fillStyle = i % 2 ? '#6b736b' : '#6e6b5a';
      ctx.fillRect(x, 512 - h, 78, h);
      ctx.fillStyle = '#d1ba7b';
      for (let y = 530 - h; y < 470; y += 48) for (let xx = x + 13; xx < x + 70; xx += 28) ctx.fillRect(xx, y, 11, 21);
    }
    for (let i = 0; i < 450; i++) {
      ctx.strokeStyle = '#eff6dd2b';
      ctx.lineWidth = 1;
      const x = random() * 512,
        y = random() * 512;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 3, y + 8 + random() * 18);
      ctx.stroke();
    }
  });
}

export function pubExitSignTexture() {
  return canvasTexture(256, 64, (ctx) => {
    ctx.fillStyle = '#2c583b';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#e3f1cb';
    ctx.textAlign = 'center';
    ctx.font = 'bold 42px Arial';
    ctx.fillText('EXIT  →', 128, 48);
  });
}

export function pubDoormatTexture() {
  return canvasTexture(512, 256, (ctx) => {
    ctx.fillStyle = '#544638';
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = '#b49d71';
    ctx.lineWidth = 8;
    ctx.strokeRect(16, 16, 480, 224);
    ctx.fillStyle = '#b49d71';
    ctx.textAlign = 'center';
    ctx.font = 'bold 35px Georgia';
    ctx.fillText('THE CORNER POCKET', 256, 141);
  });
}

export function pubDartboardTexture() {
  return canvasTexture(512, 512, (ctx) => {
    ctx.fillStyle = '#27241f';
    ctx.fillRect(0, 0, 512, 512);
    const nums = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
    for (let i = 0; i < 20; i++) {
      const a = ((i - 0.5) / 20) * Math.PI * 2 - Math.PI / 2,
        b = ((i + 0.5) / 20) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(256, 256);
      ctx.arc(256, 256, 192, a, b);
      ctx.closePath();
      ctx.fillStyle = i % 2 ? '#d9caa5' : '#262920';
      ctx.fill();
      for (const [r, w] of [
        [178, 13],
        [111, 11],
      ]) {
        ctx.beginPath();
        ctx.arc(256, 256, r, a, b);
        ctx.strokeStyle = i % 2 ? '#37684e' : '#923f37';
        ctx.lineWidth = w;
        ctx.stroke();
      }
      ctx.fillStyle = '#ded4b6';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '23px Georgia';
      const mid = (a + b) / 2;
      ctx.fillText(String(nums[i]), 256 + Math.cos(mid) * 216, 256 + Math.sin(mid) * 216);
    }
    ctx.beginPath();
    ctx.arc(256, 256, 16, 0, Math.PI * 2);
    ctx.fillStyle = '#37684e';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(256, 256, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#923f37';
    ctx.fill();
  });
}

/** Value-noise lattice with a couple of octaves. Wood without it is stripes; with it the rings drift
 * and wander the way sawn timber actually does. */
function woodNoise(random: () => number) {
  const size = 64,
    lattice = new Float32Array(size * size);
  for (let i = 0; i < lattice.length; i++) lattice[i] = random();
  const at = (ix: number, iy: number) => lattice[(iy & (size - 1)) * size + (ix & (size - 1))];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const noise = (x: number, y: number) => {
    const x0 = Math.floor(x),
      y0 = Math.floor(y),
      fx = smooth(x - x0),
      fy = smooth(y - y0);
    const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx,
      bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };
  return (x: number, y: number) =>
    noise(x, y) * 0.6 + noise(x * 2.3 + 11, y * 2.1 + 7) * 0.27 + noise(x * 4.9 + 23, y * 4.3 + 19) * 0.13;
}

/** Tongue-and-groove oak panelling for the room's walls, as a colour map and a matching bump map so
 * the grooves and the latewood actually catch the room's lamps instead of being painted-on lines.
 * Each board gets its own pith offset and ring pitch so the tile never lines up into wallpaper.
 * Nothing here may be a once-per-wall feature (a rail, a dado): the map tiles, and so would it. */
export function pubPanellingTexture() {
  const random = seededRandom('pub-panelling-oak');
  const fbm = woodNoise(random);
  const width = 512,
    height = 1024,
    boards = 9,
    boardWidth = width / boards;
  const cuts = Array.from({ length: boards }, () => ({
    // Where the log's centre sat relative to this cut. Close in = tight rings and strong arches.
    pith: (random() - 0.5) * boardWidth * 3,
    pitch: 0.055 + random() * 0.055,
    tone: 0.88 + random() * 0.26,
    lean: (random() - 0.5) * 0.6,
  }));
  // One pass computes the surface, then the colour and the bump are both read from it.
  const shade = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const board = Math.min(boards - 1, Math.floor(x / boardWidth)),
        cut = cuts[board],
        local = x - board * boardWidth;
      const dx = local - cut.pith + (y - height / 2) * cut.lean * 0.02,
        dy = (y - height / 2) * 0.19;
      const warp = (fbm(local * 0.05 + board * 17, y * 0.009) - 0.5) * 14;
      const ring = Math.hypot(dx, dy) + warp;
      // Latewood is a narrow dark band, earlywood a wide pale one: the profile is skewed, not a sine.
      const figure = ((Math.sin(ring * cut.pitch * Math.PI * 2) + 1) / 2) ** 2.6;
      const fibre = (fbm(local * 2.4 + board * 41, y * 0.85) - 0.5) * 0.13; // the fine stuff, close up
      const blotch = (fbm(local * 0.09 + board * 7, y * 0.016) - 0.5) * 0.16;
      let value = (0.36 + figure * 0.5 + fibre + blotch) * cut.tone;
      if (local < 1.5)
        value *= 0.26; // the groove between boards
      else if (local < 2.8) value *= 0.6;
      else if (local > boardWidth - 2) value *= 1.2; // chamfer catching the light
      shade[y * width + x] = Math.max(0, Math.min(1.3, value));
    }

  const map = canvasTexture(width, height, (ctx) => {
    const image = ctx.createImageData(width, height),
      data = image.data;
    for (let i = 0; i < shade.length; i++) {
      const v = shade[i],
        index = i * 4;
      // Aged oak: brown rather than orange, with the darks staying neutral.
      data[index] = 40 + v * 126;
      data[index + 1] = 26 + v * 88;
      data[index + 2] = 17 + v * 62;
      data[index + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  });
  const bump = canvasTexture(width, height, (ctx) => {
    const image = ctx.createImageData(width, height),
      data = image.data;
    for (let i = 0; i < shade.length; i++) {
      // Latewood stands proud of earlywood, and the grooves sit well below both.
      const v = Math.max(0, Math.min(1, shade[i] * 0.82 + 0.1)) * 255,
        index = i * 4;
      data[index] = data[index + 1] = data[index + 2] = v;
      data[index + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  });
  bump.colorSpace = THREE.NoColorSpace;
  for (const texture of [map, bump]) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return { map, bump };
}

/** Glazed brick-bond wall tiles for the wet areas: off-white ceramic, grey grout, and a glaze that
 * varies tile to tile so a run of them never looks like one flat panel. */
export function pubWallTileTexture() {
  const random = seededRandom('pub-wall-tiles');
  const texture = canvasTexture(512, 512, (ctx) => {
    ctx.fillStyle = '#6d6a63'; // grout
    ctx.fillRect(0, 0, 512, 512);
    const rows = 8,
      cols = 4,
      tileHeight = 512 / rows,
      tileWidth = 512 / cols;
    for (let row = 0; row < rows; row++)
      for (let col = -1; col <= cols; col++) {
        const x = col * tileWidth + (row % 2) * (tileWidth / 2),
          y = row * tileHeight,
          tone = 226 + random() * 26;
        ctx.fillStyle = `rgb(${tone},${tone - 3},${tone - 12})`;
        ctx.fillRect(x + 3, y + 3, tileWidth - 6, tileHeight - 6);
        // Glaze pooling: brighter at the top edge, a touch of crazing across the face.
        const glaze = ctx.createLinearGradient(x, y, x, y + tileHeight);
        glaze.addColorStop(0, 'rgba(255,255,255,0.5)');
        glaze.addColorStop(0.35, 'rgba(255,255,255,0.08)');
        glaze.addColorStop(1, 'rgba(120,112,96,0.16)');
        ctx.fillStyle = glaze;
        ctx.fillRect(x + 3, y + 3, tileWidth - 6, tileHeight - 6);
        for (let n = 0; n < 5; n++) {
          ctx.strokeStyle = `rgba(150,142,126,${random() * 0.12})`;
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          const sx = x + 6 + random() * (tileWidth - 12),
            sy = y + 6 + random() * (tileHeight - 12);
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + (random() - 0.5) * 26, sy + (random() - 0.5) * 18);
          ctx.stroke();
        }
      }
    ctx.fillStyle = 'rgba(40,36,30,0.10)'; // bedding shadow under each course
    for (let row = 0; row < rows; row++) ctx.fillRect(0, row * tileHeight + tileHeight - 5, 512, 3);
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}
