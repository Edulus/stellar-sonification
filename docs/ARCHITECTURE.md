# Architecture

## System Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Browser                                                                     │
│                                                                              │
│  ┌─────────────────────┐    star ID     ┌──────────────────┐                 │
│  │  Stellarium Web      │──────────────▶│  StarDataResolver │                 │
│  │  Engine (WASM/WebGL) │               │                  │                 │
│  │                      │               │  1. bright-stars  │                 │
│  │  - Star catalog      │               │  2. survey match  │                 │
│  │  - Sky rendering     │               │  3. template      │                 │
│  │  - User interaction  │               └────────┬─────────┘                 │
│  │  - Time/location     │                        │                           │
│  └──────────┬───────────┘                        │ line list                 │
│             │                                    ▼                           │
│             │ hover/select        ┌──────────────────────────┐               │
│             │ events              │  SonificationEngine       │               │
│             │                     │                          │               │
│             │                     │  oscillator bank         │               │
│             │                     │    └─▶ biquad filter     │               │
│             │                     │         └─▶ ADSR gain    │               │
│             │                     │              ├─▶ dry bus  │──▶ speakers   │
│             │                     │              └─▶ reverb   │               │
│             ▼                     └──────────────────────────┘               │
│  ┌──────────────────────┐                                                    │
│  │  React App Shell      │                                                    │
│  │                       │                                                    │
│  │  ┌─────────────────┐ │                                                    │
│  │  │ SkyCanvas        │ │  ◄── Stellarium engine mounts here                │
│  │  ├─────────────────┤ │                                                    │
│  │  │ SpectrumPanel    │ │  ◄── Canvas 2D absorption spectrum visualization  │
│  │  ├─────────────────┤ │                                                    │
│  │  │ StarInfoPanel    │ │  ◄── Selected star metadata                       │
│  │  ├─────────────────┤ │                                                    │
│  │  │ ParamMapping     │ │  ◄── Real-time sonification parameter readout     │
│  │  └─────────────────┘ │                                                    │
│  └───────────────────────┘                                                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Layer Details

### 1. Stellarium Web Engine (Rendering Layer)

**What it is**: A C codebase compiled to WebAssembly via Emscripten. Renders a full planetarium sky in WebGL with star catalogs, constellations, atmosphere, and landscape simulation.

**How we embed it**: The engine exposes a JavaScript API through Emscripten bindings. It renders into a `<canvas>` element. The engine uses an **object-oriented attribute system** internally (documented in `doc/internals.md`): every entity inherits from `obj_t`, and properties are accessed via `obj_call(obj, "attribute_name", signature)`. From JavaScript, this surfaces through `SweObj` methods/properties and the global engine handle.

**Engine object model** (from internals.md):
```
+-------+
| obj_t |       ← base class, everything inherits from this
+-------+
    ^
    |
    +----------------+---------------+--------------+
    |                |               |              |
+---------+   +------------+   +---------+   +------------+
| core_t  |   | observer_t |   | stars_t |   | milkyway_t |
+---------+   +------------+   +---------+   +------------+
```

Sky objects carry position data internally, but selected-star coordinates are **not** exposed to JavaScript as direct `obj.ra` / `obj.dec` properties. The verified JS position surface is `obj.getInfo('radec')`, which returns an **ICRF Cartesian unit vector `[x,y,z]`**. Convert that vector with the engine's frame helpers and `stel.c2s(...)` when actual angular RA/Dec is needed.

**Key JS integration points** — ✅ VERIFIED in Phase 0 (full detail + source
references in [`../PHASE0-FINDINGS.md`](../PHASE0-FINDINGS.md)):
```javascript
// Bootstrap: the built engine .js defines a global factory.
StelWebEngine({ wasmFile, canvas, onReady: (stel) => { ... } });

// Selection is EVENT-based (not polling): register a global change listener and
// filter to the 'selection' attribute. (Reading stel.core.selection also works;
// setting stel.core.selection = obj selects programmatically.)
stel.change((obj, attr) => {
  if (attr === 'selection') { const sel = stel.core.selection; /* ... */ }
  // NB: attr === 'hovered' fires constantly on mouse-move — ignore it here.
});

// A selected star (a SweObj):
obj.designations()                // METHOD → ["HIP 32349","HD 48915","NAME Sirius","GAIA …"]
obj.getInfo('vmag')               // visual magnitude
obj.getInfo('distance')           // distance
obj.getInfo('radec')              // ICRF unit vector [x,y,z] (convert with frame helpers + stel.c2s)
obj.jsonData.model_data.spect_t   // spectral type "A1V" when catalog data carries it
obj.jsonData.model_data.BVMag     // B-V color
obj.jsonData.model_data.plx       // parallax

// Observer: stel.core.observer.longitude / .latitude (radians), settable.
```
HIP/HD/Gaia identifiers are parsed from `designations()` strings; there are no
`obj.hip` / `obj.hd` properties. Spectral type lives in `jsonData.model_data`,
not `obj.spect_t`, and magnitude is `getInfo('vmag')`. See
PHASE0-FINDINGS.md §2–§3, §7–§8.

