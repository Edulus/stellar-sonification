// Curated absorption-line data — adapter over the data-pipeline output.
//
// The canonical source of truth is data-pipeline/output/bright-stars.json
// (keyed by HIP, Sol under "SOL"), produced by data-pipeline/build-bright-stars.py
// and committed. This module re-exports it in the array shape the resolver wants.
//
// The resolver matches selections by name/alias (the bundled engine catalog gives
// names but no HIP — PHASE0-FINDINGS.md §9), so each star object carries `name`
// and `aliases`. Per line: wl(nm), depth(0-1), width(Å), profile, ew(mÅ),
// el(element), ep(eV). To regenerate: `python data-pipeline/build-bright-stars.py`.

import RAW from "../../data-pipeline/output/bright-stars.json";

// Object keyed by HIP/SOL -> array of star records (resolver iterates by name).
export const BRIGHT_STARS = Object.values(RAW);

// Keyed access by HIP key ("HIP32349", "SOL") for callers that have an id.
export const BRIGHT_STARS_BY_HIP = RAW;

export default BRIGHT_STARS;
