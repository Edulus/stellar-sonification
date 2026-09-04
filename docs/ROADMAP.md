# Roadmap

## Phase 0 — Scaffold and Prove Engine Integration ✅ COMPLETE

**Goal**: Get Stellarium Web Engine rendering in a React app with click events emitting star identifiers.

**No audio yet.** This phase is purely about proving the engine works in the browser and that we can intercept user interactions with individual stars.

> **Status: DONE.** Engine builds from source and runs as WASM in the browser;
> selection events fire; the bridge emits normalized star data. Build procedure
> in [`BUILD.md`](BUILD.md); full API + findings in
> [`../PHASE0-FINDINGS.md`](../PHASE0-FINDINGS.md).

### Tasks

- [x] Initialize Vite + React project
- [x] Build Stellarium Web Engine from source (Emscripten → WASM + JS glue) — needed pinned **emscripten 1.39.17** + a custom `build-direct.sh` (SCons unusable on this Windows path); see PHASE0-FINDINGS.md §6
- [x] Copy engine artifacts to `public/engine/` (+ skydata to `public/skydata/`)
- [x] Create `StellariumBridge.js` — wrapper class that initializes engine into a canvas ref
- [x] Wire selection event → log star identifier to console — via `stel.change((obj,attr)=>…)` filtered to `attr==='selection'` (event-based, not polling)
- [x] Verify `hip`, `hd`, `spectralType`, `magnitude` — ⚠️ **partial**: `magnitude` (+ name/BV/distance/radec) come live from the engine; `hip`/`spectralType` need a richer catalog than the bundled sample (data-tier gap; see Acceptance + PHASE0-FINDINGS.md §9). Bridge extraction of all fields proven by `verify:extract`.
- [x] Create `SkyCanvas.jsx` — React component that mounts bridge, fills viewport
- [x] Handle basic nav: drag to pan, scroll to zoom — the engine's own `canvas.js` wires this for free
- [x] Confirm WASM loads correctly, WebGL context is healthy, no React re-render interference

### Acceptance criteria

Target: clicking Sirius logs `{ hip: 32349, name: "Sirius", spType: "A1V", vmag: -1.46, ... }`.

**Result:** live selection of Sirius logs `{ name: "Sirius", magnitude: -1.44, bv, distance, radec, hip: null, spectralType: null }` — engine integration proven (`npm run verify:engine`). `hip`/`spType` are `null` only because the bundled `test-skydata` catalog omits them; the bridge produces the exact target payload (`hip: 32349, spectralType: "A1V"`) when given a catalog that carries those fields (`npm run verify:extract`).

### Risks

- ~~Stellarium Web Engine's JS API uses an attribute-based model... we'll need to poll~~ — ✅ RESOLVED: selection is delivered via the `stel.change((obj, attr) => …)` callback (filter `attr === 'selection'`); no polling loop is required. The `apps/web-frontend/` Vue app was the authoritative reference, as predicted.
- The engine is AGPL-3.0. Understand licensing implications before distributing.
- The engine repo has had consistent commits through 2026 (3,474 total), so it's actively maintained, but the JS-facing API may not be thoroughly documented beyond the internals doc and the Vue app example.

### Key references for Phase 0

- `stellarium-web-engine/doc/internals.md` — C object model, attribute system, sky object properties
- `stellarium-web-engine/apps/simple-html/` — minimal browser embedding example
- `stellarium-web-engine/apps/web-frontend/` — full Vue app using the engine (reference for JS API usage)
- `stellarium-web-engine/src/modules/stars.c` — star module implementation (defines available star attributes)
- `stellarium_star_catalogs/` — catalog pipeline showing what data fields exist per star (HIP, HD, Gaia, spectral type, B-V, magnitude)

---

## Phase 1 — Data Layer and Star Resolution

**Goal**: Click a star in the sky and resolve its absorption line data.

> ⚠️ **Carried over from Phase 0 (PHASE0-FINDINGS.md §9):** the bundled engine
> catalog (`test-skydata`, vmag ≤ 7) provides **no HIP/HD/Gaia ids and no
> spectral types** — selected stars come back with only name + magnitude +
> position. Before HIP-keyed resolution can work, Phase 1 must obtain a richer
> catalog (the `stellarium_star_catalogs` pipeline) **or** add a fallback that
> matches the engine's selection to our dataset by name/position when HIP is
> absent. This is the first task, not an afterthought.

