// Per-finger curl from MediaPipe's 21 landmarks, then a small debounced gesture
// classifier. MediaPipe already gives the landmarks; this module turns them
// into finger states so the demo can react to more than just fist vs open.
import { CONFIG } from './config.js';
import { lmToAspect } from './coords.js';

const FINGERS = [
  { name: 'thumb', joints: [1, 2, 3, 4] },
  { name: 'index', joints: [5, 6, 7, 8] },
  { name: 'middle', joints: [9, 10, 11, 12] },
  { name: 'ring', joints: [13, 14, 15, 16] },
  { name: 'pinky', joints: [17, 18, 19, 20] },
];
const FINGER_NAMES = FINGERS.map((f) => f.name);

export const GESTURE_LABELS = {
  fist: '握拳',
  open: '张手',
  point: '指向',
  victory: '比耶',
  thumbs_up: '点赞',
  six: '六',
  gun: '手枪',
  gun_variant: '改枪',
  none: '—',
};

// Bend at b in radians: 0 when a-b-c are straight, grows as the joint folds.
function bendAt(a, b, c) {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const l1 = Math.hypot(v1x, v1y);
  const l2 = Math.hypot(v2x, v2y);
  if (l1 < 1e-6 || l2 < 1e-6) return 0;
  const cos = (v1x * v2x + v1y * v2y) / (l1 * l2);
  return Math.PI - Math.acos(Math.max(-1, Math.min(1, cos)));
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function toPoints(lms, view) {
  return lms.map((lm) => lmToAspect(lm, view));
}

function dist2(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Total bend of the three joints, normalized so a folded finger reads ~1.
function fingerCurl(pts, joints, wrist, fullBend) {
  const total = bendAt(wrist, pts[joints[0]], pts[joints[1]])
    + bendAt(pts[joints[0]], pts[joints[1]], pts[joints[2]])
    + bendAt(pts[joints[1]], pts[joints[2]], pts[joints[3]]);
  return clamp01(total / fullBend);
}

export class HandGesture {
  constructor(name = 'hand') {
    this.name = name;
    this.detected = false;
    this.label = 'none';
    this.candidate = 'none';
    this.hold = 0;
    this.initialized = false;
    this.curls = { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 };
    this.extended = { thumb: true, index: true, middle: true, ring: true, pinky: true };
    this.handSize = 0;
    this.debug = null;
  }

  reset() {
    this.detected = false;
    this.label = 'none';
    this.candidate = 'none';
    this.hold = 0;
    this.initialized = false;
  }

  /**
   * @param {number} dt seconds since the last call
   * @param {Array|null} lms 21 MediaPipe normalized landmarks, null when the hand is lost
   * @param {object|null} view covered-video rect, used to undo the aspect squeeze
   */
  update(dt, lms, view = null) {
    if (!lms || lms.length < 21) {
      this.detected = false;
      this._step('none', dt);
      return;
    }

    const pts = toPoints(lms, view);
    this.detected = true;
    const wrist = pts[0];
    this.handSize = Math.hypot(pts[9].x - wrist.x, pts[9].y - wrist.y);

    const k = 1 - Math.exp(-CONFIG.gestureSmooth * dt);
    const raw = {};
    for (const finger of FINGERS) {
      raw[finger.name] = fingerCurl(pts, finger.joints, wrist, CONFIG.gestureCurlFull);
    }
    // Thumb metacarpal is angled off the palm, so the joint sum under-reads a
    // folded thumb. Its tip also comes down near the middle knuckle in a fist.
    const thumbReach = Math.hypot(pts[4].x - pts[9].x, pts[4].y - pts[9].y)
      / Math.max(this.handSize, 1e-6);
    raw.thumb = Math.max(raw.thumb, clamp01((0.8 - thumbReach) / 0.45));

    if (!this.initialized) {
      for (const name of FINGER_NAMES) this.curls[name] = raw[name];
      this.initialized = true;
    } else {
      for (const name of FINGER_NAMES) {
        this.curls[name] += (raw[name] - this.curls[name]) * k;
      }
    }

    // per-finger hysteresis, so a jittering landmark does not flip the state
    for (const name of FINGER_NAMES) {
      const curl = this.curls[name];
      if (this.extended[name] && curl > CONFIG.gestureCurlCurled) this.extended[name] = false;
      else if (!this.extended[name] && curl < CONFIG.gestureCurlExtended) this.extended[name] = true;
    }

    const e = this.extended;

    this._step(this._classify(pts, e), dt);

    this.debug = {
      curls: { ...this.curls },
      extended: { ...e },
    };
  }

  _classify(pts, e) {
    if (e.thumb && !e.index && !e.middle && !e.ring && !e.pinky) {
      // thumb tip well above the wrist = thumbs up, otherwise a closed hand
      const up = pts[0].y - pts[4].y > CONFIG.gestureThumbUpRatio * this.handSize;
      return up ? 'thumbs_up' : 'fist';
    }
    if (!e.thumb && !e.index && !e.middle && !e.ring && !e.pinky) return 'fist';
    if (e.index && e.middle && e.ring && e.pinky) return 'open';
    if (e.thumb && !e.index && !e.middle && !e.ring && e.pinky) return 'six';
    if (e.thumb && e.index && !e.middle && !e.ring && !e.pinky) return 'gun';
    // gun + middle finger; the thumb tells it apart from a thumb-tucked V sign
    if (e.thumb && e.index && e.middle && !e.ring && !e.pinky) return 'gun_variant';
    if (e.index && e.middle && !e.ring && !e.pinky) return 'victory';
    if (e.index && !e.middle && !e.ring && !e.pinky) return 'point';
    return 'none';
  }

  _step(label, dt) {
    if (label === this.label) {
      this.candidate = label;
      this.hold = 0;
      return;
    }
    if (label === this.candidate) this.hold += dt;
    else {
      this.candidate = label;
      this.hold = 0;
    }
    if (this.hold >= CONFIG.gestureDebounce) {
      this.label = label;
      this.candidate = label;
      this.hold = 0;
    }
  }
}

const THUMB_TIP = 4;
const INDEX_TIP = 8;

// Two-hand combo: the corresponding fingertips of the two hands meet (left
// thumb against right thumb, left index against right index) and the pair is
// roughly mirrored about the vertical line between the wrists. No other
// finger state is required.
export class PairGesture {
  constructor(name = 'pair') {
    this.name = name;
    this.active = false;
    this.hold = 0;
    this.metrics = null;
  }

  reset() {
    this.active = false;
    this.hold = 0;
    this.metrics = null;
  }

  /**
   * @param {object} left slot with `lastLms`
   * @param {object} right slot with `lastLms`
   */
  update(dt, left, right, view) {
    const a = left && left.lastLms;
    const b = right && right.lastLms;
    if (!a || !b) {
      this.reset();
      return;
    }

    const pa = toPoints(a, view);
    const pb = toPoints(b, view);
    const sizeA = dist2(pa[0], pa[9]);
    const sizeB = dist2(pb[0], pb[9]);
    if (!(sizeA > 1e-6 && sizeB > 1e-6)) {
      this.reset();
      return;
    }
    const handSize = 0.5 * (sizeA + sizeB);

    const dThumb = dist2(pa[THUMB_TIP], pb[THUMB_TIP]) / handSize;
    const dIndex = dist2(pa[INDEX_TIP], pb[INDEX_TIP]) / handSize;
    const axisX = 0.5 * (pa[0].x + pb[0].x);
    const midThumbX = 0.5 * (pa[THUMB_TIP].x + pb[THUMB_TIP].x);
    const midIndexX = 0.5 * (pa[INDEX_TIP].x + pb[INDEX_TIP].x);
    const symmetry = Math.max(Math.abs(midThumbX - axisX), Math.abs(midIndexX - axisX)) / handSize;
    const apart = Math.abs(pa[0].x - pb[0].x) / handSize;
    const heightDiff = Math.abs(pa[0].y - pb[0].y) / handSize;
    this.metrics = { dThumb, dIndex, symmetry, apart, heightDiff };

    const on = dThumb < CONFIG.zeroContactOn
      && dIndex < CONFIG.zeroContactOn
      && symmetry < CONFIG.zeroSymmetry
      && apart > CONFIG.zeroMinApart
      && heightDiff < CONFIG.zeroMaxHeightDiff;
    const off = dThumb > CONFIG.zeroContactOff
      || dIndex > CONFIG.zeroContactOff
      || symmetry > CONFIG.zeroSymmetry * 1.6
      || apart < CONFIG.zeroMinApart * 0.7
      || heightDiff > CONFIG.zeroMaxHeightDiff * 1.4;

    if (!this.active) {
      if (on) {
        this.hold += dt;
        if (this.hold >= CONFIG.gestureDebounce) {
          this.active = true;
          this.hold = 0;
        }
      } else {
        this.hold = 0;
      }
    } else if (off) {
      this.hold += dt;
      if (this.hold >= CONFIG.gestureDebounce) {
        this.active = false;
        this.hold = 0;
      }
    } else {
      this.hold = 0;
    }
  }
}
