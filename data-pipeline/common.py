"""Shared helpers for the data pipeline: profile rules, rounding, blackbody
color, and the feature-strength model the template builder samples.

No output-file dependencies between scripts — this is a plain importable module.

The feature-strength model is a compact spectral atlas encoded as code: for each
diagnostic absorption feature, piecewise-linear anchors give (depth, ew) as a
function of effective temperature. It is deliberately "sounds-right" physics, not
publication-grade (ROADMAP Phase 1). The six prototype stars anchor it: Balmer
peaks near A0-A1, Ca II K strengthens G->K, He lines appear in B/O, TiO in M.
"""

import math

# ── Profile rules (applied uniformly; see README) ─────────────────────────
BALMER_WL = {656.3, 486.1, 434.0, 410.2}      # Hα Hβ Hγ Hδ
CAII_WL = {393.4, 396.8, 849.8, 854.2, 866.2}  # Ca II K, H, IR triplet
NAD_WL = {589.0, 589.6}


def assign_profile(wl, el, teff):
    """Profile from the uniform rules in the build spec."""
    label = (el or "").lower()
    if wl in BALMER_WL or label in {"hα", "hβ", "hγ", "hδ"}:
        return "lorentzian" if teff > 7500 else "voigt"
    if wl in CAII_WL or "ca ii" in label:
        return "voigt"
    if wl in NAD_WL or "na i d" in label:
        return "voigt"
    if "tio" in label or "cn" in label or "ch" in label:
        return "gaussian"
    return "gaussian"  # all other metal lines


# ── Rounding (output schema) ──────────────────────────────────────────────
def round_line(line):
    """Round a line dict to the schema's precision and order the keys."""
    return {
        "wl": round(float(line["wl"]), 1),
        "depth": round(float(line["depth"]), 2),
        "width": round(float(line["width"]), 2),
        "profile": line["profile"],
        "ew": int(round(float(line["ew"]))),
        "el": line["el"],
        "ep": round(float(line["ep"]), 2),
    }


# ── Blackbody -> hex (perceived star color) ───────────────────────────────
def blackbody_to_hex(teff):
    """Approximate sRGB hex for a blackbody of temperature `teff` (K).

    Tanner Helland's piecewise fit, clamped to 1000-40000 K. Good enough for a
    display swatch; the six seed stars override this with hand-picked hex.
    """
    t = max(1000.0, min(40000.0, teff)) / 100.0

    if t <= 66:
        r = 255
    else:
        r = 329.698727446 * ((t - 60) ** -0.1332047592)
    if t <= 66:
        g = 99.4708025861 * math.log(t) - 161.1195681661
    else:
        g = 288.1221695283 * ((t - 60) ** -0.0755148492)
    if t >= 66:
        b = 255
    elif t <= 19:
        b = 0
    else:
        b = 138.5177312231 * math.log(t - 10) - 305.0447927307

    def clamp(x):
        return max(0, min(255, int(round(x))))

    return f"#{clamp(r):02x}{clamp(g):02x}{clamp(b):02x}"


