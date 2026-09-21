import * as THREE from 'three';

export type PubSport = 'soccer' | 'rugby';
const soccerRoute = [
  [0.15, 0.55],
  [0.3, 0.67],
  [0.45, 0.5],
  [0.6, 0.31],
  [0.72, 0.42],
  [0.88, 0.56],
  [0.97, 0.5],
  [0.55, 0.47],
];
const rugbyRoute = [
  [0.28, 0.52],
  [0.36, 0.66],
  [0.44, 0.41],
  [0.53, 0.35],
  [0.66, 0.47],
  [0.79, 0.54],
  [0.92, 0.46],
  [0.45, 0.49],
];

/** Deterministic fictional match action, bounded to each television's playing field. */
export function pubBroadcastFrame(sport: PubSport, time: number) {
  const t = Math.max(0, Number.isFinite(time) ? time : 0),
    route = sport === 'soccer' ? soccerRoute : rugbyRoute;
  const phase = ((t % (sport === 'soccer' ? 28 : 24)) / (sport === 'soccer' ? 28 : 24)) * route.length;
  const index = Math.floor(phase),
    from = route[index],
    to = route[(index + 1) % route.length],
    u = phase - index;
  const ball = {
    x: from[0] + (to[0] - from[0]) * u,
    y: from[1] + (to[1] - from[1]) * u,
    angle: Math.atan2(to[1] - from[1], to[0] - from[0]),
  };
  const count = sport === 'soccer' ? 11 : 15;
  const players = Array.from({ length: count * 2 }, (_, i) => {
    const team = i < count ? 0 : 1,
      n = i % count;
    const baseX =
      sport === 'soccer' ? (n === 0 ? 0.045 : 0.19 + Math.floor((n - 1) / 4) * 0.17) : 0.26 + Math.floor(n / 5) * 0.12;
    const baseY = sport === 'soccer' ? (n === 0 ? 0.5 : 0.17 + ((n - 1) % 4) * 0.22) : 0.13 + (n % 5) * 0.185;
    return {
      team,
      x: THREE.MathUtils.clamp((team ? 1 - baseX : baseX) + Math.sin(t * 0.48 + n * 1.9 + team) * 0.045, 0.025, 0.975),
      y: THREE.MathUtils.clamp(baseY + Math.sin(t * 0.72 + n * 2.3 + team) * 0.055, 0.035, 0.965),
    };
  });
  const runner = players[sport === 'soccer' ? 9 : 12];
  runner.x = THREE.MathUtils.clamp(ball.x - 0.022, 0.025, 0.975);
  runner.y = THREE.MathUtils.clamp(ball.y + 0.014, 0.035, 0.965);
  const seconds = Math.floor(t * 2.4) + (sport === 'soccer' ? 27 * 60 + 14 : 43 * 60 + 6);
  return {
    ball,
    players,
    clock: `${String(Math.floor(seconds / 60) % 90).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`,
  };
}

