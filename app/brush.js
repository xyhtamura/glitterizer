// Pointer input to field writes. A stroke accumulates into its own buffer with
// a max, then commits into the target field on release, so a slow drag does
// not burn a hotter line than a fast one and one undo step covers one stroke.
//
// Four tools share the same pointer handling: three of them paint a field
// (glitter, direction, focus) and the fourth places focal points.

import { Field, VectorField, FIELD_DIVISOR } from './fields.js';
import { flowAt, focalPointAt, newFocalPoint } from './flow.js';

/** Grid spacing, in image pixels, of the direction arrows drawn on the overlay. */
const ARROW_SPACING = 46;
const ARROW_MAX = 900;

export class Brush {
  /**
   * @param {HTMLCanvasElement} overlay  canvas for stroke preview and cursor
   * @param {Doc} doc
   * @param {() => void} onCommit        called after a stroke lands
   * @param {(i: number) => void} onSelect  called when the focal selection changes
   */
  constructor(overlay, doc, onCommit, onSelect = () => {}) {
    this.overlay = overlay;
    this.ctx = overlay.getContext('2d');
    this.doc = doc;
    this.onCommit = onCommit;
    this.onSelect = onSelect;
    this.target = 'density';
    this.mode = 'paint';
    this.stroke = null;        // Field, for density and focus
    this.vecStroke = null;     // VectorField, for direction
    this.drawing = false;
    this.last = null;
    this.cursor = null;
    this.dir = null;           // smoothed drag direction, for the flow tool
    this.selected = -1;        // focal point index
    this.draggingFocal = -1;

    // Scratch canvas for upscaling a scalar stroke buffer into the preview.
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

  setTarget(target) {
    this.target = target;
    if (target !== 'focal') this.selected = -1;
    this.paintOverlay();
  }

  /** Client coordinates to image pixels. */
  toImage(e) {
    const r = this.overlay.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * this.doc.width,
      y: ((e.clientY - r.top) / r.height) * this.doc.height
    };
  }

  /** The field this tool writes to, or null for the focal tool. */
  targetField() {
    if (this.target === 'flow') return this.doc.flow;
    if (this.target === 'focus') return this.doc.focus;
    return this.doc.density;
  }

  down(e) {
    if (!this.doc.hasImage) return;
    try { this.overlay.setPointerCapture(e.pointerId); } catch { /* no active pointer */ }
    const p = this.toImage(e);
    this.last = p;
    this.cursor = p;

    if (this.target === 'focal') {
      this.downFocal(p);
      this.paintOverlay();
      return;
    }

    this.drawing = true;
    this.dir = null;
    this.ensureBuffers();
    if (this.target === 'flow') {
      // Direction comes from the drag, so there is nothing to write until the
      // pointer has moved far enough to have one.
      this.vecStroke.clear();
    } else {
      this.stroke.clear();
      this.stamp(p);
    }
    this.paintOverlay();
  }

  move(e) {
    if (!this.doc.hasImage) return;
    const p = this.toImage(e);
    this.cursor = p;

    if (this.draggingFocal >= 0) {
      const fp = this.doc.focalPoints[this.draggingFocal];
      fp.x = p.x;
      fp.y = p.y;
      this.paintOverlay();
      return;
    }

    if (this.drawing) {
      this.line(this.last, p);
      this.last = p;
    }
    this.paintOverlay();
  }

  up(e) {
    try { this.overlay.releasePointerCapture(e.pointerId); } catch { /* already released */ }

    if (this.draggingFocal >= 0) {
      this.draggingFocal = -1;
      this.paintOverlay();
      this.onCommit();
      return;
    }
    if (!this.drawing) return;
    this.drawing = false;

    const erase = this.mode === 'erase';
    this.doc.pushUndo(this.target);
    if (this.target === 'flow') {
      this.doc.flow.commitStroke(this.vecStroke, erase);
      this.vecStroke.clear();
    } else {
      const field = this.targetField();
      if (erase) field.subtractFrom(this.stroke);
      else field.addFrom(this.stroke);
      this.stroke.clear();
    }
    this.paintOverlay();
    this.onCommit();
  }

