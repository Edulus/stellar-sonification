# PHOENIX extraction

`python build-templates.py --phoenix` uses local PHOENIX-ACES synthetic spectra to build the existing `output/spectral-templates.json` schema. Runtime code does not change.

## Supported input

The implemented contract is the Göttingen **PHOENIX-ACES-AGSS-COND-2011 HiRes** layout at solar metallicity (`[Fe/H] = 0.0`) with no alpha-enhancement. Put the files anywhere under:

`data-pipeline/downloads/phoenix/`

The directory may preserve the archive tree or be flat. It must contain:

- `WAVE_PHOENIX-ACES-AGSS-COND-2011.fits`
- model files named like `lte05800-4.50-0.0.PHOENIX-ACES-AGSS-COND-2011-HiRes.fits`

The wavelength array is treated as vacuum wavelength. NIST optical wavelengths in the cache are converted from air to vacuum before matching.

## Grid policy

Template keys keep the existing Teff and luminosity-class mapping from `build-templates.py`. Luminosity class maps to log g as before: V = 4.5, III = 2.5, I = 1.0. Generic templates use `[Fe/H] = 0.0`.

The nearest local PHOENIX grid point is used without interpolation. Every run records the requested and actual grid point in `phoenix-diagnostics.json`.

A template is rejected from PHOENIX if its requested Teff lies materially outside the downloaded grid or the nearest gravity differs by more than 1 dex. Those keys use an **explicit, logged model fallback**. This is expected for the hottest O/B starter keys against the public PHOENIX-ACES HiRes grid; a 15,000 K model is never relabelled O5V.

## Measurement path

1. Restrict the spectrum to 3800–7600 Å.
2. Degrade the native HiRes spectrum to `R = 7500`, derived from the median wavelength/FWHM scale of the six curated stars.
3. Sweep pseudo-continuum windows of 5, 10, 20, 40 and 80 Å using G2V/Sol and A0V/Vega as calibration references.
4. Pick one window for the whole run. The sweep and chosen window are written to diagnostics.
5. Normalize to a 95th-percentile upper envelope in overlapping windows.
6. Measure feature centre, continuum-relative depth, FWHM and EW from the degraded normalized spectrum.
7. Cross-match atomic features to the NIST line table in the vacuum wavelength frame.
8. Sort by EW and keep at most eight features, enforcing the live `wlToFreq` one-semitone spacing of 10.56 nm.

The window is selected empirically per PHOENIX run rather than hard-coded without a real grid measurement. It is still one uniform value for every template in that run.

## Identification and blends

`nist.py` now requests NIST absorption oscillator strength `f_ik` and lower-level statistical weight `g_i` and stores `log(gf) = log10(g_i * f_ik)` when both are available. Its cache is backward-compatible with older three-column files that contain only wavelength, species and excitation potential.

A feature with one candidate transition is retained. For a multi-transition blend, `phoenix.py` uses `10**log(gf)` as an explicitly operational intrinsic-strength proxy when every candidate has that field. One transition must own at least 70% of the proxy weight to identify the blend. If the cache is old or any candidate lacks a defensible strength value, the blend is dropped. Raw NIST relative intensity is deliberately never used for this threshold.

Dropped features, their measured values and candidate transitions are written to `phoenix-diagnostics.json`.

## Profiles and molecular bands

Profiles follow the curated-star pattern: Balmer is Lorentzian above 7500 K and Voigt below; Ca I, Ca II, Na I and He I are Voigt; ordinary metals are Gaussian.

The repo currently has one sourced molecular-band anchor, TiO γ at 705.3 nm. Cool templates therefore get a separate broad-feature pass for that band. No additional molecular band heads are invented.

## Protected stars

`build-templates.py` never writes `bright-stars.json` and byte-checks it before/after the build. Sol, Vega, Betelgeuse, Sirius, Arcturus and Rigel remain curated and win runtime resolution by name/alias before any template.

## Verification

`npm run verify:phoenix` is browser-free and checks the NIST `log(gf)` cache path, grid discovery, out-of-grid rejection, wavelength-frame conversion, conservative blend rejection, `log(gf)` dominance, synthetic feature extraction and pitch-spacing de-duplication.

A real PHOENIX run additionally produces `phoenix-diagnostics.json`; it is intentionally git-ignored because it is run-specific and can be large.
