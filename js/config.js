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

  // Fist ignition: ignite below ON openness, extinguish above OFF, and a
  // gesture must hold for `gestureDebounce` seconds before it switches.
  fireOnOpenness: 0.35,
  fireOffOpenness: 0.55,
  gestureDebounce: 0.12,
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

  exposure: 1.05,

  // Bloom reads the linear-HDR frame, so only the flame clears the threshold.
  bloomStrength: 0.5,
  bloomRadius: 0.2,
  bloomThreshold: 1.3,
};
