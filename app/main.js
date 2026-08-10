// Boot and wiring. M2: the loop transport, twinkle, a playback scrubber, WebM
// export, and project save/load, over M1's field → particle → composite chain.
// See glitterizer.md §8.

import {
  Doc, deserialize,
  LAYER_PARAMS, BRUSH_PARAMS, LOOP_PARAMS, EXPORT_PARAMS, defaultsOf
} from './doc.js';
import { getKit } from './kits/index.js';
import { deriveParticles } from './particles.js';
import { renderBase, renderFrame, drawParticles } from './render.js';
import { Brush } from './brush.js';
import { exportPNG } from './export/png.js';
import { exportWebM, webmSupported } from './export/webm.js';
import { saveProject, readProjectFile } from './export/project.js';
import { newSeed } from './rng.js';

const el = (id) => document.getElementById(id);

const els = {
  empty: el('empty'),
  stage: el('stage'),
  panel: el('panel'),
  transport: el('transport'),
  base: el('base'),
  sparkle: el('sparkle'),
  overlay: el('overlay'),
  status: el('status'),
  file: el('file'),
  fileProject: el('file-project'),
  choose: el('btn-choose'),
  play: el('btn-play'),
  scrub: el('scrub'),
  frameLabel: el('frame-label'),
  undo: el('btn-undo'),
  clear: el('btn-clear'),
  reshuffle: el('btn-reshuffle'),
  png: el('btn-png'),
  webm: el('btn-webm'),
  save: el('btn-save'),
  load: el('btn-load'),
  brushControls: el('brush-controls'),
  layerControls: el('layer-controls'),
  loopControls: el('loop-controls'),
  kitControls: el('kit-controls'),
  exportControls: el('export-controls'),
  kitTitle: el('kit-title')
};

const doc = new Doc();
let kit = getKit(doc.kitId);
doc.kitParams = defaultsOf(kit.params);

const baseCtx = els.base.getContext('2d');
const sparkleCtx = els.sparkle.getContext('2d');
const brush = new Brush(els.overlay, doc, () => invalidate());

const state = {
  particles: [],
  dirty: true,
  frame: 0,
  playing: false,
  raf: 0,
  clockStart: 0,
  busy: false
};

// ---- render scheduling ----

let queued = false;

/** Particles need rebuilding: the field, the seed, or a parameter changed. */
function invalidate() {
  state.dirty = true;
  scheduleDraw();
}

function scheduleDraw() {
  if (state.playing || queued) return;
  // A hidden tab never runs requestAnimationFrame, which would leave the
  // canvas stale behind an export or a background edit. Draw straight away.
  if (document.hidden) {
    draw();
    return;
  }
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    draw();
  });
}

function ensureParticles() {
  if (!state.dirty || !doc.hasImage) return;
  kit.init(doc.kitParams);
  state.particles = deriveParticles(doc, kit);
  state.dirty = false;
  status();
}

function timeOf(frame) {
  return (frame % doc.loop.frames) / doc.loop.frames;
}

function draw() {
  if (!doc.hasImage) return;
  ensureParticles();
  renderFrame(sparkleCtx, state.particles, kit, timeOf(state.frame), doc.loop.lifetime / 100);
}

/** One composited frame, for export. */
function compositeFrame(ctx, t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, doc.width, doc.height);
  ctx.drawImage(els.base, 0, 0);
  drawParticles(ctx, state.particles, kit, t, doc.loop.lifetime / 100);
}

// ---- transport ----

function setFrame(f) {
  const n = doc.loop.frames;
  state.frame = ((f % n) + n) % n;
  syncTransport();
  draw();
}

function syncTransport() {
  els.scrub.max = String(doc.loop.frames - 1);
  els.scrub.value = String(state.frame);
  els.frameLabel.textContent = `Frame ${state.frame + 1} of ${doc.loop.frames}`;
}