export function drawBroadcast(ctx: CanvasRenderingContext2D, sport: PubSport, time: number) {
  const w = ctx.canvas.width,
    h = ctx.canvas.height,
    field = { x: 27, y: 70, w: w - 54, h: h - 97 };
  ctx.fillStyle = '#142229';
  ctx.fillRect(0, 0, w, h);
  // The stadium seats and alternating mowing bands move only through match action.
  for (let i = 0; i < 128; i++) {
    ctx.fillStyle = ['#6a786f', '#a7a794', '#2d454f', '#b1a68c'][i % 4];
    ctx.fillRect(i * 6, 49 + (i % 3) * 4, 3, 3);
  }
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = i % 2 ? '#397a42' : '#43874b';
    ctx.fillRect(field.x + (i * field.w) / 12, field.y, field.w / 12 + 0.5, field.h);
  }
  ctx.strokeStyle = '#e6efdc';
  ctx.lineWidth = 1.6;
  ctx.strokeRect(field.x, field.y, field.w, field.h);
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath();
    ctx.moveTo(field.x + x1 * field.w, field.y + y1 * field.h);
    ctx.lineTo(field.x + x2 * field.w, field.y + y2 * field.h);
    ctx.stroke();
  };
  line(0.5, 0, 0.5, 1);
  if (sport === 'soccer') {
    ctx.beginPath();
    ctx.ellipse(field.x + field.w / 2, field.y + field.h / 2, field.w * 0.076, field.h * 0.19, 0, 0, Math.PI * 2);
    ctx.stroke();
    for (const side of [0, 1]) {
      const x = side ? field.x + field.w - field.w * 0.16 : field.x;
      ctx.strokeRect(x, field.y + field.h * 0.23, field.w * 0.16, field.h * 0.54);
      ctx.strokeRect(
        side ? field.x + field.w - field.w * 0.055 : field.x,
        field.y + field.h * 0.37,
        field.w * 0.055,
        field.h * 0.26,
      );
      ctx.strokeRect(side ? field.x + field.w : field.x - 9, field.y + field.h * 0.42, 9, field.h * 0.16);
    }
  } else {
    for (const x of [0.08, 0.22, 0.78, 0.92]) line(x, 0, x, 1);
    ctx.setLineDash([5, 5]);
    for (const x of [0.32, 0.4, 0.6, 0.68]) line(x, 0.06, x, 0.94);
    ctx.setLineDash([]);
    for (const side of [0.035, 0.965]) {
      line(side, 0.39, side, 0.61);
      line(side, 0.39, side - 0.012, 0.33);
      line(side, 0.61, side - 0.012, 0.67);
      ctx.fillStyle = '#f0efe1';
      ctx.font = '12px Arial';
      ctx.fillText('22', field.x + (side < 0.5 ? 0.23 : 0.74) * field.w, field.y + 18);
    }
  }
  const frame = pubBroadcastFrame(sport, time);
  for (let i = 0; i < frame.players.length; i++) {
    const player = frame.players[i],
      x = field.x + player.x * field.w,
      y = field.y + player.y * field.h;
    ctx.fillStyle = '#143c2866';
    ctx.beginPath();
    ctx.ellipse(x + 3, y + 5, 5.5, 2.7, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = player.team
      ? sport === 'soccer'
        ? '#f0e4bb'
        : '#d8e8db'
      : sport === 'soccer'
        ? '#2fbed2'
        : '#942b46';
    ctx.beginPath();
    ctx.ellipse(x, y, 4, 5.4, Math.sin(time * 4 + i) * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d2ac81';
    ctx.beginPath();
    ctx.arc(x, y - 4.8, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = player.team ? '#283148' : '#15262e';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x - 1, y + 4);
    ctx.lineTo(x - 2 + Math.sin(time * 9 + i) * 2, y + 8);
    ctx.moveTo(x + 1, y + 4);
    ctx.lineTo(x + 2 - Math.sin(time * 9 + i) * 2, y + 8);
    ctx.stroke();
  }
  const bx = field.x + frame.ball.x * field.w,
    by = field.y + frame.ball.y * field.h;
  ctx.fillStyle = '#122c2755';
  ctx.beginPath();
  ctx.ellipse(bx + 3, by + 4, 4, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(frame.ball.angle + time * (sport === 'rugby' ? 2 : 0));
  ctx.fillStyle = '#fff9e8';
  ctx.strokeStyle = '#333a3a';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(0, 0, sport === 'rugby' ? 4.4 : 3, sport === 'rugby' ? 2.4 : 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#343b40';
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
  // Fictional local club channels, with a broadcast score bug rather than app UI.
  ctx.fillStyle = '#102535';
  ctx.fillRect(26, 17, 319, 31);
  ctx.fillStyle = sport === 'soccer' ? '#25c7d1' : '#ba4665';
  ctx.fillRect(26, 17, 5, 31);
  ctx.fillStyle = '#e8f1ec';
  ctx.font = 'bold 16px Arial';
  ctx.fillText(sport === 'soccer' ? 'NORTHBRIDGE  1 : 0  EASTVALE' : 'HARBOR  18 : 15  RIDGE', 40, 38);
  ctx.fillStyle = '#f4de94';
  ctx.fillRect(345, 17, 74, 31);
  ctx.fillStyle = '#13242e';
  ctx.fillText(frame.clock, 357, 38);
  ctx.fillStyle = '#f3efe2';
  ctx.font = 'bold 19px Arial';
  ctx.textAlign = 'right';
  ctx.fillText(sport === 'soccer' ? 'CP FOOTBALL' : 'CP RUGBY', w - 27, 30);
  ctx.font = '11px Arial';
  ctx.fillStyle = '#72d9c1';
  ctx.fillText('CLUB SPORTS', w - 27, 45);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#111f29';
  ctx.fillRect(0, h - 22, w, 22);
  ctx.fillStyle = '#d9dfd5';
  ctx.font = '12px Arial';
  ctx.fillText(
    sport === 'soccer'
      ? 'SATURDAY NIGHT FOOTBALL   •   CORNER POCKET SPORTS'
      : 'RUGBY CLUB SHOWCASE   •   CORNER POCKET SPORTS',
    27,
    h - 7,
  );
}
