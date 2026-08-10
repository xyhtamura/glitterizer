// Deriving particles from fields. Nothing here is stored on the document —
// given the same seed and the same fields this produces the same sparkles, in
// the same order, every time. See glitterizer.md §1.

import { particleRng, r2, splitmix32 } from './rng.js';

/** Hard ceiling on candidates tested, regardless of density and image size. */
const MAX_CANDIDATES = 120000;

/**
 * @param {Doc} doc
 * @param {object} kit    the active kit module
 * @returns {Array} particles, each with at least x, y, plus kit properties
 */
export function deriveParticles(doc, kit) {
  const field = doc.density;
  if (!field || field.isEmpty()) return [];

  const area = doc.width * doc.height;
  const target = doc.layer.density * area / 10000;

  // A candidate survives with probability density(x, y), so the expected
  // accepted count is target * mean(density). Testing target/mean candidates
  // would hit the target exactly, but then the pool would shrink as you paint
  // and the same seed would place sparkles differently. Testing a fixed pool
  // sized by area keeps placement stable while painting; the accepted count
  // scales with how much of the image is actually painted, which is what the
  // "per 100 px²" label promises for painted area.
  const candidates = Math.min(MAX_CANDIDATES, Math.ceil(target / Math.max(0.02, field.mean())));
  const limit = doc.layer.maxParticles;

  // Offsets keep two layers with the same seed from landing on top of one
  // another, and give "reshuffle" something to move.
  const off = splitmix32(doc.seed ^ (doc.layerId * 0x2545f491));
  const ox = off();
  const oy = off();

  const out = [];
  for (let i = 0; i < candidates && out.length < limit; i++) {
    const [u, v] = r2(i, ox, oy);
    const d = field.sample(u, v);
    if (d <= 0) continue;

    const rng = particleRng(doc.seed, doc.layerId, i);
    if (rng() >= d) continue;

    // Drawn before the kit gets the generator, so birth phase is a property of
    // the particle rather than of whichever kit happens to be active.
    const phase = rng();

    const x = u * doc.width;
    const y = v * doc.height;
    const sampled = doc.source.at(x, y);
    const p = kit.spawn(rng, sampled, doc.kitParams, d);
    p.x = x;
    p.y = y;
    p.density = d;
    p.phase = phase;
    out.push(p);
  }
  return out;
}

/**
 * Lifetime envelope, 0 when the particle is not alive at time t.
 *
 * Birth phases are uniform and every lifetime is the same length, so the live
 * population is stationary: the same number of sparkles are alive at t = 0 and
 * t = 1, and the loop closes without a visible reset. A lifetime covering the
 * whole loop is the special case where nothing is ever born or dies.
 *
 * @param {number} phase  birth phase in [0, 1)
 * @param {number} t      loop time in [0, 1)
 * @param {number} life   lifetime as a fraction of the loop
 */
export function lifeAt(phase, t, life) {
  if (life >= 1) return 1;
  let age = (t - phase) % 1;
  if (age < 0) age += 1;
  if (age >= life) return 0;
  const u = age / life;
  if (u < 0.2) return u / 0.2;        // quick in
  if (u > 0.65) return (1 - u) / 0.35; // slower out
  return 1;
}
