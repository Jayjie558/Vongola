// Vongola sky flame: fist ignites, open palm extinguishes. Rendered on a 2D
// canvas above the WebGL glove, anchored to the tracked hand landmarks.
import { CONFIG } from './config.js';

const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
const TIPS = [4, 8, 12, 16, 20];
const PALM_VERTS = [0, 5, 9, 13, 17];

const SPRITE_SIZE = 64;
const SPRITE_STEP = 16;
const ALPHA_STEP = 0.25;
const MAX_EMBERS = 1200;
const MAX_SPARKS = 500;
const MAX_BURST = 300;

function flicker(seed, t, freq) {
  return Math.sin(seed * 12.9898 + t * freq) * Math.cos(seed * 78.233 + t * freq * 1.7) * 0.5
    + Math.sin(seed * 43.117 + t * freq * 0.6) * 0.3
    + Math.cos(seed * 17.791 + t * freq * 2.1) * 0.2;
}

// ── Cached sprite blitting (baking the gradients once is what keeps this fast) ──
const spriteCache = {};

function quantizeChannel(v) {
  v = Math.max(0, Math.min(255, v | 0));
  return Math.floor(v / SPRITE_STEP) * SPRITE_STEP;
}

function getFlameSprite(ir, ig, ib, or, og, ob, outerAlpha) {
  ir = quantizeChannel(ir); ig = quantizeChannel(ig); ib = quantizeChannel(ib);
  or = quantizeChannel(or); og = quantizeChannel(og); ob = quantizeChannel(ob);
  outerAlpha = Math.round(Math.max(0, Math.min(1, outerAlpha)) / ALPHA_STEP) * ALPHA_STEP;
  const key = ir + '_' + ig + '_' + ib + '_' + or + '_' + og + '_' + ob + '_' + outerAlpha;
  let s = spriteCache[key];
  if (!s) {
    s = document.createElement('canvas');
    s.width = SPRITE_SIZE;
    s.height = SPRITE_SIZE;
    const g = s.getContext('2d');
    const r = SPRITE_SIZE / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'rgba(' + ir + ',' + ig + ',' + ib + ',1)');
    grad.addColorStop(0.55, 'rgba(' + or + ',' + og + ',' + ob + ',' + outerAlpha + ')');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(r, r, r, 0, Math.PI * 2);
    g.fill();
    spriteCache[key] = s;
  }
  return s;
}

// Set while drawing hand flames; particles below use the full-strength look.
let stampOpacity = 1;

