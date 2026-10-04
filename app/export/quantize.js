// Bounded histogram median cut, followed by palette mapping and dithering.
export function adaptivePalette(rgba, count = 64) {
  const bins = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const key = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
    let bin = bins.get(key);
    if (!bin) bins.set(key, bin = { n: 0, r: 0, g: 0, b: 0 });
    bin.n++; bin.r += r; bin.g += g; bin.b += b;
  }
  const colors = [...bins.values()].map(c => [c.r / c.n, c.g / c.n, c.b / c.n, c.n]);
  if (!colors.length) return [[0, 0, 0]];
  const box = items => {
    const ranges = [0, 1, 2].map(ch => {
      let lo = 255, hi = 0;
      for (const c of items) { lo = Math.min(lo, c[ch]); hi = Math.max(hi, c[ch]); }
      return hi - lo;
    });
    const axis = ranges.indexOf(Math.max(...ranges));
    const weight = items.reduce((n, c) => n + c[3], 0);
    return { items, axis, weight, score: items.length > 1 ? ranges[axis] * weight : -1 };
  };
  const boxes = [box(colors)];
  while (boxes.length < count) {
    boxes.sort((a, b) => b.score - a.score);
    const current = boxes[0];
    if (current.score <= 0) break;
    current.items.sort((a, b) => a[current.axis] - b[current.axis]);
    let sum = 0, split = 1;
    for (; split < current.items.length; split++) {
      sum += current.items[split - 1][3];
      if (sum >= current.weight / 2) break;
    }
    split = Math.min(split, current.items.length - 1);
    boxes.splice(0, 1, box(current.items.slice(0, split)), box(current.items.slice(split)));
  }
  return boxes.map(({ items, weight }) => [0, 1, 2].map(ch =>
    Math.round(items.reduce((sum, c) => sum + c[ch] * c[3], 0) / weight)));
}

export function webSafePalette() {
  const out = [];
  for (let r = 0; r <= 255; r += 51)
    for (let g = 0; g <= 255; g += 51)
      for (let b = 0; b <= 255; b += 51) out.push([r, g, b]);
  return out;
}

function bayer(size) {
  let values = [0], n = 1;
  while (n < size) {
    const next = new Array(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = values[y * n + x] * 4;
      next[y * n * 2 + x] = v;
      next[y * n * 2 + x + n] = v + 2;
      next[(y + n) * n * 2 + x] = v + 3;
      next[(y + n) * n * 2 + x + n] = v + 1;
    }
    values = next; n *= 2;
  }
  return values;
}
const BAYER4 = bayer(4), BAYER8 = bayer(8);

export function mapPalette(rgba, width, height, palette, dither = 'none') {
  const indexed = new Uint8Array(width * height);
  const output = new Uint8ClampedArray(rgba.length);
  const cache = new Map();
  const nearest = (r, g, b) => {
    r = Math.round(Math.max(0, Math.min(255, r)));
    g = Math.round(Math.max(0, Math.min(255, g)));
    b = Math.round(Math.max(0, Math.min(255, b)));
    const key = r << 16 | g << 8 | b;
    if (cache.has(key)) return cache.get(key);
    let best = 0, distance = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const c = palette[i];
      const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
      if (d < distance) { distance = d; best = i; }
    }
    if (cache.size < 65536) cache.set(key, best);
    return best;
  };
  const fs = dither === 'fs';
  let row = new Float32Array((width + 2) * 3), next = new Float32Array(row.length);
  const size = dither === 'bayer4' ? 4 : 8;
  const matrix = size === 4 ? BAYER4 : BAYER8;
  const ordered = dither === 'bayer4' || dither === 'bayer8';
  const spread = 255 / Math.cbrt(palette.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, e = (x + 1) * 3;
      const offset = ordered ? ((matrix[(y % size) * size + x % size] + 0.5) / (size * size) - 0.5) * spread : 0;
      const rgb = [0, 1, 2].map(ch => rgba[i + ch] + offset + (fs ? row[e + ch] : 0));
      const idx = nearest(...rgb), color = palette[idx];
      indexed[i / 4] = idx;
      for (let ch = 0; ch < 3; ch++) {
        output[i + ch] = color[ch];
        if (fs) {
          const error = Math.max(0, Math.min(255, rgb[ch])) - color[ch];
          row[e + 3 + ch] += error * 7 / 16;
          next[e - 3 + ch] += error * 3 / 16;
          next[e + ch] += error * 5 / 16;
          next[e + 3 + ch] += error / 16;
        }
      }
      output[i + 3] = rgba[i + 3];
    }
    [row, next] = [next, row]; next.fill(0);
  }
  return { indexed, rgba: output };
}
