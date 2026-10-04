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

/**
 * A two-channel field, for direction. Carries a third weight channel used only
 * by stroke buffers: a stroke records the strongest weight it laid at each
 * cell, then blends that into the document's field on release, so painting
 * over an area rotates it toward the new direction instead of accumulating.
 */
export class VectorField {
  constructor(w, h) {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    const n = this.w * this.h;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.wt = new Float32Array(n);
  }

  static forImage(imgW, imgH) {
    return new VectorField(
      Math.ceil(imgW / FIELD_DIVISOR),
      Math.ceil(imgH / FIELD_DIVISOR)
    );
  }

  clear() {
    this.x.fill(0);
    this.y.fill(0);
    this.wt.fill(0);
  }

  clone() {
    const f = new VectorField(this.w, this.h);
    f.x.set(this.x);
    f.y.set(this.y);
    f.wt.set(this.wt);
    return f;
  }

  copyFrom(other) {
    this.x.set(other.x);
    this.y.set(other.y);
    this.wt.set(other.wt);
  }

  isEmpty() {
    for (let i = 0; i < this.x.length; i++) {
      if (this.x[i] !== 0 || this.y[i] !== 0) return false;
    }
    return true;
  }

  /** Bilinear sample of both channels into `out`. u, v in [0, 1]. */
  sample(u, v, out) {
    const px = u * this.w - 0.5;
    const py = v * this.h - 0.5;
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const fx = px - x0;
    const fy = py - y0;
    const idx = (ix, iy) => {
      const cx = ix < 0 ? 0 : ix >= this.w ? this.w - 1 : ix;
      const cy = iy < 0 ? 0 : iy >= this.h ? this.h - 1 : iy;
      return cy * this.w + cx;
    };
    const a = idx(x0, y0), b = idx(x0 + 1, y0), c = idx(x0, y0 + 1), d = idx(x0 + 1, y0 + 1);
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy);
    const w01 = (1 - fx) * fy, w11 = fx * fy;
    out[0] = this.x[a] * w00 + this.x[b] * w10 + this.x[c] * w01 + this.x[d] * w11;
    out[1] = this.y[a] * w00 + this.y[b] * w10 + this.y[c] * w01 + this.y[d] * w11;
    return out;
  }

  /** Stroke-buffer write: keep the strongest weight and its direction. */
  stampDirection(cx, cy, radius, dx, dy, strength, hardness) {
    if (radius <= 0 || strength <= 0) return;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + radius));
    const r2 = radius * radius;
    const feather = Math.max(1e-4, 1 - hardness);
    for (let y = y0; y <= y1; y++) {
      const ddy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const ddx = x + 0.5 - cx;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 > r2) continue;
        let t = (1 - Math.sqrt(d2) / radius) / feather;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const w = t * t * (3 - 2 * t) * strength;
        const i = y * this.w + x;
        if (w > this.wt[i]) {
          this.wt[i] = w;
          this.x[i] = dx;
          this.y[i] = dy;
        }
      }
    }
  }

  /** Blend a finished stroke in: toward its direction, or toward zero. */
  commitStroke(stroke, erase) {
    for (let i = 0; i < this.x.length; i++) {
      const w = stroke.wt[i];
      if (w <= 0) continue;
      if (erase) {
        this.x[i] *= 1 - w;
        this.y[i] *= 1 - w;
      } else {
        this.x[i] += (stroke.x[i] - this.x[i]) * w;
        this.y[i] += (stroke.y[i] - this.y[i]) * w;
      }
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

/**
 * Direction travels as a PNG too: x in red, y in green.
 *
 * Zero sits at 127 with a scale of 127, not at 127.5 with a scale of 127.5.
 * The half-step version cannot represent zero — it rounds to 128, which decodes
 * to 0.004, so an unpainted field would come back as a faint drift everywhere
 * and `isEmpty` would stop being true. This mapping is exactly invertible on
 * the byte grid, so zero stays zero and ±1 stay ±1.
 */
const VEC_ZERO = 127;

export function vectorFieldToDataURL(field) {
  const c = document.createElement('canvas');
  c.width = field.w;
  c.height = field.h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(field.w, field.h);
  const enc = (v) => {
    const b = Math.round(Math.max(-1, Math.min(1, v)) * VEC_ZERO) + VEC_ZERO;
    return b < 0 ? 0 : b > 255 ? 255 : b;
  };
  for (let i = 0; i < field.x.length; i++) {
    const j = i * 4;
    img.data[j] = enc(field.x[i]);
    img.data[j + 1] = enc(field.y[i]);
    img.data[j + 2] = 0;
    img.data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

export function vectorFieldFromImage(img, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const f = new VectorField(w, h);
  for (let i = 0; i < f.x.length; i++) {
    f.x[i] = (d[i * 4] - VEC_ZERO) / VEC_ZERO;
    f.y[i] = (d[i * 4 + 1] - VEC_ZERO) / VEC_ZERO;
  }
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
