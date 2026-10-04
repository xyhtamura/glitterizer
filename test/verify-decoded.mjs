import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = new URL('./output/', import.meta.url);
const frames = JSON.parse(await readFile(new URL('expected-frames.json', base)));
for (let i = 0; i < frames.length; i++) {
  const actual = await readFile(new URL(`fixture-${i}.rgba`, base));
  const expected = await readFile(new URL(`fixture-${i}.expected.rgba`, base));
  assert.ok(actual.equals(expected), `Decoded pixels differ for fixture ${i}`);
  const metadata = JSON.parse(await readFile(new URL(`fixture-${i}.json`, base), 'utf8'));
  assert.equal(Number(metadata.streams[0].nb_read_frames), frames[i]);
  assert.equal(Number(metadata.format.duration), 2);
}
console.log('PASS: all four GIFs decode to every expected pixel, exact frame counts, and 2 s duration.');
