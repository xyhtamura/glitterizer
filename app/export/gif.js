import { resizeComposite, outputSize, outputTiming } from './profile.js';
import { downloadBlob, stamp } from './download.js';

/** Two passes, one transferred frame at a time: palette sampling, then encoding. */
export async function encodeGIF(drawFrame, opts) {
  const worker = new Worker(new URL('./gif.worker.js', import.meta.url), { type: 'module' });
  const full = document.createElement('canvas');
  full.width = opts.width; full.height = opts.height;
  const ctx = full.getContext('2d');
  const resized = document.createElement('canvas');
  const size = outputSize(opts.width, opts.height, opts.profile);
  const timing = outputTiming(opts.loop, opts.profile);
  let pending;
  worker.onmessage = ({ data }) => {
    if (!pending) return;
    const { resolve, reject } = pending; pending = null;
    if (data.type === 'error') reject(new Error(data.message));
    else resolve(data);
  };
  worker.onerror = e => {
    if (pending) { pending.reject(new Error(e.message || 'Could not run the GIF worker.')); pending = null; }
  };
  const send = (data, transfer = []) => new Promise((resolve, reject) => {
    pending = { resolve, reject }; worker.postMessage(data, transfer);
  });
  const frameData = i => {
    drawFrame(ctx, i / timing.frames);
    resizeComposite(full, opts.profile, resized);
    return resized.getContext('2d').getImageData(0, 0, resized.width, resized.height).data;
  };
  try {
    await send({ type: 'init', opts: { ...size, ...timing, profile: opts.profile } });
    for (let i = 0; i < timing.frames; i++) {
      const rgba = frameData(i);
      await send({ type: 'sample', buffer: rgba.buffer }, [rgba.buffer]);
      opts.onProgress?.('palette', i + 1, timing.frames);
    }
    await send({ type: 'start' });
    for (let i = 0; i < timing.frames; i++) {
      const rgba = frameData(i);
      await send({ type: 'frame', index: i, buffer: rgba.buffer }, [rgba.buffer]);
      opts.onProgress?.('encode', i + 1, timing.frames);
    }
    const result = await send({ type: 'finish' });
    return new Blob([result.buffer], { type: 'image/gif' });
  } finally { worker.terminate(); }
}

export async function exportGIF(drawFrame, opts) {
  const blob = await encodeGIF(drawFrame, opts);
  downloadBlob(blob, `${stamp('glitterizer')}.gif`);
  return blob.size;
}