### Tasks

- [ ] Create `spectral-templates.json` — curate ~70 canonical spectral type templates, each with 4–8 representative absorption lines
  - Cover O, B, A, F, G, K, M classes at standard subclasses and luminosity classes (V, III, I)
  - Use data from `stellar-sonification.jsx` as starting points for the 6 existing stars
  - Source remaining templates from NIST Atomic Spectra Database + published spectral atlases
- [ ] Create `bright-stars.json` — start with the 6 stars already in the prototype, expand toward ~100
  - Key by HIP number for fast lookup
  - Include all 7 sonification parameters per line: `wl, depth, width, profile, ew, el, ep`
  - Include star-level fields: `name, type, temp, rv, color`
- [ ] Implement `StarDataResolver.js`
  - Load both JSON files at app startup
  - Implement resolution cascade: bright-stars → template fallback
  - Implement spectral type parser: handle "G2V", "G2 V", "G2/3V", "G2Ve", "K1.5III", etc.
  - Implement nearest-match logic for unmatched subtypes
- [ ] Integrate resolver with bridge: star click → resolve → store result in React state
- [ ] Build `StarInfoPanel.jsx` — display selected star name, type, temp, RV, data source badge
- [ ] Create `catalogs.js` — HIP↔HD cross-reference for the curated set (enables lookup by either ID)

### Acceptance criteria

Clicking any star in the sky populates `StarInfoPanel` with correct metadata and a line list. Bright stars show "curated" badge. Unknown stars show "template" badge with their matched spectral type.

### Key data decisions

- Template absorption lines should be physically reasonable but don't need to be publication-quality. They need to *sound right* — the sonification maps are forgiving of small parameter errors.
- `rv` for template fallback should default to 0 (no detune). Only curated stars carry measured radial velocities.
- `color` for template fallback can be computed from `temp` using a Teff→RGB mapping.

---

## Phase 2 — Sonification Engine

**Goal**: Select a star and hear it through explicit playback controls.

### Tasks

- [x] Extract `mappings.js` from `stellar-sonification.jsx`
  - `wlToFreq(wl)` — wavelength → pitch
  - `depthToGain(depth)` — absorption depth → amplitude
  - `widthToQ(width)` — line width → filter Q
  - `profileToEnvelope(profile)` — line profile → ADSR
  - `ewToReverb(ew)` — equivalent width → reverb send
  - `rvToDetune(rv)` — radial velocity → detune
  - `epToHarmonics(ep)` — excitation potential → harmonic richness
  - Export all as pure functions with no side effects
- [x] Extract `reverb.js` — algorithmic reverb builder
  - 4 parallel delay lines (29ms, 37ms, 53ms, 67ms)
  - Feedback gains: [0.6, 0.55, 0.5, 0.45] + reverbAmt * 0.2
  - LP damping: 2500 - reverbAmt * 800 Hz
  - Takes AudioContext + reverbAmt, returns connected graph
- [x] Build `SonificationEngine.js`
  - `ensureContext()` — lazily create/resume AudioContext from a user gesture
  - `playLine(line, starRV = 0)` — build oscillator bank, filter, ADSR, reverb
  - `playSequence(data, opts = {})` — sort lines by EW desc and play sequentially
  - `playChord(data, amount = params.harmonizeAmount)` — harmonize and play all lines together
  - `playSeed(data, opts = {})` — render the deterministic seeded arrangement
  - `stop()` — stop active click/sequence/chord/SEED playback
  - `getParams(line, starRV = 0)` — return computed params for UI display (no audio)
- [x] Wire into App: star selection resolves data and stays silent; the panel's ▶ routes the selected mode to `playSequence`, `playChord`, or `playSeed`, while a spectrum-line click calls `playLine`
- [ ] Verify audio plays correctly in Chrome, Firefox, Safari (AudioContext quirks differ by browser)
- [x] Handle edge case: selecting a new star while previous click playback is still playing → stop old playback and load the new spectrum

### Acceptance criteria

Selecting Sol or Vega and pressing ▶ produces distinct audio from the same spectral mappings; selecting a random dim star with template data produces reasonable audio. Selection itself remains silent, with playback explicit through the panel or hover mode.

### Audio polish (can defer)

- Consider crossfade between old and new star instead of hard stop
- Consider ambient pad that fades in when no star is selected (subtle, very quiet)
- Volume master control

