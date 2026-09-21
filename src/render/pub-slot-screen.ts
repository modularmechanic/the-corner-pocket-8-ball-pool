function drawReelSymbol(ctx: CanvasRenderingContext2D, symbol: number, x: number, y: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (symbol === 0) {
    ctx.fillStyle = '#bb2636';
    ctx.font = 'bold italic 77px Georgia';
    ctx.fillText('7', 0, 0);
    ctx.strokeStyle = '#eab95c';
    ctx.lineWidth = 2;
    ctx.strokeText('7', 0, 0);
  } else if (symbol === 1) {
    ctx.strokeStyle = '#3b7139';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-15, 8);
    ctx.quadraticCurveTo(0, -12, 14, -25);
    ctx.lineTo(18, 9);
    ctx.stroke();
    ctx.fillStyle = '#c22c42';
    for (const cx of [-17, 18]) {
      ctx.beginPath();
      ctx.arc(cx, 14, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ec6170';
      ctx.beginPath();
      ctx.arc(cx - 5, 8, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c22c42';
    }
  } else if (symbol === 2) {
    ctx.fillStyle = '#193746';
    ctx.fillRect(-42, -22, 84, 44);
    ctx.fillStyle = '#efda99';
    ctx.font = 'bold 32px Arial';
    ctx.fillText('BAR', 0, 0);
  } else {
    ctx.fillStyle = '#249ca7';
    ctx.beginPath();
    ctx.moveTo(0, -35);
    ctx.lineTo(33, 0);
    ctx.lineTo(0, 35);
    ctx.lineTo(-33, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#a2e7df';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.restore();
}
export function drawSlot(ctx: CanvasRenderingContext2D, time: number, machine: number) {
  const w = ctx.canvas.width,
    h = ctx.canvas.height,
    t = time + machine * 1.7,
    cycle = Math.floor(t / 8),
    phase = t % 8;
  const colors = ['#86d9dd', '#e9ba65', '#ca9fea'];
  ctx.fillStyle = '#11232d';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = colors[machine];
  ctx.lineWidth = 4;
  ctx.strokeRect(7, 7, w - 14, h - 14);
  ctx.fillStyle = colors[machine];
  ctx.font = 'bold 27px Georgia';
  ctx.textAlign = 'center';
  ctx.fillText(['LUCKY BREAK', 'CLUB CLASSICS', 'MIDNIGHT SEVENS'][machine], w / 2, 42);
  for (let reel = 0; reel < 3; reel++) {
    const x = 21 + reel * 157,
      top = 72,
      height = 250;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, top, 145, height);
    ctx.clip();
    ctx.fillStyle = '#e8e2c5';
    ctx.fillRect(x, top, 145, height);
    const spin = Math.min(1, phase / (1.4 + reel * 0.32)),
      offset = (cycle + machine + reel + 12 * (1 - (1 - spin) ** 3)) * 96;
    for (let row = -1; row < 5; row++) {
      const index = Math.floor(offset / 96) + row;
      drawReelSymbol(ctx, ((index % 4) + 4) % 4, x + 72, top + row * 96 - (offset % 96) + 46);
    }
    const shade = ctx.createLinearGradient(0, top, 0, top + height);
    shade.addColorStop(0, '#17252ab5');
    shade.addColorStop(0.22, '#17252a00');
    shade.addColorStop(0.78, '#17252a00');
    shade.addColorStop(1, '#17252ab5');
    ctx.fillStyle = shade;
    ctx.fillRect(x, top, 145, height);
    ctx.restore();
    ctx.strokeStyle = '#a99a6f';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, top, 145, height);
  }
  ctx.strokeStyle = colors[machine];
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(14, 198);
  ctx.lineTo(w - 14, 198);
  ctx.stroke();
  ctx.font = 'bold 18px Arial';
  ctx.fillStyle = '#ebddb6';
  ctx.textAlign = 'center';
  ctx.fillText(phase < 2.1 ? 'THE CLUB IS OPEN' : '★  THE CORNER POCKET  ★', w / 2, h - 29);
}
