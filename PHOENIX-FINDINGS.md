# PHOENIX Gate 1 Findings

Base: `main` at `1c57908d9d37e09277632306eb06f7697656935b`

Scope: investigation only. No extraction implementation has been started.

## Gate 1 stop

The current pipeline shape is understood, and the runtime handoff test passes. Several implementation decisions need review before code begins:

1. The repo does not define a concrete PHOENIX grid product/version or local file layout beyond a non-empty `downloads/phoenix/` directory.
2. The public PHOENIX-ACES high-resolution archive does not cover all 22 current template temperatures. The hot O/B keys are the main gap.
3. The existing NIST layer can supply transition identity and excitation potential, but its parser discards transition-strength information. NIST relative intensity is not suitable for a quantitative 70% blend-dominance threshold. `log(gf)` / oscillator-strength data are available upstream and are the best candidate proxy, but the exact meaning of the 70% rule needs review.
4. PHOENIX high-resolution wavelengths are vacuum wavelengths, while `nist.py` currently queries/labels air wavelengths in the 3800-7600 A range. Cross-matching without an explicit air/vacuum conversion would be wrong.
5. `common.py::assign_profile` does not exactly reproduce the six curated stars for Ca I and He I.
6. The repo contains one explicit molecular-band reference, TiO gamma at 705.3 nm. It does not contain a general molecular band-head list.

Gate 1 stops here as required by the brief.

## 1. What `--phoenix` does today

`data-pipeline/build-templates.py` already owns the flag.

End to end:

1. `main()` parses `--phoenix` and calls `build(use_phoenix=True)`.
2. `build()` loads the NIST cache through `nist.ensure_cache()` unless `--no-nist` is supplied.
3. For each of the 22 `SPECTRAL_TYPES`, `build()` calls `_try_phoenix(typ, teff, LOGG[lclass], nist_table)`.
4. `_try_phoenix()` checks only that `data-pipeline/downloads/phoenix/` exists and is non-empty.
5. It then checks that `astropy` and `scipy` import.
6. If either check fails, it returns `None` and the existing model path runs.
7. If both checks pass, the current stub still prints `PHOENIX extraction not implemented - model fallback` and returns `None`.
8. `build()` then calls `common.synth_lines(...)`, stores `{"temp": teff, "lines": lines}` under the current spectral-type key, and finally writes the whole `data-pipeline/output/spectral-templates.json` file.

The exact join point is the local `lines` variable inside the per-template loop. A real PHOENIX extractor only has to return the same line-list shape at that point. The output JSON schema and downstream modules do not need to change.

One implementation detail matters for the acceptance criteria: the current code uses `if not lines:` before falling back. A legitimate PHOENIX result of `[]` would therefore silently invoke the model. If an empty extracted template is supposed to be a hard failure rather than a model substitution, implementation will need to distinguish `None` (PHOENIX unavailable) from an empty extracted result while preserving the existing no-grid fallback.

## 2. Dependencies and local files

`data-pipeline/requirements.txt` already declares:

- `numpy>=1.24`
- `astropy>=5.0`
- `scipy>=1.10`
- `tqdm>=4.0`

The repository intentionally ignores `data-pipeline/downloads/` and `data-pipeline/nist_lines.tsv` in `data-pipeline/.gitignore`.

Therefore GitHub cannot establish what, if anything, is currently present in a developer's local `downloads/phoenix/` directory. No PHOENIX grid or NIST cache is committed.

### What the current detection logic expects

The current code does not actually define:

- a filename pattern;
- a PHOENIX archive version;
- HiRes versus medium-resolution product;
- a shared wavelength-file name;
- FITS header requirements;
- flux units;
- wavelength units/frame;
- metallicity layout;
- how to choose the nearest model.

Any non-empty directory passes the file-presence test.

### External PHOENIX format relevant to implementation

The Husser/PHOENIX-ACES high-resolution library uses files such as:

`lte06800-4.50-0.0.PHOENIX-ACES-AGSS-COND-2011-HiRes.fits`

The high-resolution spectrum FITS contains one primary flux array. Husser et al. document the surface flux units as `erg/s/cm^2/cm`. The wavelength array is stored separately and shared by all models, for example:

`WAVE_PHOENIX-ACES-AGSS-COND-2011.fits`

The optical high-resolution sampling is approximately `R = 500000`, and the grid is therefore far above the resolution this project intends to measure. The PHOENIX wavelength grid is in vacuum wavelengths.

Sources:

- Husser et al. 2013, A&A 553 A6: https://doi.org/10.1051/0004-6361/201219058
- Göttingen archive, v2 HiRes: https://phoenix.astro.physik.uni-goettingen.de/data/v2.0/HiResFITS/

## 3. Current model-based template generator

The default path is deliberately small and deterministic.

`common.py::FEATURES` is a built-in diagnostic spectral atlas. Each feature carries:

- rest wavelength;
- element/feature label;
- excitation potential;
- feature category;
- piecewise `(Teff, depth, EW)` anchors.

