// Trace target for the 描红数字 protocol. The digit is rendered twice:
//  - a faint orange glyph that InkWriter shows under the flame strokes;
//  - a solid white glyph that is sampled into guide points for scoring.
//
// Guide points are normalized by the box height with the box center as origin,
// which is exactly how protocols.js maps recorded fingertip positions. Keeping
// both sides on this one convention is what makes accuracy scores comparable
// between recordings and window sizes.
import { CONFIG } from './config.js';

const FONT_STACK = '"Segoe UI", "Microsoft YaHei", sans-serif';

export function makeGuideBox(cw, ch) {
  const h = Math.min(ch * 0.56, 560);
  const w = h * 0.7;
  return {
    cx: cw * 0.5,
    cy: ch * 0.5 - ch * 0.015,
    w,
    h,
  };
}

export function buildWritingGuide(digit, box) {
  const w = Math.max(2, Math.round(box.w));
  const h = Math.max(2, Math.round(box.h));
  const fontPx = Math.round(h * 0.82);
  const font = 'bold ' + fontPx + 'px ' + FONT_STACK;
  const drawGlyph = (ctx, fill, stroke, lineWidth) => {
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = fill;
    ctx.fillText(digit, w / 2, h / 2 + fontPx * 0.02);
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.strokeText(digit, w / 2, h / 2 + fontPx * 0.02);
    }
  };

  // Display layer: faint orange fill with a slightly stronger outline.
  const display = document.createElement('canvas');
  display.width = w;
  display.height = h;
  const dg = display.getContext('2d');
  drawGlyph(dg, 'rgba(255, 172, 84, 0.14)', 'rgba(255, 186, 110, 0.34)', Math.max(2, h * 0.006));

  // Sampling layer: solid white on transparent, read back pixel by pixel.
  const sample = document.createElement('canvas');
  sample.width = w;
  sample.height = h;
  const sg = sample.getContext('2d', { willReadFrequently: true });
  drawGlyph(sg, '#fff', null, 0);
  const img = sg.getImageData(0, 0, w, h).data;

  const step = Math.max(4, Math.round(h / 100));
  const points = [];
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      // Alpha channel of the white glyph: any real coverage counts as target.
      if (img[(y * w + x) * 4 + 3] > 40) {
        points.push({
          x: (x - w / 2) / h,
          y: (y - h / 2) / h,
        });
      }
    }
  }

  return {
    digit: String(digit),
    box: { ...box },
    points,
    display,
    tolerance: CONFIG.writingAccuracyTolerance,
  };
}
