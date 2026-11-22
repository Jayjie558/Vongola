// 魔言书写: in write mode the extended index fingertip leaves a thin sky-flame
// trail on the frontmost screen plane. Everything here is screen-space (pixels
// from coords.lmToPixel) on purpose: MediaPipe's z is far too noisy to write
// with, and the user asked for the "no z" plane closest to the viewer.
//
// This module is display-only. The smoothed points are for drawing; any
// measurement must read the raw landmarks (see measure.js).
import { CONFIG } from './config.js';
import { lmToPixel } from './coords.js';
import { isWriteGesture } from './gesture.js';
import { buildWritingGuide, makeGuideBox } from './writing-guide.js';

const INDEX_TIP = 8;
const WRIST = 0;
const MIDDLE_MCP = 9;

function smoothAlpha(hz, dt) {
  return 1 - Math.exp(-hz * dt);
}

function makeTipSprite() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255, 246, 214, 0.95)');
  grad.addColorStop(0.24, 'rgba(255, 196, 96, 0.62)');
  grad.addColorStop(0.58, 'rgba(255, 112, 22, 0.2)');
  grad.addColorStop(1, 'rgba(255, 80, 10, 0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(r, r, r, 0, Math.PI * 2);
  g.fill();
  return c;
}

// Small additive sprite for embers; fresh embers use the hot one, old ones
// cool to the deep orange one before they die.
function makeEmberSprite(inner, mid) {
  const size = 32;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.4, mid);
  grad.addColorStop(1, 'rgba(255, 70, 8, 0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(r, r, r, 0, Math.PI * 2);
  g.fill();
  return c;
}

