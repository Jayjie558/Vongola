export const CONFIG = {
  // 'glow': a closed fist only makes the glove glow. 'flame': the sphere flame.
  defaultMode: 'glow',
  gloveGlowColor: 0xffa64d,
  gloveGlowStrength: 1.0,
  gloveGlowPower: 2.0,
  gloveGlowPulse: 0.12,
  // 零点突破: a much stronger, broader glove glow flashing once per second.
  gloveGlowZeroStrength: 3.6,
  gloveGlowZeroBlinkHz: 1,
  gloveGlowZeroPower: 1.25,

  targetFps: 30,
  maxHands: 2,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.4,

  // keep the glove on screen briefly when detection drops out
  handLostMs: 350,

  // MediaPipe's normalized z is roughly in x units; 1 is usually right
  zGain: 1.0,

  rootSmooth: 0.38,
  boneSmooth: 0.5,

  // The legacy MediaPipe Hands solution assumes a mirrored (selfie) input.
  // We feed it the raw camera frame, so the handedness labels come out
  // swapped; flip them back. The on-screen button can override at runtime.
  swapHandedness: true,

  // Ignition is the gesture layer's debounced `fist` label. Openness still
  // scales the flame: at `fireOffOpenness` it reaches full size.
  fireOffOpenness: 0.55,
  fireOpacity: 0.6,

  // Gesture layer: per-finger curl (0 = straight, 1 = folded). A finger counts
  // as curled above CURLED and extended again below EXTENDED; a gesture must
  // hold for `gestureDebounce` seconds before it is reported.
  gestureSmooth: 12,
  gestureCurlCurled: 0.62,
  gestureCurlExtended: 0.42,
  gestureCurlFull: 4.2,
  gestureDebounce: 0.15,
  gestureThumbUpRatio: 0.35,

  // 零点突破: the hands' corresponding fingertips meet (left thumb against
  // right thumb, left index against right index) in a roughly mirrored shape.
  // Distances are in hand-size units (wrist -> middle knuckle).
  zeroContactOn: 0.4,
  zeroContactOff: 0.6,
  zeroSymmetry: 0.5,
  zeroMinApart: 0.9,
  zeroMaxHeightDiff: 0.8,

  // Raw recording (M key to start/stop): 30 Hz keeps a 5-minute session at 9k
  // samples. Raise the rate if a later tremor analysis needs more detail.
  measureHz: 30,
  measureMaxSamples: 9000,

  // Guided measurement protocols: a lead-in countdown, then a fixed-length
  // task window. Analyzers live in js/protocols.js and run on the same raw
  // samples, so the thresholds below only affect the derived metrics.
  protocolLeadIn: 3,
  protocolSeconds: 10,
  metricCoverageMin: 0.35,
  metricCycleSmoothMs: 80,
  metricRotationSmoothMs: 120,
  // Signal amplitude is in hand-size units (wrist -> middle knuckle).
  metricCycleMinAmplitude: 0.12,
  // Rotation must swing at least this far before it counts as a turn.
  metricRotationMinSwing: 0.26, // ~15 degrees, radians
  metricRefractoryMs: 100,
  // Intervals longer than this are tracking dropouts, not rhythm information.
  metricMaxIntervalMs: 2000,

  // Always-on tremor view: palm-center motion high-passed to remove voluntary
  // drift. Amplitude is normalized by hand size (wrist -> middle knuckle), so
  // it does not depend on camera distance. 30 Hz sampling resolves ~2-12 Hz.
  tremorWindowMs: 5000,
  tremorCutoffHz: 2,
  tremorFreqMin: 2,
  tremorFreqMax: 12,
  // Below this filtered RMS (hand units), do not report a frequency: it is
  // sensor noise rather than a tremor.
  tremorFreqMinAmplitude: 0.0015,
  tremorScaleFloor: 0.004,

  exposure: 1.05,

  // Bloom reads the linear-HDR frame, so only the flame clears the threshold.
  bloomStrength: 0.5,
  bloomRadius: 0.2,
  bloomThreshold: 1.3,
};