# ── Feature-strength model ────────────────────────────────────────────────
# Each feature: rest wl (nm), label, ep (eV), category (drives width + profile),
# and anchors: list of (teff, depth, ew_mA) sorted by teff ascending. Linear
# interpolation between anchors; clamped at the ends. ew == 0 means absent.
FEATURES = [
    # Calcium
    {"wl": 393.4, "el": "Ca II K", "ep": 0.00, "cat": "CaII", "anchors": [
        (2800, 0.45, 400), (3600, 0.60, 550), (4286, 0.90, 950), (4400, 0.92, 1000),
        (5200, 0.90, 900), (5778, 0.85, 800), (6700, 0.55, 450), (8200, 0.30, 250),
        (9940, 0.10, 80), (15000, 0.07, 45), (41000, 0.04, 25)]},
    {"wl": 396.8, "el": "Ca II H", "ep": 0.00, "cat": "CaII", "anchors": [
        (2800, 0.40, 340), (3600, 0.52, 470), (4286, 0.78, 760), (5200, 0.78, 720),
        (5778, 0.72, 640), (6700, 0.46, 360), (8200, 0.24, 190), (9940, 0.08, 60),
        (15000, 0.05, 35), (41000, 0.03, 20)]},
    {"wl": 422.7, "el": "Ca I", "ep": 0.00, "cat": "CaI", "anchors": [
        (3000, 0.55, 480), (3600, 0.80, 700), (4286, 0.70, 550), (5200, 0.45, 320),
        (5778, 0.30, 200), (6700, 0.15, 90), (8200, 0.05, 30)]},
    # Hydrogen Balmer
    {"wl": 656.3, "el": "Hα", "ep": 10.20, "cat": "H", "anchors": [
        (2800, 0.20, 120), (3600, 0.25, 150), (4286, 0.30, 200), (5200, 0.28, 170),
        (5778, 0.30, 180), (6700, 0.55, 450), (7350, 0.62, 700), (8200, 0.70, 1000),
        (9600, 0.75, 1200), (9940, 0.80, 1300), (12000, 0.62, 880), (15400, 0.50, 700),
        (22000, 0.38, 480), (32000, 0.30, 380), (41000, 0.28, 360)]},
    {"wl": 486.1, "el": "Hβ", "ep": 10.20, "cat": "H", "anchors": [
        (2800, 0.12, 70), (3600, 0.16, 95), (4286, 0.18, 110), (5200, 0.30, 200),
        (5778, 0.50, 350), (6700, 0.55, 420), (7350, 0.62, 560), (8200, 0.75, 900),
        (9600, 0.80, 1100), (9940, 0.85, 1250), (12000, 0.65, 1000), (15400, 0.55, 850),
        (22000, 0.42, 560), (32000, 0.32, 420), (41000, 0.30, 380)]},
    {"wl": 434.0, "el": "Hγ", "ep": 10.20, "cat": "H", "anchors": [
        (4286, 0.15, 90), (5200, 0.28, 170), (5778, 0.42, 300), (6700, 0.50, 380),
        (7350, 0.58, 520), (8200, 0.68, 800), (9600, 0.72, 950), (9940, 0.75, 1000),
        (12100, 0.55, 800), (15400, 0.50, 700), (22000, 0.38, 480), (41000, 0.26, 320)]},
    {"wl": 410.2, "el": "Hδ", "ep": 10.20, "cat": "H", "anchors": [
        (5200, 0.22, 130), (5778, 0.35, 230), (6700, 0.45, 320), (7350, 0.52, 440),
        (8200, 0.60, 640), (9600, 0.55, 600), (9940, 0.60, 700), (12000, 0.45, 520),
        (15400, 0.45, 520), (22000, 0.35, 400), (41000, 0.22, 260)]},
    # Helium (hot stars)
    {"wl": 447.1, "el": "He I", "ep": 20.96, "cat": "HeI", "anchors": [
        (9000, 0.00, 0), (10500, 0.10, 70), (12000, 0.22, 180), (15400, 0.25, 200),
        (22000, 0.30, 260), (28000, 0.28, 240), (41000, 0.18, 150)]},
    {"wl": 587.6, "el": "He I D₃", "ep": 20.96, "cat": "HeI", "anchors": [
        (9000, 0.00, 0), (10500, 0.08, 60), (12100, 0.30, 300), (15400, 0.28, 260),
        (22000, 0.26, 230), (41000, 0.16, 130)]},
    {"wl": 468.6, "el": "He II", "ep": 48.00, "cat": "HeII", "anchors": [
        (24000, 0.00, 0), (28000, 0.12, 120), (32000, 0.18, 200), (41000, 0.24, 280)]},
    {"wl": 454.1, "el": "He II", "ep": 48.00, "cat": "HeII", "anchors": [
        (24000, 0.00, 0), (30000, 0.16, 180), (41000, 0.22, 260)]},
    # Metals
    {"wl": 448.1, "el": "Mg II", "ep": 8.86, "cat": "MgII", "anchors": [
        (7000, 0.05, 25), (8200, 0.12, 40), (9600, 0.15, 40), (9940, 0.18, 50),
        (12000, 0.16, 60), (15400, 0.10, 45)]},
    {"wl": 516.7, "el": "Mg I b₁", "ep": 2.71, "cat": "metal", "anchors": [
        (3600, 0.55, 350), (4286, 0.55, 320), (5200, 0.50, 250), (5778, 0.45, 200),
        (6700, 0.30, 120), (8200, 0.10, 40)]},
    {"wl": 527.0, "el": "Fe I", "ep": 0.86, "cat": "metal", "anchors": [
        (3600, 0.70, 500), (4286, 0.60, 350), (5200, 0.48, 220), (5778, 0.40, 150),
        (6700, 0.25, 90), (8200, 0.08, 30)]},
    {"wl": 589.0, "el": "Na I D₁", "ep": 0.00, "cat": "NaD", "anchors": [
        (2800, 0.92, 1000), (3600, 0.90, 900), (4286, 0.75, 600), (5200, 0.62, 420),
        (5778, 0.60, 400), (6700, 0.40, 240), (8200, 0.18, 90), (9940, 0.06, 30)]},
    {"wl": 634.7, "el": "Si II", "ep": 8.12, "cat": "metal", "anchors": [
        (9000, 0.05, 30), (12100, 0.20, 100), (15400, 0.18, 95), (22000, 0.12, 70)]},
    # Molecular (cool stars)
    {"wl": 705.3, "el": "TiO γ", "ep": 0.00, "cat": "TiO", "anchors": [
        (2800, 0.80, 1900), (3200, 0.72, 1650), (3600, 0.55, 1200), (3850, 0.35, 700),
        (4100, 0.12, 250), (4400, 0.00, 0)]},
]


