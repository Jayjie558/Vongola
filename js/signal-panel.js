// Live signal panel: all DOM and canvas work for #signal-panel. The data comes
// from SignalMonitor; this module only decides how it is shown.
import { CONFIG } from './config.js';
import {
  DRAW_INTERVAL_MS, WAVE_COLORS, drawEmptyText, drawGridLine, plotSeries,
} from './waveform.js';

const GAP_WARN_MS = 250;

export function createSignalPanel({ params }) {
  const panel = document.getElementById('signal-panel');
  const taskEl = document.getElementById('signal-task');
  const footEl = document.getElementById('signal-foot');
  const rows = [
    {
      side: 'left',
      canvas: document.getElementById('signal-left'),
      stats: document.getElementById('signal-left-stats'),
      color: WAVE_COLORS.left,
    },
    {
      side: 'right',
      canvas: document.getElementById('signal-right'),
      stats: document.getElementById('signal-right-stats'),
      color: WAVE_COLORS.right,
    },
  ];

  let visible = params.has('signal');
  let lastDraw = 0;
  if (panel) panel.hidden = !visible;

  function sync(def) {
    if (taskEl) taskEl.textContent = def.id === 'free' ? '自由模式（无指标）' : def.name;
    if (footEl) {
      footEl.textContent = def.metric === 'rotation'
        ? '波形为掌心翻转角（度）· S 关闭'
        : def.metric === 'none'
          ? '选择测量协议后显示 · S 关闭'
          : '虚线 p5 / p95 · 橙带 = 幅度下限 · S 关闭';
    }
  }

  function toggle(next = !visible) {
    visible = next;
    if (panel) panel.hidden = !visible;
    return visible;
  }

  function update(monitor, def, now) {
    if (!panel || !visible) return;
    if (now - lastDraw < DRAW_INTERVAL_MS) return;
    lastDraw = now;
    const snap = monitor.snapshot();
    for (const row of rows) {
      const hand = snap.hands[row.side];
      drawWave(row.canvas, hand, def.metric, now, snap.windowMs, row.color);
      row.stats.textContent = def.metric === 'none'
        ? '—'
        : formatStats(hand, def.metric);
    }
  }

  return {
    sync,
    toggle,
    update,
    get visible() { return visible; },
  };
}

function drawWave(canvas, hand, metric, now, windowMs, color) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  for (let i = 1; i < 3; i++) drawGridLine(ctx, W, (H * i) / 3);

  const points = (hand?.points || []).filter((p) => p.t >= now - windowMs);
  if (!points.length) {
    drawEmptyText(ctx, metric === 'none' ? '选择测量协议' : '未检测到手', W, H);
    return;
  }

  const summary = hand.summary;
  const toDisplay = (v) => (metric === 'rotation' ? (v * 180) / Math.PI : v);
  const values = points.map((p) => toDisplay(p.v));
  if (summary?.smoothed) {
    for (const p of summary.smoothed) {
      if (p.t >= now - windowMs) values.push(toDisplay(p.v));
    }
  }

  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (summary && metric !== 'rotation') {
    lo = Math.min(lo, summary.low);
    hi = Math.max(hi, summary.high);
  }
  if (hi - lo < 1e-6) {
    lo -= 0.1;
    hi += 0.1;
  }
  const pad = (hi - lo) * 0.12;
  lo -= pad;
  hi += pad;

  const xOf = (t) => W - ((now - t) / windowMs) * W;
  const yOf = (v) => H - ((toDisplay(v) - lo) / (hi - lo)) * H;

  // The p5-p95 envelope and the minimum-amplitude band are what the detector
  // keys on, so show them: "why did this not count" becomes obvious.
  if (summary && metric !== 'rotation') {
    const yLow = yOf(summary.low);
    const yHigh = yOf(summary.high);
    ctx.fillStyle = 'rgba(255, 150, 60, 0.07)';
    ctx.fillRect(0, Math.min(yLow, yHigh), W, Math.abs(yHigh - yLow));

    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1;
    for (const v of [summary.low, summary.high]) {
      ctx.beginPath();
      ctx.moveTo(0, yOf(v));
      ctx.lineTo(W, yOf(v));
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const yNeed = yOf(summary.low + summary.minAmplitude);
    ctx.fillStyle = 'rgba(255, 150, 60, 0.12)';
    ctx.fillRect(0, Math.min(yLow, yNeed), W, Math.abs(yNeed - yLow));
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = 'rgba(255, 150, 60, 0.55)';
    ctx.beginPath();
    ctx.moveTo(0, yNeed);
    ctx.lineTo(W, yNeed);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Smoothed series first (what the detector sees), raw samples on top.
  if (summary?.smoothed?.length) {
    const smoothed = summary.smoothed.filter((p) => p.t >= now - windowMs);
    plotSeries(ctx, smoothed, (p) => p.v, { color, width: 2, alpha: 0.45, xOf, yOf });
  }
  plotSeries(ctx, points, (p) => p.v, { color, width: 2, xOf, yOf });

  const last = points[points.length - 1];
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(xOf(last.t), yOf(last.v), 4, 0, Math.PI * 2);
  ctx.fill();
}

function formatStats(hand, metric) {
  if (!hand || !hand.points.length) return '—';
  const parts = [];
  parts.push('值 ' + (metric === 'rotation'
    ? Math.round(hand.latest * 180 / Math.PI) + '°'
    : hand.latest.toFixed(2)));

  const s = hand.summary;
  if (s) {
    if (metric === 'rotation') {
      const need = Math.round(CONFIG.metricRotationMinSwing * 180 / Math.PI);
      parts.push('范围 ' + Math.round(s.rangeDeg) + '°');
      parts.push('翻腕 ' + s.count.toFixed(1) + ' 次');
      if (s.freqHz) parts.push(s.freqHz.toFixed(1) + ' Hz');
      if (s.rangeDeg < need) parts.push('⚠ 幅度不足');
    } else {
      const need = CONFIG.metricCycleMinAmplitude;
      parts.push('幅度 ' + s.amplitude.toFixed(2) + ' / 需 ' + need.toFixed(2));
      parts.push('开合 ' + s.count + ' 次');
      if (s.freqHz) parts.push(s.freqHz.toFixed(1) + ' Hz');
      if (s.amplitude < need) parts.push('⚠ 幅度不足');
    }
  }
  parts.push('覆盖 ' + Math.round(hand.coverage * 100) + '%');
  if (hand.maxGapMs > GAP_WARN_MS) parts.push('丢帧 ' + Math.round(hand.maxGapMs) + 'ms');
  return parts.join(' · ');
}
