// Radial spectrum ("spectrograph halo") for the waves a singing star sends out.
// Pure and browser-free; verify:melody tests it. RingOverlay paints the result.
//
// Encoding (after the user's radial-spectrum concept notes):
//   • wavelength → radius, linearly: SPEC_MIN (violet) at the inner edge of
//     the ring, SPEC_MAX (red) at the outer edge. Colour is the shared wlToRGB.
//   • every angle repeats the same spectrum; angle carries no data.
//   • each absorption line of THIS star is a darker concentric ring at its
//     wavelength. Darkness comes from the line's depth and the ring's width
//     from the line's width, with a visibility floor: real lines are a fraction
//     of a nanometre wide, which would be far below one pixel here.
// Two styles, same data:
//   • "dark"   — a full rainbow with the lines as dark rings (how a spectrograph
//     shows absorption). Faithful, but every star reads as "a rainbow".
//   • "bright" — the inverse: the continuum is only a faint wash and each line
//     glows in its own colour, so the star's line pattern is what you see.
// It is a picture of the star's line list (curated or template), not a
// measured spectrum, and not physical shells around the star.

import { SPEC_MIN, SPEC_MAX } from "../audio/mappings.js";
import { wlToRGB } from "../audio/color.js";

const SAMPLE_NM = 10;        // colour samples across the band
const EDGE = 0.06;           // soft fade at the inner and outer edge (fraction of the ring)
const MIN_HALF_PX = 1.1;     // narrowest dark ring, half-width
const HALF_PX_PER_WIDTH = 0.7; // extra half-width per unit of line width (Å)
const MAX_HALF_PX = 3.5;
// "bright" style: faint continuum, wider glowing rings.
const BRIGHT_BASE = 0.1;       // continuum brightness
const BRIGHT_MIN_HALF_PX = 2.6;
const BRIGHT_HALF_PX_PER_WIDTH = 1.1;
const BRIGHT_MAX_HALF_PX = 6;

/** Position 0..1 across the ring for a wavelength (clamped to the band). */
export function wlToRingPos(wl) {
  return Math.max(0, Math.min(1, (wl - SPEC_MIN) / (SPEC_MAX - SPEC_MIN)));
}

/**
 * Gradient stops for one ring.
 * @param {Array<{wl:number, depth:number, width:number}>} lines  the star's absorption lines
 * @param {number} spanPx  the ring's radial thickness in pixels (outer − inner)
 * @param {"dark"|"bright"} [style]  lines as dark rings on a rainbow, or as bright rings on a faint wash
 * @returns {Array<{pos:number, rgb:number[], k:number}>}  sorted by pos; k is
 *   brightness 0..1 (edge fade × absorption), to be multiplied by the wave's alpha.
 */
export function spectrumStops(lines, spanPx, style = "dark") {
  const span = Math.max(1, spanPx);
  const bright = style === "bright";
  const halfPx = (l) => (bright
    ? Math.min(BRIGHT_MAX_HALF_PX, BRIGHT_MIN_HALF_PX + BRIGHT_HALF_PX_PER_WIDTH * (l.width ?? 0))
    : Math.min(MAX_HALF_PX, MIN_HALF_PX + HALF_PX_PER_WIDTH * (l.width ?? 0)));
  const notches = (lines || [])
    .filter((l) => l && l.wl >= SPEC_MIN && l.wl <= SPEC_MAX)
    .map((l) => ({
      p: wlToRingPos(l.wl),
      half: halfPx(l) / span,
      // Line strength 0..1 from depth: how dark (or, inverted, how bright) its ring is.
      dark: Math.max(0, Math.min(1, 0.45 + 0.55 * (l.depth ?? 0))),
    }));

  const positions = new Set();
  for (let wl = SPEC_MIN; wl <= SPEC_MAX; wl += SAMPLE_NM) positions.add(wlToRingPos(wl));
  positions.add(EDGE); positions.add(1 - EDGE);
  for (const n of notches) for (const q of [n.p - n.half, n.p, n.p + n.half]) if (q >= 0 && q <= 1) positions.add(q);

  return [...positions].sort((a, b) => a - b).map((pos) => {
    const wl = SPEC_MIN + pos * (SPEC_MAX - SPEC_MIN);
    const edge = Math.min(1, pos / EDGE, (1 - pos) / EDGE);
    let k;
    if (bright) {
      // Strongest line glow at this radius, over a faint continuum. Lines near
      // the ring's edge are not edge-faded, or Ca II H&K (393/397 nm) would vanish.
      let glow = 0;
      for (const n of notches) {
        const d = Math.abs(pos - n.p);
        if (d < n.half) glow = Math.max(glow, n.dark * (1 - d / n.half));
      }
      k = Math.max(BRIGHT_BASE * edge, glow);
    } else {
      k = edge;
      for (const n of notches) {
        const d = Math.abs(pos - n.p);
        if (d < n.half) k *= 1 - n.dark * (1 - d / n.half);
      }
    }
    return { pos, rgb: wlToRGB(wl), k: Math.max(0, Math.min(1, k)) };
  });
}