def _interp(anchors, teff):
    """Piecewise-linear (depth, ew) at teff, clamped to the anchor range."""
    if teff <= anchors[0][0]:
        return anchors[0][1], anchors[0][2]
    if teff >= anchors[-1][0]:
        return anchors[-1][1], anchors[-1][2]
    for (t0, d0, e0), (t1, d1, e1) in zip(anchors, anchors[1:]):
        if t0 <= teff <= t1:
            f = (teff - t0) / (t1 - t0) if t1 != t0 else 0.0
            return d0 + (d1 - d0) * f, e0 + (e1 - e0) * f
    return anchors[-1][1], anchors[-1][2]


def _width(cat, teff):
    """Typical FWHM (Å) for a feature category at this temperature."""
    if cat == "H":
        return 2.2 if teff > 12000 else 1.8 if teff > 8000 else 0.9 if teff > 6000 else 0.6
    if cat in ("HeI", "HeII"):
        return 1.0 if teff > 15000 else 0.8
    if cat == "CaII":
        return 1.0 if teff < 5000 else 0.8
    if cat == "CaI":
        return 0.6
    if cat == "NaD":
        return 0.8 if teff < 4000 else 0.5 if teff < 6500 else 0.35
    if cat == "MgII":
        return 0.2
    if cat == "TiO":
        return 3.0
    return 0.3  # generic metal


# Wavelengths always retained in the kept set when the model produces them —
# iconic diagnostic lines we never want truncated by the EW cap (Hα especially:
# the prototype lists it for every star). 656.3 = Hα, 393.4 = Ca II K.
MUST_KEEP_WL = {656.3, 393.4}


def synth_lines(teff, nist_table=None, keep=8, min_ew=20, force_categories=None):
    """Build a line list for a temperature from the feature model.

    nist_table: optional [(wl,el,ep)] to refine el/ep by nearest match (<=0.05nm).
    force_categories: categories to include even if below min_ew (e.g. {"HeII"}
    for O/B, {"TiO"} for M) — diagnostically important lines.
    Lines at MUST_KEEP_WL are guaranteed a slot if generated, even past `keep`.
    """
    import nist as _nist
    force_categories = force_categories or set()
    out = []
    for feat in FEATURES:
        depth, ew = _interp(feat["anchors"], teff)
        if ew < min_ew and feat["cat"] not in force_categories:
            continue
        if ew <= 0:
            continue
        el, ep = feat["el"], feat["ep"]
        if nist_table:
            hit = _nist.lookup_nearest(nist_table, feat["wl"], tol_nm=0.05)
            if hit:
                # Keep our curated label (e.g. "Ca II K") but adopt NIST ep when
                # our model has a placeholder of 0 for a non-resonance line.
                _, nist_ep = hit
                if feat["cat"] in ("metal", "MgII") and nist_ep > 0:
                    ep = nist_ep
        out.append(round_line({
            "wl": feat["wl"], "depth": depth, "width": _width(feat["cat"], teff),
            "profile": assign_profile(feat["wl"], el, teff), "ew": ew, "el": el, "ep": ep,
        }))
    out.sort(key=lambda ln: ln["ew"], reverse=True)
    kept = out[:keep]
    # Guarantee iconic lines a slot: if a MUST_KEEP line was generated but cut,
    # swap it in for the weakest currently-kept non-iconic line.
    kept_wl = {ln["wl"] for ln in kept}
    for ln in out[keep:]:
        if ln["wl"] in MUST_KEEP_WL and ln["wl"] not in kept_wl:
            for j in range(len(kept) - 1, -1, -1):
                if kept[j]["wl"] not in MUST_KEEP_WL:
                    kept[j] = ln
                    break
            kept.sort(key=lambda x: x["ew"], reverse=True)
            kept_wl = {x["wl"] for x in kept}
    return kept
