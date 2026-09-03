# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A web planetarium that lets you click a star and *hear* its absorption-line spectrum (clicking opens the spectrum; ▶ in the panel sounds it — selection itself is silent, hover mode is the automatic path). Stellarium Web Engine (C→WASM/WebGL) renders the sky; a React shell intercepts star selections, resolves each to an absorption-line list, and synthesizes audio with the raw Web Audio API. No audio libraries.

## Commands

```bash
npm run dev          # Vite dev server → http://localhost:5173
npm run build        # production build
npm run preview      # serve the production build

npm run verify:engine    # Playwright: loads the live engine, selects Sirius, checks the bridge payload
                         #   (needs `npm run dev` running + `npx playwright install chromium`)
npm run verify:extract   # unit: StellariumBridge.extractStarData on a synthetic populated star (no browser)
npm run verify:seed      # unit: SEED composer — determinism, in-key, no clustered voicings (no browser)
npm run verify:slice     # browser: silent selection, ▶ play-on-demand, curated/template badges
                         #   (needs `npm run dev` running + Playwright)
npm run verify:tooltip   # browser: hover readout on a star AND a non-star, edge-flip, hide-on-leave
                         #   (needs `npm run dev` running + Playwright)
```

There is no lint step and no test runner; the `verify:*` scripts in `scripts/` are plain Node `.mjs` files run directly. Playwright is not a declared dependency — it must be installed in the environment for every `verify:*` script except `verify:extract` and `verify:seed` (the browser-free ones). `verify:engine`, `verify:slice` and `verify:tooltip` all need `npm run dev` running first.

## The engine must be built before the app runs

The app will not work until the Stellarium Web Engine WASM artifacts exist in `public/engine/`. They are **git-ignored and not committed** — build them locally. This is the single biggest gotcha in the repo:

- Requires **Emscripten 1.39.17, pinned**. Newer Emscripten (3.x/4.x) removes runtime methods the engine's JS glue needs and fails at link.
- **Do not use `make js` / SCons** — it is unusable on a Windows path with spaces. Use `stellarium-web-engine/build-direct.sh`, which drives `emcc` directly.
- Full procedure (env vars, copy steps) is in [docs/BUILD.md](docs/BUILD.md). The cloned `stellarium-web-engine/` and `emsdk/` directories are build inputs, git-ignored, ~2 GB.

Required artifacts (see [public/engine/README.md](public/engine/README.md) and [src/engine/config.js](src/engine/config.js)):
- `public/engine/stellarium-web-engine.{js,wasm}`
- `public/engine/fonts/Roboto-{Regular,Bold}.ttf`
- `public/skydata/` ← copied from the engine repo's `apps/test-skydata/` (`stars/` is the only subtree needed for a clickable sky)

## Architecture (click → sound)

Three decoupled layers, wired together in [src/ui/App.jsx](src/ui/App.jsx):

1. **Engine bridge** — [src/engine/StellariumBridge.js](src/engine/StellariumBridge.js) wraps the raw Emscripten API into a tiny event emitter. Selection is **event-based**, not polled: it registers `stel.change((obj, attr) => …)` and filters to `attr === 'selection'` (ignore `'hovered'` — it fires on every mouse move). `extractStarData` normalizes a selected object into `{hip, hd, gaia, name, designations, spectralType, magnitude, bv, distanceAU, radecICRF}`. The verified JS surface (which methods/fields actually exist) is documented in [PHASE0-FINDINGS.md](PHASE0-FINDINGS.md); note `designations()` is a *method* and spectral type lives at `obj.jsonData.model_data.spect_t`, not a property. **Hover** is a second, separate path: the engine has no hover gesture, so `_wireHover` polls the custom-exported picker `stel.getObjAt(x, y, maxDist)` on canvas `mousemove` (throttled to one pick per frame) and emits `starHovered` / `starUnhovered`. Its payload carries `info` from `extractObjectInfo()` — a **type-agnostic** readout (name, otype label, mag, distance, size, alt/az, RA/Dec) for stars, clusters, galaxies, planets and moons alike, feeding [src/ui/ObjectTooltip.jsx](src/ui/ObjectTooltip.jsx). Read whatever you need *before* the pick releases the object (`_obj_release`).

2. **Data resolver** — [src/data/StarDataResolver.js](src/data/StarDataResolver.js) turns a selected star into a spectral line list via a cascade: (1) curated match against [src/data/bright-stars.js](src/data/bright-stars.js), then template by (2) spectral type, (3) B–V color, (4) default — see [src/data/spectral-templates.js](src/data/spectral-templates.js). Every selection always returns *something* so every star sings. Each result carries a `dataSource: 'curated' | 'template'` tag.

