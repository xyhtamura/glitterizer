/** Browser/decoder checks. node test/verify-export.mjs --playwright <module path> [--browser <executable>] */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const args = process.argv.slice(2);
const arg = name => args[args.indexOf(name) + 1];
if (!args.includes('--playwright')) throw new Error('Pass --playwright with the installed Playwright module path.');
const require = createRequire(import.meta.url);
const { chromium } = require(resolve(arg('--playwright')));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'test/output');
await mkdir(out, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!path.startsWith(root + '/')) {
      // Windows separators are handled by the second containment check.
      if (!path.startsWith(root + '\\')) throw new Error('Outside root');
    }
    const data = await readFile(path.endsWith('\\') || path.endsWith('/') ? path + 'index.html' : path);
    res.setHeader('Content-Type', { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' }[extname(path)] || 'application/octet-stream');
    res.end(data);
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true, ...(args.includes('--browser') ? { executablePath: arg('--browser') } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  const fixture = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 400;
    const ctx = c.getContext('2d'), g = ctx.createLinearGradient(0, 0, 640, 400);
    g.addColorStop(0, '#173786'); g.addColorStop(0.5, '#ee268f'); g.addColorStop(1, '#f8c633');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 640, 400);
    return c.toDataURL().split(',')[1];
  });
  await page.locator('#file').setInputFiles({ name: 'gradient.png', mimeType: 'image/png', buffer: Buffer.from(fixture, 'base64') });
  await page.locator('#panel').waitFor({ state: 'visible' });
  await page.locator('#btn-play').click();
  const overlay = await page.locator('#overlay').boundingBox();
  await page.mouse.move(overlay.x + overlay.width * 0.2, overlay.y + overlay.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(overlay.x + overlay.width * 0.8, overlay.y + overlay.height * 0.5, { steps: 20 });
  await page.mouse.up();
  await page.locator('#btn-2007').click();
  await page.locator('#preview-output').check();
  await page.waitForTimeout(150);
  assert.deepEqual(await page.locator('#output-preview').evaluate(c => [c.width, c.height]), [400, 250]);
  const bounds = await page.evaluate(() => ['base', 'output-preview', 'overlay'].map(id => {
    const r = document.getElementById(id).getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
  }));
  assert.deepEqual(bounds[0], bounds[1]); assert.deepEqual(bounds[0], bounds[2]);
  const loops = page.getByLabel('Loops to record');
  await loops.fill('1'); await loops.dispatchEvent('input');
  for (const [button, name] of [['#btn-png', 'ui.png'], ['#btn-gif', 'ui.gif'], ['#btn-webm', 'ui.webm'], ['#btn-save', 'project.json']]) {
    const wait = page.waitForEvent('download'); await page.locator(button).click();
    await (await wait).saveAs(resolve(out, name));
    await page.waitForFunction(() => !document.getElementById('btn-png').disabled);
  }
  const project = JSON.parse(await readFile(resolve(out, 'project.json'), 'utf8'));
  assert.equal(project.profile.colors, 64); assert.equal(project.profile.dither, 'bayer8');
  await page.locator('#btn-clean').click();
  await page.locator('#file-project').setInputFiles(resolve(out, 'project.json'));
  await page.waitForFunction(() => !document.getElementById('btn-png').disabled);
  assert.equal(await page.getByLabel('Maximum long edge (px)').inputValue(), '400');
  delete project.profile; project.version = 1;
  await writeFile(resolve(out, 'old-project.json'), JSON.stringify(project));
  await page.locator('#file-project').setInputFiles(resolve(out, 'old-project.json'));
  await page.waitForFunction(() => !document.getElementById('btn-png').disabled);
  assert.equal(await page.getByLabel('Palette', { exact: true }).inputValue(), 'none');
  await page.locator('#btn-play').click();
  await page.screenshot({ path: resolve(out, 'interface.png'), fullPage: true });

  const encoded = await page.evaluate(async () => {
    const { encodeGIF } = await import('/app/export/gif.js');
    const { paletteFor, outputTiming, resizeComposite } = await import('/app/export/profile.js');
    const { mapPalette } = await import('/app/export/quantize.js');
    const width = 80, height = 48, loop = { frames: 24, fps: 12 };
    const draw = (ctx, t) => {
      const g = ctx.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, '#102030'); g.addColorStop(1, '#ecbadc');
      ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.floor(t * 55), 12, 12, 12);
      ctx.fillStyle = '#00ee55'; ctx.fillRect(60, 30, 10, 10);
    };
    const b64 = bytes => {
      let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return btoa(s);
    };
    const results = [];
    for (const profile of [
      { edge: '0', palette: 'adaptive', colors: 64, dither: 'bayer8', fps: '12' },
      { edge: '0', palette: 'adaptive', colors: 256, dither: 'fs', fps: '24' },
      { edge: '0', palette: 'websafe', colors: 64, dither: 'bayer4', fps: '15' },
      { edge: '0', palette: 'none', colors: 256, dither: 'none', fps: '10' }
    ]) {
      const timing = outputTiming(loop, profile), samples = [], frames = [];
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const resized = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      for (let i = 0; i < timing.frames; i++) {
        draw(ctx, i / timing.frames);
        resizeComposite(canvas, profile, resized);
        const rgba = resized.getContext('2d').getImageData(0, 0, width, height).data; frames.push(rgba);
        const stride = Math.max(1, Math.ceil(width * height / 2048));
        for (let j = 0; j < rgba.length; j += stride * 4) samples.push(rgba[j], rgba[j + 1], rgba[j + 2], 255);
      }
      const palette = paletteFor(new Uint8ClampedArray(samples), profile, true);
      const expected = new Uint8Array(timing.frames * width * height * 4);
      frames.forEach((rgba, i) => expected.set(mapPalette(rgba, width, height, palette, profile.dither).rgba, i * width * height * 4));
      const blob = await encodeGIF(draw, { width, height, loop, profile });
      results.push({ gif: b64(new Uint8Array(await blob.arrayBuffer())), expected: b64(expected), frames: timing.frames });
    }
    return results;
  });
  for (let i = 0; i < encoded.length; i++) {
    const file = resolve(out, `fixture-${i}.gif`);
    await writeFile(file, Buffer.from(encoded[i].gif, 'base64'));
    await writeFile(resolve(out, `fixture-${i}.expected.rgba`), Buffer.from(encoded[i].expected, 'base64'));
  }
  await writeFile(resolve(out, 'expected-frames.json'), JSON.stringify(encoded.map(c => c.frames)));
  assert.deepEqual(errors, []);
  console.log('PASS: UI presets, preview alignment, PNG/GIF downloads, project round trip, old project defaults. Four GIF fixtures and expected pixels written for decoder verification.');
} finally { await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
