// Frame compositor. Sparkles are drawn additively onto their own canvas; the
// source image sits on a canvas underneath and is never touched.
// The loop transport and time-varying draw arrive in M2 — see glitterizer.md §8.

import { lifeAt, positionAt } from './particles.js';

// Reused across particles so a frame does not allocate once per sparkle.
const pos = [0, 0];

export function renderFrame(ctx, particles, kit, t = 0, lifetime = 1) {
  const { width, height } = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  drawParticles(ctx, particles, kit, t, lifetime);
}

/** Sparkles only, over whatever is already on the context. */
export function drawParticles(ctx, particles, kit, t = 0, lifetime = 1) {
  if (!particles.length) return;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // Nearest-neighbour scaling of the sprite atlas. The chunky edge is the
  // point of this register, not an artefact to smooth away.
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const env = lifeAt(p.phase, t, lifetime);
    if (env <= 0) continue;
    positionAt(p, t, lifetime, pos);
    kit.draw(ctx, p, t, env, pos);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** Draw the source image onto the base canvas. Called once per image load. */
export function renderBase(ctx, image, w, h) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(image, 0, 0, w, h);
}
