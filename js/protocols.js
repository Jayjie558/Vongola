// Guided measurement protocols and the analysis of their recorded series.
//
// A protocol is just a fixed task window (lead-in countdown + N seconds) that
// SessionRecorder captures. All derived numbers are computed here from the raw
// landmark samples, so the JSON stays the source of truth and the metrics can
// be recomputed or replaced without re-recording.
//
// Pure JS (no DOM, no THREE) so analyzers can be exercised directly in tests.
import { CONFIG } from './config.js';

export const PROTOCOLS = {
  free: {
    id: 'free',
    name: '自由录制',
    metric: 'none',
    leadIn: 0,
    seconds: 0,
    hint: '按 M 开始 / 结束',
  },
  finger_tap: {
    id: 'finger_tap',
    name: '手指敲击',
    metric: 'tap',
    leadIn: CONFIG.protocolLeadIn,
    seconds: CONFIG.protocolSeconds,
    hint: '拇指与食指快速对捏，尽量快而均匀',
  },
  open_close: {
    id: 'open_close',
    name: '握拳张开',
    metric: 'cycle',
    leadIn: CONFIG.protocolLeadIn,
    seconds: CONFIG.protocolSeconds,
    hint: '反复握拳，再完全张开',
  },
  pronation_supination: {
    id: 'pronation_supination',
    name: '旋前旋后',
    metric: 'rotation',
    leadIn: CONFIG.protocolLeadIn,
    seconds: CONFIG.protocolSeconds,
    hint: '手掌朝上 / 朝下反复翻转，前臂保持不动',
  },
};

const FINGERTIPS = [8, 12, 16, 20];
const SIDE_NAMES = ['left', 'right'];

/**
 * @param {object} data a stopped SessionRecorder payload
 * @param {string} [protocolId] defaults to data.protocol
 */
export function analyzeSession(data, protocolId = data.protocol) {
  const def = PROTOCOLS[protocolId] || PROTOCOLS.free;
  const samples = data.samples || [];
  const result = {
    version: 1,
    protocol: def.id,
    durationMs: Math.round(data.durationMs || 0),
    sampleCount: data.sampleCount ?? samples.length,
    hands: {},
  };
  if (def.metric === 'none' || samples.length === 0) return result;

  const video = data.environment?.video || [640, 480];
  for (const side of SIDE_NAMES) {
    result.hands[side] = analyzeHand(samples, side, def.metric, video);
  }
  return result;
}

function analyzeHand(samples, side, metric, video) {
  const points = [];
  const labels = new Map();
  let present = 0;
  let lastT = null;
  let maxGapMs = 0;

  for (const sample of samples) {
    const hand = sample[side];
    if (!hand || !Array.isArray(hand.landmarks) || hand.landmarks.length < 21) continue;
    present++;
    const label = hand.label || '—';
    labels.set(label, (labels.get(label) || 0) + 1);

    const view = makeView(sample, video);
    // Recorder output is [x, y, z]; accept objects too so tests can hand-build
    // landmarks.
    const lms = hand.landmarks.map(toLandmark);
    const p2 = lms.map((lm) => point2(lm, view));
    const handSize = dist2(p2[0], p2[9]);
    if (!(handSize > 1e-5)) continue;

    let value;
    if (metric === 'tap') {
      value = dist2(p2[4], p2[8]) / handSize;
    } else if (metric === 'cycle') {
      value = FINGERTIPS.reduce((sum, i) => sum + dist2(p2[i], p2[0]) / handSize, 0)
        / FINGERTIPS.length;
    } else {
      value = palmAngle(lms.map((lm) => point3(lm, view)));
    }
    if (!Number.isFinite(value)) continue;

    if (lastT !== null) maxGapMs = Math.max(maxGapMs, sample.t - lastT);
    lastT = sample.t;
    points.push({ t: sample.t, v: value });
  }

  const coverage = samples.length ? present / samples.length : 0;
  const spanMs = points.length > 1 ? points[points.length - 1].t - points[0].t : 0;
  const quality = {
    detected: coverage >= CONFIG.metricCoverageMin && spanMs >= 1000 && points.length >= 10,
    coverage: round(coverage, 3),
    spanMs: Math.round(spanMs),
    maxGapMs: Math.round(maxGapMs),
    handSwap: detectHandSwap(labels, present),
  };

  if (!quality.detected) {
    return { ...quality, count: 0, freqHz: 0 };
  }

  if (metric === 'rotation') return { ...quality, ...rotationMetrics(points) };
  return { ...quality, ...oscillationMetrics(points, metric) };
}

