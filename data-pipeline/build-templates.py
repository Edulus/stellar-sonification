"""build-templates.py — produce spectral-templates.json.

Default (offline-friendly) path: sample the feature-strength model in common.py
at each spectral type's canonical Teff, refine element labels / excitation
potentials against the NIST cache, apply the uniform profile rules, keep the
6-8 strongest lines by EW, and sort by EW descending.

Optional --phoenix path: extract lines from PHOENIX synthetic spectra (Husser
et al. 2013). Gated and graceful — if the grid isn't downloaded it logs and
falls back to the model so the build always produces output. See README.

Runnable independently of build-bright-stars.py.
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nist  # noqa: E402
import common  # noqa: E402

# Force UTF-8 stdio so element labels (Hβ, Hα, Mg I b₁, TiO γ) print on Windows.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "output", "spectral-templates.json")
NIST_CACHE = os.path.join(HERE, "nist_lines.tsv")

# Spectral type -> (canonical Teff K, luminosity class). Teff from the build spec.
SPECTRAL_TYPES = [
    ("O5V", 41000, "V"), ("O9V", 32000, "V"),
    ("B0V", 28000, "V"), ("B2V", 22000, "V"), ("B5V", 15400, "V"),
    ("B8V", 12000, "V"), ("B8Ia", 12100, "I"),
    ("A0V", 9600, "V"), ("A1V", 9940, "V"), ("A5V", 8200, "V"),
    ("F0V", 7350, "V"), ("F5V", 6700, "V"),
    ("G0V", 6000, "V"), ("G2V", 5778, "V"), ("G5V", 5660, "V"),
    ("K0V", 5200, "V"), ("K1.5III", 4286, "III"), ("K5V", 4400, "V"),
    ("M0V", 3850, "V"), ("M1Iab", 3600, "I"), ("M2V", 3550, "V"), ("M5V", 2800, "V"),
]

LOGG = {"V": 4.5, "III": 2.5, "I": 1.0}


def force_categories_for(teff):
    """Diagnostically important lines to include even below the EW threshold."""
    cats = set()
    if teff > 25000:
        cats.add("HeII")
    if teff > 10000:
        cats.add("HeI")
    if teff < 3800:
        cats.add("TiO")
    return cats


def build(use_nist=True, use_phoenix=False):
    nist_table = []
    if use_nist:
        try:
            nist_table = nist.ensure_cache(NIST_CACHE)
            print(f"[templates] NIST table: {len(nist_table)} lines")
        except Exception as e:  # noqa: BLE001
            print(f"[templates] NIST unavailable ({e}); using built-in labels", file=sys.stderr)

    templates = {}
    for typ, teff, lclass in SPECTRAL_TYPES:
        lines = None
        if use_phoenix:
            lines = _try_phoenix(typ, teff, LOGG[lclass], nist_table)
        if not lines:
            lines = common.synth_lines(
                teff, nist_table=nist_table, keep=8,
                force_categories=force_categories_for(teff),
            )
        templates[typ] = {"temp": teff, "lines": lines}
        top = lines[0] if lines else {"el": "—", "ew": 0}
        print(f"[templates] {typ:8s} Teff={teff:5d}  {len(lines)} lines  "
              f"(strongest {top['el']} EW={top['ew']})")
    return templates


def _try_phoenix(typ, teff, logg, nist_table):
    """Gated PHOENIX extraction. Returns a line list or None (-> model fallback).

    Per the build spec this would: locate the nearest PHOENIX grid FITS in
    downloads/, restrict to 3800-7600 A, continuum-normalize (deg 8-12 poly on
    the upper envelope), find minima < 0.97 / >= 0.1 A wide, measure depth/FWHM/EW,
    label via NIST, profile via rules. It needs astropy + scipy + the grid files.
    """
    grid_dir = os.path.join(HERE, "downloads", "phoenix")
    if not os.path.isdir(grid_dir) or not os.listdir(grid_dir):
        print(f"[templates] {typ}: PHOENIX grid not present in downloads/phoenix — "
              f"falling back to model", file=sys.stderr)
        return None
    try:
        import astropy  # noqa: F401
        import scipy  # noqa: F401
    except ImportError:
        print(f"[templates] {typ}: astropy/scipy not installed — falling back to model",
              file=sys.stderr)
        return None
    # Extraction implementation intentionally deferred — see README "PHOENIX".
    print(f"[templates] {typ}: PHOENIX extraction not implemented — model fallback",
          file=sys.stderr)
    return None


def main():
    ap = argparse.ArgumentParser(description="Build spectral-templates.json")
    ap.add_argument("--no-nist", action="store_true", help="skip NIST fetch/lookup")
    ap.add_argument("--phoenix", action="store_true", help="try PHOENIX extraction (gated)")
    args = ap.parse_args()

    templates = build(use_nist=not args.no_nist, use_phoenix=args.phoenix)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(templates, f, ensure_ascii=False, indent=2)
    size = os.path.getsize(OUT)
    print(f"\n[templates] wrote {len(templates)} templates -> {OUT} ({size/1024:.1f} KB)")


if __name__ == "__main__":
    main()