3. **Sonification engine** — [src/audio/SonificationEngine.js](src/audio/SonificationEngine.js) builds a per-line Web Audio graph: oscillator bank (mixed by excitation potential) → biquad lowpass (Q from line width) → ADSR gain (from line profile) → dry + algorithmic reverb buses ([src/audio/reverb.js](src/audio/reverb.js)). The seven spectral→audio mappings are pure functions in [src/audio/mappings.js](src/audio/mappings.js). One voice = one call to `_buildVoice(line, {freq, dur, when, gainScale})`; `playLine` is the monophonic wrapper around it, and everything polyphonic (chord, SEED) calls it directly.

   Three playback modes, all on the same voice graph: **SEQ** (`playSequence`, lines strongest-first), **CHORD** (`playChord`, all lines at once via [harmonize.js](harmonize.js)) and **SEED** (`playSeed` — see below).

### Things that bite

- **AudioContext needs a user gesture.** `ensureContext()` is created lazily; App.jsx unlocks it on the first `pointerdown`. Don't construct it earlier.
- **The canvas belongs to the engine, not React.** [src/ui/SkyCanvas.jsx](src/ui/SkyCanvas.jsx) hands the bare `<canvas>` to the bridge via a ref and never lets React re-render that node. The effect also guards against StrictMode's double-invoke spinning up two engines.
- **`listObjs()` is broken; enumerate the sky by hand.** The engine's own `module.listObjs(obs, maxMag, filter)` returns **at most one object** no matter what is in view — the `SweObj` constructor clobbers the same `g_ret` global the wrapper's loop is iterating. Call `_module_list_objs2` with your own `addFunction` callback and **snapshot the pointer array before constructing any `SweObj`**; recipe + measured costs in [PHASE0-FINDINGS.md](PHASE0-FINDINGS.md) §11-B. Done right it is cheap: ~5,300 stars enumerated in 2 ms, full data harvest 243 ms. But there is still **no forward RA/Dec→screen projection exported to JS** (§11-C, RING-OVERLAY-FINDINGS §2), so you can get data for thousands of objects and place none of them — screen positions come only from the inverse picker.
- **Selection is silent; playback is explicit.** `App.handleStarSelected` opens the spectrum and `stop()`s whatever was sounding, but starts nothing — the panel's ▶ (`handleReplay`) is the only way a click-selected star makes sound, and it flips to ■ while sounding. Switching SEQ↔CHORD is silent too. `scripts/verify-slice.mjs` asserts both halves (0 oscillators on select, >0 after ▶), so don't reintroduce auto-play without updating it. Hover mode is deliberately exempt — hovering still sounds immediately.
- **`mappings.js` magic numbers are live-tunable.** They live in `DEFAULT_PARAMS`; the Synth Character panel ([src/ui/SynthPanel.jsx](src/ui/SynthPanel.jsx)) edits them and changes apply to the *next* note. Every mapping function takes an optional `p` (params) argument — keep that signature if you add one.
- **Bundled catalog data is thin — and its ids are split.** `test-skydata` (vmag ≤ 7) carries B–V for every star and **no HD/Gaia ids and no spectral types**. HIP ids *are* present, but only on the stars that have **no** proper or Bayer/Flamsteed name: a star gets either a name (`Capella`, `* alf Aur`, `* 13 Aur`) **or** a bare `HIP 52425`, never both. So the bright stars you would want to resolve by HIP are exactly the ones missing it. Measured on a live view (~5,300 stars to mag 8): ~1,500 named/Bayer, ~3,760 HIP-only, 100% with B–V, 0% with spectral type. In practice bright stars resolve by name (tier 1) and everything else by B–V (tier 3); resolving *bright* stars by HIP needs a richer catalog (the `stellarium_star_catalogs` pipeline).
- **`observer.latitude`/`longitude` are RADIANS.** Everything else (the picker, [src/data/locations.js](src/data/locations.js), human intuition) speaks degrees, so this is a silent foot-gun. `StellariumBridge.setLocation(lat, lng)` takes **degrees** and converts; never assign raw degrees to the observer. The sky stays dark at any hour by design — see the time-control bullet below — but that darkness comes entirely from `atmosphere.visible = false`, not from freezing the clock.
- **Ground/horizon is user-toggleable, off by default.** `config.nightSky.landscape: false` only sets the engine's *starting* state — `StellariumBridge.setLandscapeVisible(bool)` flips `core.landscapes.visible` at runtime, wired to the GROUND button in [src/ui/GroundToggle.jsx](src/ui/GroundToggle.jsx) (top-left HUD, beside the location picker). Off means you can look straight through the ground at stars below the local horizon — useful for exploring, but not an actual horizon; on draws the `guereins` landscape silhouette from `public/skydata/landscapes/`.
- **Time is real and live by default, not locked.** An earlier revision pinned the clock to solar midnight at whatever location was selected (`config.nightSky.lockToNight`) — that's gone. `StellariumBridge.init()` now calls `setLive(true)`, and since `core_init` already seeds the observer from the real system clock, the app opens on the actual current sky, ticking forward (`core.time_speed = 1`). [src/ui/TimeControl.jsx](src/ui/TimeControl.jsx) (top-left HUD, third button) lets the user jump to any date/time — doing so calls `setDateTime(date)`, which **freezes** the clock there (`time_speed = 0`); picking a moment and having it immediately drift away would defeat the point. ▶ NOW calls `setLive(true)` again, which — this is the part that bit once — **must** re-snap `observer.utc` to `Date.now()` before flipping `time_speed` back on, or "live" silently means "keep ticking forward from wherever it was frozen" (e.g. still 1969) instead of jumping back to the present. Everything is UTC (the engine has no per-location timezone database, so it's the only unambiguous choice for "any point on Earth") — never assign a JS `Date` to `observer.tt` directly like the old code did; use `observer.utc = stel.date2MJD(date.getTime())` and `stel.MJD2date(observer.utc)` for the reverse, both genuine exported engine functions that handle the UTC/TT leap-second offset correctly. Changing location does **not** touch the clock, and vice versa — they're independent.
- **Sol is keyed `"SOL"`, not a HIP — and Sol is a validation star.** The Sun has no Hipparcos number, so [data-pipeline/output/bright-stars.json](data-pipeline/output/bright-stars.json) keys it `"SOL"` (all others are `"HIP…"`). Today the resolver matches by name/alias (`Sol`/`Sun`) so this is invisible. But **when resolution moves to HIP keys**, the engine still emits *some* id for the Sun (HIP 0 / a sentinel), and the bridge must map that to `"SOL"` — not `"HIP0"` — or one of the six validation stars silently falls through to a template. Put that mapping in `StellariumBridge` where star ids are normalized.
- **The `src/data/*.js` data modules are generated adapters.** `bright-stars.js` / `spectral-templates.js` import the committed JSON in [data-pipeline/output/](data-pipeline/output/) (the source of truth) and reshape it. Edit the **pipeline** (`data-pipeline/build-*.py`, or `common.py::FEATURES` for template line strengths) and rerun, not the JS. Templates are a physical *model*, not measured spectra — tune anchors there if a spectral class sounds wrong.

