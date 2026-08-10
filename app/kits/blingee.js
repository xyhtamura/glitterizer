// blingee — the 2007 stamp look. Chunky pre-rendered sprite atlas, hard edges,
// quantized hues, additive compositing. See glitterizer.md §2.

const CELL = 64;
const R = 30;
const HUES = 24;              // hue quantization: 15° steps
const HUE_STEP = 360 / HUES;
const WHITE_COL = HUES;       // the extra column past the hues

const SHAPES = ['star4', 'star6', 'cross', 'snowflake', 'heart', 'ring'];

export const id = 'blingee';
export const label = 'Glitter';

export const params = [
  {
    key: 'shapes',
    label: 'Shapes',
    type: 'multi',
    options: [
      { v: 'star4', l: '4-point' },
      { v: 'star6', l: '6-point' },
      { v: 'cross', l: 'Cross' },
      { v: 'snowflake', l: 'Snowflake' },
      { v: 'heart', l: 'Heart' },
      { v: 'ring', l: 'Ring' }
    ],
    value: ['star4']
  },
  { key: 'sizeMin', label: 'Smallest sparkle (px)', type: 'range', min: 2, max: 60, step: 1, value: 8 },
  { key: 'sizeMax', label: 'Largest sparkle (px)', type: 'range', min: 3, max: 140, step: 1, value: 32 },
  {
    key: 'colorSource',
    label: 'Colour from',
    type: 'select',
    options: [
      { v: 'rainbow', l: 'Rainbow spread' },
      { v: 'image', l: 'Image underneath' },
      { v: 'single', l: 'One hue' }
    ],
    value: 'rainbow'
  },
  { key: 'hue', label: 'Hue (degrees)', type: 'range', min: 0, max: 345, step: 15, value: 300, showIf: { colorSource: 'single' } },
  { key: 'saturation', label: 'Saturation (%)', type: 'range', min: 0, max: 100, step: 5, value: 100 },
  { key: 'white', label: 'White sparkles (%)', type: 'range', min: 0, max: 100, step: 5, value: 25 },
  { key: 'core', label: 'White core (%)', type: 'range', min: 0, max: 100, step: 5, value: 65 },
  { key: 'rotate', label: 'Random rotation (%)', type: 'range', min: 0, max: 100, step: 5, value: 30 },
  { key: 'brightness', label: 'Brightness (%)', type: 'range', min: 20, max: 100, step: 5, value: 90 },
  { key: 'twinkle', label: 'Twinkle depth (%)', type: 'range', min: 0, max: 100, step: 5, value: 70 },
  { key: 'twinkleSpeed', label: 'Twinkle (cycles per loop)', type: 'range', min: 1, max: 12, step: 1, value: 3 },
  { key: 'spin', label: 'Spinning sparkles (%)', type: 'range', min: 0, max: 100, step: 5, value: 20 }
];

// Twinkle snaps between three sizes and an off state rather than dimming
// smoothly. The discrete jump is the 2007 look; a smooth curve reads as a
// modern particle system. Each sparkle gets its own order through the four.
const STEPS = [0, 0.45, 0.8, 1];

let atlas = null;
let atlasKey = '';

/** Rebuild the sprite atlas when a parameter it bakes in has changed. */
export function init(p) {
  const key = `${p.saturation}|${p.core}`;
  if (atlas && atlasKey === key) return;
  atlas = buildAtlas(p.saturation / 100, p.core / 100);
  atlasKey = key;
}

export function spawn(rng, sampled, p) {
  const shapes = p.shapes.length ? p.shapes : ['star4'];
  const shape = SHAPES.indexOf(shapes[(rng() * shapes.length) | 0]);

  let col;
  if (rng() < p.white / 100) {
    col = WHITE_COL;
  } else if (p.colorSource === 'image') {
    col = Math.round(rgbHue(sampled.r, sampled.g, sampled.b) / HUE_STEP) % HUES;
  } else if (p.colorSource === 'single') {
    col = (Math.round(p.hue / HUE_STEP) + ((rng() * 3) | 0) - 1 + HUES) % HUES;
  } else {
    col = (rng() * HUES) | 0;
  }

  // Biased toward the small end: a few large sparkles over many small ones is
  // what reads as glitter rather than as confetti.
  const lo = Math.min(p.sizeMin, p.sizeMax);
  const hi = Math.max(p.sizeMin, p.sizeMax);
  const size = lo + (hi - lo) * Math.pow(rng(), 1.8);

  // Twinkle rate is a whole number of cycles per loop, so every sparkle is
  // back where it started at t = 1 and the loop closes exactly.
  const rate = p.twinkleSpeed * [1, 1, 2, 3][(rng() * 4) | 0];
  const steps = shuffled(STEPS, rng);
  // Spin likewise: one whole turn per loop, or none.
  const spin = rng() < p.spin / 100 ? (rng() < 0.5 ? 1 : -1) : 0;

  return {
    shape: shape < 0 ? 0 : shape,
    col,
    size,
    rot: rng() * Math.PI * 2 * (p.rotate / 100),
    alpha: (0.55 + 0.45 * rng()) * (p.brightness / 100),
    depth: p.twinkle / 100,
    rate,
    steps,
    twOff: rng(),
    spin
  };
}

