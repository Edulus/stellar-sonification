"""PHOENIX-ACES HiRes extraction for spectral templates.

Contract: PHOENIX-ACES-AGSS-COND-2011 HiRes FITS, solar metallicity,
shared WAVE_PHOENIX-ACES-AGSS-COND-2011.fits, under downloads/phoenix/.
"""
from __future__ import annotations

import math
import os
import re
from dataclasses import dataclass

import numpy as np

OPTICAL_MIN_A = 3800.0
OPTICAL_MAX_A = 7600.0
TARGET_RESOLUTION = 7500.0
MIN_SPACING_NM = (760.0 - 380.0) / 36.0  # one semitone in wlToFreq
CONTINUUM_PERCENTILE = 95.0
WINDOW_SCALE_CANDIDATES_A = (5.0, 10.0, 20.0, 40.0, 80.0)
MIN_FEATURE_DEPTH = 0.03
MAX_LINES = 8
BLEND_DOMINANCE = 0.70
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
    wave_path, models = None, []
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
                os.path.join(root, name), int(m.group("teff")),
                float(m.group("logg")), feh,
            ))
    return wave_path, sorted(models, key=lambda x: (x.teff, x.logg))


def nearest_model(models, teff, logg):
    if not models:
        return None
    teffs = [m.teff for m in models]
    if teff < min(teffs) - 250 or teff > max(teffs) + 500:
        return None
    best = min(
        models,
        key=lambda m: ((m.teff - teff) / 100.0) ** 2 + ((m.logg - logg) / 0.5) ** 2,
    )
    return None if abs(best.logg - logg) > 1.0 else best


def read_hires(model_path, wave_path):
    from astropy.io import fits
    flux = np.asarray(fits.getdata(model_path), dtype=float).reshape(-1)
    wave = np.asarray(fits.getdata(wave_path), dtype=float).reshape(-1)
    if len(flux) != len(wave):
        raise ValueError(f"PHOENIX flux/wavelength mismatch: {len(flux)} != {len(wave)}")
    mask = (
        np.isfinite(wave) & np.isfinite(flux) & (flux > 0)
        & (wave >= OPTICAL_MIN_A) & (wave <= OPTICAL_MAX_A)
    )
    wave, flux = wave[mask], flux[mask]
    if len(wave) < 1000:
        raise ValueError("PHOENIX optical slice is unexpectedly small")
    order = np.argsort(wave)
    return wave[order], flux[order]


def degrade_resolution(wave_a, flux, resolution=TARGET_RESOLUTION):
    from scipy.ndimage import gaussian_filter1d
    logw = np.log(np.asarray(wave_a, dtype=float))
    flux = np.asarray(flux, dtype=float)
    dlog = float(np.median(np.diff(logw)))
    grid = np.arange(logw[0], logw[-1], dlog)
    f = np.interp(grid, logw, flux)
    sigma_pix = max(0.5, ((1.0 / resolution) / 2.354820045) / dlog)
    return np.exp(grid), gaussian_filter1d(f, sigma_pix, mode="nearest")


def pseudo_continuum(wave_a, flux, window_a):
    from scipy.ndimage import gaussian_filter1d
    wave_a, flux = np.asarray(wave_a), np.asarray(flux)
    step = half = window_a / 2.0
    centers = np.arange(wave_a[0], wave_a[-1] + step, step)
    upper = np.empty_like(centers)
    left = right = 0
    n = len(wave_a)
    for i, c in enumerate(centers):
        lo, hi = c - half, c + half
        while left < n and wave_a[left] < lo:
            left += 1
        right = max(right, left)
        while right < n and wave_a[right] <= hi:
            right += 1
        seg = flux[left:right]
        upper[i] = np.percentile(seg, CONTINUUM_PERCENTILE) if len(seg) else np.nan
    good = np.isfinite(upper) & (upper > 0)
    if good.sum() < 4:
        raise ValueError("Could not estimate PHOENIX pseudo-continuum")
    upper = np.interp(centers, centers[good], upper[good])
    upper = gaussian_filter1d(upper, 1.0, mode="nearest")
    return np.maximum(np.interp(wave_a, centers, upper), np.finfo(float).tiny)


