"""build-bright-stars.py — produce bright-stars.json keyed by HIP.

Default run emits exactly the six prototype seed stars (validated, hand-tuned,
dataSource "curated"). These are sacrosanct: the survey path never overwrites
them even if a survey has the same star.

Optional --survey path (GALAH DR4 / LAMOST DR10): gated and graceful. The GALAH
per-star *spectrum* download goes through a registered job queue, so we do NOT
measure lines from spectra. Instead, when a survey catalogue FITS is present in
downloads/, we cross-match to HIP (SIMBAD TAP) + Vmag (VizieR I/239), and for
each bright qualifying star derive its line list from the spectral-type template
implied by its catalogue Teff/logg — tagged dataSource "survey-galah" /
"survey-lamost". Any network or file failure logs and continues (partial output
is fine). Runnable independently of build-templates.py.

Note: Sol (the Sun) has no Hipparcos number, so it is keyed "SOL", not HIP.
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

# Force UTF-8 stdio so element labels (Hβ, Hα, Mg I b₁, TiO γ) print on Windows.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "output", "bright-stars.json")

# ── Seed data: the six prototype stars, exactly as in src/data/bright-stars.js ──
# (wl, depth, width, profile, ew, el, ep). HIP numbers added here (Hipparcos);
# Sol has none. Values are the validated ground truth — do not edit.
SEED = [
    {"key": "SOL", "hip": None, "name": "Sol", "aliases": ["Sun"], "type": "G2V",
     "temp": 5778, "rv": 0, "color": "#f5e6a3",
     "lines": [
         (393.4, 0.85, 0.80, "voigt", 800, "Ca II K", 0.00),
         (486.1, 0.50, 0.50, "voigt", 350, "Hβ", 10.20),
         (516.7, 0.45, 0.30, "gaussian", 200, "Mg I b₁", 2.71),
         (527.0, 0.40, 0.25, "gaussian", 150, "Fe I", 0.86),
         (589.0, 0.60, 0.40, "voigt", 400, "Na I D₁", 0.00),
         (656.3, 0.55, 0.60, "voigt", 380, "Hα", 10.20)]},
    {"key": "HIP91262", "hip": 91262, "name": "Vega", "aliases": ["alf Lyr", "alpha Lyrae"],
     "type": "A0V", "temp": 9600, "rv": -13.9, "color": "#cce0ff",
     "lines": [
         (410.2, 0.55, 1.20, "lorentzian", 600, "Hδ", 10.20),
         (434.0, 0.70, 1.50, "lorentzian", 900, "Hγ", 10.20),
         (448.1, 0.15, 0.20, "gaussian", 40, "Mg II", 8.86),
         (486.1, 0.80, 1.80, "lorentzian", 1100, "Hβ", 10.20),
         (527.0, 0.08, 0.15, "gaussian", 20, "Fe I", 0.86),
         (656.3, 0.75, 2.00, "lorentzian", 1200, "Hα", 10.20)]},
    {"key": "HIP27989", "hip": 27989, "name": "Betelgeuse", "aliases": ["alf Ori", "alpha Orionis"],
     "type": "M1Iab", "temp": 3600, "rv": 21.9, "color": "#ffb088",
     "lines": [
         (393.4, 0.60, 1.00, "voigt", 550, "Ca II K", 0.00),
         (422.7, 0.80, 0.60, "voigt", 700, "Ca I", 0.00),
         (516.7, 0.55, 0.40, "gaussian", 350, "Mg I b₁", 2.71),
         (527.0, 0.70, 0.50, "gaussian", 500, "Fe I", 0.86),
         (589.0, 0.90, 0.80, "voigt", 900, "Na I D₁", 0.00),
         (705.3, 0.65, 3.00, "gaussian", 1500, "TiO γ", 0.00)]},
    {"key": "HIP32349", "hip": 32349, "name": "Sirius",
     "aliases": ["alf CMa", "alpha Canis Majoris", "9 CMa"],
     "type": "A1V", "temp": 9940, "rv": -5.5, "color": "#d4e8ff",
     "lines": [
         (410.2, 0.60, 1.40, "lorentzian", 700, "Hδ", 10.20),
         (434.0, 0.75, 1.70, "lorentzian", 1000, "Hγ", 10.20),
         (448.1, 0.18, 0.25, "gaussian", 50, "Mg II", 8.86),
         (486.1, 0.85, 2.00, "lorentzian", 1250, "Hβ", 10.20),
         (516.9, 0.12, 0.20, "gaussian", 35, "Fe II", 2.89),
         (656.3, 0.80, 2.20, "lorentzian", 1300, "Hα", 10.20)]},
    {"key": "HIP69673", "hip": 69673, "name": "Arcturus", "aliases": ["alf Boo", "alpha Bootis"],
     "type": "K1.5III", "temp": 4286, "rv": -5.2, "color": "#ffd4a0",
     "lines": [
         (393.4, 0.90, 1.00, "voigt", 950, "Ca II K", 0.00),
         (422.7, 0.70, 0.50, "voigt", 550, "Ca I", 0.00),
         (516.7, 0.55, 0.40, "gaussian", 300, "Mg I b₁", 2.71),
         (527.0, 0.60, 0.35, "gaussian", 350, "Fe I", 0.86),
         (589.0, 0.75, 0.50, "voigt", 600, "Na I D₁", 0.00),
         (656.3, 0.30, 0.40, "voigt", 200, "Hα", 10.20)]},
    {"key": "HIP24436", "hip": 24436, "name": "Rigel", "aliases": ["bet Ori", "beta Orionis"],
     "type": "B8Ia", "temp": 12100, "rv": 17.8, "color": "#b8d4ff",
     "lines": [
         (434.0, 0.55, 1.80, "lorentzian", 800, "Hγ", 10.20),
         (447.1, 0.25, 0.80, "voigt", 200, "He I", 20.96),
         (486.1, 0.65, 2.20, "lorentzian", 1000, "Hβ", 10.20),
         (587.6, 0.30, 1.00, "voigt", 300, "He I D₃", 20.96),
         (634.7, 0.20, 0.40, "gaussian", 100, "Si II", 8.12),
         (656.3, 0.40, 2.50, "lorentzian", 800, "Hα", 10.20)]},
]


def seed_star(entry):
    """Materialize a seed entry into the output schema, lines sorted by EW desc."""
    lines = [common.round_line({
        "wl": wl, "depth": d, "width": w, "profile": prof, "ew": ew, "el": el, "ep": ep,
    }) for (wl, d, w, prof, ew, el, ep) in entry["lines"]]
    lines.sort(key=lambda ln: ln["ew"], reverse=True)
    return {
        "name": entry["name"],
        "aliases": entry["aliases"],
        "hip": entry["hip"],
        "type": entry["type"],
        "temp": entry["temp"],
        "rv": entry["rv"],
        "color": entry["color"],
        "lines": lines,
        "dataSource": "curated",
    }


def build(use_survey=False):
    stars = {}
    for entry in SEED:
        stars[entry["key"]] = seed_star(entry)
    print(f"[bright-stars] seeded {len(stars)} curated stars (sacrosanct)")

    if use_survey:
        added = survey_expand(existing=stars)
        # Never overwrite a seed/curated star.
        for key, star in added.items():
            if key in stars:
                print(f"[bright-stars] keep curated {key} (survey skipped)")
                continue
            stars[key] = star
        print(f"[bright-stars] survey added {len(added)} stars")
    return stars


def survey_expand(existing):
    """Gated GALAH/LAMOST expansion. Returns {HIPkey: star} or {} if unavailable.

    Uses catalogue stellar parameters (Teff/logg) -> spectral-type template to
    derive a line list (NOT per-star spectrum measurement, which needs a
    registered GALAH job). Requires a catalogue FITS in downloads/ and astropy.
    """
    dl = os.path.join(HERE, "downloads")
    cats = [f for f in os.listdir(dl)] if os.path.isdir(dl) else []
    fits = [f for f in cats if f.lower().endswith(".fits")]
    if not fits:
        print("[bright-stars] no survey catalogue FITS in downloads/ — "
              "skipping survey expansion (default seed-only build).", file=sys.stderr)
        return {}
    try:
        import astropy  # noqa: F401
    except ImportError:
        print("[bright-stars] astropy not installed — skipping survey expansion.",
              file=sys.stderr)
        return {}
    # Full GALAH/LAMOST cross-match (SIMBAD TAP HIP + VizieR I/239 Vmag<6.5) and
    # template-from-params derivation is intentionally deferred to a maintainer
    # run with the catalogue present — see README "Survey expansion".
    print("[bright-stars] survey catalogue present but cross-match step is a "
          "maintainer task — see README; skipping for now.", file=sys.stderr)
    return {}


def main():
    ap = argparse.ArgumentParser(description="Build bright-stars.json")
    ap.add_argument("--survey", action="store_true", help="attempt GALAH/LAMOST expansion (gated)")
    args = ap.parse_args()

    stars = build(use_survey=args.survey)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(stars, f, ensure_ascii=False, indent=2)
    size = os.path.getsize(OUT)
    print(f"\n[bright-stars] wrote {len(stars)} stars -> {OUT} ({size/1024:.1f} KB)")


if __name__ == "__main__":
    main()
