// Canonical wavelength → visible RGB mapping (ported from the prototype).
// Shared so the spectrum panel and the ring overlay color things identically —
// do not fork this logic; both must use the same line→color mapping.

export function wlToRGB(wl) {
  let r = 0, g = 0, b = 0;
  if (wl >= 380 && wl < 440) { r = -(wl - 440) / 60; b = 1; }
  else if (wl >= 440 && wl < 490) { g = (wl - 440) / 50; b = 1; }
  else if (wl >= 490 && wl < 510) { g = 1; b = -(wl - 510) / 20; }
  else if (wl >= 510 && wl < 580) { r = (wl - 510) / 70; g = 1; }
  else if (wl >= 580 && wl < 645) { r = 1; g = -(wl - 645) / 65; }
  else if (wl >= 645 && wl <= 780) { r = 1; }
  const f = wl < 420 ? 0.3 + 0.7 * (wl - 380) / 40
    : wl <= 700 ? 1 : wl <= 780 ? 0.3 + 0.7 * (780 - wl) / 80 : 0;
  return [Math.round(r * f * 255), Math.round(g * f * 255), Math.round(b * f * 255)];
}

export default wlToRGB;
