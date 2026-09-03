# RING-OVERLAY-FINDINGS.md

Investigation for the Star Ring Animation Overlay (Part 1 of the brief). Findings reflect
the current `src/` engine app (not the prototype). **Three items contradict assumptions in
the brief — see §6.** Read those before implementing.

> **Reading order (noted 2026-09-02):** §1–§6 are the *pre-build* investigation and quote code
> that has since been replaced — `playHoverChord` is now `startHoverChord` / `startHoverSequence`
> (per-`starKey` voice groups), hover-off fades in **both** modes via `fadeHoverStar` /
> `fadeAllHover`, and `App.handleStarHovered` now also feeds the hover tooltip
> ([src/ui/ObjectTooltip.jsx](src/ui/ObjectTooltip.jsx)) *before* the hover-audio gate, so the
> tooltip appears whether or not hover mode is on. **§7 records what actually shipped** — read it
> as the current state and §1–§6 as the reasoning that got there. §2 (no forward projection) and
> §5 (DPR) are still accurate and still binding.

---

## 1. Hover → audio path

The fire point is `handleStarHovered` in [src/ui/App.jsx](src/ui/App.jsx#L99), invoked by the
bridge's `starHovered` event (wired through `SkyCanvas`). It early-returns unless hover mode
is ON. It resolves the line list and dispatches by trigger type:

```js
// src/ui/App.jsx:99
const handleStarHovered = useCallback((star) => {
  if (!hoverEnabledRef.current) return;
  const resolved = resolverRef.current.resolve(star);            // ← resolved line list
  setHoveredStar({ ...resolved, screenX: star.screenX, screenY: star.screenY });
  if (hoverTypeRef.current === "chord") {
    engineRef.current.playHoverChord(resolved);                   // chord
  } else {
    engineRef.current.playSequence(resolved, { loop: ..., shouldContinue: ... }); // sequence
  }
}, []);
```

- **Resolved line list**: `resolved.lines` (array of `{wl, depth, width, profile, ew, ep, el}`),
  from `StarDataResolver.resolve(star)`. `resolved` also carries `name`, `color`, `rv`, `type`.
- **EW sorting**: NOT done here. `playSequence`/`playHoverChord` sort internally by EW desc.
  The overlay's `lines` payload must be sorted by EW desc by the emitter (brief requires it).
- This is the only place the overlay needs to hook for "start"; it has both the resolved
  lines and the screen position in scope.

## 2. Star screen coordinates — **screen-space only, no forward projection**

Hover detection lives in `StellariumBridge._wireHover` / `_starScreenCenter`
([src/engine/StellariumBridge.js](src/engine/StellariumBridge.js)). It works **entirely in
screen space**:

- The engine exposes only the **inverse** picker `core_get_obj_at(x, y, maxDist)` → object
  (we added the `EMSCRIPTEN_KEEPALIVE` export + `stel.getObjAt()` wrapper for hover). There
  is **no forward RA/Dec→screen projection exported** to JS. (`painter_project` /
  `project_to_win` exist in C but are not exported; `core_get_proj` exists but needs a
  painter.)
- The star's screen position is found by sampling the picker around the cursor and taking the
  centroid (`_starScreenCenter`), then cached as `screenX`/`screenY` (CSS px relative to the
  canvas, which is full-viewport `inset:0`, so ≈ viewport coords).

**Conclusion — Case B (no re-queryable projection).** Rings anchor to the **static cached
hover position**. They will **NOT track the star during panning/zooming** — accepted v1
degradation per the brief (Part 1.2, acceptance #7). The sky is also night-locked (frozen
clock) so there is no autonomous drift; only a user pan/zoom would desync, and during a drag
the cursor re-picks anyway. We pass a static `screenPos`, not a `positionQuery()`.

The RA/Dec-radians foot-gun (CLAUDE.md) is therefore **not in play** — we never feed RA/Dec
to a projection; we only consume already-computed screen pixels.

## 3. Fade-out observability — **asymmetric: chord fades, sequence hard-stops**

Hover-off is `handleStarUnhovered` ([src/ui/App.jsx](src/ui/App.jsx#L116)):

```js
const handleStarUnhovered = useCallback(() => {
  if (!hoverEnabledRef.current) return;
  setHoveredStar(null);
  if (hoverTypeRef.current === "chord") {
    engineRef.current.fadeOutHover(engineRef.current.params.hoverFadeOut); // FADE
  } else {
    engineRef.current.stop();                                              // HARD STOP
  }
}, []);
```

- **Chord** hover-off → `SonificationEngine.fadeOutHover(durationSec)` — linear gain ramp to 0
  over `durationSec`, then `osc.stop()`. Duration = `params.hoverFadeOut`, **default `0.8`**,
  defined in `DEFAULT_PARAMS` in [src/audio/mappings.js](src/audio/mappings.js) and editable
  via the Synth panel "Fade out (s)" slider (0.2–3.0).
- **Sequence** hover-off → `SonificationEngine.stop()` — **immediate**; clears `seqTimer`,
  `chordTimer`, stops `activeNodes`. No fade. (See §6-A.)
- **Rapid self-clear**: `playHoverChord` begins with `this.fadeOutHover(0.05)` to clear any
  prior hover chord (50 ms). `playSequence` begins with `this.stop()`.
- **Can the overlay be notified when a fade starts, with duration?** Not today — there are
  **no audio→UI events for fade/stop**. The only callbacks are `engine.onStep` /
  `engine.onChord` (line-highlight for the *selection/click* path). We must add the event
  surface (Part 3). Cleanest emit point is inside `SonificationEngine` (the audio layer):
  `fadeOutHover` knows the duration; `playHoverChord`/`playSequence` know start; a hard stop
  knows stop. `starKey`, `screenPos`, and sorted `lines` are known at the App call sites — so
  the emit needs those passed in (see §6-C).

## 4. Concurrency state — **effectively max 1 today; no registry, no cap of 3**

- Hover audio uses a **single shared pool** `SonificationEngine.hoverNodes` (chord) plus the
  shared `activeNodes`/`seqTimer` (sequence). There is **no per-star tracking** and **no
  ordered registry**.
- Because `playHoverChord` self-clears (`fadeOutHover(0.05)`) and `playSequence` self-`stop()`s
  at entry, hovering a new star **replaces** the previous one. So the **current effective cap
  is 1 concurrent ringing star.**
- No "max concurrent stars" constant exists anywhere.

→ Implementing the brief's **max-3 with force-fade-oldest** requires a real refactor: per-star
node pools keyed by `starKey`, an ordered registry, and per-star fade/stop. This is the bulk
of Part 2 and touches both chord and sequence paths (see §6-B).

## 5. DPR handling

The engine sizes its own canvas in [stellarium-web-engine/src/js/canvas.js](stellarium-web-engine/src/js/canvas.js):

```js
var dpr = window.devicePixelRatio || 1;
var rect = canvas.getBoundingClientRect();        // CSS px
canvas.width  = rect.width  * dpr;                // backing store = CSS × dpr
canvas.height = rect.height * dpr;
Module._core_render(rect.width, rect.height, dpr);
```

`SkyCanvas` styles the canvas `position:absolute; inset:0; width:100%; height:100%`. So the
overlay must mirror exactly: **CSS size = viewport; backing store = CSS × dpr; draw in CSS px
after `ctx.setTransform(dpr,0,0,dpr,0,0)`** (or `ctx.scale(dpr,dpr)`). Hover `screenX/screenY`
are already in **CSS px**, so rings drawn in CSS-px space land on the star at any DPR.

---

## 6. Contradictions with the brief (resolve before building)

**A. Sequence hover-off is a hard stop, not a "rapid fade."** The brief states (Part 2,
Part 3 `starFadeStart`, acceptance #4) that hover-off "continues to trigger the rapid fade …
existing behavior." That is true only for **chord** mode. **Sequence** hover-off calls
`engine.stop()` — instant silence, no fade. Proposed resolution (no audio-curve change, per
"What NOT to touch"): for sequence hover-off, emit `starStopped` immediately (treat as
`fadeDurationSec = 0`) so rings vanish exactly when sound does. Confirm, or you want sequence
hover-off changed to a real fade (that *would* change existing behavior).

**B. Max-3 concurrency is a substantial audio refactor, not a tweak.** Today hover audio is a
single shared pool that replaces on each hover (effective max 1). To get 3 independent ringing
stars with force-fade-oldest I will refactor hover playback into **per-`starKey` voice groups**
(each its own node list + gain, independently fade/stoppable) and an **ordered registry** in
`SonificationEngine`. Chord and sequence both need this; sequence especially (today one shared
`seqTimer`) becomes up to 3 concurrent staggered sequences. This is the largest part of the
work and changes the core hover-audio structure — flagging so it's an expected, deliberate
change, not scope creep.

**C. `starKey` needs a source.** No stable per-star key exists. Proposed: derive from the raw
selected star — `star.hip ? "HIP"+hip : (star.name || designations[0])` — computed in the
bridge or App and threaded into the engine calls + events. (Note the CLAUDE.md `SOL` caveat;
irrelevant to hover-by-name today.)

**D. Re-hover of an already-ringing star** (Part 2) must be idempotent — needs the registry
from B to detect "already present" by `starKey`.

---

## 7. Resolutions applied (post-confirmation)

- **§6-A**: per user decision, sequence hover-off now **fades** over `hoverFadeOut`
  (same path as chord), not a hard stop. `fadeHoverStar(key, dur)` is the single
  fade path for hover-off and force-fade-oldest.
- **§6-B concurrency model (refined during build)**: moving the cursor star→star
  does **not** stop the previous star — up to 3 stars **accumulate and ring
  together**. The cap is on **actively-singing** stars (3); hovering a 4th
  force-fades the **oldest active** star over `hoverFadeOut` (a fading tail may
  briefly coexist, which is the audible expression of "the oldest rapid-fades as
  the new one starts"). Leaving the cursor to **empty sky / mouseleave** winds
  **all** ringing stars down via `fadeAllHover`. (The bridge therefore emits
  `starHovered` on star-change but `starUnhovered` only on leave-to-empty.)
- **§6-C `starKey`**: the bridge's existing hover identity string (`obj.id` /
  first designation / pointer) is reused as the key for audio + rings.
- **§6-D re-hover**: `_admitHoverStar` returns false (no-op) if the star is already
  ringing and not fading; if it was mid-fade it is hard-stopped and restarted.
- Engine debug hooks added (mirroring `window.__bridge`/`__stel`):
  `window.__engine` and `window.__ringOverlay` (used by the acceptance checks).

## Proposed build order (unchanged from brief, pending §6 confirmation)

1. (this doc)
2. Audio layer: per-`starKey` registry + max-3 + force-fade-oldest; resolve §6-A/B/C.
   Test audibly.
3. Emit `starChordStart` / `starLineStart` / `starFadeStart` / `starStopped` from the engine.
4. `RingOverlay.jsx`: positioning, DPR, resize, idle-aware rAF.
5. Chord rendering → 6. Sequence rendering → 7. Multi-star/force-fade → 8. Acceptance walk.
