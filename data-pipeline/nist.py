"""NIST Atomic Spectra Database line list — fetch, cache, and look up.

Shared by build-bright-stars.py and build-templates.py. We use the ASD
`lines1.pl` CGI with `format=2` (tab-delimited text), one query per spectrum
(e.g. "Fe I"), over 3800-7600 Angstrom in air wavelengths. The endpoint is a
form, not a stable API, so every parse is defensive and any failure is logged
and skipped rather than fatal — a partial NIST table still lets the build run,
because the diagnostic features we actually emit also live in a small built-in
canonical table (see common.py) that does not depend on the network at all.

ep (excitation potential) is the lower-level energy. ASD reports it as Ei; if
the column is in cm^-1 we convert to eV (1 eV = 8065.544 cm^-1).

The cache also retains log(gf) when ASD supplies absorption oscillator strength
and the lower-level statistical weight. This is an intrinsic transition-strength
proxy for PHOENIX blend identification. Old three-column caches remain readable.
"""

import io
import os
import sys
import time
import csv
import math

import requests

ASD_URL = "https://physics.nist.gov/cgi-bin/ASD/lines1.pl"
CM1_PER_EV = 8065.544

SPECTRA = [
    "H I", "He I", "He II", "Li I",
    "C I", "N I", "O I",
    "Na I", "Mg I", "Mg II", "Al I", "Si I", "Si II",
    "Ca I", "Ca II", "Ti I", "Ti II", "Cr I",
    "Fe I", "Fe II", "Ni I", "Ba II",
]

LOW_W, UPP_W = 3800, 7600


def fetch_spectrum(spectrum, session, timeout=30):
    """Return rows [(wl_nm, el, ep_eV, loggf|None), ...], or [] on failure."""
    params = {
        "spectra": spectrum,
        "low_w": LOW_W,
        "upp_w": UPP_W,
        "unit": 0,
        "de": 0,
        "format": 2,
        "line_out": 0,
        "remove_js": "on",
        "en_unit": 1,
        "output": 0,
        "page_size": 15,
        "show_obs_wl": 1,
        "show_calc_wl": 1,
        "A_out": 0,
        "f_out": "on",       # absorption oscillator strength f_ik
        "g_out": "on",       # lower/upper statistical weights
        "intens_out": "on",
        "allowed_out": 1,
        "enrg_out": "on",
        "level_id": "on",
        "submit": "Retrieve Data",
    }
    try:
        r = session.get(ASD_URL, params=params, timeout=timeout)
        r.raise_for_status()
    except Exception as e:  # noqa: BLE001
        print(f"  [nist] {spectrum}: request failed ({e}); skipping", file=sys.stderr)
        return []

    text = r.text
    if "<pre" in text.lower():
        start = text.lower().find("<pre")
        start = text.find(">", start) + 1
        end = text.lower().find("</pre>", start)
        text = text[start:end] if end > 0 else text[start:]

    return _parse_table(text, spectrum)


