// The document. Holds the source image, the painted fields, the layer and kit
// parameters, and an undo stack of field snapshots. Serialization to JSON is
// M2 — see glitterizer.md §8.

import {
  Field, VectorField,
  fieldToDataURL, fieldFromImage,
  vectorFieldToDataURL, vectorFieldFromImage,
  loadImage
} from './fields.js';
import { newSeed } from './rng.js';
import { CLEAN } from './export/profile.js';

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
  },
  {
    // How far a sparkle travels along the flow over one lifetime. Sparkles
    // hold still at a lifetime of 100%, where there is no fade to hide the
    // return to the start — see LOOP_PARAMS below.
    key: 'travel',
    label: 'Travel distance (px per life)',
    type: 'range',
    min: 0,
    max: 500,
    step: 10,
    value: 140
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
  // At 100% a sparkle is alive for the whole loop and never fades, so there is
  // no cover for the jump back to the start of its path — travel is switched
  // off there, and the default sits below it so painted direction shows.
  { key: 'lifetime', label: 'Sparkle lifetime (% of loop)', type: 'range', min: 10, max: 100, step: 5, value: 70 }
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
    this.flow = null;       // VectorField — direction of travel
    this.focus = null;      // Field — concentration of attention
    this.focalPoints = [];
    this.source = null;     // SourceSampler
    this.seed = newSeed();
    this.layerId = 1;
    this.layer = defaultsOf(LAYER_PARAMS);
    this.brush = defaultsOf(BRUSH_PARAMS);
    this.loop = defaultsOf(LOOP_PARAMS);
    this.exportOpts = defaultsOf(EXPORT_PARAMS);
    this.profile = { ...CLEAN };
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
    this.flow = VectorField.forImage(this.width, this.height);
    this.focus = Field.forImage(this.width, this.height);
    this.focalPoints = [];
    this.source = new SourceSampler(img, this.width, this.height);
    this.undoStack = [];
  }

  /**
   * One entry per stroke, holding only the thing that stroke touched. Keeping
   * three full fields per step would cost megabytes for no benefit.
   * @param {'density'|'flow'|'focus'|'focal'} target
   */
  pushUndo(target = 'density') {
    if (!this.density) return;
    const snapshot = target === 'focal'
      ? this.focalPoints.map((p) => ({ ...p }))
      : this[target].clone();
    this.undoStack.push({ target, snapshot });
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    if (entry.target === 'focal') this.focalPoints = entry.snapshot;
    else this[entry.target].copyFrom(entry.snapshot);
    return entry.target;
  }

  /** Clear one painted field, or remove every focal point. */
  clearField(target = 'density') {
    if (!this.density) return;
    this.pushUndo(target);
    if (target === 'focal') this.focalPoints = [];
    else this[target].clear();
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
      profile: { ...this.profile },
      kitId: this.kitId,
      kitParams: structuredClone(this.kitParams),
      focalPoints: this.focalPoints.map((p) => ({ ...p })),
      image: baseCanvas.toDataURL('image/png'),
      density: fieldToDataURL(this.density),
      flow: vectorFieldToDataURL(this.flow),
      focus: fieldToDataURL(this.focus)
    };
  }
}

export const PROJECT_FORMAT = 'glitterizer';
export const PROJECT_VERSION = 2;

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

  // Version 1 files predate direction and focus; they load with both empty.
  if (json.flow) {
    doc.flow = vectorFieldFromImage(await loadImage(json.flow), doc.flow.w, doc.flow.h);
  }
  if (json.focus) {
    doc.focus = fieldFromImage(await loadImage(json.focus), doc.focus.w, doc.focus.h);
  }
  doc.focalPoints = Array.isArray(json.focalPoints)
    ? json.focalPoints.map((p) => ({ ...p }))
    : [];

  doc.seed = json.seed ?? doc.seed;
  doc.layerId = json.layerId ?? doc.layerId;
  doc.kitId = json.kitId ?? doc.kitId;
  merge(doc.layer, json.layer);
  merge(doc.brush, json.brush);
  merge(doc.loop, json.loop);
  merge(doc.exportOpts, json.exportOpts);
  doc.profile = { ...CLEAN };
  merge(doc.profile, json.profile);
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
