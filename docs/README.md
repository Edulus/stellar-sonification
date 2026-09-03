# Stellarium Sonification

A web-based planetarium that lets users navigate the night sky and hear stars sing their spectroscopic absorption line data. Built on Stellarium Web Engine (WASM/WebGL) with a custom 7-parameter sonification system using the Web Audio API.

## Concept

Every star absorbs light at specific wavelengths depending on its chemical composition, temperature, and physical conditions. These absorption lines are the star's fingerprint. This project makes that fingerprint audible: click any star in the sky and it plays a synthesized tone derived directly from its spectral data.

The sky is visual. The stars are sonic. The bridge is a click.

## Core Interaction

1. User navigates the sky via Stellarium Web Engine (pan, zoom, time, location)
2. User clicks a star
3. Engine emits star identifier (HIP/HD/Gaia source ID)
4. Data layer resolves identifier → absorption line list
5. Sonification engine synthesizes audio from the line list via Web Audio API
6. Optional: spectrum visualization panel shows what the user is hearing

## Sonification Model (Proven)

The sonification mapping is implemented and tested in `stellar-sonification.jsx`. It maps 7 physical parameters of each absorption line to 7 audio synthesis parameters:

| Spectral Parameter | Audio Parameter | Mapping |
|---|---|---|
| Wavelength (nm) | Pitch (Hz) | MIDI 84→48 across 380–760nm, 3-octave range |
| Absorption depth (0–1) | Gain (0.03–0.22) | Linear: deeper lines are louder |
| Line width (Å) | Filter Q (0.5–18) | Inverse: narrow lines = tight resonance |
| Line profile (gaussian/lorentzian/voigt) | ADSR envelope shape | Gaussian=soft symmetric, Lorentzian=sharp+long tail, Voigt=hybrid |
| Equivalent width (mÅ) | Reverb send (0–1) + play order | Stronger lines are wetter and play first in sequence |
| Radial velocity (km/s) | Detune (Hz) | ±30 km/s → ±6 Hz pitch drift (Doppler analogy) |
| Excitation potential (eV) | Harmonic richness (0–1) | 0 eV=sine only, 21 eV=overtone-rich (triangle+sawtooth) |

### Synthesis Architecture

- Oscillator bank: fundamental (sine) + 2nd harmonic (triangle) + 3rd harmonic (sawtooth) + sub-oscillator, mixed by excitation potential
- Biquad lowpass filter controlled by line width
- ADSR gain envelope shaped by line profile type
- Algorithmic reverb: 4 parallel delay lines (29/37/53/67ms) with feedback and LP damping, send level controlled by equivalent width
- Per-star detune from radial velocity applied to all oscillators

### Sequence Playback

When "play all lines" is triggered, lines are sorted by equivalent width descending (strongest features first) and played sequentially with 80ms gaps. Each tone lasts 1.2 seconds.

## Tech Stack

| Layer | Technology |
|---|---|
| Sky rendering | Stellarium Web Engine (C → WASM via Emscripten, WebGL) |
| App shell | React (Vite) |
| Audio synthesis | Web Audio API (native, no libraries) |
| Spectrum visualization | HTML Canvas 2D |
| Spectral data | Static JSON bundle + synthetic fallback templates |
| Styling | CSS-in-JS (inline styles), IBM Plex Mono + Outfit fonts |

## Project Structure

```
├── README.md                    # This file
├── ARCHITECTURE.md              # Technical architecture and data flow
├── ROADMAP.md                   # Phased development plan
├── stellar-sonification.jsx     # Proven sonification prototype (reference implementation)
├── src/
│   ├── engine/                  # Stellarium Web Engine wrapper and integration
│   │   ├── StellariumBridge.js  # JS↔WASM bridge, event handlers, star selection API
│   │   └── config.js            # Engine configuration (catalogs, rendering, location)
│   ├── data/
│   │   ├── spectral/            # Absorption line datasets
│   │   │   ├── bright-stars.json        # Real line data for ~500 brightest stars
│   │   │   └── spectral-templates.json  # Synthetic line lists by spectral type
│   │   ├── StarDataResolver.js  # Resolves star ID → absorption line list
│   │   └── catalogs.js          # Cross-reference mappings (HIP↔HD↔Gaia)
│   ├── audio/
│   │   ├── SonificationEngine.js  # Web Audio synthesis pipeline
│   │   ├── mappings.js            # The 7 parameter mapping functions
│   │   └── reverb.js              # Algorithmic reverb (4-tap delay network)
│   ├── ui/
│   │   ├── App.jsx                # Root component
│   │   ├── SkyCanvas.jsx          # Stellarium engine mount point
│   │   ├── SpectrumPanel.jsx      # Absorption spectrum visualization
│   │   ├── StarInfoPanel.jsx      # Selected star metadata display
│   │   └── ParamMappingPanel.jsx  # Sonification parameter readout
│   └── main.jsx
├── public/
│   └── engine/                    # Stellarium WASM binary + assets
├── data-pipeline/
│   ├── extract-gaia-bprp.py       # Extract absorption features from Gaia BP/RP
│   ├── build-templates.py         # Generate synthetic spectra from PHOENIX models
│   └── build-bright-stars.py      # Curate real line data for bright star bundle
└── vite.config.js
```

