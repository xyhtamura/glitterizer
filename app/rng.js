// Seeded randomness. Every particle property is derived from (seed, layerId,
// index), so nothing about a sparkle needs to be stored — see glitterizer.md §1.

/** splitmix32. Returns a function producing floats in [0, 1). */
export function splitmix32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return (t >>> 0) / 4294967296;
  };
}

/** Mix three integers into one 32-bit seed. */
export function hash3(a, b, c) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ b ^ (h >>> 13), 0xc2b2ae35);
  h = Math.imul(h ^ c ^ (h >>> 16), 0x27d4eb2f);
  return (h ^ (h >>> 15)) | 0;
}

/** A generator for one particle: stable across re-renders and edits. */
export function particleRng(seed, layerId, index) {
  return splitmix32(hash3(seed, layerId, index));
}

// R2, Roberts' generalized golden-ratio sequence. Low discrepancy in 2D, so
// candidate positions cover the canvas evenly instead of clumping the way
// uniform random does — sparse glitter still looks scattered rather than lumpy.
const G = 1.32471795724474602596;
const A1 = 1 / G;
const A2 = 1 / (G * G);

/** Candidate position n in unit square, offset so each layer differs. */
export function r2(n, ox, oy) {
  return [(ox + A1 * n) % 1, (oy + A2 * n) % 1];
}

/** Random-ish 32-bit seed for a new document or a reshuffle. */
export function newSeed() {
  return (Math.random() * 0xffffffff) | 0;
}