def _parse_number(value):
    raw = (value or "").strip().strip('"')
    raw = raw.replace("=", "").replace("[", "").replace("]", "")
    raw = raw.replace("(", "").replace(")", "").replace(" ", "")
    if not raw or raw in {"—", "-"}:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _parse_table(text, spectrum):
    """Parse ASD text into (wl_nm, el, ep_eV, loggf|None)."""
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        return []

    header_idx = None
    for i, ln in enumerate(lines):
        low = ln.lower()
        if "wl" in low and ("ei" in low or "e_i" in low or "ek" in low):
            header_idx = i
            break
    if header_idx is None:
        return []

    reader = csv.reader(io.StringIO("\n".join(lines[header_idx:])), delimiter="\t")
    header = [h.strip().strip('"').lower() for h in next(reader)]

    def find_col(*needles):
        for j, name in enumerate(header):
            compact = name.replace(" ", "").replace("_", "")
            for needle in needles:
                n = needle.lower().replace(" ", "").replace("_", "")
                if n in compact:
                    return j
        return None

    wl_col = find_col("obs_wl_air", "obs_wl", "obs wl")
    if wl_col is None:
        wl_col = find_col("ritz_wl_air", "ritz_wl", "wl")
    ei_col = find_col("ei(ev)", "ei (ev)", "ei(cm", "ei ", "ei(")
    el_col = find_col("element")
    sp_col = find_col("sp_num")
    loggf_col = find_col("log(gf)", "loggf")
    f_col = find_col("f_ik", "fik", "oscillatorstrength")
    gi_col = find_col("g_i", "gi")
    ei_in_cm = ei_col is not None and "cm" in header[ei_col]

    if wl_col is None or ei_col is None:
        return []

    out = []
    for row in reader:
        if len(row) <= max(wl_col, ei_col):
            continue
        wl_a = _parse_number(row[wl_col])
        ep = _parse_number(row[ei_col])
        if wl_a is None or ep is None:
            continue
        if ei_in_cm:
            ep = ep / CM1_PER_EV

        if el_col is not None and el_col < len(row) and row[el_col].strip():
            stage = row[sp_col].strip() if (sp_col is not None and sp_col < len(row)) else ""
            el = f"{row[el_col].strip()} {stage}".strip()
        else:
            el = spectrum

        loggf = None
        if loggf_col is not None and loggf_col < len(row):
            loggf = _parse_number(row[loggf_col])
        if loggf is None and f_col is not None and gi_col is not None:
            if f_col < len(row) and gi_col < len(row):
                fik = _parse_number(row[f_col])
                gi = _parse_number(row[gi_col])
                if fik is not None and gi is not None and fik > 0 and gi > 0:
                    loggf = math.log10(fik * gi)

        out.append((
            round(wl_a / 10.0, 4),
            el,
            round(ep, 3),
            None if loggf is None else round(loggf, 4),
        ))
    return out


def fetch_all(out_path):
    """Fetch every spectrum and write the combined cache TSV. Returns row count."""
    session = requests.Session()
    session.headers.update({"User-Agent": "stellar-sonification-data-pipeline/1.0"})
    all_rows = []
    for spectrum in SPECTRA:
        rows = fetch_spectrum(spectrum, session)
        print(f"  [nist] {spectrum}: {len(rows)} lines")
        all_rows.extend(rows)
        time.sleep(0.5)
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t")
        w.writerow(["wl_nm", "el", "ep_eV", "loggf"])
        for wl, el, ep, loggf in sorted(all_rows, key=lambda x: x[0]):
            w.writerow([wl, el, ep, "" if loggf is None else loggf])
    return len(all_rows)


def load(path):
    """Load a 3- or 4-column cache, sorted by wavelength."""
    if not os.path.exists(path):
        return []
    rows = []
    with open(path, encoding="utf-8") as f:
        r = csv.reader(f, delimiter="\t")
        next(r, None)
        for line in r:
            if len(line) < 3:
                continue
            try:
                base = (float(line[0]), line[1], float(line[2]))
            except ValueError:
                continue
            if len(line) >= 4 and line[3].strip():
                try:
                    rows.append(base + (float(line[3]),))
                    continue
                except ValueError:
                    pass
            rows.append(base)
    return sorted(rows, key=lambda x: x[0])


def lookup_nearest(table, wl_nm, tol_nm=0.05):
    """Nearest NIST line within tol; returns (el, ep) or None."""
    best = None
    best_d = tol_nm
    for row in table:
        if len(row) < 3:
            continue
        w, el, ep = row[:3]
        d = abs(w - wl_nm)
        if d <= best_d:
            best = (el, ep)
            best_d = d
    return best


def ensure_cache(path):
    """Load the cache, fetching it first if absent. Returns the line table."""
    if not os.path.exists(path):
        print(f"[nist] cache {path} not found — fetching from NIST ASD…")
        n = fetch_all(path)
        print(f"[nist] wrote {n} lines to {path}")
    return load(path)


if __name__ == "__main__":
    target = os.path.join(os.path.dirname(__file__), "nist_lines.tsv")
    count = fetch_all(target)
    print(f"Wrote {count} NIST lines to {target}")