**Engine build**: use the verified procedure in [`BUILD.md`](BUILD.md) / [`../PHASE0-FINDINGS.md`](../PHASE0-FINDINGS.md) §6. It pins **Emscripten 1.39.17** and runs `stellarium-web-engine/build-direct.sh`, which drives `emcc` directly. The upstream SCons / `make js` path was tested and is unusable for this project on the native Windows path.

**Star catalog pipeline**: The `Stellarium/stellarium_star_catalogs` repo (forked from henrysky) generates richer engine star catalogs from Hipparcos + Gaia DR3 data. Key details:
- `simbad_query_hipsaohdhr.py` — queries SIMBAD for HIP/SAO/HD/HR cross-references
- `Parse_HIP_Catalog.ipynb` — cleans HIP catalog, links to Gaia source IDs
- `Gaia_Photometry.ipynb` — computes V-band magnitude and B-V color from Gaia DR3
- Catalogs are hierarchical HiPS tiles (`Norder0..N`), **fetched at runtime** via
  `core.stars.addDataSource({url})`; they are not baked into the WASM
- The bundled `apps/test-skydata/` sample is deliberately thin: measured live, it gives stars either proper/Bayer/Flamsteed names **or** a HIP id, not both; it carries B-V for all sampled stars, no HD/Gaia ids, and no spectral types (PHASE0-FINDINGS.md §11-A)

The richer catalog pipeline can carry cross-identifiers, but the bundled catalog cannot support HIP-keyed lookup for the named bright stars. The current resolver therefore name/alias-matches curated bright stars and falls back through template data; richer catalog work remains a data-tier task.

**Important constraints**:
- The engine owns the WebGL context on its canvas. Do NOT render other WebGL content on the same canvas.
- Engine updates run on requestAnimationFrame. Keep the main thread responsive.
- Star catalog and other skydata are served separately and registered at runtime with `addDataSource(...)`; the WASM contains the engine, not those catalogs.
- The engine is AGPL-3.0 licensed. This affects distribution of any modified engine builds.

### 2. Star Data Resolver (Data Layer)

**Purpose**: Given a star identifier from the engine, return an absorption line list suitable for sonification.

**Interface**:

```typescript
interface AbsorptionLine {
  wl: number;       // Wavelength in nm (e.g. 656.3 for Hα)
  depth: number;    // Absorption depth, 0–1
  width: number;    // Line width in Å
  profile: 'gaussian' | 'lorentzian' | 'voigt';
  ew: number;       // Equivalent width in mÅ
  el: string;       // Element identification (e.g. "Ca II K", "Hα", "TiO γ")
  ep: number;       // Excitation potential in eV
}

interface StarSpectralData {
  name: string;
  type: string;     // Spectral classification (e.g. "G2V")
  temp: number;     // Effective temperature in K
  rv: number;       // Radial velocity in km/s
  color: string;    // Display color hex
  lines: AbsorptionLine[];
  dataSource: 'curated' | 'survey' | 'template';  // Provenance tracking
}

// Core resolver function
async function resolveStarData(starId: StarIdentifier): Promise<StarSpectralData>
```

**Resolution cascade**:

```
resolveStarData(starId)
  │
  ├─▶ Try bright-stars.json (keyed by HIP number)
  │   Found? Return curated line list.
  │
  ├─▶ Try survey cross-match (keyed by HD or Gaia ID)
  │   Found? Return extracted line list.
  │
  └─▶ Fall back to spectral-templates.json
      Parse spectral type string → base type + luminosity class
      Return canonical template line list for that class.
      Use engine-provided Teff for blackbody, default RV=0.
```

