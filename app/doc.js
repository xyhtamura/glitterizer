// The document. Holds the source image, the painted fields, the layer and kit
// parameters, and an undo stack of field snapshots. Serialization to JSON is
// M2 — see glitterizer.md §8.

import { Field, fieldToDataURL, fieldFromImage, loadImage } from './fields.js';
import { newSeed } from './rng.js';

/** Long edge of the working canvas. Larger sources are scaled down on load. */
export const MAX_EDGE = 1600;

/** Parameters that belong to the field, not to any particular kit. */
export const LAYER_PARAMS = [
  {
    key: 'density',
    label: 'Sparkles per 100 px²',
    type: 'range',
    min: 0.2,
    max: 16,
    step: 0.2,
    value: 6
  },
  {
    key: 'maxParticles',
    label: 'Sparkle limit',
    type: 'range',
    min: 200,
    max: 8000,
    step: 100,
    value: 4000
  }
];

/**
 * The loop. Every time-varying quantity is an integer number of cycles per
 * loop and the live population is stationary, so the frame at t = 0 and the
 * frame at t = 1 are identical and the loop closes exactly.
 */
export const LOOP_PARAMS = [
  { key: 'frames', label: 'Loop length (frames)', type: 'range', min: 6, max: 60, step: 1, value: 24 },
  { key: 'fps', label: 'Frames per second', type: 'range', min: 4, max: 30, step: 1, value: 12 },
  { key: 'lifetime', label: 'Sparkle lifetime (% of loop)', type: 'range', min: 10, max: 100, step: 5, value: 100 }
];

export const EXPORT_PARAMS = [
  { key: 'loops', label: 'Loops to record', type: 'range', min: 1, max: 8, step: 1, value: 3 }
];

export const BRUSH_PARAMS = [
  { key: 'size', label: 'Brush size (px)', type: 'range', min: 8, max: 400, step: 4, value: 90 },
  { key: 'flow', label: 'Flow (%)', type: 'range', min: 5, max: 100, step: 5, value: 100 },
  { key: 'softness', label: 'Edge softness (%)', type: 'range', min: 0, max: 100, step: 5, value: 60 }
];

export function defaultsOf(schema) {
  const out = {};
  for (const p of schema) out[p.key] = Array.isArray(p.value) ? p.value.slice() : p.value;
  return out;
}

const UNDO_LIMIT = 30;

export class Doc {
  constructor() {
    this.image = null;      // HTMLImageElement or ImageBitmap
    this.width = 0;
    this.height = 0;
    this.density = null;    // Field
    this.source = null;     // SourceSampler
    this.seed = newSeed();
    this.layerId = 1;
    this.layer = defaultsOf(LAYER_PARAMS);
    this.brush = defaultsOf(BRUSH_PARAMS);
    this.loop = defaultsOf(LOOP_PARAMS);
    this.exportOpts = defaultsOf(EXPORT_PARAMS);
    this.kitId = 'blingee';
    this.kitParams = {};
    this.undoStack = [];
  }

  get hasImage() {
    return this.image !== null;
  }

  /** Fit a source image inside MAX_EDGE and rebuild the fields around it. */
  setImage(img, naturalW, naturalH) {
    const scale = Math.min(1, MAX_EDGE / Math.max(naturalW, naturalH));
    this.width = Math.max(1, Math.round(naturalW * scale));
    this.height = Math.max(1, Math.round(naturalH * scale));
    this.image = img;
    this.density = Field.forImage(this.width, this.height);
    this.source = new SourceSampler(img, this.width, this.height);
    this.undoStack = [];
  }

  pushUndo() {
    if (!this.density) return;
    this.undoStack.push(this.density.clone());
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.density.copyFrom(prev);
    return true;
  }

  clearField() {
    if (!this.density) return;
    this.pushUndo();
    this.density.clear();
  }

  /**
   * The editable document, not a render. Carries the source image and the
   * painted fields; the sparkles themselves are derived from the seed, so
   * nothing about them needs saving. See glitterizer.md §1.
   */
  serialize(baseCanvas) {
    return {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      width: this.width,
      height: this.height,
      seed: this.seed,
      layerId: this.layerId,
      layer: { ...this.layer },
      brush: { ...this.brush },
      loop: { ...this.loop },
      exportOpts: { ...this.exportOpts },
      kitId: this.kitId,
      kitParams: structuredClone(this.kitParams),
      image: baseCanvas.toDataURL('image/png'),
      density: fieldToDataURL(this.density)
    };
  }
}

export const PROJECT_FORMAT = 'glitterizer';
export const PROJECT_VERSION = 1;

/**
 * Restore a project into `doc`. Returns the decoded source image so the caller
 * can size its canvases and draw the base layer.
 */
export async function deserialize(json, doc) {
  if (!json || json.format !== PROJECT_FORMAT) {
    throw new Error('That file is not a glitterizer project.');
  }
  if (json.version > PROJECT_VERSION) {
    throw new Error(`That project was saved by a newer version (${json.version}).`);
  }

  const img = await loadImage(json.image);
  doc.setImage(img, json.width, json.height);

  const fieldImg = await loadImage(json.density);
  doc.density = fieldFromImage(fieldImg, doc.density.w, doc.density.h);

  doc.seed = json.seed ?? doc.seed;
  doc.layerId = json.layerId ?? doc.layerId;
  doc.kitId = json.kitId ?? doc.kitId;
  merge(doc.layer, json.layer);
  merge(doc.brush, json.brush);
  merge(doc.loop, json.loop);
  merge(doc.exportOpts, json.exportOpts);
  merge(doc.kitParams, json.kitParams);
  return img;
}

/** Copy known keys only, so an old file cannot introduce unknown parameters. */
function merge(target, source) {
  if (!source) return;
  for (const k of Object.keys(target)) {
    if (k in source) {
      target[k] = Array.isArray(source[k]) ? source[k].slice() : source[k];
    }
  }
}

/**
 * Reads the source image's pixels so kits can respond to what is underneath a
 * sparkle. Sampled once per image load, at working resolution.
 */
export class SourceSampler {
  constructor(img, w, h) {
    this.w = w;
    this.h = h;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    this.data = ctx.getImageData(0, 0, w, h).data;
  }

  /** Nearest-neighbour read at image pixel coordinates. */
  at(x, y) {
    const ix = x < 0 ? 0 : x >= this.w ? this.w - 1 : x | 0;
    const iy = y < 0 ? 0 : y >= this.h ? this.h - 1 : y | 0;
    const i = (iy * this.w + ix) * 4;
    const r = this.data[i];
    const g = this.data[i + 1];
    const b = this.data[i + 2];
    return { r, g, b, lum: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 };
  }
}
