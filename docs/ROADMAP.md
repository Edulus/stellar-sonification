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
- [x] Verify `hip`, `hd`, `spectralType`, `magnitude` — ⚠️ **partial**: `magnitude` (+ name/BV/distance/radec) come live from the engine; the bundled sample splits named stars from HIP-only stars, has no HD/Gaia ids, and has no spectral types in the measured sample (data-tier gap; see Acceptance + PHASE0-FINDINGS.md §11-A). Bridge extraction of all fields proven by `verify:extract`.
- [x] Create `SkyCanvas.jsx` — React component that mounts bridge, fills viewport
- [x] Handle basic nav: drag to pan, scroll to zoom — the engine's own `canvas.js` wires this for free
- [x] Confirm WASM loads correctly, WebGL context is healthy, no React re-render interference

### Acceptance criteria

Target: clicking Sirius logs `{ hip: 32349, name: "Sirius", spType: "A1V", vmag: -1.46, ... }`.

**Result:** live selection of Sirius logs `{ name: "Sirius", magnitude: -1.44, bv, distance, radec, hip: null, spectralType: null }` — engine integration proven (`npm run verify:engine`). Sirius has `hip: null` because its bundled catalog record is named rather than HIP-keyed; other unnamed bundled stars can carry HIP ids. `spectralType` is absent across the measured bundled sample. The bridge produces the exact target payload (`hip: 32349, spectralType: "A1V"`) when given a catalog that carries those fields (`npm run verify:extract`).

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

> **Status: CORE RESOLUTION PATH BUILT.** The app has committed starter data,
> `StarDataResolver`, and selection→resolver integration. The bundled catalog's
> identifier limits remain a data-tier issue rather than an engine-integration
> blocker: named bright stars resolve by name/alias, while non-curated stars fall
> back through spectral type when available, B-V color, then a default template.

> **Phase 0 data finding (PHASE0-FINDINGS.md §11-A):** bundled `test-skydata`
> gives a star either a proper/Bayer/Flamsteed designation or a HIP id, not both.
> It carries B-V broadly, no HD/Gaia ids, and no spectral types in the measured
> sample. A richer catalog is still needed for HIP-keyed lookup of named bright
> stars.

### Tasks

- [x] Create starter `spectral-templates.json` — committed pipeline output currently covers 22 canonical spectral types, with generated JS adapter in `src/data/spectral-templates.js`
  - Covers O, B, A, F, G, K, M starter classes and luminosity examples
  - Includes the prototype stars' relevant spectral classes
  - Broader template coverage remains part of the later data-expansion phase
- [x] Create starter `bright-stars.json` — six curated prototype stars, keyed by HIP where applicable (Sol uses `SOL`), with generated JS adapter in `src/data/bright-stars.js`
  - Includes all 7 sonification parameters per line: `wl, depth, width, profile, ew, el, ep`
  - Includes star-level fields: `name, type, temp, rv, color`
- [x] Implement `StarDataResolver.js`
  - Resolution cascade: curated name/alias match → template by spectral type → template by B-V → default template
  - Spectral type parsing handles catalog-style strings and maps unsupported variants to available canonical templates
  - Every selectable star returns either curated or template data
- [x] Integrate resolver with bridge: star selection → resolve → store result in React state
- [ ] Build dedicated `StarInfoPanel.jsx` — not present; selected-star identity/type/temp/RV/data-source are currently shown in `SpectrumPanel`, while `ObjectTooltip` covers hover identity
- [ ] Create `catalogs.js` — HIP↔HD cross-reference for the curated set (enables lookup by either ID)

### Acceptance criteria

**Current result:** selecting any star resolves to a curated or template line list and opens `SpectrumPanel`, whose header shows name, type, temperature, RV, and a curated/template badge. A dedicated `StarInfoPanel` and the identifier cross-reference remain open.

### Key data decisions