// ---------------------------------------------------------------------------
// Signal extraction

function toLandmark(raw) {
  if (Array.isArray(raw)) return { x: raw[0], y: raw[1], z: raw[2] || 0 };
  return raw;
}

function makeView(sample, video) {
  const [vw, vh] = video;
  if (!(vw > 0 && vh > 0 && sample.cw > 0 && sample.ch > 0)) {
    return { rw: 0, rh: 0, ox: 0, oy: 0 };
  }
  const scale = Math.max(sample.cw / vw, sample.ch / vh);
  const rw = vw * scale;
  const rh = vh * scale;
  return { rw, rh, ox: (sample.cw - rw) / 2, oy: (sample.ch - rh) / 2 };
}

// Equal-scale units: same cover-fit mapping as coords.lmToAspect, but without
// its THREE dependency so this module stays standalone.
function point2(lm, view) {
  const px = (1 - lm.x) * view.rw + view.ox;
  const py = lm.y * view.rh + view.oy;
  return { x: px / view.rh, y: py / view.rh };
}

function point3(lm, view) {
  return {
    ...point2(lm, view),
    z: -lm.z * (view.rw / view.rh) * CONFIG.zGain,
  };
}

// Palm orientation is a rotation about the forearm axis. Take the palm normal
// (index MCP -> wrist x pinky MCP -> wrist), project it onto the plane
// perpendicular to the wrist->middle-knuckle axis, and measure its angle in
// that plane. Projecting removes the hand's tilt; only the twist remains.
function palmAngle(p3) {
  const down = sub(p3[9], p3[0]); // wrist -> middle knuckle, approx. forearm axis
  const u = normalize(down);
  if (!u) return NaN;
  let n = normalize(cross(sub(p3[5], p3[0]), sub(p3[17], p3[0])));
  if (!n) return NaN;
  const along = scale(u, dot(n, u));
  n = normalize(sub(n, along));
  if (!n) return NaN;

  let e1 = cross(u, { x: 0, y: 0, z: 1 });
  if (length(e1) < 0.2) e1 = cross(u, { x: 0, y: 1, z: 0 });
  e1 = normalize(e1);
  const e2 = cross(u, e1);
  return Math.atan2(dot(n, e2), dot(n, e1));
}

// MediaPipe landmarks come in normalized video coordinates, where x and y are
// scaled by different pixel counts. All distance math above runs in equal-scale
// units, so a square hand does not read as tall.

// ---------------------------------------------------------------------------
// Tap / open-close: threshold crossings with hysteresis.

function oscillationMetrics(points, metric) {
  const tau = metric === 'tap' ? CONFIG.metricTapSmoothMs : CONFIG.metricCycleSmoothMs;
  const minAmplitude = metric === 'tap'
    ? CONFIG.metricTapMinAmplitude
    : CONFIG.metricCycleMinAmplitude;
  // A tap is a contact (closing edge); an open-close cycle is an opening edge.
  const countDirection = metric === 'tap' ? -1 : 1;

  const smoothed = emaSmooth(points, tau);
  const values = smoothed.map((p) => p.v);
  const low = percentile(values, 0.05);
  const high = percentile(values, 0.95);
  const amplitude = high - low;
  const spanS = (points[points.length - 1].t - points[0].t) / 1000;

  const out = {
    count: 0,
    freqHz: 0,
    amplitude: round(amplitude, 3),
    intervalCv: 0,
  };
  if (!(amplitude >= minAmplitude) || spanS <= 0) return out;

  const on = low + amplitude * 0.65;
  const off = low + amplitude * 0.35;
  let state = values[0] >= (on + off) * 0.5 ? 'high' : 'low';
  let lastEdgeT = -Infinity;
  const edges = [];

  for (const p of smoothed) {
    if (state === 'low' && p.v >= on) {
      state = 'high';
      if (countDirection > 0 && p.t - lastEdgeT >= CONFIG.metricRefractoryMs) {
        edges.push(p.t);
        lastEdgeT = p.t;
      }
    } else if (state === 'high' && p.v <= off) {
      state = 'low';
      if (countDirection < 0 && p.t - lastEdgeT >= CONFIG.metricRefractoryMs) {
        edges.push(p.t);
        lastEdgeT = p.t;
      }
    }
  }

  const intervals = diffs(edges).filter((d) => d <= CONFIG.metricMaxIntervalMs);
  out.count = edges.length;
  out.freqHz = round(intervals.length ? 1000 / median(intervals) : edges.length / spanS, 2);
  out.intervalCv = round(cv(intervals), 3);
  return out;
}