export class InkWriter {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.enabled = false;
    this.time = 0;
    this.strokes = [];
    this.embers = [];
    this.pens = new Map();
    this.tipSprite = makeTipSprite();
    this.hotEmber = makeEmberSprite('rgba(255, 248, 220, 1)', 'rgba(255, 186, 80, 0.65)');
    this.coolEmber = makeEmberSprite('rgba(255, 196, 96, 0.85)', 'rgba(255, 96, 16, 0.45)');
    this.seed = 0;
    this.guideDigit = null;
    this.guide = null;
    // Why strokes ended: useful when a real hand reports mysterious gaps.
    this.breaks = { lift: 0, grace: 0, lost: 0, jump: 0, cap: 0 };
    this.resize();
    this.clear();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.cw = window.innerWidth;
    this.ch = window.innerHeight;
    this.canvas.width = Math.round(this.cw * dpr);
    this.canvas.height = Math.round(this.ch * dpr);
    this.canvas.style.width = this.cw + 'px';
    this.canvas.style.height = this.ch + 'px';
    this._buildGuide();
  }

  // Trace target for 描红数字; null hides it. Rebuilt on resize so the box
  // always matches the current window while no task is recording.
  setGuideDigit(digit) {
    this.guideDigit = digit == null ? null : String(digit);
    this._buildGuide();
  }

  _buildGuide() {
    this.guide = this.guideDigit
      ? buildWritingGuide(this.guideDigit, makeGuideBox(this.cw, this.ch))
      : null;
  }

  // Serialized into the session so protocols.js can score the trace offline.
  getGuideMeta() {
    const g = this.guide;
    if (!g) return null;
    return {
      digit: g.digit,
      box: { ...g.box },
      points: g.points,
      tolerance: g.tolerance,
    };
  }

  setEnabled(on) {
    if (this.enabled === on) return;
    this.enabled = on;
    this.clear();
  }

  clear() {
    this.strokes.length = 0;
    this.embers.length = 0;
    this.pens.clear();
    if (!this.ctx) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // Frame update. `slotList` is HandRig.slotList; only slots whose debounced
  // gesture is a writing pose lay ink. Pen up is hysteretic:
  //  - open / fist are deliberate lifts and end the stroke at once;
  //  - an unclassified label, a flicker to another gesture, or a missing
  //    landmark only ends the stroke after `inkPenUpGraceMs`. Within that
  //    window the same stroke resumes instead of leaving a visible gap.
  update(dt, view, slotList, time, enabled) {
    this.time = time;
    if (!enabled) return;

    const now = time * 1000;
    for (const slot of slotList) {
      const pen = this._pen(slot);
      const lms = slot.lastLms;
      const label = slot.gesture ? slot.gesture.label : 'none';
      const pointing = !!lms && isWriteGesture(label);
      pen.tip = lms ? lmToPixel(lms[INDEX_TIP], view) : null;

      if (!lms) {
        pen.graceMs = (pen.graceMs || 0) + dt * 1000;
        if (pen.down && pen.graceMs > CONFIG.inkPenUpGraceMs) this._end(pen, now, 'lost');
        continue;
      }

      if (!pointing) {
        if (pen.down) {
          if (label === 'open' || label === 'fist') {
            this._end(pen, now, 'lift');
          } else {
            pen.graceMs = (pen.graceMs || 0) + dt * 1000;
            if (pen.graceMs > CONFIG.inkPenUpGraceMs) this._end(pen, now, 'grace');
          }
        }
        continue;
      }
      pen.graceMs = 0;

      const raw = pen.tip;
      const wrist = lmToPixel(lms[WRIST], view);
      const mcp = lmToPixel(lms[MIDDLE_MCP], view);
      const handSize = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y) || 100;

      if (!pen.down) {
        this._start(pen, raw, now);
        continue;
      }

      const jump = Math.hypot(raw.x - pen.lastRaw.x, raw.y - pen.lastRaw.y);
      if (jump > handSize * CONFIG.inkJumpHandSizes) {
        this._end(pen, now, 'jump');
        this._start(pen, raw, now);
        continue;
      }
      pen.lastRaw.x = raw.x;
      pen.lastRaw.y = raw.y;

      const a = smoothAlpha(CONFIG.inkSmoothHz, dt);
      pen.smooth.x += (raw.x - pen.smooth.x) * a;
      pen.smooth.y += (raw.y - pen.smooth.y) * a;

      const stroke = pen.stroke;
      const points = stroke.points;
      if (points.length >= CONFIG.inkMaxPoints) {
        // Absurdly long continuous stroke: close it and keep writing.
        this._end(pen, now, 'cap');
        this._start(pen, raw, now);
        continue;
      }
      const last = points[points.length - 1];
      if (Math.hypot(pen.smooth.x - last.x, pen.smooth.y - last.y) >= 1.2) {
        points.push({ x: pen.smooth.x, y: pen.smooth.y });
      }
    }

    this._shed(dt, slotList);
    this._updateEmbers(dt, time);
    this._expire(now);
    this._draw(now, slotList);
  }

  _pen(slot) {
    let pen = this.pens.get(slot.name);
    if (!pen) {
      pen = {
        down: false,
        smooth: null,
        lastRaw: null,
        stroke: null,
        tip: null,
        spawn: 0,
        graceMs: 0,
      };
      this.pens.set(slot.name, pen);
    }
    return pen;
  }

  // Embers are purely decorative and live in screen space like the ink. While
  // drawing they come from the fresh end of the stroke (not just the tip), so
  // the whole line appears to smoulder.
  _shed(dt, slotList) {
    for (const slot of slotList) {
      const pen = this.pens.get(slot.name);
      if (!pen || !pen.tip || !isWriteGesture(slot.gesture.label)) {
        if (pen) pen.spawn = 0;
        continue;
      }
      const rate = pen.down ? CONFIG.inkEmberRate : CONFIG.inkEmberRateHover;
      pen.spawn += rate * dt;
      while (pen.spawn >= 1) {
        pen.spawn -= 1;
        let src = pen.tip;
        const pts = pen.stroke?.points;
        if (pen.down && pts && pts.length > 8 && Math.random() < 0.55) {
          src = pts[pts.length - 1 - Math.floor(Math.random() * Math.min(40, pts.length))];
        }
        this._spawnEmber(src);
      }
    }
  }

  _spawnEmber(p) {
    if (this.embers.length >= CONFIG.inkEmberMax) return;
    const life = 0.45 + Math.random() * 0.7;
    this.embers.push({
      x: p.x + (Math.random() - 0.5) * 10,
      y: p.y + (Math.random() - 0.5) * 10,
      vx: (Math.random() - 0.5) * 34,
      vy: -(26 + Math.random() * 60),
      life,
      maxLife: life,
      size: 1.8 + Math.random() * 3.2,
      phase: Math.random() * Math.PI * 2,
    });
  }

  _updateEmbers(dt, time) {
    const drag = Math.exp(-1.4 * dt);
    for (const e of this.embers) {
      e.life -= dt;
      e.x += (e.vx + Math.sin(time * 3.1 + e.phase) * 9) * dt;
      e.y += e.vy * dt;
      e.vx *= drag;
      e.vy -= 7 * dt; // buoyancy
    }
    this.embers = this.embers.filter(
      (e) => e.life > 0 && e.y > -40 && e.x > -40 && e.x < this.cw + 40,
    );
  }

  _start(pen, p, now) {
    pen.down = true;
    pen.graceMs = 0;
    pen.smooth = { x: p.x, y: p.y };
    pen.lastRaw = { x: p.x, y: p.y };
    const stroke = {
      points: [{ x: p.x, y: p.y }],
      start: now,
      end: 0,
      seed: ++this.seed,
    };
    pen.stroke = stroke;
    this.strokes.push(stroke);
    while (this.strokes.length > CONFIG.inkMaxStrokes) this.strokes.shift();
  }

  _end(pen, now, reason = null) {
    if (!pen.down) return;
    pen.down = false;
    pen.graceMs = 0;
    if (reason) this.breaks[reason] = (this.breaks[reason] || 0) + 1;
    if (pen.stroke) pen.stroke.end = now;
    pen.stroke = null;
    pen.smooth = null;
    pen.lastRaw = null;
  }

  _expire(now) {
    const dead = CONFIG.inkFadeAfterMs + CONFIG.inkFadeMs;
    this.strokes = this.strokes.filter((s) => !s.end || now - s.end < dead);
  }

  // 0..1, 1 while drawing; completed strokes hold for a while, then fade.
  _alpha(stroke, now) {
    if (!stroke.end) return 1;
    const age = now - stroke.end;
    if (age <= CONFIG.inkFadeAfterMs) return 1;
    return Math.max(0, 1 - (age - CONFIG.inkFadeAfterMs) / CONFIG.inkFadeMs);
  }

  _draw(now, slotList) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cw, this.ch);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Faint trace target, below the flame so the patient's ink stays readable.
    if (this.guide) {
      const g = this.guide;
      ctx.globalAlpha = 0.82 + 0.18 * Math.sin(now * 0.002);
      ctx.drawImage(
        g.display,
        g.box.cx - g.box.w / 2,
        g.box.cy - g.box.h / 2,
        g.box.w,
        g.box.h,
      );
      ctx.globalAlpha = 1;
    }

    for (const stroke of this.strokes) {
      const alpha = this._alpha(stroke, now);
      if (alpha <= 0) continue;
      const pts = stroke.points;
      // Slow per-stroke flicker keeps the line alive without wobbling it.
      const flick = 0.9 + 0.1 * Math.sin(now * 0.012 + stroke.seed * 1.7);

      if (pts.length < 2) {
        this._dot(ctx, pts[0], alpha);
        continue;
      }

      const w = CONFIG.inkWidthScale;
      ctx.globalCompositeOperation = 'lighter';
      this._line(ctx, pts, 13 * w, 'rgba(255, 86, 10, ' + (0.09 * alpha * flick) + ')');
      this._line(ctx, pts, 6.5 * w, 'rgba(255, 132, 28, ' + (0.2 * alpha * flick) + ')');

      ctx.globalCompositeOperation = 'source-over';
      this._line(ctx, pts, 2.6 * w, 'rgba(255, 210, 140, ' + (0.9 * alpha) + ')');
      this._line(ctx, pts, 1.05 * w, 'rgba(255, 248, 226, ' + (0.96 * alpha) + ')');
    }

    // Embers rising off the fresh part of the line: hot while young, cooling
    // to deep orange as they die.
    ctx.globalCompositeOperation = 'lighter';
    for (const e of this.embers) {
      const f = Math.max(0, Math.min(1, e.life / e.maxLife));
      const r = e.size * (1.5 + 0.7 * (1 - f));
      ctx.globalAlpha = 0.22 + 0.68 * f;
      ctx.drawImage(f > 0.55 ? this.hotEmber : this.coolEmber, e.x - r, e.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // Pen glow at each index fingertip: ember while pointing, brighter when
    // a stroke is actually being laid down.
    for (const slot of slotList) {
      const pen = this.pens.get(slot.name);
      if (!pen || !pen.tip || !isWriteGesture(slot.gesture.label)) continue;
      const pulse = 1 + 0.12 * Math.sin(now * 0.02 + (slot.name === 'left' ? 0 : 2));
      const r = (pen.down ? 34 : 24) * pulse;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.tipSprite, pen.tip.x - r, pen.tip.y - r, r * 2, r * 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(255, 250, 232, 0.9)';
      ctx.beginPath();
      ctx.arc(pen.tip.x, pen.tip.y, pen.down ? 2.2 : 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  _line(ctx, pts, width, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  _dot(ctx, p, alpha) {
    const w = CONFIG.inkWidthScale;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255, 130, 30, ' + (0.35 * alpha) + ')';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5 * w, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(255, 245, 220, ' + (0.9 * alpha) + ')';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.8 * w, 0, Math.PI * 2);
    ctx.fill();
  }
}
