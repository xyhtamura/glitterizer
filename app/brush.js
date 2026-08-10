// Pointer input to field writes. A stroke accumulates into its own buffer with
// a max, then commits into the density field on release, so a slow drag does
// not burn a hotter line than a fast one and one undo step covers one stroke.

import { Field, FIELD_DIVISOR } from './fields.js';

export class Brush {
  /**
   * @param {HTMLCanvasElement} overlay  canvas for stroke preview and cursor
   * @param {Doc} doc
   * @param {() => void} onCommit        called after a stroke lands
   */
  constructor(overlay, doc, onCommit) {
    this.overlay = overlay;
    this.ctx = overlay.getContext('2d');
    this.doc = doc;
    this.onCommit = onCommit;
    this.mode = 'paint';
    this.stroke = null;
    this.drawing = false;
    this.last = null;
    this.cursor = null;

    // Scratch canvas for upscaling the stroke buffer into the preview.
    this.scratch = document.createElement('canvas');
    this.scratchCtx = this.scratch.getContext('2d');

    overlay.addEventListener('pointerdown', (e) => this.down(e));
    overlay.addEventListener('pointermove', (e) => this.move(e));
    overlay.addEventListener('pointerup', (e) => this.up(e));
    overlay.addEventListener('pointercancel', (e) => this.up(e));
    overlay.addEventListener('pointerleave', () => {
      this.cursor = null;
      if (!this.drawing) this.paintOverlay();
    });
  }

  /** Client coordinates to image pixels. */
  toImage(e) {
    const r = this.overlay.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * this.doc.width,
      y: ((e.clientY - r.top) / r.height) * this.doc.height
    };
  }

  down(e) {
    if (!this.doc.hasImage) return;
    try { this.overlay.setPointerCapture(e.pointerId); } catch { /* no active pointer */ }
    this.drawing = true;
    if (!this.stroke || this.stroke.w !== this.doc.density.w || this.stroke.h !== this.doc.density.h) {
      this.stroke = new Field(this.doc.density.w, this.doc.density.h);
    }
    this.stroke.clear();
    const p = this.toImage(e);
    this.last = p;
    this.cursor = p;
    this.stamp(p);
    this.paintOverlay();
  }

  move(e) {
    if (!this.doc.hasImage) return;
    const p = this.toImage(e);
    this.cursor = p;
    if (this.drawing) {
      this.line(this.last, p);
      this.last = p;
    }
    this.paintOverlay();
  }

  up(e) {
    if (!this.drawing) return;
    this.drawing = false;
    try { this.overlay.releasePointerCapture(e.pointerId); } catch { /* already released */ }

    this.doc.pushUndo();
    if (this.mode === 'erase') this.doc.density.subtractFrom(this.stroke);
    else this.doc.density.addFrom(this.stroke);
    this.stroke.clear();
    this.paintOverlay();
    this.onCommit();
  }

  stamp(p) {
    const b = this.doc.brush;
    this.stroke.stampMax(
      p.x / FIELD_DIVISOR,
      p.y / FIELD_DIVISOR,
      (b.size / 2) / FIELD_DIVISOR,
      b.flow / 100,
      1 - b.softness / 100
    );
  }

  /** Stamp along the segment so a fast drag stays continuous. */
  line(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const step = Math.max(1, this.doc.brush.size * 0.15);
    const n = Math.ceil(dist / step);
    for (let i = 1; i <= n; i++) {
      this.stamp({ x: a.x + (dx * i) / n, y: a.y + (dy * i) / n });
    }
  }

  /** Stroke-in-progress preview, then the cursor ring on top. */
  paintOverlay() {
    const ctx = this.ctx;
    const { width, height } = this.overlay;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (this.drawing && this.stroke) {
      const f = this.stroke;
      if (this.scratch.width !== f.w || this.scratch.height !== f.h) {
        this.scratch.width = f.w;
        this.scratch.height = f.h;
      }
      const img = this.scratchCtx.createImageData(f.w, f.h);
      const erase = this.mode === 'erase';
      const [cr, cg, cb] = erase ? [255, 90, 90] : [255, 95, 210];
      for (let i = 0; i < f.data.length; i++) {
        const a = f.data[i];
        if (a <= 0) continue;
        const j = i * 4;
        img.data[j] = cr;
        img.data[j + 1] = cg;
        img.data[j + 2] = cb;
        img.data[j + 3] = Math.min(255, a * 150);
      }
      this.scratchCtx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.scratch, 0, 0, width, height);
    }

    if (this.cursor) {
      const r = this.doc.brush.size / 2;
      ctx.lineWidth = Math.max(1, width / 600);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.arc(this.cursor.x, this.cursor.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.arc(this.cursor.x, this.cursor.y, r + ctx.lineWidth, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  clearOverlay() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }
}
