// Minimal measurement layer: record the raw landmark time series with enough
// metadata to re-run analysis later. No clinical metrics or scores here.
import { CONFIG } from './config.js';

const VERSION = 1;
const COORDINATE_SPACE = 'mediapipe-normalized; x unmirrored, y down, z relative';
const HANDEDNESS_NOTE = 'samples.left/right are real hands; hand.label is the raw MediaPipe handedness';

export class SessionRecorder {
  constructor({ video, hz = CONFIG.measureHz, maxSamples = CONFIG.measureMaxSamples } = {}) {
    this.video = video;
    this.sampleInterval = 1000 / hz;
    this.maxSamples = maxSamples;
    this.active = false;
    this.protocol = 'free';
    this.meta = null;
    this.samples = [];
    this.lastSampleT = null;
  }

  start(protocol = 'free') {
    if (this.active) return;
    this.active = true;
    this.protocol = protocol;
    this.samples = [];
    this.lastSampleT = null;
    this.meta = {
      version: VERSION,
      protocol,
      coordinateSpace: COORDINATE_SPACE,
      handednessNote: HANDEDNESS_NOTE,
      startedAt: new Date().toISOString(),
      environment: {
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio || 1,
        screen: [window.screen.width, window.screen.height],
        video: [this.video?.videoWidth || 640, this.video?.videoHeight || 480],
      },
      tracking: {
        targetFps: CONFIG.targetFps,
        handLostMs: CONFIG.handLostMs,
        zGain: CONFIG.zGain,
      },
    };
  }

  stop() {
    if (!this.active) return null;
    this.active = false;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    return {
      ...this.meta,
      endedAt: new Date().toISOString(),
      sampleCount: this.samples.length,
      durationMs: first && last ? last.t - first.t : 0,
      samples: this.samples,
    };
  }

  toggle(protocol) {
    if (this.active) return this.stop();
    this.start(protocol);
    return null;
  }

  // Called once per rendered frame; internal rate limiting keeps the buffer at
  // `hz` even though the render loop runs faster.
  record(now, view, slotList) {
    if (!this.active || this.samples.length >= this.maxSamples) return false;
    if (this.lastSampleT !== null && now - this.lastSampleT < this.sampleInterval) return false;

    const dt = this.lastSampleT === null ? 0 : now - this.lastSampleT;
    this.lastSampleT = now;
    const sample = { t: now, dt, cw: view.cw, ch: view.ch, left: null, right: null };
    for (const slot of slotList) sample[slot.name] = handSample(slot, now);
    this.samples.push(sample);
    return true;
  }
}

function handSample(slot, now) {
  if (!slot.lastLms) return null;
  // lastInput is what this frame actually rendered: a live detection or a
  // synthetic selftest pose. A stale detection may still be held by the glove.
  const input = slot.lastInput;
  return {
    label: input ? input.label : null,
    score: input && input.score != null ? Math.round(input.score * 1e4) / 1e4 : null,
    ageMs: input && input.t != null ? Math.max(0, Math.round(now - input.t)) : 0,
    landmarks: slot.lastLms.map((p) => [
      Math.round(p.x * 1e5) / 1e5,
      Math.round(p.y * 1e5) / 1e5,
      Math.round(p.z * 1e5) / 1e5,
    ]),
  };
}

export function downloadSession(data) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = data.startedAt.replace(/[:.]/g, '-');
  a.href = url;
  a.download = `glovear-session-${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