function drawFlameSprite(ctx, x, y, radius, innerAlpha, outerAlpha, ir, ig, ib, or, og, ob) {
  if (innerAlpha <= 0.004 || radius <= 0.5) return;
  const ratio = innerAlpha > 0.001 ? Math.min(1, outerAlpha / innerAlpha) : 0;
  const s = getFlameSprite(ir, ig, ib, or, og, ob, ratio);
  ctx.globalAlpha = Math.min(1, innerAlpha * stampOpacity);
  ctx.drawImage(s, x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = 1;
}

function drawFlameStreak(ctx, x, y, length, width, angle, innerAlpha, outerAlpha, ir, ig, ib, or, og, ob) {
  if (innerAlpha <= 0.004 || length <= 0.5) return;
  const ratio = innerAlpha > 0.001 ? Math.min(1, outerAlpha / innerAlpha) : 0;
  const s = getFlameSprite(ir, ig, ib, or, og, ob, ratio);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = Math.min(1, innerAlpha * stampOpacity);
  ctx.drawImage(s, -length, -width, length * 2, width * 2);
  ctx.restore();
  ctx.globalAlpha = 1;
}

function flameStamp(ctx, x, y, r, ir, ig, ib, innerA, or, og, ob, outerA) {
  drawFlameSprite(ctx, x, y, r * 2.2, innerA, outerA * 0.6, ir, ig, ib, or, og, ob);
}

// ── One hand's flame state ──
export class HandFire {
  constructor(system, name) {
    this.system = system;
    this.name = name;
    this.points = null;
    this.size = 90;
    this.detected = false;
    this.openness = 1;
    this.targetOpenness = 1;
    this.prevOpenness = 1;
    this.palmX = 0;
    this.palmY = 0;
    this.prevPalmX = 0;
    this.prevPalmY = 0;
    this.havePalm = false;
    this.speed = 0;
    this.speedBoost = 0;
    this.intensity = 0;
    this.targetIntensity = 0;
    this.burstEnergy = 0;
    this.firing = false;
    this.igniteHold = 0;
    this.extinguishHold = 0;
  }

  update(dt, view, lms, force = false) {
    const lerpF = 1 - Math.exp(-12 * dt);

    if (lms && view) {
      this.points = lms.map((lm) => ({
        x: (1 - lm.x) * view.rw + view.ox,
        y: lm.y * view.rh + view.oy,
      }));
      this.detected = true;

      const pts = this.points;
      let px = 0, py = 0;
      for (const i of PALM_VERTS) { px += pts[i].x; py += pts[i].y; }
      px /= PALM_VERTS.length;
      py /= PALM_VERTS.length;
      if (!this.havePalm) {
        this.palmX = this.prevPalmX = px;
        this.palmY = this.prevPalmY = py;
        this.havePalm = true;
      }
      this.palmX += (px - this.palmX) * lerpF;
      this.palmY += (py - this.palmY) * lerpF;
      const rawSpeed = Math.hypot(this.palmX - this.prevPalmX, this.palmY - this.prevPalmY)
        / Math.max(dt, 0.001);
      this.speed += (rawSpeed - this.speed) * (1 - Math.exp(-3 * dt));
      this.prevPalmX = this.palmX;
      this.prevPalmY = this.palmY;

      const wrist = pts[0];
      const mcp = pts[9];
      const handSize = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y);
      this.size = handSize;
      if (handSize > 1) {
        let sum = 0;
        for (const i of TIPS) sum += Math.hypot(pts[i].x - wrist.x, pts[i].y - wrist.y);
        const ratio = (sum / TIPS.length) / handSize;
        this.targetOpenness = Math.max(0, Math.min(1, (ratio - 1.0) / 1.2));
      }
    } else {
      this.detected = false;
      this.speed += (0 - this.speed) * (1 - Math.exp(-2 * dt));
    }

    if (force) {
      this.firing = true;
      this.targetIntensity = 0.85;
      this.intensity += (0.85 - this.intensity) * lerpF;
    } else {
      if (this.detected) {
        this.openness += (this.targetOpenness - this.openness) * lerpF;

        // Hysteresis + debounce, so the fire does not flicker around the cutoff.
        if (!this.firing) {
          if (this.openness < CONFIG.fireOnOpenness) {
            this.igniteHold += dt;
            if (this.igniteHold >= CONFIG.gestureDebounce) {
              this.firing = true;
              this.igniteHold = 0;
              this.extinguishHold = 0;
            }
          } else {
            this.igniteHold = 0;
          }
        } else if (this.openness > CONFIG.fireOffOpenness) {
          this.extinguishHold += dt;
          if (this.extinguishHold >= CONFIG.gestureDebounce) {
            this.firing = false;
            this.extinguishHold = 0;
            this.igniteHold = 0;
          }
        } else {
          this.extinguishHold = 0;
        }

        // A fast closing fist is the ignition punch.
        const delta = this.openness - this.prevOpenness;
        if (delta < -0.25 && this.speed > 150) {
          this.burstEnergy = Math.min(1, -delta * 2);
        }
        this.prevOpenness = this.openness;

        this.speedBoost = Math.min(1, this.speed / 1200);
        if (this.firing) {
          const base = Math.max(0, Math.min(1,
            (CONFIG.fireOffOpenness - this.openness) / CONFIG.fireOffOpenness));
          this.targetIntensity = Math.min(0.9, base * 1.3 + this.speedBoost * 0.5 + this.burstEnergy);
        } else {
          this.targetIntensity = 0;
        }
      } else {
        this.firing = false;
        this.igniteHold = 0;
        this.extinguishHold = 0;
        this.targetIntensity = 0;
      }
      this.burstEnergy += (0 - this.burstEnergy) * (1 - Math.exp(-3 * dt));
      this.intensity += (this.targetIntensity - this.intensity) * lerpF;
    }

    if (this.points && this.intensity > 0.05) {
      const eff = Math.min(1, this.intensity + this.speedBoost * 0.35);
      this.system.spawnEmbers(this, eff, dt);
      if (this.intensity > 0.25) this.system.spawnSparks(this, eff, dt);
    }
    if (this.points && this.burstEnergy > 0.3) {
      this.system.spawnBurst(this, this.burstEnergy);
      this.burstEnergy *= 0.5;
    }
  }

  draw(ctx, time) {
    if (this.intensity <= 0.02 || !this.points) return;
    renderHandFlame(ctx, this, time);
  }
}

