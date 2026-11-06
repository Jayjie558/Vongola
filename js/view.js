// The one cover-fit mapping from the video to the window. The renderer, the
// gesture math and the offline analyzer all need the same rect; keeping the
// formula here prevents them from drifting apart. Pure JS (no THREE) so the
// analyzer can import it in tests.
export function coverRect(cw, ch, vw, vh) {
  if (!(vw > 0 && vh > 0 && cw > 0 && ch > 0)) return null;
  const scale = Math.max(cw / vw, ch / vh);
  const rw = vw * scale;
  const rh = vh * scale;
  return { cw, ch, rw, rh, ox: (cw - rw) / 2, oy: (ch - rh) / 2 };
}

// Normalized landmark -> equal-scale 2D units on the mirrored, cover-fitted
// frame. Callers pass a coverRect result, so render and analysis agree.
export function lmToAspectUnits(lm, view) {
  return {
    x: ((1 - lm.x) * view.rw + view.ox) / view.rh,
    y: (lm.y * view.rh + view.oy) / view.rh,
  };
}