`common.synth_lines()`:

1. interpolates `depth` and `ew` from the feature anchors at the requested Teff;
2. applies a category-based width rule;
3. applies `assign_profile()`;
4. optionally uses the NIST cache to refine `ep` for selected metal features;
5. drops features below the EW floor unless forced;
6. sorts by EW descending;
7. keeps eight features;
8. guarantees H-alpha and Ca II K a slot if generated.

This returns exactly the line-list shape that `_try_phoenix()` must return. `build-templates.py` then joins both paths at the same `lines` variable and writes the same `spectral-templates.json` structure.

The current output has 22 keys:

`O5V, O9V, B0V, B2V, B5V, B8V, B8Ia, A0V, A1V, A5V, F0V, F5V, G0V, G2V, G5V, K0V, K1.5III, K5V, M0V, M1Iab, M2V, M5V`.

## 4. Grid parameter mapping and coverage

The current template table supplies Teff and luminosity class. `build-templates.py` currently turns luminosity class into surface gravity with:

- V -> log g 4.5
- III -> log g 2.5
- I -> log g 1.0

There is no current `[Fe/H]` mapping in the code. Section 7 of the brief requires one. Solar `[Fe/H] = 0.0` is the obvious generic-template baseline, but the brief does not explicitly authorize that value, so it remains a review decision rather than a finding.

The repo also does not specify a PHOENIX archive version. For coverage analysis only, the public v2.0 solar-metallicity HiRes archive is a useful concrete reference because it is a high-resolution PHOENIX-ACES product and extends to 15000 K.

Approximate nearest Teff points against that archive are:

| Key | Requested Teff | Current log g | Nearest v2 HiRes Teff | Finding |
|---|---:|---:|---:|---|
| O5V | 41000 | 4.5 | 15000 | outside grid by 26000 K |
| O9V | 32000 | 4.5 | 15000 | outside grid by 17000 K |
| B0V | 28000 | 4.5 | 15000 | outside grid by 13000 K |
| B2V | 22000 | 4.5 | 15000 | outside grid by 7000 K |
| B5V | 15400 | 4.5 | 15000 | near upper edge, 400 K offset |
| B8V | 12000 | 4.5 | 12000 | Teff exact |
| B8Ia | 12100 | 1.0 | 12000/12500 | Teff close; hot low-gravity coverage requires explicit file check |
| A0V | 9600 | 4.5 | 9600 | exact |
| A1V | 9940 | 4.5 | 10000 | 60 K offset |
| A5V | 8200 | 4.5 | 8200 | exact |
| F0V | 7350 | 4.5 | 7400 | 50 K offset |
| F5V | 6700 | 4.5 | 6700 | exact |
| G0V | 6000 | 4.5 | 6000 | exact |
| G2V | 5778 | 4.5 | 5800 | 22 K offset |
| G5V | 5660 | 4.5 | 5700 | 40 K offset |
| K0V | 5200 | 4.5 | 5200 | exact |
| K1.5III | 4286 | 2.5 | 4300 | 14 K offset |
| K5V | 4400 | 4.5 | 4400 | exact |
| M0V | 3850 | 4.5 | 3800/3900 | 50 K offset |
| M1Iab | 3600 | 1.0 | 3600 | Teff exact |
| M2V | 3550 | 4.5 | 3500/3600 | 50 K offset |
| M5V | 2800 | 4.5 | 2800 | exact |

The first four hot keys cannot be represented honestly by nearest-neighbor selection against this grid. `B5V` is close to the top edge. `B8Ia` needs a real-file gravity check because high-Teff PHOENIX archive combinations do not necessarily include the low gravities that exist at cooler temperatures.

This means the implementation needs an explicit policy for template keys outside the chosen PHOENIX grid. Mapping O5V/O9V/B0V/B2V to a 15000 K spectrum would preserve the JSON key but destroy the intended subtype meaning.

## 5. Atomic line list and the 70% blend rule

There is already an atomic-line layer: `data-pipeline/nist.py`.

### What it retains today

The current cache contract is only:

`(wl_nm, el, ep_eV)`

The parser extracts:

- observed air wavelength, with Ritz/calculated fallback;
- element/species label;
- lower-level energy `Ei`, converted to eV when needed and used as `ep`.

The query requests relative intensity (`intens_out=on`) and NIST's normal output can include transition probability data, but `_parse_table()` discards those columns. `nist_lines.tsv` stores only wavelength, element, and excitation potential.

### What NIST can supply upstream

NIST ASD documents output for:

- `Aki` / weighted `gk Aki`;
- absorption oscillator strength `fik`;
- line strength `S`;
- `log(gf)`;
- relative intensity.

NIST explicitly warns that relative intensities are source-dependent and generally qualitative. They are not a sound basis for a quantitative cross-species 70% dominance test.

`fik` or `log(gf)` is a much better intrinsic absorption-transition strength proxy and can be requested from the same NIST service, so this is a parser/query extension rather than a missing dependency.

