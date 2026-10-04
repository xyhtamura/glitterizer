import { adaptivePalette, webSafePalette, mapPalette } from './quantize.js';

export const CLEAN = { edge: '0', palette: 'none', colors: 256, dither: 'none', fps: '24' };
export const VINTAGE = { edge: '400', palette: 'adaptive', colors: 64, dither: 'bayer8', fps: '12' };
export const PROFILE_PARAMS = [
  { key: 'edge', label: 'Maximum long edge (px)', type: 'select', value: '0', options:
    [0, 800, 600, 400, 320].map(v => ({ v: String(v), l: v ? String(v) : 'Working size' })) },
  { key: 'palette', label: 'Palette', type: 'select', value: 'none', options:
    [{ v: 'none', l: 'Full color' }, { v: 'adaptive', l: 'Adaptive' }, { v: 'websafe', l: 'Web-safe (216 colors)' }] },
  { key: 'colors', label: 'Palette colors', type: 'range', min: 8, max: 256, step: 1, value: 256, showIf: { palette: 'adaptive' } },
  { key: 'dither', label: 'Dither', type: 'select', value: 'none', options:
    [{ v: 'none', l: 'None' }, { v: 'bayer4', l: 'Bayer 4 × 4' }, { v: 'bayer8', l: 'Bayer 8 × 8' }, { v: 'fs', l: 'Floyd–Steinberg' }] },
  { key: 'fps', label: 'Output frames per second', type: 'select', value: '24', options:
    [24, 15, 12, 10].map(v => ({ v: String(v), l: String(v) })) }
];

export function outputSize(width, height, profile) {
  const edge = Number(profile.edge);
  const scale = edge > 0 ? Math.min(1, edge / Math.max(width, height)) : 1;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function outputTiming(loop, profile) {
  const duration = loop.frames / loop.fps;
  const frames = Math.max(1, Math.round(duration * Number(profile.fps)));
  return { frames, fps: frames / duration, duration };
}

export function paletteFor(rgba, profile, gif = false) {
  if (profile.palette === 'websafe') return webSafePalette();
  if (profile.palette === 'none' && !gif) return null;
  return adaptivePalette(rgba, profile.palette === 'adaptive' ? Number(profile.colors) : 256);
}

/** Resize the finished composite. Transparent sources are flattened onto white. */
export function resizeComposite(source, profile, out = document.createElement('canvas')) {
  const size = outputSize(source.width, source.height, profile);
  if (out.width !== size.width) out.width = size.width;
  if (out.height !== size.height) out.height = size.height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

export function applyProfile(source, profile, out) {
  out = resizeComposite(source, profile, out);
  if (profile.palette === 'none') return out;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, out.width, out.height);
  const palette = paletteFor(image.data, profile);
  image.data.set(mapPalette(image.data, out.width, out.height, palette, profile.dither).rgba);
  ctx.putImageData(image, 0, 0);
  return out;
}