  // ---- focal points ----

  downFocal(p) {
    const grab = Math.max(14, this.doc.width * 0.02);
    const hit = focalPointAt(this.doc, p.x, p.y, grab);
    this.doc.pushUndo('focal');
    if (hit >= 0) {
      this.selected = hit;
      this.draggingFocal = hit;
    } else {
      this.doc.focalPoints.push(newFocalPoint(p.x, p.y));
      this.selected = this.doc.focalPoints.length - 1;
      this.draggingFocal = this.selected;
      this.onCommit();
    }
    this.onSelect(this.selected);
  }

  removeSelectedFocal() {
    if (this.selected < 0) return false;
    this.doc.pushUndo('focal');
    this.doc.focalPoints.splice(this.selected, 1);
    this.selected = Math.min(this.selected, this.doc.focalPoints.length - 1);
    this.onSelect(this.selected);
    this.paintOverlay();
    return true;
  }

  // ---- writing ----

  ensureBuffers() {
    const d = this.doc.density;
    if (!this.stroke || this.stroke.w !== d.w || this.stroke.h !== d.h) {
      this.stroke = new Field(d.w, d.h);
    }
    if (!this.vecStroke || this.vecStroke.w !== d.w || this.vecStroke.h !== d.h) {
      this.vecStroke = new VectorField(d.w, d.h);
    }
  }

  stamp(p, dx, dy) {
    const b = this.doc.brush;
    const cx = p.x / FIELD_DIVISOR;
    const cy = p.y / FIELD_DIVISOR;
    const r = (b.size / 2) / FIELD_DIVISOR;
    const hardness = 1 - b.softness / 100;
    if (this.target === 'flow') {
      this.vecStroke.stampDirection(cx, cy, r, dx, dy, b.flow / 100, hardness);
    } else {
      this.stroke.stampMax(cx, cy, r, b.flow / 100, hardness);
    }
  }

  /** Stamp along the segment so a fast drag stays continuous. */
  line(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);

    if (this.target === 'flow') {
      // Below a pixel of travel the direction is noise, so hold the last one.
      if (dist > 1) {
        const nx = dx / dist;
        const ny = dy / dist;
        this.dir = this.dir
          ? normalize(this.dir[0] + (nx - this.dir[0]) * 0.35, this.dir[1] + (ny - this.dir[1]) * 0.35)
          : [nx, ny];
      }
      if (!this.dir) return;
    }

