// Video export. MediaRecorder timestamps frames by wall clock, so the loop is
// played out in real time at its own frame rate and each frame is pushed into
// the stream explicitly. Recording several loops gives a file long enough to
// scrub. This is a real-time recorder: it can drop frames under load and does
// not write a seekable duration. Frame-exact WebM is a separate follow-up.

import { downloadBlob, stamp } from './download.js';

const CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm'
];

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  return CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Settling time between start() and the first recorded frame. */
const WARMUP_MS = 250;

/**
 * @param {(ctx: CanvasRenderingContext2D, t: number) => void} drawFrame
 * @param {{width, height, frames, fps, loops, onProgress}} opts
 */
export async function exportWebM(drawFrame, opts) {
  const mime = pickMime();
  if (!mime) throw new Error('This browser cannot record WebM.');

  const canvas = document.createElement('canvas');
  canvas.width = opts.width;
  canvas.height = opts.height;
  const ctx = canvas.getContext('2d');

  // captureStream(0) hands frame timing to us instead of the compositor.
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16000000 });

  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise((res) => { rec.onstop = res; });

  const total = opts.frames * opts.loops;
  const dt = 1000 / opts.fps;

  // Prime the encoder. Frames pushed in the first moments after start() are
  // dropped while it spins up, and on a one-second loop that can be the whole
  // file — the first recording of a session came back as a bare container.
  // A priming frame plus a short settle costs nothing and the leading frame is
  // t = 0, which is where the loop starts anyway.
  drawFrame(ctx, 0);
  rec.start(200);
  await sleep(WARMUP_MS);
  track.requestFrame();
  await sleep(dt);

  for (let i = 0; i < total; i++) {
    const t = (i % opts.frames) / opts.frames;
    drawFrame(ctx, t);
    track.requestFrame();
    opts.onProgress?.(i + 1, total);
    await sleep(dt);
  }
  await sleep(dt);
  rec.stop();
  await stopped;
  track.stop();

  const blob = new Blob(chunks, { type: mime.split(';')[0] });
  if (!blob.size) throw new Error('The recording came back empty.');
  downloadBlob(blob, `${stamp('glitterizer')}.webm`);
  return blob.size;
}

export function webmSupported() {
  return pickMime() !== null;
}
