export const CONFIG = {
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

  exposure: 1.05,

  // Bloom reads the linear-HDR frame, so only the flame clears the threshold.
  bloomStrength: 0.5,
  bloomRadius: 0.2,
  bloomThreshold: 1.3,
};
