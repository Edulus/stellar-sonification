// Synthetic spectral-type templates — the fallback tier of the resolution
// cascade (ARCHITECTURE.md §2). When a clicked star has no curated entry, we
// resolve to a canonical line list for its spectral class so it still sings.
//
// Adapter over the data-pipeline output: the canonical source of truth is
// data-pipeline/output/spectral-templates.json (22 types, keyed by type),
// produced by data-pipeline/build-templates.py and committed. That file carries
// only { temp, lines } per ARCHITECTURE's schema; we add a display `color`
// derived from temperature here. To regenerate: `python data-pipeline/build-templates.py`.

import RAW from "../../data-pipeline/output/spectral-templates.json";

// Approximate sRGB hex for a blackbody temperature (Tanner Helland fit), so each
// template gets a swatch even though the JSON schema omits color.
export function tempToHex(temp) {
  const t = Math.max(1000, Math.min(40000, temp)) / 100;
  let r, g, b;
  if (t <= 66) r = 255;
  else r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
  if (t <= 66) g = 99.4708025861 * Math.log(t) - 161.1195681661;
  else g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const clamp = (x) => Math.max(0, Math.min(255, Math.round(x)));
  const hex = (x) => clamp(x).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// Build the in-memory template table from the JSON, attaching a color per entry.
export const SPECTRAL_TEMPLATES = Object.fromEntries(
  Object.entries(RAW).map(([key, tpl]) => [key, { ...tpl, color: tempToHex(tpl.temp) }])
);

// Order of preference within a base class when an exact key is missing. Keys
// must exist in the JSON (the 22 prompt types). Giants map to the available
// giant/supergiant templates (K1.5III, M1Iab); hotter giants fall to dwarfs.
const DWARF_BY_CLASS = { O: "O5V", B: "B5V", A: "A0V", F: "F5V", G: "G2V", K: "K5V", M: "M2V" };
const GIANT_BY_CLASS = { O: "B5V", B: "B5V", A: "A0V", F: "G2V", G: "K1.5III", K: "K1.5III", M: "M1Iab" };

/**
 * Parse a spectral type string ("G2V", "K1.5III", "G2/3V", "A1Vm", "M1Iab") into
 * { cls, sub, lum }. Tolerant of the messy formats the catalogs produce.
 */
export function parseSpectralType(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^([OBAFGKM])\s*(\d(?:\.\d)?)?.*?(I{1,3}|IV|V|Ia|Ib|Iab)?/i);
  if (!m) return null;
  return {
    cls: m[1].toUpperCase(),
    sub: m[2] !== undefined ? parseFloat(m[2]) : 5,
    lum: (m[3] || "V").toUpperCase(),
  };
}

function isGiant(lum) {
  return lum && lum !== "V" && lum !== "IV"; // III, II, I, Ia, Ib, Iab
}

/** Pick a template for a parsed/raw spectral type string. Prefers an exact key. */
export function templateForType(typeStr) {
  const p = parseSpectralType(typeStr);
  if (!p) return null;
  // Exact match first (e.g. the engine reports "A1V" or "B8Ia" directly).
  const exact = String(typeStr).trim();
  if (SPECTRAL_TEMPLATES[exact]) return { key: exact, ...SPECTRAL_TEMPLATES[exact] };
  const table = isGiant(p.lum) ? GIANT_BY_CLASS : DWARF_BY_CLASS;
  const key = table[p.cls];
  const tpl = key && SPECTRAL_TEMPLATES[key];
  return tpl ? { key, ...tpl } : null;
}

// Approximate main-sequence B–V color -> spectral class (used when the catalog
// gives B–V but no spectral type — exactly our bundled-catalog situation).
export function classFromBV(bv) {
  if (bv == null || Number.isNaN(bv)) return null;
  if (bv < -0.20) return "B5V";
  if (bv < 0.00) return "A0V";
  if (bv < 0.30) return "A0V";
  if (bv < 0.58) return "F5V";
  if (bv < 0.81) return "G2V";
  if (bv < 1.40) return "K5V";
  return "M2V";
}

/** Pick a template from a B–V color. */
export function templateForBV(bv) {
  const key = classFromBV(bv);
  if (!key) return null;
  return { key, ...SPECTRAL_TEMPLATES[key] };
}

// Last-resort default so something always sings.
export const DEFAULT_TEMPLATE_KEY = "A0V";
export function defaultTemplate() {
  return { key: DEFAULT_TEMPLATE_KEY, ...SPECTRAL_TEMPLATES[DEFAULT_TEMPLATE_KEY] };
}
