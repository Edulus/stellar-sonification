"""build-templates.py — produce spectral-templates.json.

Default path: sample the feature-strength model in common.py at each spectral
type's canonical Teff.

Optional --phoenix path: use local PHOENIX-ACES HiRes FITS models where the
supported grid genuinely covers a template key. The run calibrates one global
pseudo-continuum window from G2V/Sol + A0V/Vega before extracting templates.
Grid-unavailable behavior remains the existing model fallback.
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nist  # noqa: E402
import common  # noqa: E402
import phoenix  # noqa: E402

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "output", "spectral-templates.json")
BRIGHT_OUT = os.path.join(HERE, "output", "bright-stars.json")
NIST_CACHE = os.path.join(HERE, "nist_lines.tsv")
PHOENIX_DIR = os.path.join(HERE, "downloads", "phoenix")
PHOENIX_DIAGNOSTICS = os.path.join(HERE, "phoenix-diagnostics.json")

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
FEH = 0.0


def force_categories_for(teff):
    cats = set()
    if teff > 25000:
        cats.add("HeII")
    if teff > 10000:
        cats.add("HeI")
    if teff < 3800:
        cats.add("TiO")
    return cats


def _model_lines(teff, nist_table):
    return common.synth_lines(
        teff, nist_table=nist_table, keep=8,
        force_categories=force_categories_for(teff),
    )


def _load_curated():
    with open(BRIGHT_OUT, encoding="utf-8") as f:
        raw = json.load(f)
    return {star["name"]: star for star in raw.values()}


def _prepare_phoenix(nist_table):
    """Return PHOENIX run context or None to preserve no-grid fallback."""
    if not os.path.isdir(PHOENIX_DIR) or not os.listdir(PHOENIX_DIR):
        print("[templates] PHOENIX grid not present in downloads/phoenix — "
              "falling back to model", file=sys.stderr)
        return None
    try:
        import astropy  # noqa: F401
        import scipy  # noqa: F401
    except ImportError:
        print("[templates] astropy/scipy not installed — falling back to model",
              file=sys.stderr)
        return None

    wave_path, models = phoenix.discover_grid(PHOENIX_DIR)
    if not wave_path or not models:
        print("[templates] no supported PHOENIX-ACES HiRes solar-metallicity "
              "grid found — falling back to model", file=sys.stderr)
        return None

    by_key = {}
    grid_report = {}
    for typ, teff, lclass in SPECTRAL_TYPES:
        model = phoenix.nearest_model(models, teff, LOGG[lclass])
        by_key[typ] = model
        grid_report[typ] = None if model is None else {
            "requested": {"teff": teff, "logg": LOGG[lclass], "feh": FEH},
            "actual": {"teff": model.teff, "logg": model.logg, "feh": model.feh},
            "file": os.path.relpath(model.path, PHOENIX_DIR).replace("\\", "/"),
        }

    if by_key.get("G2V") is None or by_key.get("A0V") is None:
        print("[templates] PHOENIX grid lacks G2V/A0V calibration models — "
              "falling back to model", file=sys.stderr)
        return None

    curated = _load_curated()
    window_a, sweep = phoenix.calibrate_window(by_key, wave_path, curated, nist_table)
    print("[templates] PHOENIX continuum window sweep:")
    for row in sweep:
        print(f"  {row['window_a']:5.1f} A  score={row['score']:.4f}")
    print(f"[templates] calibrated global continuum window = {window_a:.1f} A")

    return {
        "wave_path": wave_path,
        "models_by_key": by_key,
        "window_a": window_a,
        "grid_report": grid_report,
        "sweep": sweep,
    }


def build(use_nist=True, use_phoenix=False):
    nist_table = []
    if use_nist:
        try:
            nist_table = nist.ensure_cache(NIST_CACHE)
            print(f"[templates] NIST table: {len(nist_table)} lines")
        except Exception as e:  # noqa: BLE001
            print(f"[templates] NIST unavailable ({e}); using built-in labels",
                  file=sys.stderr)

    phx = _prepare_phoenix(nist_table) if use_phoenix else None
    diagnostics = {
        "grid": phx["grid_report"] if phx else {},
        "windowSweep": phx["sweep"] if phx else [],
        "windowA": phx["window_a"] if phx else None,
        "templates": {},
    }

    templates = {}
    for typ, teff, lclass in SPECTRAL_TYPES:
        lines = None
        source = "model"
        dropped = []

        if phx:
            model = phx["models_by_key"].get(typ)
            if model is None:
                print(f"[templates] {typ}: outside supported PHOENIX grid — "
                      "explicit model fallback", file=sys.stderr)
            else:
                lines = phoenix.extract_template(
                    model.path, phx["wave_path"], teff, nist_table,
                    phx["window_a"], diagnostics=dropped,
                )
                if not lines:
                    raise RuntimeError(
                        f"{typ}: PHOENIX extraction succeeded but retained zero "
                        "identified features; refusing silent model fallback"
                    )
                source = "phoenix"

        if lines is None:
            lines = _model_lines(teff, nist_table)

        templates[typ] = {"temp": teff, "lines": lines}
        diagnostics["templates"][typ] = {
            "source": source,
            "retained": len(lines),
            "dropped": dropped,
        }
        top = lines[0] if lines else {"el": "—", "ew": 0}
        print(f"[templates] {typ:8s} Teff={teff:5d}  {len(lines)} lines  "
              f"source={source:7s} (strongest {top['el']} EW={top['ew']})")

    if use_phoenix and phx:
        with open(PHOENIX_DIAGNOSTICS, "w", encoding="utf-8") as f:
            json.dump(diagnostics, f, ensure_ascii=False, indent=2)
        print(f"[templates] diagnostics -> {PHOENIX_DIAGNOSTICS}")

    return templates


def main():
    ap = argparse.ArgumentParser(description="Build spectral-templates.json")
    ap.add_argument("--no-nist", action="store_true", help="skip NIST fetch/lookup")
    ap.add_argument("--phoenix", action="store_true", help="extract from local PHOENIX-ACES HiRes grid when covered")
    args = ap.parse_args()

    before = open(BRIGHT_OUT, "rb").read() if os.path.exists(BRIGHT_OUT) else None
    templates = build(use_nist=not args.no_nist, use_phoenix=args.phoenix)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(templates, f, ensure_ascii=False, indent=2)

    after = open(BRIGHT_OUT, "rb").read() if os.path.exists(BRIGHT_OUT) else None
    if before != after:
        raise RuntimeError("protected bright-stars.json changed during template build")

    size = os.path.getsize(OUT)
    print(f"\n[templates] wrote {len(templates)} templates -> {OUT} ({size/1024:.1f} KB)")


if __name__ == "__main__":
    main()
