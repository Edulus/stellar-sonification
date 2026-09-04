"""PHOENIX-ACES HiRes extraction for spectral templates.

Supported input contract:
- PHOENIX-ACES-AGSS-COND-2011 HiRes FITS
- solar metallicity ([Fe/H] = 0.0), no alpha-enhancement
- shared WAVE_PHOENIX-ACES-AGSS-COND-2011.fits wavelength file
- files may be flat or nested under downloads/phoenix/

The extractor measures wl/depth/FWHM/EW from a degraded, pseudo-continuum
normalized spectrum. Element and excitation potential come from the atomic
line table. Ambiguous blends are dropped unless a future four-field line cache
provides log(gf) and one candidate owns >= 70% of that proxy score.
"""

from __future__ import annotations

import math
import os
import re
from dataclasses import dataclass

import numpy as np

OPTICAL_MIN_A = 3800.0
OPTICAL_MAX_A = 7600.0

# Median lambda/FWHM across the six curated stars' atomic lines is ~7.4k.
# Round to a stable project target. PHOENIX HiRes (~500k) is degraded first.
TARGET_RESOLUTION = 7500.0

# wlToFreq maps 380..760 nm linearly across 36 semitones.
# One semitone therefore occupies this many nm.
MIN_SPACING_NM = (760.0 - 380.0) / 36.0

CONTINUUM_PERCENTILE = 95.0
WINDOW_SCALE_CANDIDATES_A = (5.0, 10.0, 20.0, 40.0, 80.0)
MIN_FEATURE_DEPTH = 0.03
MAX_LINES = 8
MIN_LINES = 6
BLEND_DOMINANCE = 0.70

# Only molecular band source currently present in the repo.
MOLECULAR_BANDS = (
    {"wl_nm": 705.3, "el": "TiO γ", "ep": 0.0, "half_width_a": 18.0},
)

_MODEL_RE = re.compile(
    r"lte(?P<teff>\d{5})-(?P<logg>\d\.\d{2})(?P<feh>[+-]\d\.\d)"
    r"(?P<alpha>\.Alpha=[+-]\d\.\d{2})?\.PHOENIX-ACES-AGSS-COND-2011-HiRes\.fits$"
)


@dataclass(frozen=True)
class GridModel:
    path: str
    teff: int
    logg: float
    feh: float


def discover_grid(grid_dir):
    """Return (wave_path, solar_models) for a local PHOENIX-ACES HiRes tree."""
    wave_path = None
    models = []
    for root, _, files in os.walk(grid_dir):
        for name in files:
            if name == "WAVE_PHOENIX-ACES-AGSS-COND-2011.fits":
                wave_path = os.path.join(root, name)
                continue
            m = _MODEL_RE.match(name)
            if not m or m.group("alpha"):
                continue
            feh = float(m.group("feh"))
            if abs(feh) > 1e-9:
                continue
            models.append(GridModel(
                os.path.join(root, name),
                int(m.group("teff")),
                float(m.group("logg")),
                feh,
            ))
    return wave_path, sorted(models, key=lambda m: (m.teff, m.logg))


def nearest_model(models, teff, logg):
    """Nearest solar-metallicity grid point, with explicit out-of-grid rejection."""
    if not models:
        return None
    teffs = [m.teff for m in models]
    if teff < min(teffs) - 250 or teff > max(teffs) + 500:
        return None

    # Grid steps are typically 100 K / 0.5 dex. Weight in grid-step units.
    best = min(
        models,
        key=lambda m: ((m.teff - teff) / 100.0) ** 2 + ((m.logg - logg) / 0.5) ** 2,
    )
    # A large gravity miss means that exact Teff is not genuinely represented.
    if abs(best.logg - logg) > 1.0:
        return None
    return best


def read_hires(model_path, wave_path):
    """Read one HiRes flux model plus the shared vacuum wavelength array."""
    from astropy.io import fits

    flux = np.asarray(fits.getdata(model_path), dtype=float).reshape(-1)
    wave = np.asarray(fits.getdata(wave_path), dtype=float).reshape(-1)
    if len(flux) != len(wave):
        raise ValueError(
            f"PHOENIX flux/wavelength length mismatch: {len(flux)} != {len(wave)}"
        )
    mask = (
        np.isfinite(wave) & np.isfinite(flux) & (flux > 0)
        & (wave >= OPTICAL_MIN_A) & (wave <= OPTICAL_MAX_A)
    )
    wave = wave[mask]
    flux = flux[mask]
    if len(wave) < 1000:
        raise ValueError("PHOENIX optical slice is unexpectedly small")
    order = np.argsort(wave)
    return wave[order], flux[order]