---

## Phase 2.5 — Chord Harmonization Mode ✅ COMPLETE

**Goal**: Let the user hear a star's absorption lines played *simultaneously* as a
musically-coherent chord, alongside the existing sequential playback.

> **Status: DONE.** Built and verified first in the standalone
> `stellar-sonification.jsx` prototype, then ported into the modular `src/` app.
> `SonificationEngine.playChord()` is live, and `src/ui/App.jsx` routes CHORD mode
> through it.

### What was built

- [x] `harmonize.js` (repo root) — pure-function module: pulls each line's raw
      `wlToFreq` pitch toward the nearest just-intonation consonant interval relative
      to the strongest-EW root line. Exports `harmonizeChord`, `describeChord`,
      `CHORD_TIMING`, `centsBetween`. No Web Audio deps.
- [x] Chord playback (`playChord`) in `SonificationEngine` — all lines at once through
      the same oscillator→filter→ADSR voice topology, EW-staggered onsets, 1/√N gain
      scaling, and a chord-level master swell/release envelope.
- [x] Harmonize slider (0–100%) — blends raw cluster → fully consonant chord; also
      sweeps random detune, filter brightness, and reverb wetness for an audible
      data→harmony contrast.
- [x] Sequential octave (−2..+2) and speed (400–2400 ms) controls — apply live to a
      running sequence and to single-line clicks.
- [x] HARMONICS drawer panel — right-edge tab + slide-out panel housing the mode
      toggle, sliders, and a live chord readout (root, quality, per-voice interval +
      pull %).
- [x] Simultaneous spectrum glow — chord mode lights every line at once, each in its
      own wavelength color, for the chord's full duration.
- [x] Parameter-mapping panel flicker fix — relocated the panel below the line table
      to break a hover→reflow→re-hover feedback loop.

### Acceptance criteria

Toggling to Chord mode and pressing play sounds all lines together; harmonize at 0%
is a dissonant cluster, at 100% a consonant chord; different stars produce audibly
different chords; sequential mode is unchanged.

---

## Phase 3 — Spectrum Visualization

**Goal**: When a star is selected, display its absorption spectrum alongside the sky.

### Tasks

- [ ] Port `SpectrumCanvas` from `stellar-sonification.jsx` → `SpectrumPanel.jsx`
  - Canvas 2D rendering: blackbody curve with absorption dips
  - Wavelength → visible color strip
  - Absorption line markers with element labels
  - Active/playing line highlighting
  - Hover detection on lines (show element + wavelength)
- [ ] Port `ParamBar` → `ParamMappingPanel.jsx`
  - 7 parameter bars showing current sonification mapping
  - Only visible when a line is active (hovered or playing)
- [ ] Design panel layout
  - Spectrum panel slides up from bottom or in from right
  - Semi-transparent background so sky is still partially visible
  - Collapse/dismiss button
  - Panel should not intercept engine's mouse events when collapsed
- [ ] Wire hover/click on spectrum lines → `sonificationEngine.playLine()`
  - This gives a secondary interaction mode: explore lines visually, click to hear
- [ ] Sync playing state between sequence playback and spectrum highlighting

### Acceptance criteria

Selecting a star opens the spectrum panel. The panel accurately shows the blackbody curve, absorption dips, and element labels. Hovering a line in the panel highlights it and shows sonification parameters. Clicking a line plays its tone. Playing a sequence animates through lines in the panel.

---

## Phase 4 — Data Expansion

**Goal**: Grow the curated bright star dataset and improve template coverage.

### Tasks

- [ ] Build `data-pipeline/build-bright-stars.py`
  - Source: NIST Atomic Spectra Database + Kaler's "Stars and their Spectra" + published EW catalogs
  - Target: top ~500 brightest stars (V < 4.5) with real line measurements
  - Output: `bright-stars.json` keyed by HIP number
- [ ] Build `data-pipeline/build-templates.py`
  - Source: PHOENIX synthetic spectra (Husser et al. 2013)
  - For each spectral type: compute synthetic spectrum, identify strongest absorption features, extract line list
  - Output: `spectral-templates.json` with ~70 entries
- [ ] Evaluate Gaia BP/RP as an intermediate data tier
  - `data-pipeline/extract-gaia-bprp.py`
  - Low-resolution but individual per star — could give unique (if coarse) sonification
  - If viable, add as middle tier in resolution cascade
