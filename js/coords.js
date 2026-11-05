// One mapping from MediaPipe's normalized landmarks to the screen.
//
// The video is drawn with a "cover" fit: scaled until it covers the window and
// centered, so it overflows on one axis. The glove retarget, the 2D fire canvas,
// the gesture math and the selftest all have to agree on that transform; when
// they drift apart the flame separates from the hand. Keep the formula here.
import * as THREE from 'three';
import { CONFIG } from './config.js';

export function computeView(video) {
  const cw = window.innerWidth;
  const ch = window.innerHeight;
  const vw = video?.videoWidth || 640;
  const vh = video?.videoHeight || 480;
  const scale = Math.max(cw / vw, ch / vh);
  const rw = vw * scale;
  const rh = vh * scale;
  return { cw, ch, rw, rh, ox: (cw - rw) / 2, oy: (ch - rh) / 2 };
}

// Normalized landmark -> CSS pixel on the mirrored, cover-fitted frame.
export function lmToPixel(lm, view) {
  return {
    x: (1 - lm.x) * view.rw + view.ox,
    y: lm.y * view.rh + view.oy,
  };
}

// Equal-scale 2D points for angle/distance math (x right, y down).
export function lmToAspect(lm, view) {
  if (!view || !view.rw || !view.rh) return { x: 1 - lm.x, y: lm.y };
  const p = lmToPixel(lm, view);
  return { x: p.x / view.rh, y: p.y / view.rh };
}

// Scene units: x in [-cw/2, cw/2] / ch, y up, z from MediaPipe.
export function lmToWorld(lm, view) {
  const p = lmToPixel(lm, view);
  return new THREE.Vector3(
    (p.x - view.cw * 0.5) / view.ch,
    (view.ch * 0.5 - p.y) / view.ch,
    -lm.z * (view.rw / view.ch) * CONFIG.zGain,
  );
}

export function worldToPixel(p, view) {
  return {
    x: p.x * view.ch + view.cw * 0.5,
    y: view.ch * 0.5 - p.y * view.ch,
    z: p.z ?? 0,
  };
}

export function pixelToWorld(p, view) {
  return new THREE.Vector3(
    (p.x - view.cw * 0.5) / view.ch,
    (view.ch * 0.5 - p.y) / view.ch,
    p.z ?? 0,
  );
}

// Inverse of lmToWorld, used by the synthetic selftest poses.
export function worldToLm(p, view) {
  const px = worldToPixel(p, view);
  return {
    x: 1 - (px.x - view.ox) / view.rw,
    y: (px.y - view.oy) / view.rh,
    z: -p.z * view.ch / (view.rw * CONFIG.zGain),
  };
}