def degrade_resolution(wave_a, flux, resolution=TARGET_RESOLUTION):
    """Convolve on a uniform log-lambda grid to a constant resolving power."""
    from scipy.ndimage import gaussian_filter1d

    wave_a = np.asarray(wave_a, dtype=float)
    flux = np.asarray(flux, dtype=float)
    logw = np.log(wave_a)
    dlog = float(np.median(np.diff(logw)))
    grid = np.arange(logw[0], logw[-1], dlog)
    interp_flux = np.interp(grid, logw, flux)

    # Gaussian FWHM in d(lambda)/lambda is 1/R.
    sigma_log = (1.0 / resolution) / 2.354820045
    sigma_pix = max(0.5, sigma_log / dlog)
    smooth = gaussian_filter1d(interp_flux, sigma_pix, mode="nearest")
    return np.exp(grid), smooth


def pseudo_continuum(wave_a, flux, window_a):
    """High-percentile upper envelope in overlapping wavelength windows."""
    from scipy.ndimage import gaussian_filter1d

    wave_a = np.asarray(wave_a, dtype=float)
    flux = np.asarray(flux, dtype=float)
    step = window_a / 2.0
    centers = np.arange(wave_a[0], wave_a[-1] + step, step)
    upper = np.empty_like(centers)

    left = 0
    right = 0
    half = window_a / 2.0
    n = len(wave_a)
    for i, c in enumerate(centers):
        lo, hi = c - half, c + half
        while left < n and wave_a[left] < lo:
            left += 1
        right = max(right, left)
        while right < n and wave_a[right] <= hi:
            right += 1
        segment = flux[left:right]
        upper[i] = np.percentile(segment, CONTINUUM_PERCENTILE) if len(segment) else np.nan

    good = np.isfinite(upper) & (upper > 0)
    if good.sum() < 4:
        raise ValueError("Could not estimate PHOENIX pseudo-continuum")
    upper = np.interp(centers, centers[good], upper[good])
    upper = gaussian_filter1d(upper, 1.0, mode="nearest")
    continuum = np.interp(wave_a, centers, upper)
    continuum = np.maximum(continuum, np.finfo(float).tiny)
    return continuum


def normalize_spectrum(wave_a, flux, window_a):
    cont = pseudo_continuum(wave_a, flux, window_a)
    norm = flux / cont
    return np.clip(norm, 0.0, 1.5), cont


def _crossing_x(x0, y0, x1, y1, target):
    if y1 == y0:
        return (x0 + x1) / 2.0
    f = (target - y0) / (y1 - y0)
    return x0 + f * (x1 - x0)


def measure_features(wave_a, norm_flux, min_depth=MIN_FEATURE_DEPTH):
    """Measure absorption features from a normalized degraded spectrum."""
    from scipy.signal import find_peaks

    absorption = np.clip(1.0 - np.asarray(norm_flux, dtype=float), 0.0, None)
    wave_a = np.asarray(wave_a, dtype=float)
    peaks, _ = find_peaks(absorption, height=min_depth, prominence=min_depth / 3.0)

    out = []
    for p in peaks:
        depth = float(absorption[p])
        if depth < min_depth:
            continue

        edge_level = max(0.01, depth * 0.08)
        l = p
        while l > 0 and absorption[l] > edge_level and (p - l) < 5000:
            l -= 1
        r = p
        while r < len(absorption) - 1 and absorption[r] > edge_level and (r - p) < 5000:
            r += 1
        if r - l < 2:
            continue

        half = depth / 2.0
        hl = p
        while hl > l and absorption[hl] > half:
            hl -= 1
        hr = p
        while hr < r and absorption[hr] > half:
            hr += 1
        if hl == p or hr == p:
            continue
        wl_left = _crossing_x(wave_a[hl], absorption[hl], wave_a[hl + 1], absorption[hl + 1], half)
        wl_right = _crossing_x(wave_a[hr - 1], absorption[hr - 1], wave_a[hr], absorption[hr], half)
        fwhm_a = max(0.0, wl_right - wl_left)
        if fwhm_a < 0.05:
            continue

        sl = slice(l, r + 1)
        ew_a = float(np.trapezoid(absorption[sl], wave_a[sl]))
        if ew_a <= 0:
            continue
        weights = absorption[sl]
        centroid_a = float(np.average(wave_a[sl], weights=weights))

        out.append({
            "wl": centroid_a / 10.0,
            "depth": depth,
            "width": fwhm_a,
            "ew": ew_a * 1000.0,
        })
    return out