## Docs vs. code drift

The narrative docs ([docs/README.md](docs/README.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)) describe the *intended* design and are ahead of / diverged from the actual code. Trust the code. Notable mismatches:

- Spectral data reaches the app as JS modules (`bright-stars.js`, `spectral-templates.js`) — but they are thin adapters over [data-pipeline/output/](data-pipeline/output/)`bright-stars.json` / `spectral-templates.json`, which **do** exist and are committed. (An older revision of this file said they don't; they were added with the pipeline.) The docs' `catalogs.js` is what isn't built.
- UI is `SkyCanvas.jsx` + `SpectrumPanel.jsx` + `SynthPanel.jsx` + `LocationPicker.jsx` + `GroundToggle.jsx` + `TimeControl.jsx` + `RingOverlay.jsx` + `ObjectTooltip.jsx`; the docs' `StarInfoPanel` / `ParamMappingPanel` are not built — `ObjectTooltip` covers part of what `StarInfoPanel` was meant to do, and `SynthPanel` covers `ParamMappingPanel`.
- ARCHITECTURE.md's `StellariumBridge` sketch shows a polling `_pollSelection()` loop — that was the pre-Phase-0 guess and is **wrong**; the real bridge is event-based (see above).
- [stellar-sonification.jsx](stellar-sonification.jsx) (repo root) is the original single-file prototype the `src/` modules were extracted from — reference only, not imported.
- [harmonize.js](harmonize.js) (repo root, co-located with the prototype) is a standalone, browser-free module that snaps line frequencies onto a just-intonation consonance ladder. It is wired into **both** the prototype's chord mode and the `src/` app — [src/audio/harmonize.js](src/audio/harmonize.js) re-exports it (single source of truth, no copy) and `SonificationEngine.playChord` calls `harmonizeChord`. Earlier revisions of this file said `src/` didn't use it; that is no longer true.

[docs/ROADMAP.md](docs/ROADMAP.md) tracks phases. It marks 0 and 2.5 ✅ COMPLETE, but its own status lags the code: 1 (data layer / `StarDataResolver`), 2 (sonification engine) and 3 (spectrum panel) are all built in `src/`, and parts of 5 (hover audio, ring overlay, location picker, hover tooltip) too. **Phase 4 (a catalog carrying HIP + spectral type) is the real open one** — everything the resolver can't do traces back to it. The engine is AGPL-3.0 — relevant if distributing modified engine builds.

## SEED mode

A third playback mode that arranges a star's lines into a short piece instead of
just sounding them. The composer is [src/audio/seededMusic.js](src/audio/seededMusic.js)
— browser-free and pure, so `npm run verify:seed` checks it without an AudioContext.

Ported from **jak_e's "Seeded Procedural Music Generator"**
([codepen.io/jak_e/pen/EKRarY](https://codepen.io/jak_e/pen/EKRarY)) — attribution is
in the file header. What came across: the seeded PRNG, maj/min built from whole/half
step words, the library of bar-filling note-length sequences, the bass+treble voice
split, and **the rule that makes it sound composed** — a candidate note is rejected if
it or either neighbouring scale degree is already in the chord, so chords are never
clustered seconds.

What deliberately did **not** come across:
- **Tone.js.** Raw Web Audio is a project constraint; `playSeed` renders the plan
  through the normal `_buildVoice` graph, so timbre still comes from the line's physics.
- **seedrandom.** Replaced by a 20-line xmur3 + sfc32 PRNG — no dependency.
- **abcjs staff notation**, and the endless-measure streaming (pieces are 4 bars).
- **Random pitches.** This is the important divergence: the pen rolls dice for notes.
  Here **every pitch comes from an absorption line** (`wlToFreq` → snapped to the
  nearest degree of the key). The PRNG only chooses rhythm, which line lands in which
  slot, voicing and register — so the melody still encodes the spectrum and the seed
  only rearranges it.

The star owns the key, the seed owns the arrangement:
- **tonic** = pitch class of the star's strongest line (highest EW)
- **mode** = temperature (≥ 5500 K major, below minor)
- **tempo** = log-temperature mapped onto the pen's 60–120 bpm range
- **seed** = the star's name by default (so one star always plays one piece); the
  panel's seed box overrides it, and ↻ rerolls. Rerolling never changes key or tempo.

One addition of ours: **voice leading**. Because the degree is fixed by the spectrum,
the only freedom left is which octave to sing it in — `buildBar` takes the octave
nearest the previous note (with a seeded 25% chance of a deliberate leap), which is
what stops the melody hopping sevenths the way the pen's random register does.

Note `_buildVoice` squeezes the ADSR when a note is shorter than attack+decay+release
(SEED's eighth notes can be ~0.3 s). At the default 1.2 s tone nothing is clamped, so
SEQ/CHORD/hover are bit-identical to before.

## Chord mode (prototype)

[stellar-sonification.jsx](stellar-sonification.jsx) now has a **chord harmonization
mode** wired in (Phase 2.5 — see [docs/ROADMAP.md](docs/ROADMAP.md)). Alongside
sequential playback it can play all of a star's lines at once as a harmonized chord,
driven by [harmonize.js](harmonize.js), which lives at the **repo root, co-located
with the prototype** (import path `./harmonize.js`). The chord controls live in a
right-edge "HARMONICS" drawer.

- **No longer prototype-only.** Chord mode is in the `src/` app too: `SonificationEngine.playChord` (+ `startHoverChord` for hover), the SEQ/CHORD toggle in [src/ui/SpectrumPanel.jsx](src/ui/SpectrumPanel.jsx), and `mode` state in [src/ui/App.jsx](src/ui/App.jsx). What is still prototype-only is the **HARMONICS drawer** — the `src/` app exposes the mode but not that drawer's per-parameter chord controls.
- The **parameter-mapping panel is intentionally rendered *below* the line table**,
  not above it. Mounting it above caused a layout-feedback flicker loop (the panel's
  appearance reflowed the table out from under the cursor, retriggering hover).
  **Do not move it back above the table** without reserving its vertical space first.