## Data Sources

| Source | Coverage | Resolution | Use |
|---|---|---|---|
| Gaia DR3 BP/RP | ~220M stars | Low (R~50–100) | Extract major absorption features for broad coverage |
| SDSS DR18 | ~5M spectra (limited sky) | Medium-high (R~2000) | High-quality line lists where available |
| LAMOST DR10 | ~20M spectra | Medium (R~1800) | Good Northern hemisphere coverage |
| PHOENIX/Kurucz models | All spectral types | Synthetic (any R) | Fallback: generate canonical line lists from Teff, logg, [Fe/H] |

### Data Resolution Strategy

Stars are resolved in priority order:
1. **Curated bright stars** (~500): hand-verified line lists with real measurements
2. **Survey match** (SDSS/LAMOST/Gaia): auto-extracted line features from observed spectra
3. **Template fallback**: synthetic line list generated from spectral classification (e.g., all G2V stars share a template)

The user experience is identical regardless of data tier — every clicked star produces sound. The difference is whether that sound is unique to *that* star or representative of *its class*.

## Key Design Decisions

- **Sonification as additive presence, not subtractive absence**: absorption lines are rendered as *present tones* (the star sings what it's made of) rather than notches carved from noise. More musical, more memorable, more accessible.
- **No external audio libraries**: pure Web Audio API for zero dependencies and full control over the synthesis chain.
- **Engine-first architecture**: Stellarium Web Engine is the rendering authority; the app shell wraps it rather than reimplementing sky rendering.
- **Offline-capable data**: spectral data ships as static JSON, no runtime API calls to astronomical databases.
- **Progressive enhancement**: spectrum visualization and parameter mapping panels are optional overlays on the core sky+sound experience.

## Getting Started

The app needs the Stellarium Web Engine compiled to WASM **before** it will run —
the build is non-trivial (pinned Emscripten 1.39.17, custom build script). Full
steps are in **[`docs/BUILD.md`](BUILD.md)**.

```bash
# Prerequisites: Node.js 18+, Python 3, Emscripten SDK 1.39.17 (see docs/BUILD.md)
git clone <repo> && cd stellarium-sonification

# 1) Build the engine + copy artifacts into public/  (one-time; see docs/BUILD.md)
#    -> public/engine/stellarium-web-engine.{js,wasm}, public/skydata/, fonts

# 2) Run the app
npm install
npm run dev          # http://localhost:5173 — click a star, watch the console

# 3) (optional) verify the integration
npm run verify:engine    # live engine + Sirius selection (needs dev server up)
npm run verify:extract   # bridge yields hip/spectralType/magnitude
```

- **Engine build & gotchas:** [`docs/BUILD.md`](BUILD.md)
- **Verified JS API + Phase 0 findings:** [`PHASE0-FINDINGS.md`](../PHASE0-FINDINGS.md)

## References

- Stellarium Web Engine: https://github.com/Stellarium/stellarium-web-engine
- Stellarium Web Engine internals: https://github.com/Stellarium/stellarium-web-engine/blob/master/doc/internals.md
- Stellarium star catalog pipeline: https://github.com/Stellarium/stellarium_star_catalogs
- Stellarium data tools: https://github.com/Stellarium/stellarium-data
- Web Audio API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
- Gaia DR3 BP/RP spectra: https://www.cosmos.esa.int/web/gaia/dr3
- PHOENIX model atmospheres: https://phoenix.astro.physik.uni-goettingen.de/
- NIST Atomic Spectra Database: https://www.nist.gov/pml/atomic-spectra-database