def air_to_vacuum_nm(wl_air_nm):
    """Convert standard-air optical wavelength to vacuum (Edlen-style formula)."""
    wl_a = float(wl_air_nm) * 10.0
    s2 = (1.0e4 / wl_a) ** 2
    n = 1.0 + 1.0e-8 * (
        8342.13 + 2406030.0 / (130.0 - s2) + 15997.0 / (38.9 - s2)
    )
    return wl_air_nm * n


def identify_feature(feature, nist_table):
    """Return (el, ep, diagnostic) or reject an unidentified/ambiguous feature.

    Current three-field NIST caches have no quantitative strength proxy. If more
    than one transition falls within the measured feature width, the blend is
    conservatively rejected. A future fourth field is interpreted as log(gf);
    then >=70% of sum(10**loggf) establishes operational dominance.
    """
    center = feature["wl"]
    tol_nm = max(0.02, feature["width"] / 20.0)
    candidates = []
    for row in nist_table or []:
        if len(row) < 3:
            continue
        w_air, el, ep = row[:3]
        w_vac = air_to_vacuum_nm(w_air)
        if abs(w_vac - center) <= tol_nm:
            loggf = row[3] if len(row) >= 4 else None
            candidates.append({
                "wl": w_vac, "el": el, "ep": ep, "loggf": loggf,
                "delta_nm": abs(w_vac - center),
            })

    if not candidates:
        return None, None, {"reason": "unidentified", "candidates": []}
    if len(candidates) == 1:
        c = candidates[0]
        return c["el"], c["ep"], {"reason": "single", "candidates": candidates}

    if all(c["loggf"] is not None for c in candidates):
        scores = np.array([10.0 ** float(c["loggf"]) for c in candidates], dtype=float)
        total = float(scores.sum())
        if total > 0:
            i = int(np.argmax(scores))
            share = float(scores[i] / total)
            if share >= BLEND_DOMINANCE:
                c = candidates[i]
                return c["el"], c["ep"], {
                    "reason": "dominant-loggf", "share": share, "candidates": candidates
                }

    return None, None, {"reason": "ambiguous-blend", "candidates": candidates}


def assign_profile(wl_nm, el, teff):
    """Profile rule reconciled to the six curated stars."""
    label = (el or "").lower()
    if abs(wl_nm - 656.3) < 0.3 or abs(wl_nm - 486.1) < 0.3 or \
       abs(wl_nm - 434.0) < 0.3 or abs(wl_nm - 410.2) < 0.3:
        return "lorentzian" if teff > 7500 else "voigt"
    if "ca ii" in label or "ca i" in label or "na i" in label or "he i" in label:
        return "voigt"
    if "tio" in label or "cn" in label or "ch" in label:
        return "gaussian"
    return "gaussian"


def _spacing_select(lines, keep=MAX_LINES):
    selected = []
    for line in sorted(lines, key=lambda x: x["ew"], reverse=True):
        if all(abs(line["wl"] - other["wl"]) >= MIN_SPACING_NM for other in selected):
            selected.append(line)
            if len(selected) >= keep:
                break
    return selected


def extract_atomic_lines(wave_a, flux, teff, nist_table, window_a, diagnostics=None):
    dw, df = degrade_resolution(wave_a, flux)
    norm, _ = normalize_spectrum(dw, df, window_a)
    measured = measure_features(dw, norm)
    identified = []

    for feat in sorted(measured, key=lambda x: x["ew"], reverse=True):
        el, ep, info = identify_feature(feat, nist_table)
        if el is None:
            if diagnostics is not None:
                diagnostics.append({**feat, **info})
            continue
        identified.append({
            **feat,
            "profile": assign_profile(feat["wl"], el, teff),
            "el": el,
            "ep": ep,
        })

    return _spacing_select(identified)