def normalize_spectrum(wave_a, flux, window_a):
    cont = pseudo_continuum(wave_a, flux, window_a)
    return np.clip(flux / cont, 0.0, 1.5), cont


def _cross(x0, y0, x1, y1, target):
    if y1 == y0:
        return (x0 + x1) / 2.0
    return x0 + (target - y0) * (x1 - x0) / (y1 - y0)


def measure_features(wave_a, norm_flux, min_depth=MIN_FEATURE_DEPTH):
    from scipy.signal import find_peaks
    wave_a = np.asarray(wave_a, dtype=float)
    absorption = np.clip(1.0 - np.asarray(norm_flux, dtype=float), 0.0, None)
    peaks, _ = find_peaks(absorption, height=min_depth, prominence=min_depth / 3.0)
    out = []
    for p in peaks:
        depth = float(absorption[p])
        edge = max(0.01, depth * 0.08)
        l, r = p, p
        while l > 0 and absorption[l] > edge and p - l < 5000:
            l -= 1
        while r < len(absorption) - 1 and absorption[r] > edge and r - p < 5000:
            r += 1
        half, hl, hr = depth / 2.0, p, p
        while hl > l and absorption[hl] > half:
            hl -= 1
        while hr < r and absorption[hr] > half:
            hr += 1
        if r - l < 2 or hl == p or hr == p:
            continue
        left = _cross(wave_a[hl], absorption[hl], wave_a[hl + 1], absorption[hl + 1], half)
        right = _cross(wave_a[hr - 1], absorption[hr - 1], wave_a[hr], absorption[hr], half)
        width = max(0.0, right - left)
        if width < 0.05:
            continue
        sl = slice(l, r + 1)
        ew_a = float(np.trapezoid(absorption[sl], wave_a[sl]))
        if ew_a <= 0:
            continue
        centroid = float(np.average(wave_a[sl], weights=absorption[sl]))
        out.append({"wl": centroid / 10.0, "depth": depth, "width": width, "ew": ew_a * 1000.0})
    return out


def air_to_vacuum_nm(wl_air_nm):
    wl_a = float(wl_air_nm) * 10.0
    s2 = (1.0e4 / wl_a) ** 2
    n = 1.0 + 1.0e-8 * (8342.13 + 2406030.0 / (130.0 - s2) + 15997.0 / (38.9 - s2))
    return wl_air_nm * n


def prepare_nist_table(nist_table):
    rows = []
    for row in nist_table or []:
        if len(row) < 3:
            continue
        w_air, el, ep = row[:3]
        rows.append((
            air_to_vacuum_nm(w_air), el, ep,
            row[3] if len(row) >= 4 else None,
        ))
    rows.sort(key=lambda x: x[0])
    return rows, [x[0] for x in rows]


def _identify_prepared(feature, prepared):
    import bisect
    table, wavelengths = prepared
    center = feature["wl"]
    tol_nm = max(0.02, feature["width"] / 20.0)
    lo = bisect.bisect_left(wavelengths, center - tol_nm)
    hi = bisect.bisect_right(wavelengths, center + tol_nm)
    candidates = [
        {"wl": w, "el": el, "ep": ep, "loggf": loggf, "delta_nm": abs(w - center)}
        for w, el, ep, loggf in table[lo:hi]
    ]
    if not candidates:
        return None, None, {"reason": "unidentified", "candidates": []}
    if len(candidates) == 1:
        c = candidates[0]
        return c["el"], c["ep"], {"reason": "single", "candidates": candidates}
    if all(c["loggf"] is not None for c in candidates):
        scores = np.asarray([10.0 ** float(c["loggf"]) for c in candidates])
        share = float(scores.max() / scores.sum()) if scores.sum() > 0 else 0.0
        if share >= BLEND_DOMINANCE:
            c = candidates[int(np.argmax(scores))]
            return c["el"], c["ep"], {"reason": "dominant-loggf", "share": share, "candidates": candidates}
    return None, None, {"reason": "ambiguous-blend", "candidates": candidates}


def identify_feature(feature, nist_table):
    return _identify_prepared(feature, prepare_nist_table(nist_table))