function play() {
  if (state.playing || !doc.hasImage) return;
  state.playing = true;
  els.play.textContent = 'Pause';
  els.play.classList.add('is-on');
  state.clockStart = performance.now() - state.frame * (1000 / doc.loop.fps);
  state.raf = requestAnimationFrame(tick);
}

function tick(now) {
  if (!state.playing) return;
  const f = Math.floor((now - state.clockStart) / (1000 / doc.loop.fps)) % doc.loop.frames;
  if (f !== state.frame || state.dirty) {
    state.frame = f;
    syncTransport();
    draw();
  }
  state.raf = requestAnimationFrame(tick);
}

function pause() {
  if (!state.playing) return;
  state.playing = false;
  els.play.textContent = 'Play';
  els.play.classList.remove('is-on');
  cancelAnimationFrame(state.raf);
}

els.play.addEventListener('click', () => (state.playing ? pause() : play()));
els.scrub.addEventListener('input', () => {
  pause();
  setFrame(parseInt(els.scrub.value, 10));
});

// ---- status ----

function status(msg) {
  if (msg !== undefined) {
    els.status.textContent = msg;
    return;
  }
  if (!doc.hasImage) {
    els.status.textContent = '';
    return;
  }
  const n = state.particles.length.toLocaleString();
  const limited = state.particles.length >= doc.layer.maxParticles ? ' (at the sparkle limit)' : '';
  const secs = (doc.loop.frames / doc.loop.fps).toFixed(1);
  els.status.textContent =
    `${doc.width} × ${doc.height} px · ${n} sparkles · ${secs} s loop${limited}`;
}

// ---- controls ----

/**
 * Build a control group from a parameter schema. Labels name what the control
 * changes, in the units shown on screen — see glitterizer.md §9.
 */
function buildControls(container, schema, values, onChange) {
  container.textContent = '';
  const rows = [];

  for (const p of schema) {
    const wrap = document.createElement('div');
    wrap.className = 'ctl';

    if (p.type === 'range') {
      const id = `c-${p.key}-${Math.random().toString(36).slice(2, 7)}`;
      const lab = document.createElement('label');
      lab.htmlFor = id;
      const name = document.createElement('span');
      name.textContent = p.label;
      const val = document.createElement('span');
      val.className = 'val';
      val.textContent = fmt(values[p.key]);
      lab.append(name, val);

      const input = document.createElement('input');
      input.type = 'range';
      input.id = id;
      input.min = p.min;
      input.max = p.max;
      input.step = p.step;
      input.value = values[p.key];
      input.addEventListener('input', () => {
        values[p.key] = parseFloat(input.value);
        val.textContent = fmt(values[p.key]);
        onChange(p.key);
      });
      wrap.append(lab, input);
    }

    if (p.type === 'select') {
      const lab = document.createElement('div');
      lab.className = 'lab';
      lab.textContent = p.label;
      const sel = document.createElement('select');
      for (const o of p.options) {
        const opt = document.createElement('option');
        opt.value = o.v;
        opt.textContent = o.l;
        sel.append(opt);
      }
      sel.value = values[p.key];
      sel.addEventListener('change', () => {
        values[p.key] = sel.value;
        onChange(p.key);
        applyVisibility();
      });
      wrap.append(lab, sel);
    }

    if (p.type === 'multi') {
      const lab = document.createElement('div');
      lab.className = 'lab';
      lab.textContent = p.label;
      const box = document.createElement('div');
      box.className = 'multi';
      for (const o of p.options) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = o.l;
        const on = () => values[p.key].includes(o.v);
        b.classList.toggle('is-on', on());
        b.addEventListener('click', () => {
          const list = values[p.key];
          const i = list.indexOf(o.v);
          if (i >= 0) {
            if (list.length === 1) return;   // keep at least one shape
            list.splice(i, 1);
          } else {
            list.push(o.v);
          }
          b.classList.toggle('is-on', on());
          onChange(p.key);
        });
        box.append(b);
      }
      wrap.append(lab, box);
    }

    container.append(wrap);
    rows.push({ p, wrap });
  }

  function applyVisibility() {
    for (const { p, wrap } of rows) {
      if (!p.showIf) continue;
      const ok = Object.entries(p.showIf).every(([k, v]) => values[k] === v);
      wrap.hidden = !ok;
    }
  }
  applyVisibility();
}

