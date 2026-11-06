// Rolling-window view of the task signal for the live signal panel. It reuses
// the same extraction and detectors as the offline analyzer, so what the panel
// shows is what the exported metrics will be computed from.
import { CONFIG } from './config.js';
import { measureValue, summarizeSeries } from './protocols.js';
import { RollingWindow } from './rolling-window.js';

const SIDES = ['left', 'right'];
const WINDOW_MS = 5000;

export class SignalMonitor {
  constructor({ hz = CONFIG.measureHz, windowMs = WINDOW_MS } = {}) {
    this.hz = hz;
    this.windowMs = windowMs;
    this.enabled = false;
    this.metric = 'none';
    this.reset();
  }

  setEnabled(on) {
    if (this.enabled === on) return;
    this.enabled = on;
    this.reset();
  }

  setMetric(metric) {
    if (this.metric === metric) return;
    this.metric = metric;
    this.reset();
  }

  reset() {
    this.lastT = null;
    this.windows = {
      left: makeWindow(this.windowMs, this.hz),
      right: makeWindow(this.windowMs, this.hz),
    };
  }

  // Called once per rendered frame; rate-limited like SessionRecorder so the
  // window stays comparable across frame rates.
  sample(now, view, slotList) {
    if (!this.enabled || this.metric === 'none') return;
    if (this.lastT !== null && now - this.lastT < 1000 / this.hz) return;
    this.lastT = now;

    for (const side of SIDES) this.windows[side].beginTick(now);
    for (const slot of slotList) {
      const window = this.windows[slot.name];
      if (!window || !slot.lastLms) continue;
      const value = measureValue(slot.lastLms, this.metric, view);
      if (!Number.isFinite(value)) continue;
      window.markPresent();
      window.push({ t: now, v: value });
    }
    for (const side of SIDES) this.windows[side].trim(now);
  }

  snapshot() {
    const out = { metric: this.metric, windowMs: this.windowMs, hands: {} };
    for (const side of SIDES) {
      const base = this.windows[side].snapshot();
      const points = base.points;
      out.hands[side] = {
        ...base,
        latest: points.length ? points[points.length - 1].v : null,
        summary: summarizeSeries(points, this.metric),
      };
    }
    return out;
  }
}

function makeWindow(windowMs, hz) {
  return new RollingWindow({
    windowMs,
    maxPoints: Math.ceil(windowMs / (1000 / hz)) + 2,
  });
}
