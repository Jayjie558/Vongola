// Shared canvas helpers for the two live trace panels (protocol signal and
// tremor). Keeping the plot loop here means both panels break lines at
// dropouts and clear the canvas the same way.
export const WAVE_COLORS = { left: '#ffc078', right: '#7dd3fc' };
export const DRAW_INTERVAL_MS = 66;
export const GAP_BREAK_MS = 150;

export function drawGridLine(ctx, width, y, color = 'rgba(255, 255, 255, 0.06)') {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(width, y);
  ctx.stroke();
}

export function drawEmptyText(ctx, text, width, height) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.32)';
  ctx.font = '22px Consolas, "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2);
}

// Draw one time series. `valueOf` maps a sample to its plotted value; a gap
// longer than `gapMs` starts a new stroke instead of bridging the dropout.
export function plotSeries(ctx, points, valueOf, {
  color, width, alpha = 1, xOf, yOf, gapMs = GAP_BREAK_MS,
}) {
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let prevT = null;
  let drawing = false;
  for (const p of points) {
    if (prevT !== null && p.t - prevT > gapMs) drawing = false;
    const x = xOf(p.t);
    const y = yOf(valueOf(p));
    if (drawing) ctx.lineTo(x, y);
    else {
      ctx.moveTo(x, y);
      drawing = true;
    }
    prevT = p.t;
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}