function fmt(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function buildAllControls() {
  buildControls(els.brushControls, BRUSH_PARAMS, doc.brush, () => brush.paintOverlay());
  buildControls(els.layerControls, LAYER_PARAMS, doc.layer, () => invalidate());
  buildControls(els.loopControls, LOOP_PARAMS, doc.loop, onLoopChange);
  buildControls(els.kitControls, kit.params, doc.kitParams, () => invalidate());
  buildControls(els.exportControls, EXPORT_PARAMS, doc.exportOpts, () => {});
  els.kitTitle.textContent = kit.label;
}

function onLoopChange(key) {
  if (key === 'frames' && state.frame >= doc.loop.frames) state.frame = doc.loop.frames - 1;
  if (state.playing) state.clockStart = performance.now() - state.frame * (1000 / doc.loop.fps);
  syncTransport();
  status();
  scheduleDraw();
}

buildAllControls();

for (const b of document.querySelectorAll('.mode')) {
  b.addEventListener('click', () => {
    brush.mode = b.dataset.mode;
    for (const other of document.querySelectorAll('.mode')) {
      other.classList.toggle('is-on', other === b);
    }
  });
}

// ---- image loading ----

async function loadFile(file) {
  if (!file) return;
  if (file.type && !file.type.startsWith('image/') && !/\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name)) {
    status('That file is not an image.');
    return;
  }
  status('Loading image…');
  try {
    const bitmap = await createImageBitmap(file);
    if (bitmap && bitmap.width > 0 && bitmap.height > 0) {
      setImage(bitmap, bitmap.width, bitmap.height);
      return;
    }
  } catch (err) {
    console.warn('createImageBitmap failed, trying FileReader fallback', err);
  }

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) {
        setImage(img, img.naturalWidth, img.naturalHeight);
      } else {
        status('That image has invalid dimensions.');
      }
    };
    img.onerror = () => status('That image could not be read.');
    img.src = reader.result;
  };
  reader.onerror = () => status('File reading failed.');
  reader.readAsDataURL(file);
}

function loadURL(url) {
  status('Loading image from URL…');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    if (img.naturalWidth && img.naturalHeight) {
      setImage(img, img.naturalWidth, img.naturalHeight);
    } else {
      status('That image has invalid dimensions.');
    }
  };
  img.onerror = () => status('Could not load image from URL.');
  img.src = url;
}

function showWorkspace(img) {
  for (const c of [els.base, els.sparkle, els.overlay]) {
    c.width = doc.width;
    c.height = doc.height;
  }
  renderBase(baseCtx, img, doc.width, doc.height);
  brush.clearOverlay();

  els.empty.hidden = true;
  els.stage.hidden = false;
  els.transport.hidden = false;
  els.panel.hidden = false;

  state.frame = 0;
  syncTransport();
  invalidate();
  play();
}

function setImage(img, w, h) {
  pause();
  doc.setImage(img, w, h);
  showWorkspace(img);
  status(`${doc.width} × ${doc.height} px · paint to add glitter`);
}

els.choose.addEventListener('click', () => els.file.click());
els.empty.addEventListener('click', () => els.file.click());
els.file.addEventListener('change', () => {
  const f = els.file.files[0];
  if (f) loadFile(f);
  els.file.value = '';
});