def assign_profile(wl_nm, el, teff):
    label = (el or "").lower()
    if any(abs(wl_nm - w) < 0.3 for w in (656.3, 486.1, 434.0, 410.2)):
        return "lorentzian" if teff > 7500 else "voigt"
    if any(x in label for x in ("ca ii", "ca i", "na i", "he i")):
        return "voigt"
    return "gaussian"


def _spacing_select(lines, keep=MAX_LINES):
    out = []
    for line in sorted(lines, key=lambda x: x["ew"], reverse=True):
        if all(abs(line["wl"] - x["wl"]) >= MIN_SPACING_NM for x in out):
            out.append(line)
            if len(out) >= keep:
                break
    return out


def extract_atomic_lines(wave_a, flux, teff, nist_table, window_a, diagnostics=None):
    dw, df = degrade_resolution(wave_a, flux)
    norm, _ = normalize_spectrum(dw, df, window_a)
    identified = []
    prepared = prepare_nist_table(nist_table)
    for feat in sorted(measure_features(dw, norm), key=lambda x: x["ew"], reverse=True):
        el, ep, info = _identify_prepared(feat, prepared)
        if el is None:
            if diagnostics is not None:
                diagnostics.append({**feat, **info})
            continue
        identified.append({**feat, "profile": assign_profile(feat["wl"], el, teff), "el": el, "ep": ep})
    return _spacing_select(identified)


def extract_molecular_bands(wave_a, flux, teff, window_a=120.0):
    if teff > 4400:
        return []
    dw, df = degrade_resolution(wave_a, flux)
    norm, _ = normalize_spectrum(dw, df, window_a)
    out = []
    for band in MOLECULAR_BANDS:
        center_a, hw = band["wl_nm"] * 10.0, band["half_width_a"]
        mask = (dw >= center_a - hw) & (dw <= center_a + hw)
        if mask.sum() < 5:
            continue
        subw = dw[mask]
        absorption = np.clip(1.0 - norm[mask], 0.0, None)
        depth = float(absorption.max())
        if depth < MIN_FEATURE_DEPTH:
            continue
        ew_a = float(np.trapezoid(absorption, subw))
        above = np.where(absorption >= depth / 2.0)[0]
        width = float(subw[above[-1]] - subw[above[0]]) if len(above) >= 2 else 3.0
        out.append({
            "wl": band["wl_nm"], "depth": depth, "width": max(width, 0.1),
            "ew": ew_a * 1000.0, "profile": "gaussian",
            "el": band["el"], "ep": band["ep"],
        })
    return out


def _round_line(line):
    return {
        "wl": round(float(line["wl"]), 1),
        "depth": round(float(line["depth"]), 2),
        "width": round(float(line["width"]), 2),
        "profile": line["profile"],
        "ew": int(round(float(line["ew"]))),
        "el": line["el"],
        "ep": round(float(line["ep"]), 2),
    }


def extract_template(model_path, wave_path, teff, nist_table, window_a, diagnostics=None):
    wave_a, flux = read_hires(model_path, wave_path)
    lines = extract_atomic_lines(wave_a, flux, teff, nist_table, window_a, diagnostics)
    lines += extract_molecular_bands(wave_a, flux, teff)
    return [_round_line(x) for x in _spacing_select(lines)]


def _distribution_score(lines, curated_lines):
    if not lines:
        return float("inf")
    a = sorted(lines, key=lambda x: x["ew"], reverse=True)[:8]
    b = sorted(curated_lines, key=lambda x: x["ew"], reverse=True)[:8]
    ew_a = np.asarray([max(1.0, x["ew"]) for x in a])
    ew_b = np.asarray([max(1.0, x["ew"]) for x in b])
    d_a = np.asarray([x["depth"] for x in a])
    d_b = np.asarray([x["depth"] for x in b])
    return abs(math.log(np.median(ew_a) / np.median(ew_b))) + abs(float(np.median(d_a) - np.median(d_b)))


def calibrate_window(models_by_key, wave_path, curated_by_name, nist_table):
    rows = []
    for window_a in WINDOW_SCALE_CANDIDATES_A:
        total, detail = 0.0, {}
        for key, star_name in (("G2V", "Sol"), ("A0V", "Vega")):
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
