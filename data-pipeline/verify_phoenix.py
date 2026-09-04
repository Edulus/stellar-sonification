"""Browser-free verification for PHOENIX extraction helpers."""
import os
import tempfile
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import nist
import phoenix


def check(name, ok):
    print(f"  {'✅' if ok else '❌'} {name}")
    if not ok:
        raise AssertionError(name)


print("[phoenix] unit checks")
vac = phoenix.air_to_vacuum_nm(500.0)
check("air->vacuum direction/range", 500.10 < vac < 500.20)

# Synthetic NIST format=2 row: log(gf) is computed from lower g * f_ik.
table_text = (
    'obs_wl_air\tei(ev)\telement\tsp_num\tf_ik\tg_i\n'
    '5000.0\t1.0\tFe\tI\t0.1\t2\n'
)
parsed = nist._parse_table(table_text, "Fe I")
check(
    "NIST parser retains log(gf)",
    len(parsed) == 1 and len(parsed[0]) == 4 and abs(parsed[0][3] - np.log10(0.2)) < 1e-3,
)

feat = {"wl": phoenix.air_to_vacuum_nm(500.0), "width": 0.8}
el, ep, info = phoenix.identify_feature(feat, [(500.0, "Fe I", 1.0)])
check("single candidate accepted", el == "Fe I" and ep == 1.0 and info["reason"] == "single")

el, ep, info = phoenix.identify_feature(feat, [(500.0, "Fe I", 1.0), (500.01, "Ti I", 0.8)])
check("unweighted blend rejected", el is None and info["reason"] == "ambiguous-blend")

el, ep, info = phoenix.identify_feature(
    feat, [(500.0, "Fe I", 1.0, 0.0), (500.01, "Ti I", 0.8, -1.0)]
)
check("log(gf) dominant blend accepted", el == "Fe I" and info["reason"] == "dominant-loggf")

with tempfile.TemporaryDirectory() as d:
    open(os.path.join(d, "WAVE_PHOENIX-ACES-AGSS-COND-2011.fits"), "wb").close()
    open(os.path.join(d, "lte05800-4.50-0.0.PHOENIX-ACES-AGSS-COND-2011-HiRes.fits"), "wb").close()
    open(os.path.join(d, "lte09600-4.50-0.0.PHOENIX-ACES-AGSS-COND-2011-HiRes.fits"), "wb").close()
    wave_file, models = phoenix.discover_grid(d)
    check("grid discovery", wave_file is not None and len(models) == 2)
    check("nearest grid point", phoenix.nearest_model(models, 5778, 4.5).teff == 5800)
    check("out-of-grid hot model rejected", phoenix.nearest_model(models, 41000, 4.5) is None)

wave = np.linspace(3800.0, 7600.0, 380000)
flux = 1.0 + 0.04 * np.sin((wave - 3800.0) / 450.0)
for center, depth, sigma in [(4861.0, 0.50, 0.40), (6563.0, 0.40, 0.50)]:
    flux *= 1.0 - depth * np.exp(-0.5 * ((wave - center) / sigma) ** 2)
dw, df = phoenix.degrade_resolution(wave, flux)
norm, _ = phoenix.normalize_spectrum(dw, df, 20.0)
features = phoenix.measure_features(dw, norm)
centers = [x["wl"] for x in features]
check("synthetic Hbeta recovered", any(abs(x - 486.1) < 0.2 for x in centers))
check("synthetic Halpha recovered", any(abs(x - 656.3) < 0.2 for x in centers))

lines = [{"wl": 500.0, "ew": 100}, {"wl": 505.0, "ew": 90}, {"wl": 520.0, "ew": 80}]
kept = phoenix._spacing_select(lines)
check("pitch-spacing de-duplicates close wavelengths", [x["wl"] for x in kept] == [500.0, 520.0])

print("✅ PHOENIX helper verification passes")