// ── Flame pixels for one hand ──
function renderHandFlame(ctx, hand, time) {
  const I = hand.intensity + Math.min(1, hand.speed / 1200) * 0.3;
  const pts = hand.points;
  const palm = pts[9];
  stampOpacity = CONFIG.fireOpacity;
  ctx.globalCompositeOperation = 'lighter';

  // Aura layers
  for (let k = 0; k < 4; k++) {
    const r = [140, 330, 570, 840][k] * I;
    const a = [0.7, 0.35, 0.14, 0.05][k] * I * CONFIG.fireOpacity;
    const g = ctx.createRadialGradient(palm.x, palm.y, 0, palm.x, palm.y, r);
    g.addColorStop(0, 'rgba(255,' + (220 - k * 30) + ',' + Math.min(20 + k * 8, 50) + ',' + a + ')');
    g.addColorStop(0.5, 'rgba(255,' + (120 - k * 20) + ',' + Math.min(5 + k * 3, 20) + ',' + (a * 0.4) + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(palm.x, palm.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Fingertip glow
  for (const tipIdx of TIPS) {
    const tp = pts[tipIdx];
    const tr = (70 + I * 60) * I;
    const tg = ctx.createRadialGradient(tp.x, tp.y, 0, tp.x, tp.y, tr);
    tg.addColorStop(0, 'rgba(255,250,210,' + (0.6 * I * CONFIG.fireOpacity) + ')');
    tg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = tg;
    ctx.beginPath();
    ctx.arc(tp.x, tp.y, tr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Bone cells
  for (const [ai, bj] of BONES) {
    const a = pts[ai];
    const b = pts[bj];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 2) continue;
    const seed = ai * 7 + bj * 13;
    for (let s = 0; s < 14; s++) {
      const f = s / 13;
      const bx = a.x + (b.x - a.x) * f + flicker(seed + s * 3, time, 8) * len * 0.4;
      const by = a.y + (b.y - a.y) * f + flicker(seed + s * 7 + 50, time, 10) * len * 0.25;
      flameStamp(ctx, bx, by, (30 + Math.random() * 45) * I,
        255, 55, 10, 0.5 * I, 150, 8, 15, 0.22 * I);
    }
    for (let s = 0; s < 10; s++) {
      const f = s / 9;
      const bx = a.x + (b.x - a.x) * f + flicker(seed + s * 5, time, 12) * len * 0.22;
      const by = a.y + (b.y - a.y) * f + flicker(seed + s * 11 + 30, time, 14) * len * 0.12;
      const mh = flicker(seed + s, time, 2) * 0.5 + 0.5;
      const mG = Math.floor(120 + mh * 100);
      const mB = Math.floor(3 + mh * 35);
      flameStamp(ctx, bx, by, (18 + Math.random() * 28) * I,
        255, mG, mB, 0.58 * I, 255, Math.floor(40 + mh * 45), Math.floor(mh * 12), 0.35 * I);
    }
    for (let s = 0; s < 7; s++) {
      const f = s / 6;
      const bx = a.x + (b.x - a.x) * f + flicker(seed + s * 9, time, 16) * len * 0.1;
      const by = a.y + (b.y - a.y) * f + flicker(seed + s * 13 + 15, time, 18) * len * 0.05;
      flameStamp(ctx, bx, by, (7 + Math.random() * 14) * I,
        255, 255, 210, 0.75 * I, 255, 220, 40, 0.42 * I);
    }
  }

  // Joint flames
  const knuckles = [5, 9, 13, 17];
  for (let ji = 0; ji < 21; ji++) {
    const jp = pts[ji];
    const density = (ji === 0 || knuckles.includes(ji)) ? 20 : 7;
    for (let s = 0; s < density; s++) {
      const spread = ji === 0 ? 30 : 13;
      const fx = jp.x + flicker(ji * 31 + s, time, 9) * spread;
      const fy = jp.y + flicker(ji * 37 + s, time, 8) * spread;
      const isCore = ji <= 12;
      const cG = isCore ? Math.floor(180 + Math.random() * 75) : Math.floor(100 + Math.random() * 100);
      const cB = isCore ? Math.floor(Math.random() * 50) : Math.floor(Math.random() * 30);
      flameStamp(ctx, fx, fy, (7 + Math.random() * 20) * I,
        255, cG, cB, 0.7 * I, 255, Math.floor(cG * 0.5), cB, 0.25 * I);
    }
  }

  // Palm surface fire
  let pcx = 0, pcy = 0;
  for (const vi of PALM_VERTS) { pcx += pts[vi].x; pcy += pts[vi].y; }
  pcx /= PALM_VERTS.length;
  pcy /= PALM_VERTS.length;
  for (let s = 0; s < 140; s++) {
    const vi = PALM_VERTS[(Math.random() * PALM_VERTS.length) | 0];
    const t2 = Math.random();
    const fx = pcx + (pts[vi].x - pcx) * t2 + flicker(s * 13, time, 7) * 8;
    const fy = pcy + (pts[vi].y - pcy) * t2 + flicker(s * 17, time, 6) * 6;
    const edge = Math.random() * t2;
    const cg = Math.floor(140 + edge * 80 + Math.random() * 35);
    const cb = Math.floor(5 + edge * 30 + Math.random() * 25);
    flameStamp(ctx, fx, fy, (9 + Math.random() * 24) * I,
      255, cg, cb, 0.63 * I, 255, Math.floor(cg * 0.55), cb, 0.2 * I);
  }
  for (let s = 0; s < 30; s++) {
    const px = pcx + flicker(s * 23, time, 8) * 20;
    const py = pcy + flicker(s * 29, time, 7) * 16;
    flameStamp(ctx, px, py, (12 + Math.random() * 25) * I,
      255, 220 + Math.random() * 35, Math.floor(Math.random() * 50),
      0.68 * I, 255, 180, 40, 0.28 * I);
  }

  // Cross fill
  for (let s = 0; s < 40; s++) {
    const pi = (Math.random() * 21) | 0;
    const pj = (Math.random() * 21) | 0;
    const f = Math.random();
    const fx = pts[pi].x + (pts[pj].x - pts[pi].x) * f + flicker(pi * 7 + pj * 3 + s, time, 6) * 28;
    const fy = pts[pi].y + (pts[pj].y - pts[pi].y) * f + flicker(pi * 11 + pj * 5 + s, time, 5) * 20;
    const ph = flicker(pi + pj + s, time, 3) * 0.5 + 0.5;
    const pG = Math.floor(60 + ph * 120);
    const pB = Math.floor(ph * 30);
    flameStamp(ctx, fx, fy, (14 + Math.random() * 30) * I,
      255, pG, pB, 0.45 * I, Math.floor(180 + ph * 50), Math.floor(5 + ph * 45), Math.floor(ph * 15), 0.18 * I);
  }

  // Wrist / forearm extension
  const wp = pts[0];
  const armDx = wp.x - palm.x;
  const armDy = wp.y - palm.y;
  const armLen = Math.hypot(armDx, armDy) || 1;
  const adx = armDx / armLen;
  const ady = armDy / armLen;
  const forearmLen = 430 * I;
  for (let s = 0; s < 50; s++) {
    const dist = Math.pow(Math.random(), 0.6) * forearmLen;
    const fan = (Math.random() - 0.5) * Math.PI * 0.8;
    const fx = wp.x + adx * dist + -ady * dist * Math.tan(fan) + flicker(s * 31, time, 5) * dist * 0.4;
    const fy = wp.y + ady * dist + adx * dist * Math.tan(fan) + flicker(s * 41, time, 4) * dist * 0.35;
    const heat = Math.max(0, 1 - dist / forearmLen);
    const wHue = flicker(s, time, 2) * 0.3 + 0.5;
    const wIG = Math.floor(120 * heat + 20 + wHue * 30);
    const wIB = Math.floor(15 * heat + wHue * 40);
    const wOR = Math.floor(200 * heat + 5);
    const wOG = Math.floor(20 * heat + wHue * 10);
    const wOB = Math.floor(wHue * 35 * (1 - heat));
    flameStamp(ctx, fx, fy, (12 + Math.random() * 35) * I * heat,
      255, wIG, wIB, 0.45 * heat * I, wOR, wOG, wOB, 0.2 * heat * I);
  }

  // Rising streaks
  for (let s = 0; s < 110; s++) {
    const ref = pts[(Math.random() * 21) | 0];
    const rx = ref.x + flicker(s * 43, time, 7) * 35;
    const ry = ref.y - I * 10 + flicker(s * 47, time, 6) * 25;
    const rl = (90 + Math.random() * 280) * I;
    const rw = (3 + Math.random() * 14) * I;
    const rAngle = -Math.PI / 2 + flicker(s * 13, time, 5) * 0.8;
    const rh = Math.random();
    drawFlameStreak(ctx, rx, ry, rl, rw, rAngle, 0.78 * I, 0.42 * I,
      255, Math.floor(255 - rh * 90), Math.floor(220 - rh * 200),
      Math.floor(255 - rh * 80), Math.floor(160 - rh * 140), Math.floor(30 - rh * 25));
  }

  // Floating shell embers around the hand
  for (let s = 0; s < 36; s++) {
    const ref = pts[(Math.random() * 21) | 0];
    const angle = Math.random() * Math.PI * 2;
    const dist = (60 + Math.random() * 120) * I;
    const sx = ref.x + Math.cos(angle) * dist + flicker(s * 13, time, 5) * 35;
    const sy = ref.y + Math.sin(angle) * dist + flicker(s * 17, time, 4) * 25;
    const sh = flicker(s, time, 1.5) * 0.5 + 0.5;
    const sG = Math.floor(40 + sh * 80);
    const sB = Math.floor(sh * 50);
    flameStamp(ctx, sx, sy, (18 + Math.random() * 35) * I,
      255, sG, sB, 0.35 * I, Math.floor(130 + sh * 60), Math.floor(3 + sh * 25), Math.floor(sh * 45), 0.14 * I);
  }

  ctx.globalCompositeOperation = 'source-over';
  stampOpacity = 1;
}

// Soft gold envelope used when the 3D flame mesh supplies the tongues.
function renderHandAura(ctx, hand, time) {
  const I = hand.intensity + Math.min(1, hand.speed / 1200) * 0.3;
  if (I <= 0.02 || !hand.points) return;
  const pts = hand.points;
  const palm = pts[9];
  const F = CONFIG.fireOpacity;

  ctx.globalCompositeOperation = 'lighter';
  const layers = [
    { r: 210, a: 0.55, c: [255, 232, 165] },
    { r: 460, a: 0.38, c: [255, 178, 80] },
    { r: 760, a: 0.18, c: [255, 112, 24] },
    { r: 1040, a: 0.06, c: [205, 52, 6] },
  ];
  // radii are authored for a ~90px palm; follow the hand when the user moves closer.
  const k = Math.max(0.55, Math.min(1.9, hand.size / 90));
  for (const L of layers) {
    const radius = L.r * k * I;
    const a = L.a * I * F;
    if (radius < 2 || a <= 0.003) continue;
    const g = ctx.createRadialGradient(palm.x, palm.y, 0, palm.x, palm.y, radius);
    g.addColorStop(0, 'rgba(' + L.c[0] + ',' + L.c[1] + ',' + L.c[2] + ',' + a + ')');
    g.addColorStop(0.5, 'rgba(' + L.c[0] + ',' + L.c[1] + ',' + L.c[2] + ',' + a * 0.45 + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(palm.x, palm.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const tipIdx of TIPS) {
    const tp = pts[tipIdx];
    const tr = (54 + I * 48) * I;
    const tg = ctx.createRadialGradient(tp.x, tp.y, 0, tp.x, tp.y, tr);
    tg.addColorStop(0, 'rgba(255,244,200,' + (0.42 * I * F) + ')');
    tg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = tg;
    ctx.beginPath();
    ctx.arc(tp.x, tp.y, tr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// ── Particles ──
class Ember {
  constructor(x, y, vx, vy, size, life) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.size = size; this.life = life; this.maxLife = life;
  }
  update(dt) {
    this.life -= dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy -= 36 * dt;
    this.vx += (Math.random() - 0.5) * 200 * dt;
    this.size *= (1 - 0.7 * dt);
  }
  get dead() { return this.life <= 0 || this.size < 0.3; }
}

class Spark {
  constructor(x, y, vx, vy, size, life, r, g, b) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.size = size; this.life = life; this.maxLife = life;
    this.r = r; this.g = g; this.b = b;
    this.trail = [];
  }
  update(dt) {
    this.life -= dt;
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 4) this.trail.shift();
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= (1 - 2.5 * dt);
    this.vy *= (1 - 2.5 * dt);
    this.size *= (1 - 3 * dt);
  }
  get dead() { return this.life <= 0 || this.size < 0.2; }
}

class Burst {
  constructor(x, y, vx, vy, size, life) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.size = size; this.life = life; this.maxLife = life;
  }
  update(dt) {
    this.life -= dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= (1 - 1.8 * dt);
    this.vy *= (1 - 1.8 * dt);
    this.size *= (1 - 0.5 * dt);
  }
  get dead() { return this.life <= 0; }
}

export class FireSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hands = [];
    this.embers = [];
    this.sparks = [];
    this.bursts = [];
    this.time = 0;
    this.w = 0;
    this.h = 0;
    this.use3dBody = false;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  createHand(name) {
    const hand = new HandFire(this, name);
    this.hands.push(hand);
    return hand;
  }

  spawnEmbers(hand, intensity, dt) {
    const count = Math.floor(intensity * 160 * dt);
    const pts = hand.points;
    for (let i = 0; i < count && this.embers.length < MAX_EMBERS; i++) {
      const p = pts[(Math.random() * 21) | 0];
      const speed = 40 + Math.random() * 220 * intensity;
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.2;
      this.embers.push(new Ember(
        p.x + (Math.random() - 0.5) * 30,
        p.y + (Math.random() - 0.5) * 20,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        8 + Math.random() * 30,
        0.6 + Math.random() * 1.8,
      ));
    }
  }

  spawnSparks(hand, intensity, dt) {
    const count = Math.floor(intensity * 300 * dt);
    const pts = hand.points;
    for (let i = 0; i < count && this.sparks.length < MAX_SPARKS; i++) {
      const p = pts[(Math.random() * 21) | 0];
      const angle = (Math.random() - 0.5) * Math.PI * 2;
      const speed = (80 + Math.random() * 350) * intensity * (1 + hand.speedBoost * 0.6);
      const heat = Math.random();
      this.sparks.push(new Spark(
        p.x + (Math.random() - 0.5) * 25,
        p.y + (Math.random() - 0.5) * 20,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed - speed * 0.6,
        1.2 + Math.random() * 3.5,
        0.25 + Math.random() * 0.65,
        255, Math.floor(180 + heat * 75), Math.floor(heat * 60),
      ));
    }
  }

  spawnBurst(hand, energy) {
    const count = Math.floor(energy * 60);
    const pts = hand.points;
    for (let i = 0; i < count && this.bursts.length < MAX_BURST; i++) {
      const p = pts[(Math.random() * 21) | 0];
      const angle = Math.random() * Math.PI * 2;
      const speed = 200 + Math.random() * 600 * energy;
      const life = 0.5 + Math.random() * 1.2;
      this.bursts.push(new Burst(
        p.x, p.y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed - 100,
        3 + Math.random() * 12,
        life,
      ));
    }
  }

  // Called after every hand has been updated this frame.
  render(dt) {
    this.time += dt;
    const ctx = this.ctx;

    for (const e of this.embers) e.update(dt);
    this.embers = this.embers.filter((e) => !e.dead);
    for (const s of this.sparks) s.update(dt);
    this.sparks = this.sparks.filter((s) => !s.dead);
    for (const b of this.bursts) b.update(dt);
    this.bursts = this.bursts.filter((b) => !b.dead);

    ctx.clearRect(0, 0, this.w, this.h);

    for (const hand of this.hands) {
      if (this.use3dBody) renderHandAura(ctx, hand, this.time);
      else hand.draw(ctx, this.time);
    }

    ctx.globalCompositeOperation = 'lighter';
    for (const e of this.embers) {
      const a = Math.max(0, e.life / e.maxLife);
      drawFlameSprite(ctx, e.x, e.y, e.size, a, a * 0.7, 255, 255, 200, 255, 180, 30);
    }
    for (const s of this.sparks) {
      const a = Math.max(0, s.life / s.maxLife);
      if (s.trail.length > 1) {
        ctx.strokeStyle = 'rgba(' + s.r + ',' + s.g + ',' + s.b + ',' + (a * 0.3) + ')';
        ctx.lineWidth = s.size * 0.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(s.trail[0].x, s.trail[0].y);
        for (let t = 1; t < s.trail.length; t++) ctx.lineTo(s.trail[t].x, s.trail[t].y);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
      }
      drawFlameSprite(ctx, s.x, s.y, s.size * 1.8, a, a * 0.7, 255, 255, 240, s.r, s.g, s.b);
    }
    for (const b of this.bursts) {
      const a = b.life / b.maxLife;
      drawFlameSprite(ctx, b.x, b.y, b.size, a, a * 0.6, 255, 255, 180, 255, 140, 20);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