def extract_molecular_bands(wave_a, flux, teff, window_a=120.0, diagnostics=None):
    """Explicit broad pass for the one molecular band head sourced in this repo."""
    if teff > 4400:
        return []
    dw, df = degrade_resolution(wave_a, flux)
    norm, _ = normalize_spectrum(dw, df, window_a)
    out = []
    for band in MOLECULAR_BANDS:
        center_a = band["wl_nm"] * 10.0
        hw = band["half_width_a"]
        mask = (dw >= center_a - hw) & (dw <= center_a + hw)
        if mask.sum() < 5:
            continue
        subw = dw[mask]
        subf = norm[mask]
        absorption = np.clip(1.0 - subf, 0.0, None)
        depth = float(absorption.max())
        if depth < MIN_FEATURE_DEPTH:
            continue
        ew_a = float(np.trapezoid(absorption, subw))
        half = depth / 2.0
        above = np.where(absorption >= half)[0]
        width = float(subw[above[-1]] - subw[above[0]]) if len(above) >= 2 else 3.0
        out.append({
            "wl": band["wl_nm"],
            "depth": depth,
            "width": max(width, 0.1),
            "ew": ew_a * 1000.0,
            "profile": "gaussian",
            "el": band["el"],
            "ep": band["ep"],
        })
    return out


def _round_line(line):
    return {
        "wl": round(float(line["wl"]), 1),
        "depth": round(float(line["depth"]), 2),
        "width": round(float(line["width"]), 2),
        "profile": line["profile"],
        "ew": int(round(float(line["ew"])),
        "el": line["el"],
        "ep": round(float(line["ep"]), 2),
    }


def extract_template(model_path, wave_path, teff, nist_table, window_a, diagnostics=None):
    wave_a, flux = read_hires(model_path, wave_path)
    atomic = extract_atomic_lines(wave_a, flux, teff, nist_table, window_a, diagnostics)
    molecular = extract_molecular_bands(wave_a, flux, teff, diagnostics=diagnostics)
    lines = _spacing_select(atomic + molecular)
    return [_round_line(line) for line in lines]


def _distribution_score(lines, curated_lines):
    if not lines:
        return float("inf")
    top = sorted(lines, key=lambda x: x["ew"], reverse=True)[:8]
    ref = sorted(curated_lines, key=lambda x: x["ew"], reverse=True)[:8]
    gen_ew = np.array([max(1.0, x["ew"]) for x in top], dtype=float)
    ref_ew = np.array([max(1.0, x["ew"]) for x in ref], dtype=float)
    gen_d = np.array([x["depth"] for x in top], dtype=float)
    ref_d = np.array([x["depth"] for x in ref], dtype=float)
    return (
        abs(math.log(np.median(gen_ew) / np.median(ref_ew)))
        + abs(float(np.median(gen_d) - np.median(ref_d)))
    )


def calibrate_window(models_by_key, wave_path, curated_by_name, nist_table):
    """Sweep one global pseudo-continuum window using G2V/Sol and A0V/Vega."""
    refs = (("G2V", "Sol"), ("A0V", "Vega"))
    rows = []
    for window_a in WINDOW_SCALE_CANDIDATES_A:
        total = 0.0
        detail = {}
        for key, star_name in refs:
            model = models_by_key.get(key)
            if model is None:
                raise RuntimeError(f"window calibration requires a PHOENIX model for {key}")
            wave_a, flux = read_hires(model.path, wave_path)
            dw, df = degrade_resolution(wave_a, flux)
            norm, _ = normalize_spectrum(dw, df, window_a)
            measured = _spacing_select(measure_features(dw, norm))
            score = _distribution_score(measured, curated_by_name[star_name]["lines"])
            total += score
            detail[key] = {
                "score": score,
                "median_depth": float(np.median([x["depth"] for x in measured])) if measured else None,
                "median_ew": float(np.median([x["ew"] for x in measured])) if measured else None,
            }
        rows.append({"window_a": window_a, "score": total, "detail": detail})
    best = min(rows, key=lambda x: x["score"])
    return best["window_a"], rows
