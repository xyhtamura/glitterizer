import { GIFEncoder } from '../vendor/gifenc.js';
import { paletteFor } from './profile.js';
import { mapPalette } from './quantize.js';

let opts, samples, gif, palette, previous, transparentIndex;
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'init') {
      opts = data.opts; samples = []; previous = null;
    } else if (data.type === 'sample') {
      const rgba = new Uint8ClampedArray(data.buffer);
      const stride = Math.max(1, Math.ceil(rgba.length / 4 / 2048));
      for (let i = 0; i < rgba.length; i += stride * 4) samples.push(rgba[i], rgba[i + 1], rgba[i + 2], 255);
    } else if (data.type === 'start') {
      palette = paletteFor(new Uint8ClampedArray(samples), opts.profile, true);
      samples = null;
      transparentIndex = palette.length < 256 ? palette.length : -1;
      gif = GIFEncoder();
    } else if (data.type === 'frame') {
      const rgba = new Uint8ClampedArray(data.buffer);
      const { indexed } = mapPalette(rgba, opts.width, opts.height, palette, opts.profile.dither);
      const encoded = indexed.slice();
      const delta = previous !== null && transparentIndex >= 0;
      if (delta) for (let i = 0; i < encoded.length; i++) {
        if (indexed[i] === previous[i]) encoded[i] = transparentIndex;
      }
      // Cumulative rounding avoids changing the loop duration at 12 or 24 fps.
      const delay = 10 * (Math.round((data.index + 1) * opts.duration * 100 / opts.frames)
        - Math.round(data.index * opts.duration * 100 / opts.frames));
      const colorTable = transparentIndex >= 0 ? [...palette, [0, 0, 0]] : palette;
      gif.writeFrame(encoded, opts.width, opts.height, {
        palette: data.index === 0 ? colorTable : undefined,
        delay, repeat: 0, dispose: 1, transparent: delta, transparentIndex
      });
      previous = indexed;
    } else if (data.type === 'finish') {
      gif.finish();
      const bytes = gif.bytes();
      self.postMessage({ type: 'done', buffer: bytes.buffer }, [bytes.buffer]);
      return;
    }
    self.postMessage({ type: 'ready' });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
