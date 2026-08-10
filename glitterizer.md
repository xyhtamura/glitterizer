# glitterizer

Brush procedural glitter over an image. You paint fields, not pixels: where
glitter lives, which way it travels, how tight the focus is, what colour it
takes. A renderer derives sparkles from those fields and composites them over
the untouched source. Output is a still, a loop, or a Blingee-grade GIF.

Build-free static project. Root `index.html`, browser-native ES modules, no
bundler. Served from the root server as
`http://localhost:8000/glitterizer/`.

---

## 1. Model

The document is `{ source, layers[], focalPoints[], loop, seed }`. Nothing is
ever painted into the source image. Each layer holds strokes; strokes rasterize
into four **field maps**, each a low-resolution single-channel (or 2-channel)
buffer stretched over the image:

| Field | Channels | Painted by | Read as |
|---|---|---|---|
| `density` | 1 | main brush | probability a candidate sparkle survives |
| `flow` | 2 | direction drag | advection vector, per unit loop time |
| `focus` | 1 | focus brush | kit-dependent concentration (see §3) |
| `tint` | 3 | colour brush, or sampled | sparkle colour before kit shading |

Field maps run at 1/4 image resolution and are bilinearly sampled. They are
stored in the project file as PNG data URLs, so a saved document reopens
byte-identical without re-simulating anything.

### Determinism

Particles are **derived, never stored**. Given `(seed, layerId, index)` a seeded
PRNG (splitmix32) produces every property of particle *i*. Candidate positions
come from a low-discrepancy sequence over the canvas; a candidate survives if
`rng() < density(x, y)`. Consequences:

- Editing a stroke and re-rendering changes only the region the stroke touched.
- Any frame at time `t` is reproducible without having rendered `t − 1`.
- A project file carries a seed and some fields, not a particle dump.

### Time

One loop, `t ∈ [0, 1)`, `N` frames (default 24). A particle has a birth phase
`φᵢ` drawn uniformly and a lifetime `λ` (a fraction of the loop). Because birth
phases are uniform and lifetimes are equal, the live population is stationary:
the frame at `t = 0` matches the frame at `t = 1` and the loop closes with no
pop. Particles fade in and out across their lifetime rather than appearing.

Position over time is advection through `flow`. Rather than integrating per
frame, each particle's path is precomputed once as a short polyline (L = 16
fixed steps) and sampled at `t`; this keeps per-frame cost to a lookup and
prevents integration drift across re-renders.

**Known simplification.** A hand-painted flow field is not divergence-free, so
particles accumulate at sinks and thin out at sources — density during motion
drifts away from the painted `density` field. v1 accepts the drift, which at
Blingee scale reads as "the sparkles gather over there" rather than as an error.
If it becomes objectionable, the fix is a Helmholtz–Hodge projection of `flow`
to its divergence-free part, or re-seeding weighted by the local density
deficit. Standard technique either way, not an open question.

---

## 2. Kits

A **kit** is a sparkle species: how one particle is drawn, and which extra
per-particle properties it needs. Kits share the field substrate, the PRNG, the
lifetime model, and the advection. They differ only in the draw call and in
what they make of the `focus` field.

A kit exports:

```js
export default {
  id, label,
  params,                       // declarative control schema → auto-built UI
  init(ctx, opts),              // build sprite atlas / shader, once
  spawn(rng, sampled),          // per-particle properties
  draw(ctx, p, t, opts)         // one particle, one frame
}
```

`sampled` gives the kit the source image's colour and luminance under the
particle, so kits can respond to the photo.

### v1 kits (three)

**`blingee`** — the 2007 stamp look. Chunky pre-rendered sprite atlas: 4-point
star, 6-point star, cross-twinkle, snowflake, heart, ring. Hard-edged, fully
saturated, no falloff worth the name. Twinkle is a discrete size/frame cycle,
not a smooth curve — sparkles snap between three sizes and an off state.
Composited with `globalCompositeOperation: 'lighter'`. Optional per-frame hue
rotation of the whole layer, which is what gives the rainbow crawl.

