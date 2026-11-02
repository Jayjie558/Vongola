import { CONFIG } from './config.js';

const MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/';

export async function startTracking({ video, onResults }) {
  const Hands = window.Hands;
  if (typeof Hands === 'undefined') {
    throw new Error('MediaPipe Hands 未加载（检查网络/CDN）');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  const hands = new Hands({ locateFile: (file) => MP_BASE + file });
  hands.setOptions({
    maxNumHands: CONFIG.maxHands,
    modelComplexity: 0,
    minDetectionConfidence: CONFIG.minDetectionConfidence,
    minTrackingConfidence: CONFIG.minTrackingConfidence,
  });
  hands.onResults(onResults);

  if (typeof hands.initialize === 'function') {
    try {
      await hands.initialize();
    } catch (err) {
      console.warn('Hands.initialize failed, will initialize on first send:', err);
    }
  }

  const interval = 1000 / CONFIG.targetFps;
  let lastSend = 0;
  let busy = false;

  function pump(now) {
    if (!busy && now - lastSend >= interval && video.readyState >= 2) {
      busy = true;
      lastSend = now;
      Promise.resolve(hands.send({ image: video }))
        .catch((err) => console.error('hands.send:', err))
        .finally(() => { busy = false; });
    }
    requestAnimationFrame(pump);
  }
  requestAnimationFrame(pump);

  return hands;
}
