// Always-on hand-tremor view: palm-center micro-motion after a high-pass
// filter. It runs independently of the measurement protocols, so the waveform
// is available even in free mode.
//
// 30 Hz sampling resolves roughly 2-12 Hz. Amplitude is normalized by hand
// size (wrist -> middle knuckle) and reported as the RMS of the combined x/y
// displacement, in hand-size units.
import { CONFIG } from './config.js';
import { lmToAspectUnits } from './view.js';
import { RollingWindow } from './rolling-window.js';

const SIDES = ['left', 'right'];
const PALM = [0, 5, 9, 13, 17];
const GAP_RESET_MS = 300;

export class TremorMonitor {
  constructor({ hz = CONFIG.measureHz, windowMs = CONFIG.tremorWindowMs } = {}) {
    this.hz = hz;
    this.windowMs = windowMs;
    this.reset();
  }

  reset() {
    this.lastT = null;
    this.windows = {
      left: makeWindow(this.windowMs, this.hz),
      right: makeWindow(this.windowMs, this.hz),
    };
    this.filters = { left: newHandFilter(), right: newHandFilter() };
  }

  // Called once per rendered frame; rate-limited to `hz`.
  sample(now, view, slotList) {
    if (this.lastT !== null && now - this.lastT < 1000 / this.hz) return;
    const dtMs = this.lastT === null ? 1000 / this.hz : now - this.lastT;
    this.lastT = now;

    for (const side of SIDES) this.windows[side].beginTick(now);
    for (const slot of slotList) {
      const side = slot.name;
      const window = this.windows[side];
      if (!window || !slot.lastLms) continue;
      const motion = palmMotion(slot.lastLms, view);
      if (!motion) continue;
      window.markPresent();

      const filter = this.filters[side];
      // A long gap means the hand was lost: restart the filter instead of
      // carrying the old baseline across the dropout.
      const stepMs = filter.lastT === null ? dtMs : now - filter.lastT;
      if (stepMs > GAP_RESET_MS) resetHandFilter(filter);
      filter.lastT = now;
      const alpha = hpAlpha(stepMs, CONFIG.tremorCutoffHz);
      const x = hpStep(filter.x, motion.x, alpha);
      const y = hpStep(filter.y, motion.y, alpha);
      if (x === null || y === null) continue; // the first sample only primes it
      window.push({ t: now, x, y });
    }
    for (const side of SIDES) this.windows[side].trim(now);
  }

  snapshot() {
    const out = { windowMs: this.windowMs, hands: {} };
    for (const side of SIDES) {
      const base = this.windows[side].snapshot();
      out.hands[side] = { ...base, ...tremorStats(base.points) };
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

// Palm center in hand-size units. The center is the wrist plus the four MCPs,
// so finger curl barely moves it; hand size makes the value distance-invariant.
function palmMotion(raw, view) {
  if (!view || !Array.isArray(raw) || raw.length < 21) return null;
  const pts = raw.map((lm) => lmToAspectUnits(toLandmark(lm), view));
  const size = Math.hypot(pts[0].x - pts[9].x, pts[0].y - pts[9].y);
  if (!(size > 1e-5)) return null;
  let cx = 0;
  let cy = 0;
  for (const i of PALM) {
    cx += pts[i].x;
    cy += pts[i].y;
  }
  return { x: cx / PALM.length / size, y: cy / PALM.length / size };
}

function toLandmark(raw) {
  if (Array.isArray(raw)) return { x: raw[0], y: raw[1], z: raw[2] || 0 };
  return raw;
}

function tremorStats(points) {
  if (points.length < 2) return { rms: 0, freqHz: 0, gain: 1 };
  let energy = 0;
  for (const p of points) energy += p.x * p.x + p.y * p.y;
  const rms = Math.sqrt(energy / points.length);
  const freqHz = estimateFrequency(points);
  if (!freqHz) return { rms, freqHz: 0, gain: 1 };
  // The high-pass attenuates the tremor itself (more at low frame rates), so
  // divide by its response at the measured frequency. Otherwise the amplitude
  // would depend on how fast the browser renders. The panel uses the same gain
  // on the drawn trace, keeping the waveform and the number consistent.
  const dtMs = (points[points.length - 1].t - points[0].t) / (points.length - 1);
  const gain = cascadeGain(freqHz, dtMs);
  return { rms: rms / gain, freqHz, gain };
}

function cascadeGain(hz, dtMs) {
  const w = 2 * Math.PI * hz * dtMs / 1000;
  const alpha = hpAlpha(dtMs, CONFIG.tremorCutoffHz);
  const num = alpha * Math.sqrt(2 - 2 * Math.cos(w));
  const den = Math.sqrt(1 - 2 * alpha * Math.cos(w) + alpha * alpha);
  const one = num / den;
  return Math.max(0.05, one * one);
}

// Zero-crossing rate on the dominant axis, with a deadband so sensor noise
// does not inflate the count. Only report frequencies in the tremor band.
function estimateFrequency(points) {
  if (points.length < 30) return 0;
  const spanS = (points[points.length - 1].t - points[0].t) / 1000;
  if (spanS < 1) return 0;

  let meanX = 0;
  let meanY = 0;
  for (const p of points) {
    meanX += p.x;
    meanY += p.y;
  }
  meanX /= points.length;
  meanY /= points.length;

  let varX = 0;
  let varY = 0;
  for (const p of points) {
    varX += (p.x - meanX) ** 2;
    varY += (p.y - meanY) ** 2;
  }
  const useX = varX >= varY;

  let energy = 0;
  for (const p of points) {
    const v = useX ? p.x : p.y;
    energy += v * v;
  }
  const rms = Math.sqrt(energy / points.length);
  if (!(rms > CONFIG.tremorFreqMinAmplitude)) return 0;
  const dead = rms * 0.3;

  let state = 0;
  let crossings = 0;
  for (const p of points) {
    const v = useX ? p.x : p.y;
    if (state <= 0 && v > dead) {
      state = 1;
      crossings++;
    } else if (state >= 0 && v < -dead) {
      state = -1;
      crossings++;
    }
  }

  const hz = crossings / (2 * spanS);
  return hz >= CONFIG.tremorFreqMin && hz <= CONFIG.tremorFreqMax ? hz : 0;
}

// ---------------------------------------------------------------------------
// Second-order high-pass: two one-pole stages, cutoff ~CONFIG.tremorCutoffHz.
// This removes voluntary arm/hand drift while keeping tremor frequencies.

function newHandFilter() {
  return { lastT: null, x: newAxisFilter(), y: newAxisFilter() };
}

function newAxisFilter() {
  return { prev: null, y1: 0, in1: 0, y2: 0 };
}

function resetHandFilter(filter) {
  filter.lastT = null;
  resetAxisFilter(filter.x);
  resetAxisFilter(filter.y);
}

function resetAxisFilter(axis) {
  axis.prev = null;
  axis.y1 = 0;
  axis.in1 = 0;
  axis.y2 = 0;
}

function hpAlpha(dtMs, fcHz) {
  const rc = 1 / (2 * Math.PI * fcHz);
  const dt = dtMs / 1000;
  return rc / (rc + dt);
}

function hpStep(axis, x, alpha) {
  if (axis.prev === null) {
    axis.prev = x;
    return null;
  }
  const y1 = alpha * (axis.y1 + x - axis.prev);
  axis.prev = x;
  axis.y1 = y1;
  const y2 = alpha * (axis.y2 + y1 - axis.in1);
  axis.in1 = y1;
  axis.y2 = y2;
  return y2;
}