**`ascii`** — glyph glitter. Sparkles snap to a monospace character grid and
render as text: `* + · ✦ x . ° ˙`. Cell size is a control. Glyph is chosen by
brightness, so a sparkle "fades" by walking down a glyph ramp instead of
dimming. Colour from `tint` or sampled from the source. Reads as terminal
snow over a photograph.

**`bokeh`** — defocused highlights. Soft-edged discs (aperture blades a
control: 0 = circle, 5–8 = polygon), additive, with a brighter rim and a mild
chromatic fringe. Radius and count are driven by `focus` (§3). Brightness is
weighted by the source luminance under the particle, so it lands on the
picture's existing highlights instead of floating free.

### Later kits

**`flare`** — anisotropic streaks and ghost discs along the line from a focal
point through the image centre. Depends on focal points, so it comes after §3
lands. **`flake`** — literal glitter: small quads with random surface normals
and a virtual light that sweeps with `t`, so each flake flashes as the light
crosses its normal. The one kit where the sparkle is a material rather than a
sprite.

---

## 3. Focus

Focus is **not** a depth map. Two mechanisms, both of which the kits read:

**Focal points.** Draggable markers on the canvas. Each has a strength, a
radius, and a mode: `emit` (particles are born near it and travel outward),
`orbit` (tangential flow around it), `attract` (flow bends toward it). Focal
points write into the same `flow` field the direction brush writes into, so a
scene can mix a painted stream with a radial burst. This is what makes light
appear to come from somewhere.

**The focus brush.** Paints the `focus` field — concentration of attention, not
optics. Every kit interprets it, and interpretation is what distinguishes the
registers:

- `blingee`: high focus = more sparkles, larger sprites, brighter, faster
  twinkle. Low focus = sparse and small.
- `ascii`: high focus = denser grid occupancy and higher glyphs on the ramp.
- `bokeh`: high focus = *small and sharp*; low focus = large soft discs. The
  same painted field reads as depth of field without anyone having to author a
  depth map, because a photograph's subject is usually also its focal plane.

---

## 4. Register, as an output stage

Kit and register are independent axes. Rendering runs at source resolution in
full colour; the vintage look is a post-process applied on the way out, so a
photoreal `bokeh` composite can be pushed through the 2007 downgrade and a
`blingee` composite can be exported clean.

**Output profile** controls, in order of application:

1. Resize — long edge cap (none / 800 / 600 / 400 / 320 px).
2. Palette — none / adaptive *n*-colour (median cut, 8–256) / fixed web-safe.
3. Dither — none / Bayer 4×4 / Bayer 8×8 / Floyd–Steinberg.
4. Frame rate — 24 / 15 / 12 / 10 fps.

The "2007" preset is 400 px, 64-colour adaptive, Bayer 8×8, 12 fps. The "clean"
preset is no resize, no quantization, 24 fps.

---

## 5. Export

| Format | Path | Notes |
|---|---|---|
| PNG | `canvas.toBlob` | Single frame at the playhead, full resolution. |
| WebM | `MediaRecorder` on the canvas stream | Cheap, smooth, high colour. Records whole loops back to back. MediaRecorder writes no duration into the header, so players report the length as infinite and often will not seek; the pixels are correct and the loop point is exact. |
| GIF | vendored `gifenc` | Runs the output profile, then encodes. Frame-differenced, transparency-optimized. Encode off the main thread in a Worker; show progress. |
| JSON | `doc.serialize()` | Source image as data URL, field maps as PNG data URLs, strokes, kit params, focal points, seed. Reopens exactly. |

Everything is client-side. No upload, no server.

---

## 6. Rendering

Canvas2D, not WebGL, until measurement says otherwise. Sprite atlases are
pre-rendered once per kit into an offscreen canvas; per particle the draw is a
transformed `drawImage` under `lighter`. Budget: 2,000 live particles × 24
frames. If a kit exceeds frame budget the fallback is a WebGL point-sprite
path behind the same kit interface, not a rewrite.

Two canvases stacked: the source image (static, drawn once) and the sparkle
layer (redrawn per frame). Brush feedback draws to a third overlay canvas so
strokes never trigger a sparkle re-render mid-drag.