- [ ] Build cross-reference catalog: `catalogs.js`
  - HIP → HD → Gaia source ID mappings for all stars in the datasets
  - Enables resolution regardless of which ID the engine provides

### Acceptance criteria

500+ stars have curated data. Every spectral subtype from O5V to M8III has a template. The resolution cascade never returns empty-handed.

---

## Phase 5 — Polish and UX

**Goal**: Make it feel like a finished instrument, not a prototype.

### Tasks

- [ ] Star search: text input → find by name → engine navigates to star + auto-play
- [ ] Constellation mode: play all bright stars in a constellation as a chord or arpeggio
- [ ] Comparison mode: select two stars, hear them side by side
- [ ] Audio controls: master volume, playback speed, pitch range adjustment
- [ ] Keyboard shortcuts: space=play/stop, arrows=cycle lines, tab=next star
- [ ] Mobile: responsive layout, touch events, address orientation
- [ ] Loading states: engine WASM download progress, first-render indicator
- [ ] About/help overlay explaining the sonification mapping
- [ ] Share: generate URL with star ID + view parameters for direct links
- [ ] Performance: profile engine + audio on low-end devices, optimize if needed

---

## Phase 6 — Extended Features (Future)

Ideas for later, out of scope for initial release:

- **Continuous audification mode**: as the user pans across the sky, stars within the field of view produce a quiet ambient soundscape weighted by brightness
- **Time evolution**: adjust the time slider and hear how proper motion / precession shifts the sky's sound
- **Spectral class explorer**: a non-sky-based mode that lets users walk through the spectral classification sequence (OBAFGKM) hearing how stars change from hot to cool
- **Educational overlays**: show which elements produce which lines, link to atomic physics explanations
- **Export**: render a star's sonification to WAV/MP3 for download
- **Accessibility**: screen reader support for spectrum panel, audio descriptions of sky navigation
- **Multi-star chords**: select multiple stars and hear their spectra simultaneously as a chord

---

## Dependencies and Unknowns

### Hard dependencies

- Stellarium Web Engine builds and runs in current browsers (last active development was ~2022; may need patches)
- Web Audio API is supported (it is, in all modern browsers)
- WASM loads correctly through Vite's dev server and production build

### Unknowns to resolve early

- **Engine JS API surface**: The engine uses an attribute-based object model (documented in `doc/internals.md`). Properties are accessed via `obj_call()` internally, surfaced to JS through Emscripten bindings. Selection is likely an attribute on `core_t` (e.g., `stel.core.selection`), not an event listener. The `apps/web-frontend/` Vue app in the engine repo is the definitive reference for how JS accesses star properties — study it before writing the bridge.
- **Designation format**: Stars carry designations as strings (e.g., "HIP 32349", "HD 48915"). The exact format of the designations array returned to JS needs testing. The `stellarium_star_catalogs` repo confirms HIP/HD/Gaia cross-refs exist in the catalog pipeline.
- **Spectral type availability**: The engine's star catalogs are built from Hipparcos + Gaia DR3 data with spectral data from SIMBAD (per `stellarium_star_catalogs` repo). Bright stars should have spectral types; faint Gaia-only stars may not. Need to test coverage.
- **Engine interop with React**: The engine manages its own DOM and render loop via WebGL. Using a ref and keeping React away from the canvas subtree should work, but needs Phase 0 verification. The Vue app in the engine repo proves the pattern works with a frontend framework.
- **WASM binary size**: Star catalog data is hierarchical (levels 0–8) and partially baked into the WASM binary. Need to measure total download size and decide on loading strategy (streaming instantiation, progress indicator).
- **AGPL-3.0 license**: The engine is AGPL-licensed, not GPL. This affects how the combined work must be licensed — any modifications to the engine or server-side use requires source availability. Our sonification layer is a separate module communicating via the JS API, which may limit copyleft scope, but this needs legal clarity.

### Nice-to-have explorations

- **WebGPU**: Stellarium Web Engine uses WebGL. If/when WebGPU support is added, it could improve rendering quality. Not a blocker.
- **SharedArrayBuffer**: Could enable engine computation on a worker thread. Requires COOP/COEP headers. Worth investigating for performance.
- **Tone.js**: The current implementation uses raw Web Audio API. Tone.js could simplify some patterns (scheduling, transport) but adds a dependency. Evaluate if complexity warrants it.