**Data file formats**:

`bright-stars.json`:
```json
{
  "HIP32349": {
    "name": "Sirius",
    "type": "A1V",
    "temp": 9940,
    "rv": -5.5,
    "color": "#d4e8ff",
    "lines": [
      { "wl": 410.2, "depth": 0.60, "width": 1.40, "profile": "lorentzian", "ew": 700, "el": "Hδ", "ep": 10.20 },
      ...
    ]
  }
}
```

`spectral-templates.json`:
```json
{
  "G2V": {
    "temp": 5778,
    "lines": [ ... ]
  },
  "A0V": {
    "temp": 9600,
    "lines": [ ... ]
  },
  ...
}
```

**Template matching logic**: Spectral type strings from the engine can be messy ("G2V", "G2 V", "G2/3V", "G2Ve", etc.). The matcher should:
1. Extract base letter + subclass number + luminosity class
2. Find exact match in templates
3. If no exact match, find nearest (e.g. G3V falls back to G2V)
4. If no subclass match, use the base type (e.g. G → G2V as the canonical G)

### 3. Sonification Engine (Audio Layer)

**Purpose**: Accept an absorption line list and produce audio via Web Audio API.

**Design**: Extracted and generalized from `stellar-sonification.jsx`. The modular engine now owns single-line, sequential, harmonized-chord, seeded-piece, and hover playback paths.

**Module structure**:

```
src/audio/
├── SonificationEngine.js   # Orchestrator: AudioContext, playback, hover registry
├── mappings.js              # Pure functions: wlToFreq, depthToGain, widthToQ, etc.
├── harmonize.js             # Re-export of the root harmonizer used by playChord
└── reverb.js                # Algorithmic reverb builder (4-tap delay network)
```

**SonificationEngine API**:

```javascript
class SonificationEngine {
  constructor()
  setParams(patch)
  on(event, cb)
  ensureContext()
  stop()

  playLine(line, starRV = 0)
  playSequence(data, opts = {})
  playChord(data, amount = this.params.harmonizeAmount)
  playSeed(data, opts = {})
  getParams(line, starRV = 0)

  startHoverChord(key, data, screenPos)
  startHoverSequence(key, data, screenPos, opts = {})
  fadeHoverStar(key, durationSec)
  fadeAllHover(durationSec)
}
```

`ensureContext()` lazily creates or resumes the `AudioContext`; `setParams()` updates the live synthesis parameters; `on()` exposes the audio-derived overlay event surface. The four click/panel playback methods share the engine's spectral mappings, while the hover methods maintain the separate max-three-star registry and fade lifecycle.

**Chord harmonization.** `playChord(data, amount = this.params.harmonizeAmount)` passes the star's line list to the root [`harmonize.js`](../harmonize.js) implementation through `src/audio/harmonize.js`. The harmonizer chooses the maximum-EW line as root, pulls other pitches toward the nearest just-intonation interval with stronger-EW lines resisting more of that pull, spreads voices that land within 30 cents, and returns the `1/√N` gain scale used by `playChord()`.

**Audio graph per line** (from proven prototype):

```
osc_fundamental (sine, freq=wlToFreq(λ))──┐
osc_2nd (triangle, freq*2, if EP>0.1)──────┤
osc_3rd (sawtooth, freq*3, if EP>0.4)──────┼──▶ BiquadFilter (LP, Q=widthToQ(w))
osc_sub (sine, freq*0.5, if EP<0.2)────────┘       │
                                                    ▼
                                              GainNode (ADSR from profile)
                                                ├──▶ dry bus ──▶ destination
                                                └──▶ reverb bus
                                                       │
                                          ┌────────────┼────────────┐
                                          ▼            ▼            ▼
                                       delay_29ms   delay_37ms   delay_53ms  (+ delay_67ms)
                                          │            │            │
                                          ▼            ▼            ▼
                                        LP filter   LP filter   LP filter
                                          │            │            │
                                          ▼            ▼            ▼
                                       feedback     feedback     feedback
                                          │            │            │
                                          └────────────┼────────────┘
                                                       ▼
                                                  destination
```

This topology still describes each chord voice through oscillator bank → filter → ADSR → dry/reverb. Chord mode builds its per-voice reverb network inline rather than calling `createReverbBus()`, applies amount-driven detune/filter/reverb changes, and routes every dry/wet voice through an additional chord-level master swell/release envelope before the destination.