---

## 7. Files

```
glitterizer/
  index.html
  styles.css
  app/
    main.js          boot, DOM wiring, playback transport
    doc.js           document model, undo stack, serialize/deserialize
    fields.js        field map allocation, sampling, stroke rasterization
    brush.js         pointer → stroke → field write
    rng.js           splitmix32 + low-discrepancy sampler
    particles.js     deterministic derivation, lifetimes, advection paths
    render.js        frame compositor, kit dispatch
    focal.js         focal point markers and their contribution to flow
    kits/
      index.js       registry
      blingee.js
      ascii.js
      bokeh.js
    export/
      png.js
      webm.js
      gif.js         worker driver
      gif.worker.js
      quantize.js    median cut, Bayer, Floyd–Steinberg
      profile.js     output profile pipeline
    vendor/
      gifenc.js
  glitterizer.md
```

---

## 8. Build order

- **M1** — *Done 2026-08-10.* Load image (file picker, drag-drop, paste).
  Density brush writing a field. `blingee` kit, static frame. PNG export.
  Proves the field → particle → composite chain.
- **M2** — *Done 2026-08-10.* Loop transport, birth phases, twinkle, playback
  scrubber. WebM export. Project JSON save/load.
- **M3** — Flow brush, advection paths, focal points, focus brush and its per-kit
  interpretation.
- **M4** — Output profiles: quantize, dither, resize. GIF export in a worker.
  This is the milestone that makes it Blingee rather than a particle demo.
- **M5** — `ascii` and `bokeh` kits.
- **M6** — Auto-glitter: luminance threshold + Sobel edges seed the density
  field in one click, so the tool has a zero-brushstroke path to a result.
- **Later** — `flare` and `flake` kits. Layer list UI with per-layer kit and
  blend mode. Stamp import for user PNG sprites.

---

## 9. Interface copy

Flat register throughout, per
[WRITING_VOICE_AGENT.md](../WRITING_VOICE_AGENT.md). Controls are named for what
they change, in perceived units. "Sparkles per 100 px²", not "intensity".
"Loop length (frames)", not "duration". Empty state is "Drop an image, or click
to choose one." Export progress is "Encoding frame 9 of 24." No atmosphere in
the labels; the atmosphere is the output.

---

## Log

**2026-08-09 — Claude Code —** Wrote this spec. Decisions settled with the user:
focus means focal points plus painted attention density, not a depth map; all
four export formats are in scope; both registers ship, as kit × output-profile
rather than as one switch, starting with three kits (`blingee`, `ascii`,
`bokeh`). Nothing implemented yet — the folder contains only this file. Next is
M1.

**2026-08-10 — Claude Code —** Built M1. The app loads an image by picker,
drag-drop, or paste; the brush writes the density field; the `blingee` kit
renders a static frame; PNG export composites base and sparkle layers.
Undo (one step per stroke, 30 deep), erase, clear, and reshuffle all work.
Files as laid out in §7, minus the kits and export paths belonging to later
milestones.

Two departures from the spec as written, both deliberate:

- **Candidate pool sizing.** §1 implied the pool tracks the target count. It is
  instead `target / mean(density)`, clamped, so the pool does not shrink as you
  paint — a shrinking pool re-indexes the R2 sequence and existing sparkles jump
  on every stroke. Placement now stays put while you paint, and the accepted
  count scales with painted area, which is what "per 100 px²" should mean.
- **Stroke buffer.** Strokes accumulate into their own field with a max and
  commit on release, rather than writing the density field directly. A slow drag
  and a fast one now leave the same mark, and one undo step covers one stroke.

Verified in the browser against a generated test image: painted a sine-wave
stroke and a ring, confirmed sparkles follow the painted field and stop at its
edge; erased across part of the stroke and confirmed the sparkles thin there;
switched colour source to "Image underneath" and confirmed sparkles take the
hue of what they sit on; toggled snowflake and heart shapes on; exported a
523 KB PNG. Defaults were raised after looking at the first render — 3 sparkles
per 100 px² reads as dust, so the default is 6, with sizes 8–32 px.

