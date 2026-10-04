// Where a sparkle goes. The painted direction field and the focal points feed
// one combined vector, so a scene can mix a brushed stream with a radial burst
// — see glitterizer.md §3.

export const FOCAL_MODES = [
  { v: 'emit', l: 'Emit outward' },
  { v: 'orbit', l: 'Orbit around' },
  { v: 'attract', l: 'Pull inward' }
];

export function newFocalPoint(x, y) {
  return { x, y, mode: 'emit', strength: 80, radius: 220 };
}

/**
 * Combined flow at an image pixel, written into `out` as [dx, dy] with a
 * magnitude of at most 1. Magnitude carries speed: a weakly painted area moves
 * its sparkles slowly.
 */
export function flowAt(doc, x, y, out) {
  let fx = 0;
  let fy = 0;

  if (doc.flow) {
    doc.flow.sample(x / doc.width, y / doc.height, out);
    fx = out[0];
    fy = out[1];
  }

  for (const fp of doc.focalPoints) {
    const dx = x - fp.x;
    const dy = y - fp.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= fp.radius) continue;
    // Squared falloff: the point has a definite edge rather than a haze.
    const fall = 1 - dist / fp.radius;
    const w = fall * fall * (fp.strength / 100);
    if (w <= 0) continue;
    // At the exact centre there is no outward direction to take; the vector
    // there is whatever the painted field says, which is the honest answer.
    const nx = dist > 1e-6 ? dx / dist : 0;
    const ny = dist > 1e-6 ? dy / dist : 0;
    if (fp.mode === 'emit') {
      fx += nx * w;
      fy += ny * w;
    } else if (fp.mode === 'attract') {
      fx -= nx * w;
      fy -= ny * w;
    } else {
      fx += -ny * w;
      fy += nx * w;
    }
  }

  const m = Math.hypot(fx, fy);
  if (m > 1) {
    fx /= m;
    fy /= m;
  }
  out[0] = fx;
  out[1] = fy;
  return out;
}

/** Is there anything for sparkles to travel along? */
export function hasFlow(doc) {
  if (doc.focalPoints.length) return true;
  return Boolean(doc.flow && !doc.flow.isEmpty());
}

/** Index of the focal point under an image-pixel position, or -1. */
export function focalPointAt(doc, x, y, grabRadius) {
  let best = -1;
  let bestDist = grabRadius;
  for (let i = 0; i < doc.focalPoints.length; i++) {
    const fp = doc.focalPoints[i];
    const d = Math.hypot(x - fp.x, y - fp.y);
    if (d <= bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}