for (const ev of ['dragenter', 'dragover']) {
  document.addEventListener(ev, (e) => {
    e.preventDefault();
    els.empty.classList.add('is-over');
  });
}
for (const ev of ['dragleave', 'drop']) {
  document.addEventListener(ev, (e) => {
    e.preventDefault();
    els.empty.classList.remove('is-over');
  });
}
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) {
    if (f.type === 'application/json' || f.name.endsWith('.json')) loadProjectFile(f);
    else loadFile(f);
    return;
  }
  const uri = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('URL');
  if (uri) {
    loadURL(uri);
  }
});
document.addEventListener('paste', (e) => {
  for (const item of e.clipboardData?.items || []) {
    if (item.type.startsWith('image/')) {
      loadFile(item.getAsFile());
      return;
    }
  }
});

// ---- actions ----

els.undo.addEventListener('click', () => {
  if (doc.undo()) invalidate();
  else status('Nothing to undo.');
});

els.clear.addEventListener('click', () => {
  doc.clearField();
  invalidate();
});

els.reshuffle.addEventListener('click', () => {
  doc.seed = newSeed();
  invalidate();
});

function setBusy(on) {
  state.busy = on;
  for (const b of [els.png, els.webm, els.save, els.load, els.choose]) b.disabled = on;
}

els.png.addEventListener('click', async () => {
  if (state.busy) return;
  try {
    setBusy(true);
    status('Encoding PNG…');
    ensureParticles();
    const bytes = await exportPNG(els.base, els.sparkle);
    status(`Saved PNG · ${(bytes / 1024).toFixed(0)} KB`);
  } catch (err) {
    status(`Export failed: ${err.message}`);
  } finally {
    setBusy(false);
  }
});

els.webm.addEventListener('click', async () => {
  if (state.busy) return;
  pause();
  try {
    setBusy(true);
    ensureParticles();
    const bytes = await exportWebM(compositeFrame, {
      width: doc.width,
      height: doc.height,
      frames: doc.loop.frames,
      fps: doc.loop.fps,
      loops: doc.exportOpts.loops,
      onProgress: (i, total) => status(`Recording frame ${i} of ${total}…`)
    });
    status(`Saved WebM · ${(bytes / 1024).toFixed(0)} KB`);
  } catch (err) {
    status(`Export failed: ${err.message}`);
  } finally {
    setBusy(false);
    draw();
  }
});

els.save.addEventListener('click', () => {
  if (state.busy) return;
  try {
    const bytes = saveProject(doc, els.base);
    status(`Saved project · ${(bytes / 1024).toFixed(0)} KB`);
  } catch (err) {
    status(`Save failed: ${err.message}`);
  }
});

els.load.addEventListener('click', () => els.fileProject.click());
els.fileProject.addEventListener('change', () => {
  if (els.fileProject.files[0]) loadProjectFile(els.fileProject.files[0]);
  els.fileProject.value = '';
});

async function loadProjectFile(file) {
  if (state.busy) return;
  try {
    setBusy(true);
    status('Loading project…');
    pause();
    const json = await readProjectFile(file);
    const img = await deserialize(json, doc);
    kit = getKit(doc.kitId);
    buildAllControls();
    showWorkspace(img);
    status(`Loaded project · ${doc.width} × ${doc.height} px`);
  } catch (err) {
    status(`Load failed: ${err.message}`);
  } finally {
    setBusy(false);
  }
}

if (!webmSupported()) {
  els.webm.disabled = true;
  els.webm.title = 'This browser cannot record WebM.';
}

document.addEventListener('keydown', (e) => {
  if (!doc.hasImage || state.busy) return;
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (doc.undo()) invalidate();
    return;
  }
  if (e.key === ' ' && !typing) {
    e.preventDefault();
    state.playing ? pause() : play();
    return;
  }
  if (e.key === '[' || e.key === ']') {
    doc.brush.size = Math.min(400, Math.max(8, doc.brush.size + (e.key === '[' ? -10 : 10)));
    buildControls(els.brushControls, BRUSH_PARAMS, doc.brush, () => brush.paintOverlay());
    brush.paintOverlay();
  }
  if ((e.key === ',' || e.key === '.') && !typing) {
    pause();
    setFrame(state.frame + (e.key === ',' ? -1 : 1));
  }
});