    const step = Math.max(1, this.doc.brush.size * 0.15);
    const n = Math.ceil(dist / step) || 1;
    for (let i = 1; i <= n; i++) {
      const p = { x: a.x + (dx * i) / n, y: a.y + (dy * i) / n };
      if (this.target === 'flow') this.stamp(p, this.dir[0], this.dir[1]);
      else this.stamp(p);
    }
  }

  // ---- overlay ----

  /** Committed fields, the stroke in progress, focal markers, cursor ring. */
  paintOverlay() {
    const ctx = this.ctx;
    const { width, height } = this.overlay;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!this.doc.hasImage) return;

    if (this.target === 'focus') this.drawScalarField(this.doc.focus, [110, 240, 255], 90);
    if (this.target === 'flow' || this.target === 'focal') this.drawArrows();
    if (this.drawing && this.target !== 'flow') {
      const tint = this.mode === 'erase' ? [255, 90, 90] : [255, 95, 210];
      this.drawScalarField(this.stroke, tint, 150);
    }
    if (this.drawing && this.target === 'flow') this.drawStrokeDirection();
    if (this.doc.focalPoints.length) this.drawFocalPoints();
    this.drawCursor();
  }

  drawScalarField(field, [cr, cg, cb], scale) {
    if (!field || field.isEmpty()) return;
    if (this.scratch.width !== field.w || this.scratch.height !== field.h) {
      this.scratch.width = field.w;
      this.scratch.height = field.h;
    }
    const img = this.scratchCtx.createImageData(field.w, field.h);
    for (let i = 0; i < field.data.length; i++) {
      const a = field.data[i];
      if (a <= 0) continue;
      const j = i * 4;
      img.data[j] = cr;
      img.data[j + 1] = cg;
      img.data[j + 2] = cb;
      img.data[j + 3] = Math.min(255, a * scale);
    }
    this.scratchCtx.putImageData(img, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(this.scratch, 0, 0, this.overlay.width, this.overlay.height);
  }

  /** The combined flow, as a grid of arrows. Painted field plus focal points. */
  drawArrows() {
    const ctx = this.ctx;
    const { width, height } = this.doc;
    const cols = Math.ceil(width / ARROW_SPACING);
    const rows = Math.ceil(height / ARROW_SPACING);
    if (cols * rows > ARROW_MAX) return;

    const v = [0, 0];
    const len = ARROW_SPACING * 0.42;
    const scale = Math.max(1, width / 900);
    ctx.lineWidth = 1.6 * scale;
    ctx.lineCap = 'round';

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = (c + 0.5) * ARROW_SPACING;
        const y = (r + 0.5) * ARROW_SPACING;
        flowAt(this.doc, x, y, v);
        const m = Math.hypot(v[0], v[1]);
        if (m < 0.02) continue;
        const ex = x + (v[0] / m) * len * m;
        const ey = y + (v[1] / m) * len * m;
        ctx.strokeStyle = `rgba(109, 227, 255, ${0.25 + 0.55 * m})`;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        // Head, so direction reads at a glance rather than only orientation.
        const a = Math.atan2(v[1], v[0]);
        const hl = 4.5 * scale;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - Math.cos(a - 0.5) * hl, ey - Math.sin(a - 0.5) * hl);
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - Math.cos(a + 0.5) * hl, ey - Math.sin(a + 0.5) * hl);
        ctx.stroke();
      }
    }
  }

  drawStrokeDirection() {
    if (!this.dir || !this.cursor) return;
    const ctx = this.ctx;
    const scale = Math.max(1, this.doc.width / 900);
    const r = this.doc.brush.size / 2;
    const ex = this.cursor.x + this.dir[0] * r;
    const ey = this.cursor.y + this.dir[1] * r;
    ctx.strokeStyle = this.mode === 'erase' ? 'rgba(255,90,90,0.95)' : 'rgba(109,227,255,0.95)';
    ctx.lineWidth = 3 * scale;
    ctx.beginPath();
    ctx.moveTo(this.cursor.x, this.cursor.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }

  drawFocalPoints() {
    const ctx = this.ctx;
    const active = this.target === 'focal';
    const scale = Math.max(1, this.doc.width / 900);
    for (let i = 0; i < this.doc.focalPoints.length; i++) {
      const fp = this.doc.focalPoints[i];
      const on = active && i === this.selected;
      ctx.strokeStyle = on ? 'rgba(255,95,210,0.95)' : `rgba(255,95,210,${active ? 0.5 : 0.25})`;
      ctx.lineWidth = (on ? 2.4 : 1.4) * scale;
      ctx.setLineDash([6 * scale, 5 * scale]);
      ctx.beginPath();
      ctx.arc(fp.x, fp.y, fp.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(fp.x, fp.y, (on ? 7 : 5) * scale, 0, Math.PI * 2);
      ctx.fillStyle = on ? 'rgba(255,95,210,0.95)' : 'rgba(255,95,210,0.6)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1.2 * scale;
      ctx.stroke();
    }
  }

  drawCursor() {
    if (!this.cursor || this.target === 'focal') return;
    const ctx = this.ctx;
    const r = this.doc.brush.size / 2;
    ctx.lineWidth = Math.max(1, this.overlay.width / 600);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.arc(this.cursor.x, this.cursor.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.arc(this.cursor.x, this.cursor.y, r + ctx.lineWidth, 0, Math.PI * 2);
    ctx.stroke();
  }

  clearOverlay() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }
}

function normalize(x, y) {
  const m = Math.hypot(x, y) || 1;
  return [x / m, y / m];
}
