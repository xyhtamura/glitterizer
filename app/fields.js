// Painted field maps. Strokes never touch the source image; they write here,
// and particles are sampled against these — see glitterizer.md §1.
//
// Fields run at FIELD_DIVISOR times smaller than the image and are bilinearly
// sampled, so a stroke costs a fraction of the pixels it appears to cover.

export const FIELD_DIVISOR = 4;

export class Field {
  constructor(w, h) {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.data = new Float32Array(this.w * this.h);
  }

  static forImage(imgW, imgH) {
    return new Field(
      Math.ceil(imgW / FIELD_DIVISOR),
      Math.ceil(imgH / FIELD_DIVISOR)
    );
  }

  clear() {
    this.data.fill(0);
  }

  clone() {
    const f = new Field(this.w, this.h);
    f.data.set(this.data);
    return f;
  }

  copyFrom(other) {
    this.data.set(other.data);
  }

  /** Mean value over the whole field. Used to size the candidate pool. */
  mean() {
    let sum = 0;
    for (let i = 0; i < this.data.length; i++) sum += this.data[i];
    return sum / this.data.length;
  }

  isEmpty() {
    for (let i = 0; i < this.data.length; i++) if (this.data[i] > 0) return false;
    return true;
  }

  /** Bilinear sample. u, v in [0, 1] across the image. */
  sample(u, v) {
    const x = u * this.w - 0.5;
    const y = v * this.h - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const g = (ix, iy) => {
      const cx = ix < 0 ? 0 : ix >= this.w ? this.w - 1 : ix;
      const cy = iy < 0 ? 0 : iy >= this.h ? this.h - 1 : iy;
      return this.data[cy * this.w + cx];
    };
    const top = g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx;
    const bot = g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bot * fy;
  }

  /**
   * Stamp a soft disc, keeping the maximum. Coordinates and radius are in
   * field pixels. Taking the max rather than accumulating means a slow drag
   * does not burn a hotter line than a fast one.
   */
  stampMax(cx, cy, radius, strength, hardness) {
    if (radius <= 0 || strength <= 0) return;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + radius));
    const r2 = radius * radius;
    const feather = Math.max(1e-4, 1 - hardness);
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const d = Math.sqrt(d2) / radius;
        let t = (1 - d) / feather;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const w = t * t * (3 - 2 * t) * strength;
        const i = y * this.w + x;
        if (w > this.data[i]) this.data[i] = w;
      }
    }
  }

  /** field = clamp(field + other), for committing a finished paint stroke. */
  addFrom(other) {
    const a = this.data;
    const b = other.data;
    for (let i = 0; i < a.length; i++) {
      const v = a[i] + b[i];
      a[i] = v > 1 ? 1 : v;
    }
  }

  /** field = clamp(field - other), for committing a finished erase stroke. */
  subtractFrom(other) {
    const a = this.data;
    const b = other.data;
    for (let i = 0; i < a.length; i++) {
      const v = a[i] - b[i];
      a[i] = v < 0 ? 0 : v;
    }
  }
}

// ---- serialization ----
//
// Fields travel in project files as grayscale PNGs. 8 bits is more resolution
// than a density field needs, and it keeps a saved document readable by eye.

export function fieldToDataURL(field) {
  const c = document.createElement('canvas');
  c.width = field.w;
  c.height = field.h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(field.w, field.h);
  for (let i = 0; i < field.data.length; i++) {
    const v = field.data[i];
    const b = Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255);
    const j = i * 4;
    img.data[j] = b;
    img.data[j + 1] = b;
    img.data[j + 2] = b;
    img.data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/** Decode into a field of exactly w × h, resampling if the PNG differs. */
export function fieldFromImage(img, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const f = new Field(w, h);
  for (let i = 0; i < f.data.length; i++) f.data[i] = d[i * 4] / 255;
  return f;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The image data could not be read.'));
    img.src = src;
  });
}
