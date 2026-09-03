// StarDataResolver — given a star selected in the sky, return spectral data to
// sonify. Resolution cascade (ARCHITECTURE.md §2):
//
//   1. curated  — name/alias match against the 6 bright stars (real line data)
//   2. template — by spectral type, if the catalog provides one
//   3. template — by B–V color, if provided (our bundled catalog gives B–V)
//   4. template — default, so every selection still sings
//
// The bundled engine catalog gives names + B–V but no HIP/spectral type
// (PHASE0-FINDINGS.md §9), so in practice bright stars hit tier 1 and everything
// else hits tier 3/4. Each result carries a `dataSource` tag for the UI.

import { BRIGHT_STARS } from "./bright-stars.js";
import { templateForType, templateForBV, defaultTemplate } from "./spectral-templates.js";

function norm(s) {
  return String(s)
    .toLowerCase()
    .replace(/^name\s+/, "")
    .replace(/^\*\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export class StarDataResolver {
  constructor(catalog = BRIGHT_STARS) {
    this._byName = new Map();
    for (const star of catalog) {
      for (const n of [star.name, ...(star.aliases || [])]) {
        this._byName.set(norm(n), star);
      }
    }
  }

  /**
   * @param {{name?:string, designations?:string[], spectralType?:string, bv?:number}} selected
   * @returns {object|null} spectral data with a dataSource tag, or null for nothing selectable
   */
  resolve(selected) {
    if (!selected) return null;

    // Tier 1: curated.
    const candidates = [selected.name, ...(selected.designations || [])]
      .filter(Boolean)
      .map(norm);
    for (const c of candidates) {
      const hit = this._byName.get(c);
      if (hit) return { ...hit, dataSource: "curated" };
    }

    // Tiers 2–4: synthetic template, labelled with the selected star's identity.
    const name = selected.name || (selected.hip ? `HIP ${selected.hip}` : "Unknown star");
    const tpl =
      templateForType(selected.spectralType) ||
      templateForBV(selected.bv) ||
      defaultTemplate();

    return {
      name,
      type: tpl.key,
      temp: tpl.temp,
      rv: 0, // templates carry no measured radial velocity
      color: tpl.color,
      lines: tpl.lines,
      desc: `Synthetic ${tpl.key} template (no curated data for this star).`,
      dataSource: "template",
    };
  }
}

export default StarDataResolver;
