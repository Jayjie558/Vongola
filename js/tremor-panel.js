// Always-on tremor panel: draws the high-passed palm motion from
// TremorMonitor. This panel is independent of the protocol signal panel, so it
// stays visible in every mode.
import { CONFIG } from './config.js';
import {
  DRAW_INTERVAL_MS, WAVE_COLORS, drawEmptyText, drawGridLine, plotSeries,
} from './waveform.js';

export function createTremorPanel({ params }) {
  const panel = document.getElementById('tremor-panel');
  const foot = document.getElementById('tremor-foot');
  const rows = [
    {
      side: 'left',
      canvas: document.getElementById('tremor-left'),
      stats: document.getElementById('tremor-left-stats'),
      color: WAVE_COLORS.left,
    },
    {
      side: 'right',
      canvas: document.getElementById('tremor-right'),
      stats: document.getElementById('tremor-right-stats'),
      color: WAVE_COLORS.right,
    },
  ];

  const visible = params.get('tremor') !== '0';
  let lastDraw = 0;
  let scale = 0;
  if (panel) panel.hidden = !visible;

  function update(monitor, now) {
    if (!panel || !visible) return;
    if (now - lastDraw < DRAW_INTERVAL_MS) return;
    lastDraw = now;

    const snap = monitor.snapshot();
    const target = Math.max(scaleOf(snap), CONFIG.tremorScaleFloor);
    // Grow quickly so a new tremor is visible, shrink slowly to avoid pumping.
    scale = scale ? scale + (target - scale) * (target > scale ? 0.25 : 0.08) : target;

    for (const row of rows) {
      const hand = snap.hands[row.side];
      drawWave(row.canvas, hand, now, snap.windowMs, row.color, scale);
      row.stats.textContent = formatStats(hand);
    }
    if (foot) foot.textContent = '纵轴 ±' + scale.toFixed(3) + ' · 横实 / 纵淡 · RMS（手长）';
  }

  return {
    update,
    get visible() { return visible; },
  };
}

// Shared vertical scale across both hands, so the rows are comparable.
function scaleOf(snap) {
  const values = [];
  for (const side of ['left', 'right']) {
    const hand = snap.hands[side];
    const gain = hand.gain > 0 ? hand.gain : 1;
    for (const p of hand.points) {
      values.push(Math.abs(p.x) / gain, Math.abs(p.y) / gain);
    }
  }
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  return values[Math.floor((values.length - 1) * 0.98)];
}

function drawWave(canvas, hand, now, windowMs, color, scale) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  drawGridLine(ctx, W, H / 2, 'rgba(255, 255, 255, 0.1)');

  const points = (hand?.points || []).filter((p) => p.t >= now - windowMs);
  if (!points.length) {
    drawEmptyText(ctx, '未检测到手', W, H);
    return;
  }

  const half = Math.max(scale, CONFIG.tremorScaleFloor) * 1.08;
  const gain = hand.gain > 0 ? hand.gain : 1;
  const xOf = (t) => W - ((now - t) / windowMs) * W;
  const yOf = (v) => H / 2 - (v / half) * (H * 0.46);

  plotSeries(ctx, points, (p) => p.x / gain, { color, width: 2, alpha: 0.95, xOf, yOf });
  plotSeries(ctx, points, (p) => p.y / gain, { color, width: 1.5, alpha: 0.38, xOf, yOf });

  const last = points[points.length - 1];
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(xOf(last.t), yOf(last.x / gain), 3.5, 0, Math.PI * 2);
  ctx.fill();
}

function formatStats(hand) {
  if (!hand || !hand.points.length) return '—';
  const parts = ['抖幅 ' + hand.rms.toFixed(3)];
  if (hand.freqHz) parts.push('≈' + hand.freqHz.toFixed(1) + ' Hz');
  parts.push('覆盖 ' + Math.round(hand.coverage * 100) + '%');
  if (hand.maxGapMs > 250) parts.push('丢帧 ' + Math.round(hand.maxGapMs) + 'ms');
  return parts.join(' · ');
}
