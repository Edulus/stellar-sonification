# Ring → Band: replace the thin ring with a ripple band

The ring overlay currently draws a thin stroked circle per tone. Replace that with a
thick radial band whose outer edge is bright and whose inner edge fades toward the
star — a ripple from a thrown stone. Everything else about the overlay stays as it is.

This is a **delta**. The overlay canvas, its DPR matching, `pointer-events: none`, the
idle-aware rAF loop, the max-3-star concurrency with force-fade-oldest, and the
audio-visual lock are all already built and correct. Do not rewrite them, do not
re-architect them, do not "improve" them along the way.

## 1. Investigation (required before any code)

Write findings to `BAND-FINDINGS.md`, then stop and wait for review.

- Where does a ring get created, and what fields does a ring object carry today?
- Where is a ring drawn each frame, and what does the draw call look like?
- What is the per-ring lifetime today, and where does it come from? Confirm it is
  already tied to tone duration; if it is not, say so rather than fixing it here.
- Are rings held per-star or in one flat list? The band model does not change this,
  but the reviewer needs to know before signing off.
- Confirm the emitting code has the line's wavelength and depth in scope at emission
  time. If depth is not available where a band is born, say where it would have to
  come from.

## 2. Change the ring object into a band object

At emission, a band carries:

- `born` — `performance.now()` at emission
- `life` — the tone's duration, unchanged from today's ring lifetime
- `rgb` — `wlToRGB(line.wl)`, unchanged from today
- `peak` — `0.35 + line.depth * 0.55`

`peak` is the only new field. Remove any ring-thickness or stroke-width field the
current ring object carries; the band derives its thickness from age.

## 3. Geometry constants

Add these near the top of the overlay module. Module constants, not state, not props.

```js
const BAND_SPEED     = 200; // px/s — leading edge travel
const BAND_STRETCH   = 130; // px/s — thickening as it travels
const BAND_THICKNESS = 16;  // px   — thickness at birth
const BAND_FADE      = 1.5; // exponent on the overall fade
```

These are the tuned values from the sandbox. Use them exactly.

## 4. Replace the draw

Per band, per frame, with `age = (now - band.born) / 1000` and `u = age / band.life`:

```js
const outer = starRadius + BAND_SPEED * age;
const inner = Math.max(0, outer - (BAND_THICKNESS + BAND_STRETCH * age));
const alpha = Math.pow(1 - u, BAND_FADE) * band.peak;
if (alpha <= 0.002 || outer <= 0) return;

const [r, g, b] = band.rgb;
const innerStop = Math.min(0.999, inner / outer);
const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, outer);
grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
grad.addColorStop(innerStop, `rgba(${r},${g},${b},0)`);
grad.addColorStop(
  Math.min(0.999, innerStop + (1 - innerStop) * 0.55),
  `rgba(${r},${g},${b},${alpha * 0.35})`
);
grad.addColorStop(0.985, `rgba(${r},${g},${b},${alpha})`);
grad.addColorStop(1, `rgba(${r},${g},${b},${alpha * 0.45})`);

ctx.fillStyle = grad;
ctx.beginPath();
ctx.arc(cx, cy, outer, 0, Math.PI * 2);
ctx.fill();
```

`cx, cy` are the star's screen position, `starRadius` its drawn radius — both from the
existing ring code. Bands are filled arcs, not strokes; delete the stroke path.

Set `ctx.globalCompositeOperation = "lighter"` before the band loop and restore it to
`"source-over"` after. Overlapping bands are meant to brighten where they cross.

## 5. Out of scope

- Panel controls or any UI for the four constants
- Easing the expansion (it stays linear)
- Changing band life, concurrency limits, or fade-out-on-audio-stop behaviour
- Touching the spectrum panel, the line table, or panel placement
- Any change to `harmonize.js`, the mappings, or the data pipeline

## 6. Acceptance

- Each tone emits one band; the band is gone when its tone is gone, no sooner, no later.
- The band's outer edge is visibly the brightest part and the inside fades to nothing
  before reaching the star.
- Successive tones produce concentric bands in their own colours, the newest innermost.
- A deep line (Betelgeuse Na I D₁, depth 0.90) is visibly brighter than a shallow one
  (Vega Fe I, depth 0.08).
- Nothing renders when no audio is playing, and the rAF loop still parks itself idle.

## 7. Order

1. Investigation → `BAND-FINDINGS.md` → stop for review
2. Band object fields + constants
3. Draw replacement
4. Manual pass across all six prototype stars