- Template absorption lines should be physically reasonable but don't need to be publication-quality. They need to *sound right* — the sonification maps are forgiving of small parameter errors.
- `rv` for template fallback defaults to 0 (no detune). Only curated stars carry measured radial velocities.
- `color` for template fallback is computed from `temp` using a Teff→RGB mapping in the adapter.

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
  - `playChord(data, amount = this.params.harmonizeAmount)` — harmonize and play all lines together
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

> **Status: CORE SPECTRUM PANEL BUILT.** `SpectrumPanel.jsx` is live and handles
> spectrum rendering, line hover/click, playback controls, and sequence/chord
> highlighting. The separate `ParamMappingPanel.jsx` described in the original
> plan has not been built.

### Tasks

- [x] Port `SpectrumCanvas` from `stellar-sonification.jsx` → `SpectrumPanel.jsx`
  - Canvas 2D rendering: blackbody curve with absorption dips
  - Wavelength → visible color strip
  - Absorption line markers with element labels
  - Active/playing/chord line highlighting
  - Hover detection on lines with line metadata readout
- [ ] Port `ParamBar` → dedicated `ParamMappingPanel.jsx`
  - 7 parameter bars showing current sonification mapping
  - Only visible when a line is active (hovered or playing)
- [x] Design panel layout
  - Dismissible bottom overlay with semi-transparent background so the sky remains visible
  - Selected-star identity/data-source badge and SEQ/CHORD/SEED controls live in the panel header
- [x] Wire hover/click on spectrum lines → `sonificationEngine.playLine()`
  - Hover highlights and reports line metadata; click plays that line
- [x] Sync playing state between sequence/chord playback and spectrum highlighting

### Acceptance criteria

**Current result:** selecting a star opens the spectrum panel with blackbody curve, absorption dips, element labels, and wavelength strip. Hovering a line highlights it and shows its line metadata; clicking it plays its tone. Sequence and chord playback animate the corresponding line highlights. The dedicated sonification-parameter mapping panel remains open.

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

- Stellarium Web Engine build + WASM/WebGL integration is verified with the pinned Emscripten 1.39.17 build procedure; broader browser coverage remains a separate compatibility task
- Web Audio API is supported in modern browsers; project-specific cross-browser audio verification remains open in Phase 2
- WASM loading is verified through the development server and the production deployment path

### Resolved by Phase 0

- **Engine JS API surface** — resolved. Selection changes arrive through `stel.change((obj, attr) => ...)`; filter `attr === 'selection'` and read `stel.core.selection`. No selection polling loop is required.
- **Designation/object format** — resolved. Catalog identifiers come from the `obj.designations()` string array; magnitude/distance/ICRF position use `getInfo(...)`; spectral type/B-V/parallax live in `obj.jsonData.model_data` when present. `getInfo('radec')` is an ICRF Cartesian unit vector, not an `[ra, dec]` pair.
- **Bundled catalog coverage** — measured. The bundled catalog splits named stars from HIP-only stars, carries B-V broadly, no HD/Gaia ids, and no spectral types in the measured sample. Richer identifiers/spectral coverage are a data-tier task.
- **Engine interop with React** — resolved. `SkyCanvas.jsx` mounts the engine once into a ref-owned canvas, and the engine safely owns its WebGL/render lifecycle.
- **WASM / skydata packaging** — resolved. The built WASM is about 1.2 MB; star catalogs and other skydata are separate runtime data sources registered with `addDataSource(...)`, not data baked into the WASM.

### Remaining unknowns

- **AGPL-3.0 license**: the engine is AGPL-licensed. Distribution obligations for the combined application still need legal clarity, especially if the engine itself is modified or used server-side.

### Nice-to-have explorations

- **WebGPU**: Stellarium Web Engine uses WebGL. If/when WebGPU support is added, it could improve rendering quality. Not a blocker.
- **SharedArrayBuffer**: Could enable engine computation on a worker thread. Requires COOP/COEP headers. Worth investigating for performance.
- **Tone.js**: The current implementation uses raw Web Audio API. Tone.js could simplify some patterns (scheduling, transport) but adds a dependency. Evaluate if complexity warrants it.