However, one distinction remains for review: `log(gf)` measures intrinsic transition strength. It does not by itself equal the fraction of an observed stellar blend contributed by that transition across different species, because actual opacity also depends on abundance and level/ion population. Therefore Gate 1 can establish that a defensible strength proxy exists, but the phrase ">=70% of predicted contribution" needs one of two interpretations before implementation:

1. operational: >=70% of a documented proxy score based on NIST transition strength, or
2. physical: >=70% of predicted stellar absorption opacity, which needs additional population/abundance modeling not present in the repo.

Source: NIST ASD Lines Help, https://physics.nist.gov/PhysRefData/ASD/Html/lineshelp.html

## 6. Air/vacuum wavelength mismatch

This is an implementation-critical finding.

PHOENIX HiRes wavelengths are vacuum wavelengths. `nist.py` currently describes and parses its 3800-7600 A results as observed air wavelengths. The existing `lookup_nearest()` tolerance is only 0.05 nm.

The air-vacuum offset in the optical can exceed that tolerance, so a direct cross-match would reject or misidentify otherwise correct transitions.

The extraction path must put PHOENIX features and the NIST line table into the same wavelength frame before identification. Which frame to use is an implementation detail, but the conversion must be explicit and tested.

## 7. Profile rule against the six curated stars

`common.py::assign_profile()` currently encodes:

- Balmer: Lorentzian above 7500 K, otherwise Voigt;
- Ca II: Voigt;
- Na I D: Voigt;
- molecular TiO/CN/CH: Gaussian;
- everything else: Gaussian.

Most curated-star profiles agree with this, but two visible cases do not:

- Curated Betelgeuse and Arcturus use `voigt` for Ca I 422.7 nm. `assign_profile()` currently falls through to `gaussian` for Ca I.
- Curated Rigel uses `voigt` for He I 447.1 and 587.6 nm. `assign_profile()` currently falls through to `gaussian` for He I.

Therefore section 2's instruction to derive the PHOENIX profile rule from the six curated stars should not simply reuse the current `assign_profile()` unchanged. The implementation needs to reconcile those two categories while leaving the curated JSON untouched.

## 8. Molecular-band source

The current repo has one explicit molecular feature in `common.py::FEATURES`:

- TiO gamma, band head 705.3 nm, `ep = 0`, Gaussian profile.

Betelgeuse's curated entry uses the same feature with width 3.0 A and EW 1500 mA.

That is enough to anchor an explicit TiO-gamma broad-feature path. There is no general molecular band-head list or dependency in the current repo. If the implementation wants additional TiO/CN/CH bands, a source must be identified rather than invented.

## 9. Runtime handoff comprehension check

> PHOENIX writes `spectral-templates.json`. How does that file become runtime spectral data for a selected star, and under what conditions does the resolver choose it?

Answer:

`build-templates.py` writes `data-pipeline/output/spectral-templates.json`. `src/data/spectral-templates.js` statically imports that JSON and builds the in-memory `SPECTRAL_TEMPLATES` table plus `templateForType`, `templateForBV`, and `defaultTemplate`.

`App.jsx` owns a persistent `StarDataResolver` and calls `resolve(star)` for selected and hovered stars. `StarDataResolver` first tries the curated name/alias map built from `bright-stars.json`. If that misses, it tries a spectral-type template, then a B-V-selected template, then the default A0V template. The resolved object is stored/passed to `SpectrumPanel` and the existing `SonificationEngine` playback paths.

So a regenerated PHOENIX `spectral-templates.json` reaches runtime automatically through the existing adapter after the app is rebuilt/reloaded. The resolver uses PHOENIX-generated template data only for stars that do not match one of the six curated name/alias entries. Among uncurated stars, an exact spectral-type key wins when available; otherwise the adapter's class/luminosity fallback, B-V fallback, or default template selects the data.

The reconciled `docs/ARCHITECTURE.md` and the current source agree on this path.

## 10. Gate 1 review items

Before extraction code starts, review should settle or explicitly accept these points:

1. **Grid product/version:** which PHOENIX local layout is the supported input contract. The repo currently accepts any non-empty directory.
2. **Out-of-grid hot templates:** O5V, O9V, B0V, and B2V cannot be represented by the public v2 HiRes grid's 15000 K ceiling. B5V is near the ceiling.
3. **Metallicity:** section 7 requires `[Fe/H]`, but the current template mapping has no metallicity value.
4. **Blend dominance semantics:** whether 70% means share of an intrinsic NIST transition-strength proxy such as `log(gf)`, or actual modeled feature opacity.
5. **Wavelength frame:** PHOENIX vacuum and current NIST air wavelengths must be normalized to one frame before matching.
6. **Profile rule:** Ca I and He I need reconciliation with the curated-star profiles.
7. **Molecular scope:** current repo supports one explicit TiO gamma band head; broader molecular identification has no source yet.

No source code or output JSON was changed during Gate 1.