**Critical implementation notes from the prototype**:
- AudioContext must be created after a user gesture (browser autoplay policy)
- Each oscillator gets `detune = rv * 0.2` applied (radial velocity)
- Oscillator gains are mixed by excitation potential: fundamental gets `1.0 - harmonic * 0.3`, 2nd harmonic gets `min(harmonic * 0.5, 0.4)`, etc.
- ADSR times are in seconds: Gaussian {a:0.06, d:0.1, s:0.7, r:0.06}, Lorentzian {a:0.01, d:0.05, s:0.8, r:0.35}, Voigt {a:0.03, d:0.08, s:0.75, r:0.18}
- Tone duration is fixed at 1.2 seconds
- Sequence playback has 80ms gap between tones
- Old nodes must be stopped before new ones start (prevents buildup)

### 4. React App Shell (UI Layer)

**Purpose**: Mount the engine, display overlays, manage state.

**State shape**:

```typescript
interface AppState {
  // Engine state
  engineReady: boolean;
  location: { lat: number; lng: number };
  time: Date;

  // Selection state
  selectedStar: StarIdentifier | null;
  spectralData: StarSpectralData | null;
  dataSource: 'curated' | 'survey' | 'template' | null;

  // Audio state
  isPlaying: boolean;
  isSequencePlaying: boolean;
  activeLineIndex: number | null;
  hoveredLineIndex: number | null;

  // UI state
  showSpectrum: boolean;
  showParamMapping: boolean;
}
```

**Component responsibilities**:

- `App.jsx`: Root layout, state management, coordinates engine↔data↔audio
- `SkyCanvas.jsx`: Mounts Stellarium engine, forwards selection events up
- `SpectrumPanel.jsx`: Canvas 2D rendering of absorption spectrum (ported from prototype's `SpectrumCanvas`)
- `StarInfoPanel.jsx`: Displays star name, type, temperature, metadata, data source indicator
- `ParamMappingPanel.jsx`: Real-time readout of sonification parameters (ported from prototype's `ParamBar` components)

**Layout**: The sky canvas fills the viewport. Panels overlay as collapsible drawers or slide-outs, not competing with the sky for screen real estate. The spectrum panel appears when a star is selected. Clicking empty sky dismisses it.

## Data Flow (Click → Sound)

```
1. User clicks star in Stellarium canvas
      │
2. Engine changes `core.selection`; StellariumBridge receives `stel.change(..., 'selection')`
      │
3. StellariumBridge normalizes the selected SweObj and emits `starSelected`; SkyCanvas forwards it to App.jsx
      │
4. App.jsx dispatches to StarDataResolver.resolve(starId)
      │
5. Resolver checks bright-stars.json by HIP number
      │  ├── HIT: returns curated StarSpectralData
      │  └── MISS: checks survey cross-match by HD/Gaia
      │       ├── HIT: returns survey-extracted StarSpectralData
      │       └── MISS: parses spType, returns template StarSpectralData
      │
6. App.jsx receives StarSpectralData, updates state
      │
7. SpectrumPanel renders absorption spectrum on canvas; selection itself stays silent
      │
8. User presses ▶; App.jsx dispatches by mode:
      │    CHORD → SonificationEngine.playChord(data)
      │    SEED  → SonificationEngine.playSeed(data, opts)
      │    SEQ   → SonificationEngine.playSequence(data)
      │  A spectrum-line click instead calls playLine(line, rv)
      │
9. Web Audio graph builds: oscillators → filter → ADSR → dry/reverb → speakers
      │
10. ParamMappingPanel displays real-time parameter values
```

## Integration Patterns

### Stellarium Bridge Pattern

`src/engine/StellariumBridge.js` dynamically loads the built engine glue as a classic script, then initializes the global factory and wires the engine's selection callback. The relevant pattern is:

```javascript
const StelWebEngine = await loadEngineScript(config.jsFile);
const stel = await new Promise((resolve, reject) => {
  try {
    StelWebEngine({
      wasmFile: config.wasmFile,
      canvas: this.canvas,
      translateFn: (domain, str) => str,
      onReady: (s) => resolve(s),
    });
  } catch (e) {
    reject(e);
  }
});

this.stel = stel;
this._registerDataSources(config);
this._registerFonts(config);
this._wireSelection();

// Selection is an attribute plus a callback surface; no polling loop is needed.
this.stel.change((obj, attr) => {
  if (attr !== 'selection') return;
  const selected = this.stel.core.selection;
  if (selected) this.emit('starSelected', this.extractStarData(selected));
  else this.emit('deselected');
});
```

Selected-star extraction uses the verified `SweObj` API:

```javascript
const designations = obj.designations();
const model = obj.jsonData?.model_data ?? {};
const radecICRF = obj.getInfo('radec'); // [x,y,z] ICRF unit vector, NOT [ra,dec]

return {
  hip: pickDesignation(designations, 'HIP'),
  hd: pickDesignation(designations, 'HD'),
  gaia: pickDesignation(designations, 'GAIA'),
  name: pickName(designations),
  designations,
  spectralType: model.spect_t ?? null,
  magnitude: obj.getInfo('vmag'),
  bv: model.BVMag ?? null,
  distanceAU: obj.getInfo('distance'),
  radecICRF,
};
```

See `src/engine/StellariumBridge.js` and `PHASE0-FINDINGS.md` for the complete implementation and API notes.

### React Integration

There is no `useStellariumEngine.js` hook in the implemented app. `src/ui/SkyCanvas.jsx` owns the React-side lifecycle: it creates one `StellariumBridge` for the bare canvas, subscribes to bridge events, calls `bridge.init()`, and destroys it on cleanup. The effect guards against StrictMode double-initialization.

```javascript
const bridge = new StellariumBridge(canvasRef.current);
bridge.on('starSelected', (star) => onStarSelected?.(star));
bridge.on('deselected', () => onDeselected?.());
bridge.on('ready', () => onReady?.(bridge));
bridge.init().catch(/* surface init error */);
```

## Build and Deployment

### Engine Build (one-time setup)

The verified build is documented in [`BUILD.md`](BUILD.md) and [`../PHASE0-FINDINGS.md`](../PHASE0-FINDINGS.md) §6. In short:

- pin **Emscripten 1.39.17**;
- use `stellarium-web-engine/build-direct.sh` rather than SCons / `make js`;
- copy the resulting `stellarium-web-engine.{js,wasm}` into `public/engine/`;
- serve fonts and `public/skydata/` separately. The bridge registers skydata sources at runtime with `addDataSource(...)`.

**Note on the engine repo**: `Stellarium/stellarium-web-engine` is AGPL-3.0 licensed. The `apps/web-frontend/` directory contains a Vue-based frontend that serves as the reference implementation for JS API usage. The `doc/internals.md` documents the C-level object model and attribute system surfaced through Emscripten.

**Related repo**: `Stellarium/stellarium_star_catalogs` contains Python notebooks for generating richer star catalogs from Hipparcos + Gaia DR3 data, including HIP/HD/Gaia cross-matching via SIMBAD. This pipeline is directly useful for building our spectral data cross-reference.

### App Build

```bash
npm install
npm run dev          # Development server with HMR
npm run build        # Production build
npm run preview      # Preview production build
```

### Vite Configuration Notes

- WASM files must be served with correct MIME type (`application/wasm`)
- The engine glue dynamically loads the WASM binary; the bridge passes its explicit `wasmFile` URL
- Skydata is served separately from `public/skydata/` and registered at runtime
- Canvas element for the engine must NOT be managed by React's virtual DOM after engine init — use a ref and keep React away from that DOM node

## Performance Considerations

- **Engine rendering**: Stellarium Web Engine handles its own render loop. Don't interfere with its requestAnimationFrame cycle.
- **Star data lookup**: The bright-stars JSON should be loaded at startup and held in memory as a Map keyed by HIP number. Template lookup is a small object. No async penalty on the click path after initial load.
- **Audio latency**: AudioContext should be pre-initialized (on first user gesture). Building the oscillator graph on click takes <2ms. Perceived latency should be under 20ms from click to sound.
- **Memory**: Each tone creates ~4 oscillators + filters + gain nodes. These are garbage-collected after the tone ends (stop + disconnect). No long-lived audio nodes.
- **Data bundle size**: bright-stars.json for ~500 stars with 6–10 lines each ≈ 50–80 KB gzipped. Templates for ~70 spectral subtypes ≈ 15 KB. Negligible.