export function draw(ctx, pt, t, env) {
  let m = 1;
  if (pt.depth > 0) {
    const c = (pt.twOff + t * pt.rate) % 1;
    const step = pt.steps[(c * pt.steps.length) | 0];
    m = 1 - pt.depth + pt.depth * step;
  }

  const alpha = pt.alpha * env * m;
  if (alpha <= 0.008) return;

  const s = pt.size * (0.6 + 0.4 * m);
  const rot = pt.rot + (pt.spin ? t * pt.spin * Math.PI * 2 : 0);

  ctx.globalAlpha = alpha;
  ctx.save();
  ctx.translate(pt.x, pt.y);
  if (rot) ctx.rotate(rot);
  ctx.drawImage(
    atlas,
    pt.col * CELL, pt.shape * CELL, CELL, CELL,
    -s / 2, -s / 2, s, s
  );
  ctx.restore();
}

function shuffled(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- atlas ----

function buildAtlas(sat, core) {
  const c = document.createElement('canvas');
  c.width = CELL * (HUES + 1);
  c.height = CELL * SHAPES.length;
  const ctx = c.getContext('2d');

  for (let row = 0; row < SHAPES.length; row++) {
    for (let col = 0; col <= HUES; col++) {
      ctx.save();
      ctx.translate(col * CELL, row * CELL);
      const fill = col === WHITE_COL
        ? '#ffffff'
        : `hsl(${col * HUE_STEP} ${Math.round(sat * 100)}% 62%)`;
      drawShape(ctx, SHAPES[row], fill, core);
      ctx.restore();
    }
  }
  return c;
}

function drawShape(ctx, shape, fill, core) {
  ctx.translate(CELL / 2, CELL / 2);
  ctx.fillStyle = fill;
  ctx.strokeStyle = fill;
  ctx.lineCap = 'round';

  switch (shape) {
    case 'star4': spikes(ctx, 4, R, R * 0.13); break;
    case 'star6': spikes(ctx, 6, R, R * 0.28); break;
    case 'cross': cross(ctx); break;
    case 'snowflake': snowflake(ctx); break;
    case 'heart': heart(ctx); break;
    case 'ring': ring(ctx); break;
  }

  if (core > 0) {
    ctx.globalAlpha = core;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, R * (shape === 'ring' ? 0.1 : 0.19), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function spikes(ctx, points, outer, inner) {
  const n = points * 2;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function cross(ctx) {
  const w = R * 0.15;
  ctx.beginPath();
  ctx.rect(-w, -R, w * 2, R * 2);
  ctx.rect(-R, -w, R * 2, w * 2);
  ctx.fill();
}

function snowflake(ctx) {
  ctx.lineWidth = R * 0.11;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    ctx.moveTo(0, 0);
    ctx.lineTo(dx * R, dy * R);
    for (const at of [0.5, 0.78]) {
      const bx = dx * R * at;
      const by = dy * R * at;
      for (const side of [0.6, -0.6]) {
        const ba = a + side;
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(ba) * R * 0.24, by + Math.sin(ba) * R * 0.24);
      }
    }
  }
  ctx.stroke();
}

function heart(ctx) {
  const s = R / 16;
  ctx.beginPath();
  ctx.moveTo(0, 15 * s);
  ctx.bezierCurveTo(-20 * s, 0, -12 * s, -16 * s, 0, -7 * s);
  ctx.bezierCurveTo(12 * s, -16 * s, 20 * s, 0, 0, 15 * s);
  ctx.closePath();
  ctx.fill();
}

function ring(ctx) {
  ctx.lineWidth = R * 0.18;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.72, 0, Math.PI * 2);
  ctx.stroke();
}

function rgbHue(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}