// ---------------------------------------------------------------------------
// Pronation / supination: unwrap the palm angle, then count swings with a
// zigzag detector (a turn only counts once it exceeds the swing threshold).

function rotationMetrics(points) {
  const unwrapped = unwrapAngle(points);
  const smoothed = emaSmooth(unwrapped, CONFIG.metricRotationSmoothMs);
  const pivots = zigzag(smoothed, CONFIG.metricRotationMinSwing);

  const out = {
    count: 0,
    freqHz: 0,
    rangeDeg: 0,
    rhythmCv: 0,
  };
  if (pivots.length < 2) return out;

  const first = pivots[0];
  const last = pivots[pivots.length - 1];
  const spanS = (last.t - first.t) / 1000;
  // Peak -> valley -> peak is one full pronation-supination cycle.
  const cycles = (pivots.length - 1) / 2;
  // Take the range from the raw unwrapped angle: EMA smoothing flattens the
  // turning points and would under-report how far the palm actually rotated.
  const rawValues = unwrapped.map((p) => p.v);
  const rangeRad = percentile(rawValues, 0.95) - percentile(rawValues, 0.05);

  // Same-type pivots (every other one) bound a full period.
  const periods = [];
  for (let i = 2; i < pivots.length; i += 2) periods.push(pivots[i].t - pivots[i - 2].t);

  out.count = round(cycles, 1);
  out.freqHz = round(spanS > 0 ? cycles / spanS : 0, 2);
  out.rangeDeg = round(rangeRad * 180 / Math.PI, 1);
  out.rhythmCv = round(cv(periods), 3);
  return out;
}

// ---------------------------------------------------------------------------
// Small numeric helpers

function emaSmooth(points, tauMs) {
  if (points.length === 0) return [];
  const out = [];
  let s = points[0].v;
  let prevT = points[0].t;
  out.push({ t: prevT, v: s });
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const dt = p.t - prevT;
    prevT = p.t;
    // A long gap means the hand was lost; restart the filter instead of
    // dragging the previous value across the dropout.
    const a = dt > 300 || tauMs <= 0 ? 1 : 1 - Math.exp(-dt / tauMs);
    s += (p.v - s) * a;
    out.push({ t: p.t, v: s });
  }
  return out;
}

function unwrapAngle(points) {
  const out = [{ t: points[0].t, v: points[0].v }];
  let prev = points[0].v;
  let prevT = points[0].t;
  for (let i = 1; i < points.length; i++) {
    let a = points[i].v;
    if (points[i].t - prevT <= 300) {
      while (a - prev > Math.PI) a -= 2 * Math.PI;
      while (a - prev < -Math.PI) a += 2 * Math.PI;
    }
    prev = a;
    prevT = points[i].t;
    out.push({ t: points[i].t, v: a });
  }
  return out;
}

function zigzag(points, minSwing) {
  if (points.length < 2) return [];
  const pivots = [];
  let dir = 0; // 0 = looking for the first swing, 1 = rising, -1 = falling
  let extV = points[0].v;
  let extT = points[0].t;

  for (let i = 1; i < points.length; i++) {
    const { t, v } = points[i];
    if (dir >= 0) {
      if (v > extV) {
        extV = v;
        extT = t;
      } else if (extV - v >= minSwing) {
        pivots.push({ t: extT, v: extV });
        dir = -1;
        extV = v;
        extT = t;
      }
    } else if (v < extV) {
      extV = v;
      extT = t;
    } else if (v - extV >= minSwing) {
      pivots.push({ t: extT, v: extV });
      dir = 1;
      extV = v;
      extT = t;
    }
  }
  return pivots;
}

function detectHandSwap(labels, present) {
  if (present < 10 || labels.size < 2) return false;
  const majors = [...labels.values()].filter((n) => n / present > 0.15);
  return majors.length > 1;
}

function diffs(values) {
  const out = [];
  for (let i = 1; i < values.length; i++) out.push(values[i] - values[i - 1]);
  return out;
}

function percentile(values, q) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function median(values) {
  return percentile(values, 0.5);
}

function cv(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (Math.abs(mean) < 1e-9) return 0;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

function round(v, digits) {
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function scale(a, k) { return { x: a.x * k, y: a.y * k, z: a.z * k }; }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function length(a) { return Math.hypot(a.x, a.y, a.z); }
function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function normalize(a) {
  const len = length(a);
  if (!(len > 1e-9)) return null;
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}
function dist2(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
