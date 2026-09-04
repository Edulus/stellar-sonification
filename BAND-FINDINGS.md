# BAND-FINDINGS

Investigation for `RING-TO-BAND-BRIEF.md`. This file records the current implementation only. No band code has been changed.

## 1. Where rings are created and what they carry today

The visual objects are created in `src/ui/RingOverlay.jsx`, in the audio-event handlers subscribed inside the overlay's `useEffect`.

There are two different current representations.

### Sequence mode

`onLineStart({ starKey, line, durationSec, screenPos })` creates or retrieves the per-star sequence system, then appends one explicit ring object:

```js
sys.rings.push({
  color: wlToRGB(line.wl),
  startT: now(),
  durationSec: durationSec || 1,
});
```

So a sequence ring currently carries exactly:

- `color` — RGB derived from the line wavelength
- `startT` — emission time in seconds, from `performance.now() / 1000`
- `durationSec` — the emitted tone duration, with a `1` second fallback

It does **not** carry a stroke-width/thickness field. Stroke thickness is the module constant `STROKE = 2` used only at draw time.

### Chord mode

Chord rings are not individual objects today. `onChordStart({ starKey, screenPos, lines })` creates one per-star system with:

```js
{
  mode: "chord",
  pos: screenPos,
  colors: (lines || []).map((l) => wlToRGB(l.wl)),
  startT: now(),
  fadeStartT: null,
  fadeDur: 0,
}
```

The individual chord rings therefore exist only implicitly as entries in `sys.colors`. They have no individual `born`/`startT`, lifetime, depth, or thickness fields. All chord rings share the system's `startT` and fade state.

## 2. Where rings are drawn and what the draw calls look like

All ring drawing is in `RingOverlay.jsx` inside the idle-aware `draw()` rAF callback.

The canvas is first DPR-scaled and cleared in CSS-pixel coordinates:

```js
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
ctx.clearRect(0, 0, w, h);
```

### Chord draw

For each `sys.colors` entry:

```js
const radius = BASE_RADIUS + i * RING_SPACING + drift;
const alpha = CHORD_OPACITY * spawn * fadeK;
ctx.beginPath();
ctx.arc(sys.pos.x, sys.pos.y, radius, 0, Math.PI * 2);
ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
ctx.lineWidth = STROKE;
ctx.stroke();
```

`drift = CHORD_DRIFT * (t - sys.startT)`. The rings are thin stroked circles.

### Sequence draw

For each explicit `sys.rings` entry:

```js
const progress = (t - ring.startT) / ring.durationSec;
const radius = BASE_RADIUS + progress * SEQ_EXPAND;
const env = (progress < 0.15 ? progress / 0.15 : 1) * (1 - progress);
const alpha = SEQ_OPACITY * env * fadeK;
ctx.beginPath();
ctx.arc(sys.pos.x, sys.pos.y, radius, 0, Math.PI * 2);
ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
ctx.lineWidth = STROKE;
ctx.stroke();
```

A sequence ring is spliced out when `progress >= 1`.

The current center is `sys.pos.x`, `sys.pos.y`. The current code does not expose a separately named `starRadius`; the ring geometry starts from module constant `BASE_RADIUS = 14`.

## 3. Current per-ring lifetime and whether it is tied to tone duration

### Sequence: yes, already tied to the tone duration

`SonificationEngine.startHoverSequence()` emits:

```js
this._emit("starLineStart", {
  starKey: key,
  line,
  index: i,
  durationSec: p.toneDuration,
  screenPos,
});
```

`RingOverlay.onLineStart()` stores that as `ring.durationSec`, and the draw loop removes the ring at `progress >= 1`, where:

```js
progress = (t - ring.startT) / ring.durationSec;
```

Therefore the sequence ring's lifetime is already the tone duration, `p.toneDuration`.

### Chord: no fixed per-ring lifetime exists today

`SonificationEngine.startHoverChord()` builds held voices (`held: true`) and emits `starChordStart` with the sorted line list, but no duration. Those voices are sustained until `fadeHoverStar()` is called. The overlay likewise keeps the chord system alive until the matching `starFadeStart` / `starStopped` events drive its fade/removal.

So the brief's statement that a band's `life` is "the tone's duration, unchanged from today's ring lifetime" is directly true for sequence mode, but **not** for chord mode. There is no current chord-ring `life` value to preserve. This needs reviewer direction before implementation because inventing one here would change the existing audio-visual lock.

## 4. Storage model: per-star, not one flat ring list

The overlay owns:

```js
const systemsRef = useRef(new Map()); // starKey -> ring system
```

Each active star has one system in that map.

- Sequence system: `starKey -> { mode: "sequence", pos, rings: [...], fadeStartT, fadeDur }`
- Chord system: `starKey -> { mode: "chord", pos, colors: [...], startT, fadeStartT, fadeDur }`

So rings are held per-star. There is no global flat list of rings.

The max-three-star concurrency remains enforced upstream in `SonificationEngine.hoverStars` / `MAX_HOVER_STARS = 3`, with oldest-active force-fade in `_admitHoverStar()`.

## 5. Are wavelength and depth in scope at emission time?

Yes, both are already available at the audio emission sites.

### Sequence emission

`startHoverSequence()` has the full `line` object in scope. Immediately before emitting `starLineStart`, it already reads:

```js
const gain = depthToGain(line.depth, p) * ...;
```

and the event passes the same full `line` object:

```js
this._emit("starLineStart", { starKey: key, line, ... });
```

Therefore both `line.wl` and `line.depth` reach `RingOverlay.onLineStart()` today.

### Chord emission

`startHoverChord()` also has the full line objects in scope. It reads `line.depth` while building each voice, then emits the EW-sorted full line list:

```js
const sortedLines = data.lines.slice().sort((a, b) => b.ew - a.ew);
this._emit("starChordStart", { starKey: key, screenPos, lines: sortedLines });
```

So `line.wl` and `line.depth` are present at chord emission time too. The current overlay discards depth when it immediately maps the chord lines to `colors`, but no upstream data change is needed to compute the proposed `peak = 0.35 + line.depth * 0.55`.

## 6. Review gate before code

The requested band fields and depth-based `peak` are implementable from data already present for sequence emissions and chord-start emissions.

One design point is unresolved by the current code and must be reviewed before implementation:

- Sequence tones have a finite `p.toneDuration`, and their ring lifetime already matches it exactly.
- Chord tones are deliberately held indefinitely until fade/stop, and chord rings have no finite per-ring lifetime today.

The implementation should therefore not assign a finite chord-band `life` until the reviewer specifies how the new `born`/`life` band model is meant to represent a sustained chord without changing its existing lifetime or fade-on-stop behavior.

**STOP: investigation complete. No ring-to-band code changes made.**
