// Composite the current source and sparkle frame, then apply the output profile.

import { downloadBlob, stamp } from './download.js';
import { applyProfile } from './profile.js';

export async function exportPNG(baseCanvas, sparkleCanvas, profile) {
  const out = document.createElement('canvas');
  out.width = baseCanvas.width;
  out.height = baseCanvas.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(baseCanvas, 0, 0);
  ctx.drawImage(sparkleCanvas, 0, 0);

  const processed = applyProfile(out, profile);
  const blob = await new Promise((res) => processed.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Could not encode the image.');
  downloadBlob(blob, `${stamp('glitterizer')}.png`);
  return blob.size;
}
