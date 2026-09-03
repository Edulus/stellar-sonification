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
"""

import io
import os
import sys
import time
import csv

import requests

ASD_URL = "https://physics.nist.gov/cgi-bin/ASD/lines1.pl"
CM1_PER_EV = 8065.544

# Spectra to fetch: element + ionization stage (roman numeral = stage, I = neutral).
# Covers the elements named in the build spec across their common stages.
SPECTRA = [
    "H I", "He I", "He II", "Li I",
    "C I", "N I", "O I",
    "Na I", "Mg I", "Mg II", "Al I", "Si I", "Si II",
    "Ca I", "Ca II", "Ti I", "Ti II", "Cr I",
    "Fe I", "Fe II", "Ni I", "Ba II",
]

# Wavelength window in Angstrom (3800-7600 A = 380-760 nm, with margin).
LOW_W, UPP_W = 3800, 7600


def fetch_spectrum(spectrum, session, timeout=30):
    """Return rows [(wl_nm, el, ep_eV), ...] for one spectrum, or [] on failure."""
    params = {
        "spectra": spectrum,
        "low_w": LOW_W,
        "upp_w": UPP_W,
        "unit": 0,            # 0 = Angstrom
        "de": 0,
        "format": 2,          # tab-delimited text
        "line_out": 0,        # all lines
        "remove_js": "on",
        "en_unit": 1,         # 1 = eV for energy columns (best effort)
        "output": 0,
        "page_size": 15,
        "show_obs_wl": 1,
        "show_calc_wl": 1,
        "A_out": 0,
        "intens_out": "on",
        "allowed_out": 1,
        "enrg_out": "on",
        "level_id": "on",
        "submit": "Retrieve Data",
    }
    try:
        r = session.get(ASD_URL, params=params, timeout=timeout)
        r.raise_for_status()
    except Exception as e:  # noqa: BLE001 — network is best-effort
        print(f"  [nist] {spectrum}: request failed ({e}); skipping", file=sys.stderr)
        return []

    text = r.text
    # ASD wraps the table in <pre> for some formats; strip tags if present.
    if "<pre" in text.lower():
        start = text.lower().find("<pre")
        start = text.find(">", start) + 1
        end = text.lower().find("</pre>", start)
        text = text[start:end] if end > 0 else text[start:]

    rows = _parse_table(text, spectrum)
    return rows


def _parse_table(text, spectrum):
    """Parse the tab-delimited ASD table defensively into (wl_nm, el, ep_eV)."""
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        return []
    # Find the header row (contains a wavelength column name).
    header_idx = None
    for i, ln in enumerate(lines):
        low = ln.lower()
        if "wl" in low and ("ei" in low or "e_i" in low or "ek" in low):
            header_idx = i
            break
    if header_idx is None:
        # Some responses omit a usable header; bail (caller logs/continues).
        return []

    reader = csv.reader(io.StringIO("\n".join(lines[header_idx:])), delimiter="\t")
    header = [h.strip().strip('"').lower() for h in next(reader)]

    def find_col(*needles):
        for j, name in enumerate(header):
            if any(n in name for n in needles):
                return j
        return None

    # Prefer observed air wavelength; fall back to Ritz/calculated.
    wl_col = find_col("obs_wl_air", "obs_wl", "obs wl")
    if wl_col is None:
        wl_col = find_col("ritz_wl_air", "ritz_wl", "wl")
    ei_col = find_col("ei(ev)", "ei (ev)", "ei(cm", "ei ", "ei(")
    el_col = find_col("element")
    sp_col = find_col("sp_num")
    ei_in_cm = ei_col is not None and "cm" in header[ei_col]

    if wl_col is None or ei_col is None:
        return []

    out = []
    for row in reader:
        if len(row) <= max(wl_col, ei_col):
            continue
        wl_raw = row[wl_col].strip().strip('"').replace("=", "")
        ei_raw = row[ei_col].strip().strip('"').replace("[", "").replace("]", "").replace("(", "").replace(")", "")
        try:
            wl_a = float(wl_raw)
            ep = float(ei_raw)
        except ValueError:
            continue
        if ei_in_cm:
            ep = ep / CM1_PER_EV
        # Build element label from element + stage if available, else spectrum.
        if el_col is not None and el_col < len(row) and row[el_col].strip():
            stage = row[sp_col].strip() if (sp_col is not None and sp_col < len(row)) else ""
            el = f"{row[el_col].strip()} {stage}".strip()
        else:
            el = spectrum
        out.append((round(wl_a / 10.0, 4), el, round(ep, 3)))  # A -> nm
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
        time.sleep(0.5)  # be polite to the CGI
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t")
        w.writerow(["wl_nm", "el", "ep_eV"])
        for wl, el, ep in sorted(all_rows):
            w.writerow([wl, el, ep])
    return len(all_rows)


def load(path):
    """Load the cached TSV into a list of (wl_nm, el, ep), sorted by wl."""
    if not os.path.exists(path):
        return []
    rows = []
    with open(path, encoding="utf-8") as f:
        r = csv.reader(f, delimiter="\t")
        next(r, None)  # header
        for line in r:
            if len(line) < 3:
                continue
            try:
                rows.append((float(line[0]), line[1], float(line[2])))
            except ValueError:
                continue
    return sorted(rows)


def lookup_nearest(table, wl_nm, tol_nm=0.05):
    """Nearest NIST line to wl_nm within tol; returns (el, ep) or None."""
    best = None
    best_d = tol_nm
    for w, el, ep in table:
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
