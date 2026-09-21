import { canvasTexture } from './materials';
import { seededRandom } from '../simulation/types';

/** Canvas maps for the generated sports-bar props. The meshes carry no UVs of their own, so these are
 * drawn for the projection each prop gets: cylindrical maps read v as height, 'top' maps read a plan
 * view whose outer pixels wrap down the sides. */

const grain = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  random: () => number,
  light: string,
  dark: string,
  lines = 900,
) => {
  for (let i = 0; i < lines; i++) {
    const y = random() * height;
    ctx.strokeStyle = random() > 0.5 ? light : dark;
    ctx.lineWidth = random() * 2 + 0.3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y + (random() - 0.5) * 6);
    ctx.stroke();
  }
};

/** Vertical brushing plus a little corrosion, so steel reads as spun metal rather than flat chrome. */
export function brushedSteelTexture() {
  const random = seededRandom('keg-steel');
  return canvasTexture(1024, 1024, (ctx) => {
    ctx.fillStyle = '#9fa4a8';
    ctx.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 2600; i++) {
      const x = random() * 1024,
        shade = random() > 0.5 ? 255 : 90;
      ctx.strokeStyle = `rgba(${shade},${shade},${shade},${0.02 + random() * 0.07})`;
      ctx.lineWidth = random() * 2.4 + 0.2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + (random() - 0.5) * 8, 1024);
      ctx.stroke();
    }
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(74,66,58,${random() * 0.12})`;
      ctx.beginPath();
      ctx.arc(random() * 1024, random() * 1024, random() * 9, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Pressed board: fibre speckle, printed ring and the house eight ball. */
export function coasterBoardTexture() {
  const random = seededRandom('coaster-board');
  return canvasTexture(512, 512, (ctx) => {
    ctx.fillStyle = '#cbb387';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 5200; i++) {
      ctx.fillStyle = random() > 0.5 ? `rgba(90,68,40,${random() * 0.3})` : `rgba(255,244,214,${random() * 0.3})`;
      ctx.fillRect(random() * 512, random() * 512, 1 + random() * 2, 1 + random() * 2);
    }
    ctx.strokeStyle = '#3c5a3a';
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.arc(256, 256, 214, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(256, 256, 190, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#3c5a3a';
    ctx.beginPath();
    ctx.arc(256, 256, 74, 0, Math.PI * 2);
    ctx.fill();
    // An eight ball reads at any size, where lettering smears across the stack's curve.
    ctx.fillStyle = '#efe7d2';
    ctx.beginPath();
    ctx.arc(256, 256, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#17181a';
    ctx.font = 'bold 62px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('8', 256, 260);
  });
}

/** The cabinet's whole front elevation: open doors land on oak, the centre lands on a regulation board. */
export function dartboardFaceTexture() {
  const random = seededRandom('dartboard-face');
  return canvasTexture(1024, 768, (ctx) => {
    const cx = 512,
      cy = 384,
      r = 238; // matched to the board disc the mesh actually has, so numbers stay off the frame
    ctx.fillStyle = '#47301f';
    ctx.fillRect(0, 0, 1024, 768);
    grain(ctx, 1024, 768, random, 'rgba(196,140,84,0.09)', 'rgba(12,6,3,0.14)');
    ctx.fillStyle = '#17181a';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.09, 0, Math.PI * 2);
    ctx.fill();
    const ring = (outer: number, inner: number, even: string, odd: string) => {
      for (let i = 0; i < 20; i++) {
        const start = (i * Math.PI) / 10 - Math.PI / 20 - Math.PI / 2;
        ctx.fillStyle = i % 2 ? odd : even;
        ctx.beginPath();
        ctx.arc(cx, cy, outer, start, start + Math.PI / 10);
        ctx.arc(cx, cy, inner, start + Math.PI / 10, start, true);
        ctx.closePath();
        ctx.fill();
      }
    };
    ring(r * 0.96, r * 0.6, '#e8dcbe', '#1d1e20'); // outer beds
    ring(r * 0.6, r * 0.56, '#c62128', '#1f7a3c'); // trebles
    ring(r * 0.56, r * 0.22, '#e8dcbe', '#1d1e20'); // inner beds
    ring(r * 0.22, r * 0.18, '#c62128', '#1f7a3c'); // doubles
    ctx.fillStyle = '#1f7a3c';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c62128';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.045, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#efe6cd';
    ctx.font = 'bold 32px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const numbers = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
    numbers.forEach((n, i) => {
      const angle = (i * Math.PI) / 10 - Math.PI / 2;
      ctx.fillText(String(n), cx + Math.cos(angle) * r * 1.03, cy + Math.sin(angle) * r * 1.03);
    });
  });
}

/** Cylindrical, so v is height: oak below, a buttoned leather seat on top. No painted-on metal band:
 * the footrest is a ring of geometry somewhere the map cannot know about, and a stripe across the
 * legs is worse than none. */
export function barStoolTexture() {
  const random = seededRandom('bar-stool');
  return canvasTexture(512, 1024, (ctx) => {
    ctx.fillStyle = '#48301d';
    ctx.fillRect(0, 0, 512, 1024);
    grain(ctx, 512, 1024, random, 'rgba(206,150,92,0.11)', 'rgba(10,5,2,0.18)', 900);
    ctx.fillStyle = '#191a1d'; // the seat cushion, on the top of the stool
    ctx.fillRect(0, 0, 512, 186);
    ctx.fillStyle = '#242629'; // its piped lip
    ctx.fillRect(0, 186, 512, 22);
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = '#0b0c0d';
      ctx.beginPath();
      ctx.arc(28 + i * 58, 96, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Plan view for table tops: the outer pixels are the rim, so they wrap down the legs as dark wood. */
export function tableTopTexture() {
  const random = seededRandom('table-top');
  return canvasTexture(1024, 1024, (ctx) => {
    ctx.fillStyle = '#2a1a11';
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.fillStyle = '#5c3a22';
    ctx.fillRect(70, 70, 884, 884);
    grain(ctx, 1024, 1024, random, 'rgba(214,158,98,0.13)', 'rgba(12,6,3,0.2)', 1100);
    const sheen = ctx.createLinearGradient(0, 0, 1024, 1024);
    sheen.addColorStop(0, '#ffffff16');
    sheen.addColorStop(0.5, '#00000000');
    sheen.addColorStop(1, '#00000033');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, 1024, 1024);
  });
}

/** Plan view of a table: cloth field, cushions, pockets. Its border wraps down the frame and legs. */
export function poolTableTexture() {
  const random = seededRandom('snug-pool-table');
  return canvasTexture(1024, 1024, (ctx) => {
    ctx.fillStyle = '#3a2216'; // frame and legs take the outermost pixels
    ctx.fillRect(0, 0, 1024, 1024);
    grain(ctx, 1024, 1024, random, 'rgba(198,142,86,0.1)', 'rgba(10,5,2,0.18)', 700);
    ctx.fillStyle = '#1d6b3f';
    ctx.fillRect(150, 150, 724, 724);
    ctx.fillStyle = '#237d4a';
    ctx.fillRect(178, 178, 668, 668);
    for (let i = 0; i < 2400; i++) {
      ctx.fillStyle = random() > 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';
      ctx.fillRect(178 + random() * 668, 178 + random() * 668, 2, 2);
    }
    ctx.fillStyle = '#100c09';
    for (const [x, y] of [
      [178, 178],
      [846, 178],
      [178, 846],
      [846, 846],
      [512, 172],
      [512, 852],
    ]) {
      ctx.beginPath();
      ctx.arc(x, y, 40, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Cylindrical: brown glass with a blank house label band and a foil neck. */
export function beerBottleTexture() {
  return canvasTexture(256, 1024, (ctx) => {
    ctx.fillStyle = '#4a2408';
    ctx.fillRect(0, 0, 256, 1024);
    ctx.fillStyle = '#6b3410';
    ctx.fillRect(0, 120, 256, 700);
    ctx.fillStyle = '#d8cdb2'; // label
    ctx.fillRect(0, 430, 256, 300);
    ctx.fillStyle = '#3c5a3a';
    ctx.fillRect(0, 455, 256, 26);
    ctx.fillRect(0, 686, 256, 26);
    ctx.fillStyle = '#23303a';
    ctx.fillRect(0, 60, 256, 70); // foil at the neck
    ctx.fillStyle = '#2a2018';
    ctx.font = 'bold 54px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('CP', 128, 590);
  });
}

/** Front elevation of a wall screen: dark panel in a slim bezel, with a faint off-state sheen. */
export function wallScreenTexture() {
  return canvasTexture(1024, 640, (ctx) => {
    ctx.fillStyle = '#141619';
    ctx.fillRect(0, 0, 1024, 640);
    ctx.fillStyle = '#0a0c0f';
    ctx.fillRect(38, 38, 948, 564);
    const sheen = ctx.createLinearGradient(38, 38, 986, 602);
    sheen.addColorStop(0, 'rgba(120,150,190,0.16)');
    sheen.addColorStop(0.45, 'rgba(90,110,140,0.03)');
    sheen.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(38, 38, 948, 564);
  });
}