Left undone: everything from M2 on. Nothing known broken. One environment note
for whoever verifies next — the render is scheduled on `requestAnimationFrame`,
which browsers throttle to zero in a hidden tab, so an automated check that
never displays the page will see stale canvases after a synthetic stroke.
Clicking "Reshuffle placement" renders synchronously and sidesteps it.

**2026-08-10 — Claude Code —** Built M2. Loop transport with play/pause, a frame
scrubber, and keyboard control (space, comma, full stop); per-particle birth
phases and the lifetime envelope from §1; twinkle and spin in the `blingee`
kit; WebM export; project save and load. Particles are now derived once and
cached, and only redrawn per frame — playback does not re-derive.

Design points worth keeping:

- **Everything periodic is a whole number of cycles per loop.** Twinkle rate is
  an integer multiplied by an integer factor, spin is one turn per loop or
  none, and the lifetime envelope is modular in `t`. Verified rather than
  assumed: drawing 400 particles at `t = 0` and at `t = 1` gives a
  pixel-identical canvas, while `t = 0.5` differs across 65,188 bytes of image
  data. The loop closes exactly, which is what M3's advection will need.
- **Twinkle snaps, it does not fade.** Four discrete levels including off, in a
  per-particle shuffled order. A smooth brightness curve reads as a modern
  particle system; the jump is the register.
- **Birth phase is drawn before the kit sees the generator**, so it belongs to
  the particle rather than to whichever kit is active.
- **`scheduleDraw` falls back to drawing immediately when the tab is hidden**,
  since `requestAnimationFrame` never fires there and would otherwise leave a
  stale canvas behind an export.

One real bug found by testing and fixed: the first WebM recording of a session
came back as a bare 400-byte container. Frames pushed to the encoder in the
first moments after `start()` are dropped while it spins up, and on a
one-second loop that is the entire file. The export now draws a priming frame,
starts with a 200 ms timeslice, and settles for 250 ms before the first
recorded frame. Three consecutive exports from a freshly loaded page now come
back at 230 KB each.

Verified in the browser: painted a band and confirmed frames 0, 4 and 12 differ
by roughly the whole lit area while frame 0 is identical each time it is
revisited; saved a project, then cleared the field, reshuffled the seed and
changed a kit parameter (46,834 pixels changed), loaded the project back and
got a pixel-identical frame; confirmed the exported WebM decodes at 800 × 500;
confirmed a 30% lifetime lights about 28% as many pixels per frame as a 100%
lifetime without the population collapsing on any frame.

Known caveat, not a bug: MediaRecorder writes no duration into the WebM header,
so players report infinite length and many will not seek. This is one more
reason M4's GIF path is the real deliverable for a loop.

Left undone: M3 onward. The flow field, focal points, and the focus brush are
next, and the particle path precomputation described in §1 does not exist yet —
sparkles currently hold still and only twinkle.

**2026-08-10 — Antigravity —** Overhauled the CSS interface design (`styles.css` and `index.html`) following Xyh's design calibration principles (`xyh-design-calibration.md`, `xyh-design-fallbacks.md`). The new design synthesizes Blingee-era web studio chrome (shimmer title badge, bedazzled stage frame, 3D gel buttons) with 80s toy glitter magic (*Care Bears* cloud contours, *Escape from Catrina* potion plum depth) and *Lisa Frank* max-chroma neon gradients. Maintained 100% flat usability copy, clear body typography, and functional event targets. Verified locally on `http://localhost:8000/glitterizer/`.

**2026-08-10 — Antigravity —** Evolved design to a radiant, hyper-girly cotton-candy pearl light mode using Google Fonts (`DynaPuff`, `Sniglet`, `Fredoka`). Replaced dark plum background with a soft pastel sugar-pink, sky-cyan, and lavender gradient (`#fcf2fa`) with high-contrast deep berry ink (`#380d4a`), glossy strawberry candy 3D gel buttons, and heart/ribbon sparkle icons. Verified locally on `http://localhost:8000/glitterizer/`.


