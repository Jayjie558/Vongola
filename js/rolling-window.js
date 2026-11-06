// Fixed-duration per-hand buffer shared by the live signal and tremor views.
// It owns presence ticks, trimming, coverage and the max-gap quality number,
// so both monitors report drops the same way.
export class RollingWindow {
  constructor({ windowMs, maxPoints }) {
    this.windowMs = windowMs;
    this.maxPoints = maxPoints;
    this.reset();
  }

  reset() {
    this.points = [];
    this.presence = [];
  }

  // Call once per sampling tick for every hand, before pushing a value.
  beginTick(now) {
    this.presence.push({ t: now, ok: false });
  }

  // A finite measurement arrived for this hand on the current tick.
  markPresent() {
    const tick = this.presence[this.presence.length - 1];
    if (tick) tick.ok = true;
  }

  push(point) {
    this.points.push(point);
  }

  trim(now) {
    const cutoff = now - this.windowMs;
    while (this.points.length && this.points[0].t < cutoff) this.points.shift();
    if (this.points.length > this.maxPoints) {
      this.points.splice(0, this.points.length - this.maxPoints);
    }
    while (this.presence.length && this.presence[0].t < cutoff) this.presence.shift();
    if (this.presence.length > this.maxPoints) {
      this.presence.splice(0, this.presence.length - this.maxPoints);
    }
  }

  snapshot() {
    let present = 0;
    for (const tick of this.presence) if (tick.ok) present++;
    return {
      points: this.points.slice(),
      coverage: this.presence.length ? present / this.presence.length : 0,
      maxGapMs: maxGap(this.points),
    };
  }
}

function maxGap(points) {
  let gap = 0;
  for (let i = 1; i < points.length; i++) gap = Math.max(gap, points[i].t - points[i - 1].t);
  return gap;
}
