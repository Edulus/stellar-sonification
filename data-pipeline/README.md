# data-pipeline

Offline build for the two datasets the app's data layer resolves against:

| Output | Keyed by | Built by | Consumed by |
|--------|----------|----------|-------------|
| `output/bright-stars.json` | HIP (`"HIP32349"`; Sol → `"SOL"`) | `build-bright-stars.py` | `src/data/bright-stars.js` |
| `output/spectral-templates.json` | spectral type (`"G2V"`) | `build-templates.py` | `src/data/spectral-templates.js` |

Both `src/data/*.js` modules are **thin adapters that import these JSON files** —
the JSON is the single source of truth. `bright-stars.js` re-exports the values as
the array the resolver iterates; `spectral-templates.js` adds a Teff-derived
`color` (the JSON schema omits it) and exposes the `templateForType/BV/default`
matchers. Rebuilding the JSON and reloading the app picks up changes immediately.

> **Schema/keying note.** ARCHITECTURE.md specifies HIP-keyed JSON. The running
> app currently resolves selections **by name/alias**, because the bundled engine
> catalog (`test-skydata`) returns names but no HIP (PHASE0-FINDINGS.md §9). So
> each star object also carries `name` + `aliases`, and Sol — which has no
> Hipparcos number — is keyed `"SOL"`. When a richer HIP-bearing catalog lands,
> resolution can switch to the HIP keys with no data change.

## Running

```bash
pip install -r requirements.txt          # core: requests, numpy (astropy/scipy only for survey/PHOENIX)

python build-templates.py                # 22 spectral-type templates  -> output/spectral-templates.json
python build-bright-stars.py             # 6 curated seed stars         -> output/bright-stars.json
python verify_outputs.py                 # checks the acceptance criteria below
```

Flags:
- `build-templates.py --no-nist` — skip the NIST fetch entirely (model carries authoritative labels).
- `build-templates.py --phoenix` — attempt PHOENIX extraction (gated; see below).
- `build-bright-stars.py --survey` — attempt GALAH/LAMOST expansion (gated; see below).

The scripts are independent — `build-templates.py` does **not** read any output of
`build-bright-stars.py`. Shared logic lives in `common.py` (model + rules) and
`nist.py` (line lookup); neither is an output dependency.

## Expected runtime & sizes

| Step | Runtime | Output |
|------|---------|--------|
| `build-templates.py` (default) | seconds (one NIST attempt, then model) | ~33 KB |
| `build-templates.py --no-nist` | < 1 s | ~33 KB |
| `build-bright-stars.py` (seed) | < 1 s | ~8 KB |
| `--survey` / `--phoenix` | minutes–hours, network + multi-GB downloads | (additive) |

## Data sources & licenses

| Source | Used for | License |
|--------|----------|---------|
| Built-in feature model (`common.py`) | template line strengths vs. Teff | this repo |
| Six prototype seed stars | curated `bright-stars.json` | this repo (validated by hand) |
| NIST Atomic Spectra Database | element labels + excitation potentials (enrichment) | public domain |
| GALAH DR4 *(optional)* | survey star params for expansion | CC BY 4.0 |
| LAMOST DR10 *(optional)* | northern-sky survey params | public for research |
| PHOENIX synthetic spectra *(optional)* | template line extraction | free for research use |

## Regenerate vs. update

- **Full rebuild:** rerun both scripts. Deterministic — same inputs produce identical JSON.
- **Tune a template:** edit the anchors in `common.py` `FEATURES` (piecewise
  `(Teff, depth, ew)` per feature) or the `SPECTRAL_TYPES` Teff table in
  `build-templates.py`, then rerun `build-templates.py`.
- **Add/fix a curated star:** edit the `SEED` list in `build-bright-stars.py`
  (key by HIP, or a non-HIP key like `"SOL"`), then rerun. Seed stars are
  **sacrosanct** — the survey path never overwrites them.
- **Expand from surveys:** download a catalogue FITS into `downloads/`, then run
  `build-bright-stars.py --survey`. Missing files/network → logged + skipped.

## PROFILE RULES (in `common.py::assign_profile`)

Applied uniformly, not per-source — adjust here if needed:

- **Hydrogen Balmer** (Hα 656.3, Hβ 486.1, Hγ 434.0, Hδ 410.2):
  `lorentzian` for Teff > 7500 K (pressure-broadened), else `voigt`.
- **Ca II** (K 393.4, H 396.8, IR triplet): `voigt` always (resonance + damping wings).
- **Na I D** (589.0, 589.6): `voigt` (resonance doublet).
- **All other metals** (Fe I, Mg I, Ti I, …): `gaussian` (thermal broadening).
- **Molecular bands** (TiO, CN, CH): `gaussian`.

Two iconic lines (Hα 656.3, Ca II K 393.4) are guaranteed a slot in a template's
kept set even if the EW cap would truncate them (`common.py::MUST_KEEP_WL`).

## Gated paths (why the big downloads are opt-in)

- **GALAH spectra wall.** Data Central serves the catalogue FITS openly, but
  **per-star spectra go through a registered job queue.** So `--survey` does *not*
  measure lines from spectra; when a catalogue FITS is present it derives each
  star's lines from the spectral-type template implied by its catalogue Teff/logg,
  tagged `dataSource: "survey-galah"` / `"survey-lamost"`. The SIMBAD-TAP HIP
  cross-match + VizieR I/239 Vmag<6.5 filter + template-from-params step is left
  as a maintainer task with the catalogue downloaded (see `survey_expand`).
- **PHOENIX** extraction (continuum-normalize → find minima → measure depth/FWHM/EW)
  needs the grid FITS in `downloads/phoenix/` plus astropy + scipy. Absent →
  `build-templates.py --phoenix` logs and falls back to the model, so output is
  always produced.
- **NIST** `lines1.pl` is a CGI form with no stable API; queries can 500 or reject
  column combinations. The fetch is best-effort and cached to `nist_lines.tsv`; an
  empty cache is fine because `common.py` carries authoritative labels for every
  line the model emits. Manual refresh (per element) uses the `format=2` URL:
  `https://physics.nist.gov/cgi-bin/ASD/lines1.pl?spectra=Fe+I&low_w=3800&upp_w=7600&unit=0&submit=Retrieve+Data&format=2`

## Acceptance criteria (checked by `verify_outputs.py`)

1. All six seed stars in `bright-stars.json` with values exactly matching the
   prototype (all 7 line fields).
2. All 22 spectral types in `spectral-templates.json`.
3. Dominant-line EWs physically reasonable (A: Balmer > 500; G: Ca II K > 300, Hα < 200; M: TiO + Ca II K present).
4. Both files are valid JSON.
5. No key collisions; Sol keyed non-HIP.
