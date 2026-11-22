// Guided measurement protocols and the analysis of their recorded series.
//
// A protocol is just a fixed task window (lead-in countdown + N seconds) that
// SessionRecorder captures. All derived numbers are computed here from the raw
// landmark samples, so the JSON stays the source of truth and the metrics can
// be recomputed or replaced without re-recording.
//
// Pure JS (no DOM, no THREE) so analyzers can be exercised directly in tests.
import { CONFIG } from './config.js';
import { coverRect, lmToAspectUnits } from './view.js';

export const PROTOCOLS = {
  free: {
    id: 'free',
    name: '自由录制',
    metric: 'none',
    leadIn: 0,
    seconds: 0,
    hint: '按 M 开始 / 结束',
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
  air_write: {
    id: 'air_write',
    name: '描红数字',
    metric: 'writing',
    leadIn: CONFIG.protocolLeadIn,
    seconds: CONFIG.protocolWriteSeconds,
    hint: '用食指沿淡橙色数字描红，抬指可分笔',
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
  const guide = data.task?.writing || null;
  if (def.metric === 'writing') result.digit = guide?.digit ?? null;
  for (const side of SIDE_NAMES) {
    result.hands[side] = def.metric === 'writing'
      ? analyzeWriting(samples, side, video, guide)
      : analyzeHand(samples, side, def.metric, video);
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
    const value = measureValue(hand.landmarks, metric, view);
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

  // Keep the exported JSON surface explicit; the analyzers also return drawing
  // metadata (levels, smoothed series) for the live signal panel.
  if (metric === 'rotation') {
    const m = rotationMetrics(points);
    return {
      ...quality,
      count: m.count,
      freqHz: m.freqHz,
      rangeDeg: m.rangeDeg,
      rhythmCv: m.rhythmCv,
    };
  }
  const m = oscillationMetrics(points);
  return {
    ...quality,
    count: m.count,
    freqHz: m.freqHz,
    amplitude: m.amplitude,
    intervalCv: m.intervalCv,
  };
}

// ---------------------------------------------------------------------------
// 描红数字: trace accuracy plus control-quality numbers from the index tip.

// Must match WRITE_GESTURES in gesture.js. Kept local so this module stays
// standalone (gesture.js pulls in THREE through coords.js).
const WRITE_LABELS = new Set(['point', 'gun']);
const WRITE_TIP = 8;

function analyzeWriting(samples, side, video, guide) {
  const labels = new Map();
  let present = 0;
  let firstT = null;
  let lastT = null;
  let maxGapMs = 0;
  let box = guide?.box || null;

  // Strokes in box-normalized units: x/y are divided by the box height, with
  // the box center as origin. A stroke ends on pen up, a tracking gap, or a
  // single-frame jump too large to be real motion.
  const strokes = [];
  let cur = null;
  let prev = null;

  const closeStroke = () => {
    if (!cur) return;
    const a = cur.points[0];
    const b = cur.points[cur.points.length - 1];
    cur.durationMs = b.t - a.t;
    if (cur.points.length >= CONFIG.writingMinStrokePoints
      && cur.durationMs >= CONFIG.writingMinStrokeMs) {
      strokes.push(cur);
    }
    cur = null;
    prev = null;
  };

  for (const sample of samples) {
    const hand = sample[side];
    if (!hand || !Array.isArray(hand.landmarks) || hand.landmarks.length < 21) {
      closeStroke();
      continue;
    }
    present++;
    const label = hand.label || '—';
    labels.set(label, (labels.get(label) || 0) + 1);

    const t = sample.t;
    if (firstT === null) firstT = t;
    if (lastT !== null) maxGapMs = Math.max(maxGapMs, t - lastT);
    lastT = t;

    if (!box) {
      box = { cx: sample.cw / 2, cy: sample.ch / 2, w: sample.ch, h: sample.ch };
    }

    const penDown = hand.gesture ? WRITE_LABELS.has(hand.gesture) : true;
    if (!penDown) {
      closeStroke();
      continue;
    }

    const view = makeView(sample, video);
    // Recorder output is [x, y, z]; accept objects too (see measureValue).
    const tip = toLandmark(hand.landmarks[WRITE_TIP]);
    const wrist = toLandmark(hand.landmarks[0]);
    const mcp = toLandmark(hand.landmarks[9]);
    const px = (1 - tip.x) * view.rw + view.ox;
    const py = tip.y * view.rh + view.oy;
    const p = {
      t,
      x: (px - box.cx) / box.h,
      y: (py - box.cy) / box.h,
    };

    const wPx = (1 - wrist.x) * view.rw + view.ox;
    const wPy = wrist.y * view.rh + view.oy;
    const mPx = (1 - mcp.x) * view.rw + view.ox;
    const mPy = mcp.y * view.rh + view.oy;
    const handSize = Math.hypot(mPx - wPx, mPy - wPy) / box.h;

    const breaks = !cur
      || t - prev.t > CONFIG.writingGapMs
      || dist2(p, prev) > Math.max(0.08, handSize * CONFIG.inkJumpHandSizes);
    if (breaks) {
      closeStroke();
      cur = { points: [p], durationMs: 0 };
    } else {
      cur.points.push(p);
    }
    prev = p;
  }
  closeStroke();

  const coverage = samples.length ? present / samples.length : 0;
  const spanMs = firstT !== null ? lastT - firstT : 0;
  const out = {
    detected: coverage >= CONFIG.metricCoverageMin && strokes.length > 0,
    coverage: round(coverage, 3),
    spanMs: Math.round(spanMs),
    maxGapMs: Math.round(maxGapMs),
    handSwap: detectHandSwap(labels, present),
    strokes: strokes.length,
    points: strokes.reduce((n, s) => n + s.points.length, 0),
    durationMs: Math.round(strokes.reduce((n, s) => n + s.durationMs, 0)),
    digit: guide?.digit ?? null,
    // Accuracy / coverage stay null when no guide was recorded.
    meanError: null,
    p90Error: null,
    coverageRate: null,
    tolerance: guide?.tolerance ?? null,
    meanSpeed: 0,
    peakSpeed: 0,
    peaksPerStroke: 0,
    pauseRatio: 0,
    tremorRms: 0,
    // Consistency needs at least two traced strokes; null means "not enough".
    repeatCv: null,
  };
  if (!out.detected) return out;

  const flat = [];
  for (const stroke of strokes) for (const p of stroke.points) flat.push(p);

  // --- trace accuracy vs. the guide point cloud -----------------------------
  if (guide && Array.isArray(guide.points) && guide.points.length) {
    const errs = flat.map((p) => Math.sqrt(nearestSq(p, guide.points)));
    out.meanError = round(mean(errs), 4);
    out.p90Error = round(percentile(errs, 0.9), 4);

    const tolSq = (guide.tolerance ?? CONFIG.writingAccuracyTolerance) ** 2;
    let covered = 0;
    for (const g of guide.points) {
      for (const p of flat) {
        const dx = p.x - g.x;
        const dy = p.y - g.y;
        if (dx * dx + dy * dy <= tolSq) {
          covered++;
          break;
        }
      }
    }
    out.coverageRate = round(covered / guide.points.length, 3);
    if (strokes.length >= 2) {
      out.repeatCv = round(
        cv(strokes.map((s) => meanErrorOf(s.points, guide.points))), 3);
    }
  }

  // --- speed profile / pauses / submovements --------------------------------
  const allSpeeds = [];
  let peaks = 0;
  for (const stroke of strokes) {
    const speeds = [];
    for (let i = 1; i < stroke.points.length; i++) {
      const a = stroke.points[i - 1];
      const b = stroke.points[i];
      const dt = (b.t - a.t) / 1000;
      if (dt > 0) speeds.push({ t: b.t, v: dist2(a, b) / dt });
    }
    if (speeds.length < 2) continue;
    const smooth = emaSmooth(speeds, 80);
    allSpeeds.push(...smooth.map((p) => p.v));
    const peak = Math.max(...smooth.map((p) => p.v));
    let lastPeakT = -Infinity;
    for (let i = 1; i < smooth.length - 1; i++) {
      const v = smooth[i].v;
      if (v < peak * 0.25) continue;
      if (v >= smooth[i - 1].v && v >= smooth[i + 1].v
        && smooth[i].t - lastPeakT >= 120) {
        peaks++;
        lastPeakT = smooth[i].t;
      }
    }
  }
  if (allSpeeds.length) {
    const meanSpeed = mean(allSpeeds);
    const pauseAt = Math.max(0.05, meanSpeed * 0.15);
    out.meanSpeed = round(meanSpeed, 3);
    out.peakSpeed = round(Math.max(...allSpeeds), 3);
    out.peaksPerStroke = round(peaks / strokes.length, 2);
    out.pauseRatio = round(
      allSpeeds.filter((v) => v < pauseAt).length / allSpeeds.length, 3);
  }

  // --- 4-8 Hz tremor in the fingertip path (box units) ----------------------
  out.tremorRms = round(
    bandpassRms(strokes, CONFIG.writingTremorLowHz, CONFIG.writingTremorHighHz), 5);
  return out;
}

// Rolling-window summary for the live signal panel. Uses the same detectors as
// the offline analyzer, so the panel reports what the export will report.
export function summarizeSeries(points, metric) {
  if (!Array.isArray(points) || points.length < 2) return null;
  if (metric === 'rotation') return rotationMetrics(points);
  if (metric === 'cycle') return oscillationMetrics(points);
  return null;
}

// ---------------------------------------------------------------------------
// Signal extraction

// One sample of the task signal. The offline analyzer and the live signal
// panel both call this, so what the panel shows is exactly what gets analyzed.
export function measureValue(rawLandmarks, metric, view) {
  if (!Array.isArray(rawLandmarks) || rawLandmarks.length < 21) return NaN;
  // Recorder output is [x, y, z]; accept objects too so tests can hand-build
  // landmarks.
  const lms = rawLandmarks.map(toLandmark);
  const p2 = lms.map((lm) => point2(lm, view));
  const handSize = dist2(p2[0], p2[9]);
  if (!(handSize > 1e-5)) return NaN;

  let value;
  if (metric === 'cycle') {
    value = FINGERTIPS.reduce((sum, i) => sum + dist2(p2[i], p2[0]) / handSize, 0)
      / FINGERTIPS.length;
  } else if (metric === 'rotation') {
    value = palmAngle(lms.map((lm) => point3(lm, view)));
  } else {
    return NaN;
  }
  return Number.isFinite(value) ? value : NaN;
}

function toLandmark(raw) {
  if (Array.isArray(raw)) return { x: raw[0], y: raw[1], z: raw[2] || 0 };
  return raw;
}

function makeView(sample, video) {
  const [vw, vh] = video;
  return coverRect(sample.cw, sample.ch, vw, vh) || { rw: 0, rh: 0, ox: 0, oy: 0 };
}

// Equal-scale units: same cover-fit mapping as coords.lmToAspect, but without
// its THREE dependency so this module stays standalone.
function point2(lm, view) {
  return lmToAspectUnits(lm, view);
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
// Open-close: threshold crossings with hysteresis.

function oscillationMetrics(points) {
  const smoothed = emaSmooth(points, CONFIG.metricCycleSmoothMs);
  const minAmplitude = CONFIG.metricCycleMinAmplitude;
  const values = smoothed.map((p) => p.v);
  const low = percentile(values, 0.05);
  const high = percentile(values, 0.95);
  const amplitude = high - low;
  const spanS = (points[points.length - 1].t - points[0].t) / 1000;

  const on = low + amplitude * 0.65;
  const off = low + amplitude * 0.35;
  const out = {
    count: 0,
    freqHz: 0,
    amplitude: round(amplitude, 3),
    intervalCv: 0,
    // Drawing metadata for the signal panel; stripped from the exported JSON.
    low,
    high,
    on,
    off,
    minAmplitude,
    smoothed,
  };
  if (!(amplitude >= minAmplitude) || spanS <= 0) return out;
  let state = values[0] >= (on + off) * 0.5 ? 'high' : 'low';
  let lastEdgeT = -Infinity;
  const edges = [];

  // One cycle is counted on the opening edge.
  for (const p of smoothed) {
    if (state === 'low' && p.v >= on) {
      state = 'high';
      if (p.t - lastEdgeT >= CONFIG.metricRefractoryMs) {
        edges.push(p.t);
        lastEdgeT = p.t;
      }
    } else if (state === 'high' && p.v <= off) {
      state = 'low';
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
    // Drawing metadata for the signal panel; stripped from the exported JSON.
    smoothed,
    minSwing: CONFIG.metricRotationMinSwing,
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

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function nearestSq(p, refs) {
  let best = Infinity;
  for (const r of refs) {
    const dx = p.x - r.x;
    const dy = p.y - r.y;
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return best;
}

function meanErrorOf(points, refs) {
  if (!points.length) return 0;
  let sum = 0;
  for (const p of points) sum += Math.sqrt(nearestSq(p, refs));
  return sum / points.length;
}

// One-pole high-pass at lowHz followed by a one-pole low-pass at highHz, per
// axis. Filters reset on each stroke so a pen-up gap never rings into the next
// one. Returns RMS displacement in box-height units.
function bandpassRms(strokes, lowHz, highHz) {
  let sum = 0;
  let n = 0;
  for (const stroke of strokes) {
    const pts = stroke.points;
    if (pts.length < 3) continue;
    let hpX = 0;
    let hpY = 0;
    let lpX = 0;
    let lpY = 0;
    let prev = pts[0];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      const dt = (p.t - prev.t) / 1000;
      if (!(dt > 0) || dt > 0.2) {
        prev = p;
        continue;
      }
      const a = 1 / (1 + 2 * Math.PI * lowHz * dt);
      hpX = a * (hpX + p.x - prev.x);
      hpY = a * (hpY + p.y - prev.y);
      const b = (2 * Math.PI * highHz * dt) / (1 + 2 * Math.PI * highHz * dt);
      lpX += b * (hpX - lpX);
      lpY += b * (hpY - lpY);
      sum += lpX * lpX + lpY * lpY;
      n++;
      prev = p;
    }
  }
  return n ? Math.sqrt(sum / n) : 0;
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
