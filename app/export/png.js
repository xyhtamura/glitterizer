// Still export. Composites the source and the sparkle layer into one canvas at
// working resolution. The output profile — resize, palette, dither — is M4, so
// this writes full colour for now. See glitterizer.md §4, §5.

import { downloadBlob, stamp } from './download.js';

export async function exportPNG(baseCanvas, sparkleCanvas) {
  const out = document.createElement('canvas');
  out.width = baseCanvas.width;
  out.height = baseCanvas.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(baseCanvas, 0, 0);
  ctx.drawImage(sparkleCanvas, 0, 0);

  const blob = await new Promise((res) => out.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Could not encode the image.');
  downloadBlob(blob, `${stamp('glitterizer')}.png`);
  return blob.size;
}
