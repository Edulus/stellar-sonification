import { useState, useRef, useCallback, useEffect } from "react";
import { harmonizeChord, describeChord, CHORD_TIMING } from "./harmonize.js";

// ── Real stellar absorption line data from 6 stars ──────────────────
// Parameters per line: wavelength(nm), depth(0-1), width(Å), profile, equivalentWidth(mÅ), element, excitationPotential(eV)
// Radial velocity per star provides doppler shift for detuning

const STARS = [
  {
    name: "Sol",
    type: "G2V",
    temp: 5778,
    rv: 0,
    color: "#f5e6a3",
    desc: "Our Sun. The reference G-type main sequence star.",
    lines: [
      { wl: 393.4, depth: 0.85, width: 0.80, profile: "voigt",      ew: 800,  el: "Ca II K",   ep: 0.00 },
      { wl: 486.1, depth: 0.50, width: 0.50, profile: "voigt",      ew: 350,  el: "Hβ",        ep: 10.20 },
      { wl: 516.7, depth: 0.45, width: 0.30, profile: "gaussian",   ew: 200,  el: "Mg I b₁",   ep: 2.71 },
      { wl: 527.0, depth: 0.40, width: 0.25, profile: "gaussian",   ew: 150,  el: "Fe I",      ep: 0.86 },
      { wl: 589.0, depth: 0.60, width: 0.40, profile: "voigt",      ew: 400,  el: "Na I D₁",   ep: 0.00 },
      { wl: 656.3, depth: 0.55, width: 0.60, profile: "voigt",      ew: 380,  el: "Hα",        ep: 10.20 },
    ],
  },
  {
    name: "Vega",
    type: "A0V",
    temp: 9600,
    rv: -13.9,
    color: "#cce0ff",
    desc: "Brilliant A-type. Hydrogen-dominated, weak metals.",
    lines: [
      { wl: 410.2, depth: 0.55, width: 1.20, profile: "lorentzian", ew: 600,  el: "Hδ",        ep: 10.20 },
      { wl: 434.0, depth: 0.70, width: 1.50, profile: "lorentzian", ew: 900,  el: "Hγ",        ep: 10.20 },
      { wl: 448.1, depth: 0.15, width: 0.20, profile: "gaussian",   ew: 40,   el: "Mg II",     ep: 8.86 },
      { wl: 486.1, depth: 0.80, width: 1.80, profile: "lorentzian", ew: 1100, el: "Hβ",        ep: 10.20 },
      { wl: 527.0, depth: 0.08, width: 0.15, profile: "gaussian",   ew: 20,   el: "Fe I",      ep: 0.86 },
      { wl: 656.3, depth: 0.75, width: 2.00, profile: "lorentzian", ew: 1200, el: "Hα",        ep: 10.20 },
    ],
  },
  {
    name: "Betelgeuse",
    type: "M1Iab",
    temp: 3600,
    rv: 21.9,
    color: "#ffb088",
    desc: "Red supergiant. Cool, dense, molecule-rich atmosphere.",
    lines: [
      { wl: 393.4, depth: 0.60, width: 1.00, profile: "voigt",      ew: 550,  el: "Ca II K",   ep: 0.00 },
      { wl: 422.7, depth: 0.80, width: 0.60, profile: "voigt",      ew: 700,  el: "Ca I",      ep: 0.00 },
      { wl: 516.7, depth: 0.55, width: 0.40, profile: "gaussian",   ew: 350,  el: "Mg I b₁",   ep: 2.71 },
      { wl: 527.0, depth: 0.70, width: 0.50, profile: "gaussian",   ew: 500,  el: "Fe I",      ep: 0.86 },
      { wl: 589.0, depth: 0.90, width: 0.80, profile: "voigt",      ew: 900,  el: "Na I D₁",   ep: 0.00 },
      { wl: 705.3, depth: 0.65, width: 3.00, profile: "gaussian",   ew: 1500, el: "TiO γ",     ep: 0.00 },
    ],
  },
  {
    name: "Sirius",
    type: "A1V",
    temp: 9940,
    rv: -5.5,
    color: "#d4e8ff",
    desc: "Brightest star in the sky. Hot, strong Balmer series.",
    lines: [
      { wl: 410.2, depth: 0.60, width: 1.40, profile: "lorentzian", ew: 700,  el: "Hδ",        ep: 10.20 },
      { wl: 434.0, depth: 0.75, width: 1.70, profile: "lorentzian", ew: 1000, el: "Hγ",        ep: 10.20 },
      { wl: 448.1, depth: 0.18, width: 0.25, profile: "gaussian",   ew: 50,   el: "Mg II",     ep: 8.86 },
      { wl: 486.1, depth: 0.85, width: 2.00, profile: "lorentzian", ew: 1250, el: "Hβ",        ep: 10.20 },
      { wl: 516.9, depth: 0.12, width: 0.20, profile: "gaussian",   ew: 35,   el: "Fe II",     ep: 2.89 },
      { wl: 656.3, depth: 0.80, width: 2.20, profile: "lorentzian", ew: 1300, el: "Hα",        ep: 10.20 },
    ],
  },
  {
    name: "Arcturus",
    type: "K1.5III",
    temp: 4286,
    rv: -5.2,
    color: "#ffd4a0",
    desc: "Orange giant. Metal-rich, strong atomic features.",
    lines: [
      { wl: 393.4, depth: 0.90, width: 1.00, profile: "voigt",      ew: 950,  el: "Ca II K",   ep: 0.00 },
      { wl: 422.7, depth: 0.70, width: 0.50, profile: "voigt",      ew: 550,  el: "Ca I",      ep: 0.00 },
      { wl: 516.7, depth: 0.55, width: 0.40, profile: "gaussian",   ew: 300,  el: "Mg I b₁",   ep: 2.71 },
      { wl: 527.0, depth: 0.60, width: 0.35, profile: "gaussian",   ew: 350,  el: "Fe I",      ep: 0.86 },
      { wl: 589.0, depth: 0.75, width: 0.50, profile: "voigt",      ew: 600,  el: "Na I D₁",   ep: 0.00 },
      { wl: 656.3, depth: 0.30, width: 0.40, profile: "voigt",      ew: 200,  el: "Hα",        ep: 10.20 },
    ],
  },
  {
    name: "Rigel",
    type: "B8Ia",
    temp: 12100,
    rv: 17.8,
    color: "#b8d4ff",
    desc: "Blue supergiant. Hot, helium lines, pressure-broadened.",
    lines: [
      { wl: 434.0, depth: 0.55, width: 1.80, profile: "lorentzian", ew: 800,  el: "Hγ",        ep: 10.20 },
      { wl: 447.1, depth: 0.25, width: 0.80, profile: "voigt",      ew: 200,  el: "He I",      ep: 20.96 },
      { wl: 486.1, depth: 0.65, width: 2.20, profile: "lorentzian", ew: 1000, el: "Hβ",        ep: 10.20 },
      { wl: 587.6, depth: 0.30, width: 1.00, profile: "voigt",      ew: 300,  el: "He I D₃",   ep: 20.96 },
      { wl: 634.7, depth: 0.20, width: 0.40, profile: "gaussian",   ew: 100,  el: "Si II",     ep: 8.12 },
      { wl: 656.3, depth: 0.40, width: 2.50, profile: "lorentzian", ew: 800,  el: "Hα",        ep: 10.20 },
    ],
  },
];

const SPEC_MIN = 380;
const SPEC_MAX = 760;

// ── Wavelength to visible color ──────────────────────────────────────
function wlToRGB(wl) {
  let r = 0, g = 0, b = 0;
  if (wl >= 380 && wl < 440) { r = -(wl - 440) / 60; b = 1; }
  else if (wl >= 440 && wl < 490) { g = (wl - 440) / 50; b = 1; }
  else if (wl >= 490 && wl < 510) { g = 1; b = -(wl - 510) / 20; }
  else if (wl >= 510 && wl < 580) { r = (wl - 510) / 70; g = 1; }
  else if (wl >= 580 && wl < 645) { r = 1; g = -(wl - 645) / 65; }
  else if (wl >= 645 && wl <= 780) { r = 1; }
  let f = wl < 420 ? 0.3 + 0.7 * (wl - 380) / 40
        : wl <= 700 ? 1 : wl <= 780 ? 0.3 + 0.7 * (780 - wl) / 80 : 0;
  return [Math.round(r*f*255), Math.round(g*f*255), Math.round(b*f*255)];
}

// ── Blackbody for a given temperature ────────────────────────────────
function blackbody(wl_nm, T) {
  const wl = wl_nm * 1e-9;
  const h = 6.626e-34, c = 3e8, k = 1.381e-23;
  return (2*h*c*c) / (Math.pow(wl, 5) * (Math.exp((h*c)/(wl*k*T)) - 1));
}

// ── Audio parameter mappings ─────────────────────────────────────────
// 1. wavelength → pitch (shorter λ = higher pitch, 3 octave range)
function wlToFreq(wl) {
  const midi = 84 - ((wl - SPEC_MIN) / (SPEC_MAX - SPEC_MIN)) * 36;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// 2. depth → amplitude (0-1 → 0.03-0.22)
function depthToGain(d) { return 0.03 + d * 0.19; }

// 3. width → filter Q (narrow line = tight resonance, wide = open)
function widthToQ(w) { return Math.max(0.5, 18 - w * 6); }

// 4. profile → envelope shape {attack, decay, sustain_level, release}
function profileToEnvelope(p) {
  switch (p) {
    case "gaussian":   return { a: 0.06, d: 0.1, s: 0.7, r: 0.06 };
    case "lorentzian": return { a: 0.01, d: 0.05, s: 0.8, r: 0.35 };
    case "voigt":      return { a: 0.03, d: 0.08, s: 0.75, r: 0.18 };
    default:           return { a: 0.05, d: 0.1, s: 0.7, r: 0.1 };
  }
}

// 5. equivalent width → reverb send (20mÅ → dry, 1500mÅ → drenched)
function ewToReverb(ew) { return Math.min(ew / 1500, 1); }

// Fixed tone duration
const TONE_DURATION = 1.2;

// 6. radial velocity → detune in Hz (±30 km/s → ±6 Hz)
function rvToDetune(rv) { return rv * 0.2; }

// 7. excitation potential → harmonic richness (0eV = sine, 21eV = full saw)
// We blend multiple harmonics: more EP = more overtones
function epToHarmonics(ep) {
  const t = Math.min(ep / 21, 1);
  return t; // 0 = fundamental only, 1 = rich harmonics
}

// ── Spectrum canvas ──────────────────────────────────────────────────
function SpectrumCanvas({ star, activeIdx, playingIdx, chordActiveIndices, onHover, onClick, width, height }) {
  const ref = useRef(null);

  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr; c.height = height * dpr;
    ctx.scale(dpr, dpr);

    const m = { t: 32, r: 16, b: 42, l: 48 };
    const pw = width - m.l - m.r, ph = height - m.t - m.b;
    const toX = wl => m.l + ((wl - SPEC_MIN) / (SPEC_MAX - SPEC_MIN)) * pw;

    // Compute blackbody envelope
    let maxBB = 0;
    const bbArr = [];
    for (let wl = SPEC_MIN; wl <= SPEC_MAX; wl += 0.5) {
      const v = blackbody(wl, star.temp);
      bbArr.push({ wl, v }); if (v > maxBB) maxBB = v;
    }

    // Flux with absorption dips
    const getFlux = wl => {
      let flux = blackbody(wl, star.temp) / maxBB;
      star.lines.forEach(line => {
        const sigma = line.width * 0.12;
        const dist = (wl - line.wl) / Math.max(sigma, 0.05);
        if (line.profile === "lorentzian") {
          flux *= 1 - line.depth * 0.75 / (1 + dist * dist);
        } else if (line.profile === "voigt") {
          const gauss = Math.exp(-0.5 * dist * dist);
          const lor = 1 / (1 + dist * dist);
          flux *= 1 - line.depth * 0.7 * (0.6 * gauss + 0.4 * lor);
        } else {
          flux *= 1 - line.depth * 0.75 * Math.exp(-0.5 * dist * dist);
        }
      });
      return flux;
    };

    // Background
    ctx.fillStyle = "#08080e"; ctx.fillRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = "rgba(60,70,90,0.2)"; ctx.lineWidth = 0.5;
    for (let wl = 400; wl <= 750; wl += 50) {
      const x = toX(wl);
      ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, m.t + ph); ctx.stroke();
    }

    // Spectrum strip
    const stripH = 10, stripY = m.t + ph + 4;
    for (let px = 0; px < pw; px++) {
      const wl = SPEC_MIN + (px / pw) * (SPEC_MAX - SPEC_MIN);
      const [r, g, b] = wlToRGB(wl);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(m.l + px, stripY, 1, stripH);
    }
    // Absorption dips in strip
    star.lines.forEach(line => {
      const x = toX(line.wl);
      const w = Math.max(2, line.width * 2);
      ctx.fillStyle = `rgba(0,0,0,${line.depth * 0.8})`;
      ctx.fillRect(x - w/2, stripY, w, stripH);
    });

    // Spectral fill under curve
    for (let px = 0; px < pw; px++) {
      const wl = SPEC_MIN + (px / pw) * (SPEC_MAX - SPEC_MIN);
      const flux = getFlux(wl);
      const y = m.t + ph - flux * ph;
      const [r, g, b] = wlToRGB(wl);
      const grad = ctx.createLinearGradient(0, y, 0, m.t + ph);
      grad.addColorStop(0, `rgba(${r},${g},${b},0.12)`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(m.l + px, y, 1, m.t + ph - y);
    }

    // Flux curve
    ctx.beginPath(); ctx.strokeStyle = "rgba(200,210,230,0.7)"; ctx.lineWidth = 1;
    for (let px = 0; px < pw; px++) {
      const wl = SPEC_MIN + (px / pw) * (SPEC_MAX - SPEC_MIN);
      const flux = getFlux(wl);
      const x = m.l + px, y = m.t + ph - flux * ph;
      px === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Absorption line markers
    star.lines.forEach((line, i) => {
      const x = toX(line.wl);
      const isA = activeIdx === i, isP = playingIdx === i;
      // Chord mode: many lines glow together, each in its own wavelength color.
      const isC = chordActiveIndices ? chordActiveIndices.includes(i) : false;
      const hot = isA || isP || isC;
      const ownColor = isA || isC; // use the line's wavelength color (vs. sequential yellow)
      const [lr, lg, lb] = wlToRGB(line.wl);

      // Vertical dashed line
      ctx.strokeStyle = isP ? `rgba(255,220,80,0.9)` : ownColor ? `rgba(${lr},${lg},${lb},0.9)` : `rgba(${lr},${lg},${lb},0.4)`;
      ctx.lineWidth = hot ? 1.5 : 0.8;
      ctx.setLineDash([3, 2]); ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, m.t + ph); ctx.stroke(); ctx.setLineDash([]);

      // Glow
      if (hot) {
        const glow = ctx.createRadialGradient(x, m.t + ph * 0.5, 0, x, m.t + ph * 0.5, 35);
        glow.addColorStop(0, isP ? "rgba(255,220,80,0.12)" : `rgba(${lr},${lg},${lb},0.1)`);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow; ctx.fillRect(x - 35, m.t, 70, ph);
      }

      // Top label
      ctx.fillStyle = isP ? "#ffdd55" : ownColor ? `rgb(${lr},${lg},${lb})` : "rgba(180,180,200,0.5)";
      ctx.font = hot ? "bold 9px monospace" : "8px monospace";
      ctx.textAlign = "center";
      ctx.fillText(line.el, x, m.t - 6);
      ctx.font = "7px monospace";
      ctx.fillStyle = "rgba(150,150,170,0.4)";
      ctx.fillText(`${line.wl}`, x, m.t - 16);
    });

    // Axis labels
    ctx.fillStyle = "rgba(130,140,160,0.5)"; ctx.font = "8px monospace"; ctx.textAlign = "center";
    for (let wl = 400; wl <= 750; wl += 50) ctx.fillText(`${wl}`, toX(wl), stripY + stripH + 14);
    ctx.fillText("wavelength (nm)", m.l + pw / 2, stripY + stripH + 26);
    ctx.save(); ctx.translate(10, m.t + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText("flux", 0, 0); ctx.restore();

  }, [star, activeIdx, playingIdx, chordActiveIndices, width, height]);

  const handleMouse = useCallback(e => {
    const rect = ref.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const ml = 48, mr = 16, pw = width - ml - mr;
    const wl = SPEC_MIN + ((mx - ml) / pw) * (SPEC_MAX - SPEC_MIN);
    let best = null, bestD = Infinity;
    const nmPerPx = (SPEC_MAX - SPEC_MIN) / pw;
    star.lines.forEach((line, i) => {
      const d = Math.abs(wl - line.wl) / nmPerPx;
      if (d < 18 && d < bestD) { best = i; bestD = d; }
    });
    onHover(best);
  }, [star, width, onHover]);

  return (
    <canvas ref={ref}
      style={{ width, height, cursor: activeIdx !== null ? "pointer" : "crosshair", display: "block" }}
      onMouseMove={handleMouse} onMouseLeave={() => onHover(null)}
      onClick={() => { if (activeIdx !== null) onClick(activeIdx); }}
    />
  );
}

// ── Parameter display bar ────────────────────────────────────────────
function ParamBar({ label, value, max, unit, color }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, marginBottom: 3 }}>
      <div style={{ width: 95, color: "rgba(160,165,180,0.6)", textAlign: "right", flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, height: 6, background: "rgba(40,42,55,0.8)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.3s" }} />
      </div>
      <div style={{ width: 65, color: "rgba(180,185,200,0.7)", fontSize: 9, flexShrink: 0 }}>
        {typeof value === "number" ? value.toFixed(value < 10 ? 2 : 0) : value}{unit}
      </div>
    </div>
  );
}

// ── Night-sky enforcement (Phase 0 bridge config) ────────────────────
// The standalone prototype has no Stellarium engine, so this object is
// inert here — it documents the contract the Phase-0 StellariumBridge
// initialization must satisfy so the sky is ALWAYS a dark, atmosphere-free
// night sky regardless of the observer's wall-clock time. Consume it from
// StellariumBridge init alongside setLocation(location.lat, location.lng).
const NIGHT_SKY_CONFIG = {
  atmosphere: false,  // stel.core.atmosphere.visible = false — kill Rayleigh scattering / blue daytime sky
  landscape: false,   // stel.core.landscapes.visible = false — drop the horizon so the full sphere is visible
  lockToNight: true,  // bridge must hold the sun below astronomical twilight (alt < -18°)
  sunAltitudeMaxDeg: -18, // enforcement threshold for lockToNight
  // Phase-0 note: with a fixed observer time the sun would drift above the
  // horizon as Earth rotates; the bridge should either freeze time at local
  // midnight or re-advance the clock whenever sun altitude rises above the max.
};

// ── Observing locations (location picker) ────────────────────────────
// Curated global observing sites. `lat`/`lng` in signed decimal degrees
// (N/E positive). In Phase 0 the selected site feeds
// StellariumBridge.setLocation(lat, lng) to recompute the visible sky.
const OBSERVING_LOCATIONS = [
  {
    region: "North America",
    sites: [
      { name: "Montréal",          country: "Canada",        lat: 45.50, lng: -73.57, desc: "Default observer — urban northern sky." },
      { name: "Mauna Kea",         country: "USA (Hawaii)",  lat: 19.82, lng: -155.47, desc: "13,800 ft summit; among Earth's darkest skies." },
      { name: "Kitt Peak",         country: "USA (Arizona)", lat: 31.96, lng: -111.60, desc: "Sonoran Desert observatory ridge." },
      { name: "McDonald Obs.",     country: "USA (Texas)",   lat: 30.67, lng: -104.02, desc: "Davis Mountains dark-sky reserve." },
      { name: "Mexico City",       country: "Mexico",        lat: 19.43, lng: -99.13, desc: "Low-latitude city; ecliptic rides high." },
    ],
  },
  {
    region: "South America",
    sites: [
      { name: "Cerro Paranal",     country: "Chile",         lat: -24.63, lng: -70.40, desc: "Atacama; ESO VLT — exceptional transparency." },
      { name: "La Silla",          country: "Chile",         lat: -29.26, lng: -70.73, desc: "Southern Atacama ridge observatory." },
      { name: "Cusco",             country: "Peru",          lat: -13.53, lng: -71.97, desc: "High Andes; Magellanic Clouds overhead." },
      { name: "Quito",             country: "Ecuador",       lat:  -0.18, lng: -78.47, desc: "On the equator — both poles graze the horizon." },
    ],
  },
  {
    region: "Europe",
    sites: [
      { name: "Roque de los Muchachos", country: "Spain (La Palma)", lat: 28.76, lng: -17.89, desc: "Canary ridge above the cloud layer." },
      { name: "Greenwich",         country: "UK",            lat: 51.48, lng:  0.00, desc: "The prime meridian, 0° longitude." },
      { name: "Reykjavík",         country: "Iceland",       lat: 64.15, lng: -21.94, desc: "Sub-Arctic; aurora latitudes." },
      { name: "Calar Alto",        country: "Spain",         lat: 37.22, lng:  -2.55, desc: "Andalusian high-desert observatory." },
      { name: "Pic du Midi",       country: "France",        lat: 42.94, lng:   0.14, desc: "Pyrenees summit observatory." },
    ],
  },
  {
    region: "Africa & Middle East",
    sites: [
      { name: "Sutherland (SAAO)", country: "South Africa",  lat: -32.38, lng:  20.81, desc: "Karoo plateau; deep southern sky." },
      { name: "Cairo",             country: "Egypt",         lat:  30.04, lng:  31.24, desc: "Where much of our star naming began." },
      { name: "Oukaïmeden",        country: "Morocco",       lat:  31.21, lng:  -7.87, desc: "High Atlas observatory." },
      { name: "Cape Town",         country: "South Africa",  lat: -33.93, lng:  18.42, desc: "Southern Cross near the zenith." },
    ],
  },
  {
    region: "Asia & Oceania",
    sites: [
      { name: "Siding Spring",     country: "Australia",     lat: -31.27, lng: 149.07, desc: "Warrumbungle dark-sky park." },
      { name: "Mt. John (UC)",     country: "New Zealand",   lat: -43.99, lng: 170.46, desc: "Aoraki Mackenzie dark-sky reserve." },
      { name: "Ladakh (IAO)",      country: "India",         lat:  32.78, lng:  78.96, desc: "Hanle, 14,800 ft Himalayan desert." },
      { name: "Tokyo",             country: "Japan",         lat:  35.68, lng: 139.69, desc: "Mid-northern megacity sky." },
      { name: "Singapore",         country: "Singapore",     lat:   1.35, lng: 103.82, desc: "Near-equatorial; celestial equator overhead." },
    ],
  },
  {
    region: "Polar",
    sites: [
      { name: "South Pole (Amundsen–Scott)", country: "Antarctica", lat: -90.00, lng:  0.00, desc: "Sky rotates flat; the south pole is the zenith." },
      { name: "Svalbard",          country: "Norway",        lat:  78.22, lng:  15.65, desc: "High Arctic; months-long polar night." },
    ],
  },
];

// Flattened lookup of every site (carries its region for filtering/search).
const ALL_SITES = OBSERVING_LOCATIONS.flatMap(g =>
  g.sites.map(s => ({ ...s, region: g.region }))
);

// Pretty-print a signed decimal degree as e.g. "45.5°N" / "73.6°W".
function fmtLat(lat) { return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}`; }
function fmtLng(lng) { return `${Math.abs(lng).toFixed(1)}°${lng >= 0 ? "E" : "W"}`; }

// ── Main component ───────────────────────────────────────────────────
export default function StellarSonification() {
  const [starIdx, setStarIdx] = useState(0);
  const [activeIdx, setActiveIdx] = useState(null);
  const [playingIdx, setPlayingIdx] = useState(null);
  const [seqPlaying, setSeqPlaying] = useState(false);

  // Chord harmonization mode
  const [playMode, setPlayMode] = useState("sequential"); // 'sequential' | 'chord'
  const [harmonizeAmt, setHarmonizeAmt] = useState(0.75);  // 0–1, default 0.75
  const [chordPlaying, setChordPlaying] = useState(false);
  const [chordActiveIndices, setChordActiveIndices] = useState(null); // line idxs lit together during a chord
  const [panelOpen, setPanelOpen] = useState(false);       // right-side drawer open/closed
  const [tabHover, setTabHover] = useState(false);         // drawer-handle hover (cosmetic)

  // Sequential-mode controls (drawer)
  const [seqOctave, setSeqOctave] = useState(0);    // -2..+2 octave shift applied to sequence playback
  const [seqSpeed, setSeqSpeed] = useState(1280);   // ms between tones (was TONE_DURATION*1000 + 80)

  // Hover-mode controls (drawer). When enabled, hovering a spectrum line plays
  // the star — either all lines at once (chord) or the EW-sorted sequence —
  // and mouse-off fades it out. Hover audio is a separate node pool from the
  // click/sequence path (see hoverNodesRef) so the two never stomp each other.
  const [hoverModeEnabled, setHoverModeEnabled] = useState(false);
  const [hoverModeType, setHoverModeType]       = useState("chord");   // 'chord' | 'sequence'
  const [hoverFadeOut, setHoverFadeOut]         = useState(0.8);       // seconds
  const [chordGainScale, setChordGainScale]     = useState(0.7);       // 0.2–1.0
  const [chordMaxVoices, setChordMaxVoices]     = useState(6);         // 1–6
  const [chordSpreadDetune, setChordSpreadDetune] = useState(0);       // 0–8 Hz
  const [seqRepeat, setSeqRepeat]               = useState("once");    // 'once' | 'loop'

  // Observing location (Phase 0: feeds StellariumBridge.setLocation). Default
  // matches NIGHT_SKY_CONFIG's intended first observer — Montréal.
  const [location, setLocation] = useState(ALL_SITES[0]);
  const [locOpen, setLocOpen] = useState(false);       // location-picker drawer open/closed
  const [locQuery, setLocQuery] = useState("");        // search text
  const [locRegion, setLocRegion] = useState("All");   // region filter tab

  const audioRef = useRef(null);
  const seqRef = useRef(null);
  const nodesRef = useRef([]);
  const chordTimersRef = useRef([]); // pending setTimeouts for chord highlight + end
  const hoverDebounceRef = useRef(null); // pending setActiveIdx(null) debounce
  const hoverNodesRef = useRef([]);   // { osc, masterGain }[] — hover audio, separate from nodesRef
  const prevActiveIdxRef = useRef(null); // previous activeIdx, to detect hover enter/leave
  // Live mirrors of the sequential sliders so a running sequence (and single
  // clicks) read the current value, not the one captured when playback started.
  const seqOctaveRef = useRef(seqOctave);
  const seqSpeedRef = useRef(seqSpeed);
  useEffect(() => { seqOctaveRef.current = seqOctave; }, [seqOctave]);
  useEffect(() => { seqSpeedRef.current = seqSpeed; }, [seqSpeed]);

  const star = STARS[starIdx];

  const getCtx = () => {
    if (!audioRef.current) audioRef.current = new (window.AudioContext || window.webkitAudioContext)();
    if (audioRef.current.state === "suspended") audioRef.current.resume();
    return audioRef.current;
  };

  // Stop any currently playing nodes
  const stopCurrent = useCallback(() => {
    nodesRef.current.forEach(n => { try { n.stop(); } catch {} });
    nodesRef.current = [];
    chordTimersRef.current.forEach(t => clearTimeout(t));
    chordTimersRef.current = [];
    setChordPlaying(false);
    setChordActiveIndices(null);
  }, []);

  // Debounced active-line setter: non-null applies immediately (cancelling any
  // pending clear); null is delayed 150ms so the param panel doesn't flicker as
  // the cursor crosses gaps between lines/rows.
  const handleHover = useCallback((idx) => {
    if (idx !== null) {
      if (hoverDebounceRef.current) { clearTimeout(hoverDebounceRef.current); hoverDebounceRef.current = null; }
      setActiveIdx(idx);
    } else {
      if (hoverDebounceRef.current) clearTimeout(hoverDebounceRef.current);
      hoverDebounceRef.current = setTimeout(() => {
        setActiveIdx(null);
        hoverDebounceRef.current = null;
      }, 150);
    }
  }, []);

  // Play a single line with full parameter mapping.
  // `octave` shifts every oscillator by Math.pow(2, octave) (used by sequence playback).
  const playLine = useCallback((idx, octave = 0) => {
    stopCurrent();
    const ctx = getCtx();
    const line = star.lines[idx];
    const now = ctx.currentTime;

    // Parameter derivations
    const octaveMul = Math.pow(2, octave);
    const freq = wlToFreq(line.wl);
    const gain = depthToGain(line.depth);
    const filterQ = widthToQ(line.width);
    const env = profileToEnvelope(line.profile);
    const dur = TONE_DURATION;
    const detune = rvToDetune(star.rv);
    const harmonic = epToHarmonics(line.ep);
    const reverbAmt = ewToReverb(line.ew);

    // Master gain with ADSR
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(gain, now + env.a);
    masterGain.gain.linearRampToValueAtTime(gain * env.s, now + env.a + env.d);
    masterGain.gain.setValueAtTime(gain * env.s, now + dur - env.r);
    masterGain.gain.linearRampToValueAtTime(0, now + dur);

    // Filter (width → Q)
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1200 + filterQ * 200;
    filter.Q.value = filterQ;

    // Algorithmic reverb: parallel delay lines with feedback + diffusion
    const reverbBus = ctx.createGain();
    reverbBus.gain.value = reverbAmt * 0.45;
    const dryBus = ctx.createGain();
    dryBus.gain.value = 1.0 - reverbAmt * 0.2;

    const delays = [0.029, 0.037, 0.053, 0.067];
    const feedbacks = [0.6, 0.55, 0.5, 0.45].map(f => f + reverbAmt * 0.2);
    delays.forEach((t, di) => {
      const delay = ctx.createDelay(0.1);
      delay.delayTime.value = t;
      const fb = ctx.createGain();
      fb.gain.value = feedbacks[di];
      const lpf = ctx.createBiquadFilter();
      lpf.type = "lowpass";
      lpf.frequency.value = 2500 - reverbAmt * 800;
      reverbBus.connect(delay);
      delay.connect(lpf);
      lpf.connect(fb);
      fb.connect(delay);
      lpf.connect(ctx.destination);
    });

    // Build oscillators based on harmonic richness (excitation potential)
    const oscs = [];

    // Fundamental (always present, sine)
    const osc1 = ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.value = freq * octaveMul;
    osc1.detune.value = detune;
    const g1 = ctx.createGain();
    g1.gain.value = 1.0 - harmonic * 0.3;
    osc1.connect(g1); g1.connect(filter);
    oscs.push(osc1);

    // 2nd harmonic (triangle, fades in with EP)
    if (harmonic > 0.1) {
      const osc2 = ctx.createOscillator();
      osc2.type = "triangle";
      osc2.frequency.value = freq * 2 * octaveMul;
      osc2.detune.value = detune * 0.5;
      const g2 = ctx.createGain();
      g2.gain.value = Math.min(harmonic * 0.5, 0.4);
      osc2.connect(g2); g2.connect(filter);
      oscs.push(osc2);
    }

    // 3rd harmonic (sawtooth, only for high EP)
    if (harmonic > 0.4) {
      const osc3 = ctx.createOscillator();
      osc3.type = "sawtooth";
      osc3.frequency.value = freq * 3 * octaveMul;
      osc3.detune.value = detune * 0.3;
      const g3 = ctx.createGain();
      g3.gain.value = Math.min((harmonic - 0.4) * 0.4, 0.25);
      osc3.connect(g3); g3.connect(filter);
      oscs.push(osc3);
    }

    // Sub-oscillator for low EP (dark, grounding tone)
    if (harmonic < 0.2 && freq > 200) {
      const oscSub = ctx.createOscillator();
      oscSub.type = "sine";
      oscSub.frequency.value = freq * 0.5 * octaveMul;
      oscSub.detune.value = detune;
      const gSub = ctx.createGain();
      gSub.gain.value = 0.15;
      oscSub.connect(gSub); gSub.connect(filter);
      oscs.push(oscSub);
    }

    // Routing: filter → masterGain → dry bus + reverb bus → destination
    filter.connect(masterGain);
    masterGain.connect(dryBus);
    masterGain.connect(reverbBus);
    dryBus.connect(ctx.destination);

    oscs.forEach(o => { o.start(now); o.stop(now + dur + 0.05); });
    nodesRef.current = oscs;

    setPlayingIdx(idx);
    setTimeout(() => setPlayingIdx(null), dur * 1000);
  }, [star, stopCurrent]);

  // Play full sequence (ordered by EW descending — strongest lines first)
  // `opts.loop` + `opts.shouldContinue()` (used by hover sequence mode) restart
  // the run when it finishes, as long as the predicate still holds. The PLAY
  // button passes a click event here, which has neither field — so it plays once.
  const playSequence = useCallback((opts) => {
    if (seqPlaying) return;
    const loop = !!(opts && opts.loop);
    const shouldContinue = opts && typeof opts.shouldContinue === "function" ? opts.shouldContinue : null;
    setSeqPlaying(true);
    const order = star.lines
      .map((line, idx) => ({ ew: line.ew, idx }))
      .sort((a, b) => b.ew - a.ew);
    let i = 0;
    const step = () => {
      if (i >= order.length) {
        if (loop && (!shouldContinue || shouldContinue())) {
          i = 0;
          seqRef.current = setTimeout(step, seqSpeedRef.current);
          return;
        }
        setSeqPlaying(false);
        setPlayingIdx(null);
        return;
      }
      playLine(order[i].idx, seqOctaveRef.current);
      i++;
      seqRef.current = setTimeout(step, seqSpeedRef.current);
    };
    step();
  }, [seqPlaying, star, playLine]);

  // Play all lines simultaneously as a harmonized chord.
  const playChord = useCallback(() => {
    stopCurrent();
    chordTimersRef.current.forEach((t) => clearTimeout(t));
    chordTimersRef.current = [];

    const ctx = getCtx();
    const now = ctx.currentTime;
    const chord = harmonizeChord(star.lines, star.rv, harmonizeAmt);
    const dur = CHORD_TIMING.duration;

    // Chord-level master envelope: slow swell in, slow release out.
    const chordMaster = ctx.createGain();
    chordMaster.gain.setValueAtTime(0, now);
    chordMaster.gain.linearRampToValueAtTime(1, now + CHORD_TIMING.masterAttack);
    chordMaster.gain.setValueAtTime(1, now + dur - CHORD_TIMING.masterRelease);
    chordMaster.gain.linearRampToValueAtTime(0, now + dur);
    chordMaster.connect(ctx.destination);

    const allOscs = [];

    star.lines.forEach((line, i) => {
      const voiceStart = now + i * CHORD_TIMING.stagger;

      // Same per-line derivations as playLine, but pitch comes from the
      // harmonized chord and gain is scaled (1/√N) to prevent clipping.
      const freq = chord.freqs[i];
      const gain = depthToGain(line.depth) * chord.gainScale;
      const filterQ = widthToQ(line.width);
      const env = profileToEnvelope(line.profile);
      const detune = rvToDetune(star.rv);
      const harmonic = epToHarmonics(line.ep);
      // Harmonize intervention, blended linearly with harmonizeAmt:
      //   0%  → harsh cluster: ±60¢ random detune (fundamental only), dark/muddy
      //         filter (600 + Q·100), wetter reverb (0.7×).
      //   100% → clean chord: no detune, bright filter (1800 + Q·200), drier reverb (0.3×).
      const randDetune = (Math.random() - 0.5) * 120 * (1 - harmonizeAmt); // applied to fundamental only
      const filterFreq = (600 + filterQ * 100) + harmonizeAmt * (1200 + filterQ * 100);
      const reverbAmt = ewToReverb(line.ew) * (0.7 - harmonizeAmt * 0.4); // wet @0% → dry @100%

      // Per-voice gain with ADSR, relative to this voice's staggered onset.
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0, voiceStart);
      masterGain.gain.linearRampToValueAtTime(gain, voiceStart + env.a);
      masterGain.gain.linearRampToValueAtTime(gain * env.s, voiceStart + env.a + env.d);
      masterGain.gain.setValueAtTime(gain * env.s, voiceStart + dur - env.r);
      masterGain.gain.linearRampToValueAtTime(0, voiceStart + dur);

      // Filter (width → Q), cutoff also driven by harmonizeAmt (dark → bright)
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = filterFreq;
      filter.Q.value = filterQ;

      // Algorithmic reverb: parallel delay lines with feedback + diffusion.
      const reverbBus = ctx.createGain();
      reverbBus.gain.value = reverbAmt * 0.45;
      const dryBus = ctx.createGain();
      dryBus.gain.value = 1.0 - reverbAmt * 0.2;

      const delays = [0.029, 0.037, 0.053, 0.067];
      const feedbacks = [0.6, 0.55, 0.5, 0.45].map((f) => f + reverbAmt * 0.2);
      delays.forEach((t, di) => {
        const delay = ctx.createDelay(0.1);
        delay.delayTime.value = t;
        const fb = ctx.createGain();
        fb.gain.value = feedbacks[di];
        const lpf = ctx.createBiquadFilter();
        lpf.type = "lowpass";
        lpf.frequency.value = 2500 - reverbAmt * 800;
        reverbBus.connect(delay);
        delay.connect(lpf);
        lpf.connect(fb);
        fb.connect(delay);
        lpf.connect(chordMaster); // wet → chord master (not destination directly)
      });

      // Oscillator bank by excitation potential (identical to playLine).
      const oscs = [];

      const osc1 = ctx.createOscillator();
      osc1.type = "sine";
      osc1.frequency.value = freq;
      osc1.detune.value = detune + randDetune;
      const g1 = ctx.createGain();
      g1.gain.value = 1.0 - harmonic * 0.3;
      osc1.connect(g1); g1.connect(filter);
      oscs.push(osc1);

      if (harmonic > 0.1) {
        const osc2 = ctx.createOscillator();
        osc2.type = "triangle";
        osc2.frequency.value = freq * 2;
        osc2.detune.value = detune * 0.5;
        const g2 = ctx.createGain();
        g2.gain.value = Math.min(harmonic * 0.5, 0.4);
        osc2.connect(g2); g2.connect(filter);
        oscs.push(osc2);
      }

      if (harmonic > 0.4) {
        const osc3 = ctx.createOscillator();
        osc3.type = "sawtooth";
        osc3.frequency.value = freq * 3;
        osc3.detune.value = detune * 0.3;
        const g3 = ctx.createGain();
        g3.gain.value = Math.min((harmonic - 0.4) * 0.4, 0.25);
        osc3.connect(g3); g3.connect(filter);
        oscs.push(osc3);
      }

      if (harmonic < 0.2 && freq > 200) {
        const oscSub = ctx.createOscillator();
        oscSub.type = "sine";
        oscSub.frequency.value = freq * 0.5;
        oscSub.detune.value = detune;
        const gSub = ctx.createGain();
        gSub.gain.value = 0.15;
        oscSub.connect(gSub); gSub.connect(filter);
        oscs.push(oscSub);
      }

      // Routing: filter → per-voice ADSR → dry + reverb → chord master.
      filter.connect(masterGain);
      masterGain.connect(dryBus);
      masterGain.connect(reverbBus);
      dryBus.connect(chordMaster);

      oscs.forEach((o) => { o.start(voiceStart); o.stop(voiceStart + dur + 0.05); });
      allOscs.push(...oscs);
    });

    nodesRef.current = allOscs;

    // Light every voice at once for the full chord duration; the spectrum panel
    // glows each line in its own wavelength color. Clear when the chord ends.
    setChordPlaying(true);
    setChordActiveIndices(star.lines.map((_, i) => i));
    chordTimersRef.current.push(setTimeout(() => {
      setChordPlaying(false);
      setChordActiveIndices(null);
    }, dur * 1000));
  }, [star, harmonizeAmt, stopCurrent]);

  // Fade every hover voice's master gain to 0 over `durationSec`, then stop its
  // oscillators just after the ramp. Used both for the gentle mouse-off fade and
  // (with a tiny duration) to clear any lingering hover audio before a new one.
  const fadeOutHover = useCallback((durationSec) => {
    const ctx = audioRef.current;
    if (!ctx || hoverNodesRef.current.length === 0) return;
    const now = ctx.currentTime;
    hoverNodesRef.current.forEach(({ osc, masterGain }) => {
      try {
        masterGain.gain.cancelScheduledValues(now);
        masterGain.gain.setValueAtTime(masterGain.gain.value, now);
        masterGain.gain.linearRampToValueAtTime(0, now + durationSec);
        osc.stop(now + durationSec + 0.05);
      } catch {}
    });
    hoverNodesRef.current = [];
  }, []);

  // Play the star's strongest lines simultaneously, sustained indefinitely until
  // fadeOutHover is called (on mouse-off). Mirrors playLine's per-voice graph —
  // oscillator bank by EP, width→Q filter, profile envelope, EW→reverb — but with
  // no scheduled stop, an N-voice loudness compensation, and hover-only controls
  // (gain scale, voice cap, chorus-style spread detune).
  const playHoverChord = useCallback(() => {
    const ctx = getCtx();
    const now = ctx.currentTime;

    const voices = star.lines
      .map((line, idx) => ({ line, idx }))
      .sort((a, b) => b.line.ew - a.line.ew)
      .slice(0, chordMaxVoices);
    const n = voices.length;
    if (n === 0) return;
    const loudnessComp = 1 / Math.sqrt(n);

    voices.forEach(({ line }, i) => {
      const freq = wlToFreq(line.wl);
      const gain = depthToGain(line.depth) * chordGainScale * loudnessComp;
      const filterQ = widthToQ(line.width);
      const env = profileToEnvelope(line.profile);
      const detune = rvToDetune(star.rv);
      const harmonic = epToHarmonics(line.ep);
      const reverbAmt = ewToReverb(line.ew);
      // Spread detune: fan voices apart by ±(chordSpreadDetune) for a chorus.
      const spread = (i / Math.max(n - 1, 1) - 0.5) * chordSpreadDetune * 2;

      // Per-voice ADSR up to sustain, then held (no release — fade is external).
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0, now);
      masterGain.gain.linearRampToValueAtTime(gain, now + env.a);
      masterGain.gain.linearRampToValueAtTime(gain * env.s, now + env.a + env.d);

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1200 + filterQ * 200;
      filter.Q.value = filterQ;

      // Algorithmic reverb: parallel delay lines with feedback + diffusion.
      const reverbBus = ctx.createGain();
      reverbBus.gain.value = reverbAmt * 0.45;
      const dryBus = ctx.createGain();
      dryBus.gain.value = 1.0 - reverbAmt * 0.2;

      const delays = [0.029, 0.037, 0.053, 0.067];
      const feedbacks = [0.6, 0.55, 0.5, 0.45].map(f => f + reverbAmt * 0.2);
      delays.forEach((t, di) => {
        const delay = ctx.createDelay(0.1);
        delay.delayTime.value = t;
        const fb = ctx.createGain();
        fb.gain.value = feedbacks[di];
        const lpf = ctx.createBiquadFilter();
        lpf.type = "lowpass";
        lpf.frequency.value = 2500 - reverbAmt * 800;
        reverbBus.connect(delay);
        delay.connect(lpf);
        lpf.connect(fb);
        fb.connect(delay);
        lpf.connect(ctx.destination);
      });

      // Oscillator bank by excitation potential (identical to playLine).
      const oscs = [];

      const osc1 = ctx.createOscillator();
      osc1.type = "sine";
      osc1.frequency.value = freq;
      osc1.detune.value = detune + spread;
      const g1 = ctx.createGain();
      g1.gain.value = 1.0 - harmonic * 0.3;
      osc1.connect(g1); g1.connect(filter);
      oscs.push(osc1);

      if (harmonic > 0.1) {
        const osc2 = ctx.createOscillator();
        osc2.type = "triangle";
        osc2.frequency.value = freq * 2;
        osc2.detune.value = detune * 0.5;
        const g2 = ctx.createGain();
        g2.gain.value = Math.min(harmonic * 0.5, 0.4);
        osc2.connect(g2); g2.connect(filter);
        oscs.push(osc2);
      }

      if (harmonic > 0.4) {
        const osc3 = ctx.createOscillator();
        osc3.type = "sawtooth";
        osc3.frequency.value = freq * 3;
        osc3.detune.value = detune * 0.3;
        const g3 = ctx.createGain();
        g3.gain.value = Math.min((harmonic - 0.4) * 0.4, 0.25);
        osc3.connect(g3); g3.connect(filter);
        oscs.push(osc3);
      }

      if (harmonic < 0.2 && freq > 200) {
        const oscSub = ctx.createOscillator();
        oscSub.type = "sine";
        oscSub.frequency.value = freq * 0.5;
        oscSub.detune.value = detune;
        const gSub = ctx.createGain();
        gSub.gain.value = 0.15;
        oscSub.connect(gSub); gSub.connect(filter);
        oscs.push(oscSub);
      }

      // Routing: filter → per-voice ADSR → dry + reverb → destination.
      filter.connect(masterGain);
      masterGain.connect(dryBus);
      masterGain.connect(reverbBus);
      dryBus.connect(ctx.destination);

      oscs.forEach(o => { o.start(now); hoverNodesRef.current.push({ osc: o, masterGain }); });
    });
  }, [star, chordMaxVoices, chordGainScale, chordSpreadDetune]);

  // Hover enter/leave → start/stop hover audio. "Enter" = activeIdx goes
  // null→set; "leave" = set→null. Moving between lines keeps activeIdx set, so a
  // chord rings continuously across the whole spectrum (it voices the star, not
  // the hovered line). Sequence mode plays the EW-sorted run, looping if asked.
  useEffect(() => {
    const prev = prevActiveIdxRef.current;
    prevActiveIdxRef.current = activeIdx;

    if (!hoverModeEnabled) return;

    const entering = activeIdx !== null && prev === null;
    const leaving  = activeIdx === null && prev !== null;

    if (entering) {
      fadeOutHover(0.05); // near-instant clear of any lingering hover audio
      if (hoverModeType === "chord") {
        playHoverChord();
      } else {
        playSequence({
          loop: seqRepeat === "loop",
          // Still hovering? prevActiveIdxRef tracks activeIdx; null means we left.
          shouldContinue: () => prevActiveIdxRef.current !== null,
        });
      }
    }

    if (leaving) {
      if (hoverModeType === "chord") {
        fadeOutHover(hoverFadeOut);
      } else {
        if (seqRef.current) clearTimeout(seqRef.current);
        setSeqPlaying(false);
        fadeOutHover(hoverFadeOut);
        stopCurrent(); // also stop the click-path nodes the sequence uses
      }
    }
  }, [activeIdx, hoverModeEnabled, hoverModeType, hoverFadeOut, seqRepeat, playHoverChord, playSequence, fadeOutHover, stopCurrent]);

  useEffect(() => {
    return () => {
      if (seqRef.current) clearTimeout(seqRef.current);
      if (hoverDebounceRef.current) clearTimeout(hoverDebounceRef.current);
      chordTimersRef.current.forEach(t => clearTimeout(t));
      hoverNodesRef.current.forEach(({ osc }) => { try { osc.stop(); } catch {} });
      hoverNodesRef.current = [];
      stopCurrent();
    };
  }, [stopCurrent]);

  // Currently active line info
  const info = activeIdx !== null ? star.lines[activeIdx] : null;

  // Play button reflects the active mode (sequential vs chord).
  const isChord = playMode === "chord";
  const playBusy = isChord ? chordPlaying : seqPlaying;

  // Chord summary for the drawer — pure math, cheap to recompute each render.
  const chordSummary = describeChord(harmonizeChord(star.lines, star.rv, harmonizeAmt), star.lines);

  // Location-picker derived list: region tab + free-text search.
  const locRegions = ["All", ...OBSERVING_LOCATIONS.map(g => g.region)];
  const q = locQuery.trim().toLowerCase();
  const filteredSites = ALL_SITES.filter(s =>
    (locRegion === "All" || s.region === locRegion) &&
    (!q || s.name.toLowerCase().includes(q) || s.country.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q))
  );

  return (
    <div style={{
      background: "#08080e", minHeight: "100vh", color: "#c0c4d0",
      fontFamily: "'IBM Plex Mono', 'Menlo', monospace", padding: "16px 20px", boxSizing: "border-box",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;600&family=Outfit:wght@200;400;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <div style={{ fontFamily: "Outfit", fontSize: 9, letterSpacing: 5, color: "rgba(140,160,200,0.4)", textTransform: "uppercase" }}>
          Stellar Absorption Sonification
        </div>
        <div style={{ fontFamily: "Outfit", fontSize: 22, fontWeight: 700, color: star.color, letterSpacing: 2, marginTop: 2, transition: "color 0.4s" }}>
          {star.name.toUpperCase()}
        </div>
        <div style={{ fontSize: 9, color: "rgba(160,170,190,0.4)", letterSpacing: 2, marginTop: 2 }}>
          {star.type} · {star.temp}K · RV {star.rv > 0 ? "+" : ""}{star.rv} km/s
        </div>
        {/* Observing-site + night-lock status (echoes the Phase-0 engine state) */}
        <div style={{ fontSize: 8, color: "rgba(120,150,200,0.45)", letterSpacing: 2, marginTop: 4 }}>
          ⊕ {location.name.toUpperCase()} · {fmtLat(location.lat)} {fmtLng(location.lng)}
          <span style={{ color: "rgba(110,180,140,0.5)" }}> · NIGHT LOCKED</span>
        </div>
      </div>

      {/* Star selector */}
      <div style={{ display: "flex", gap: 6, justifyContent: "center", alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        {STARS.map((s, i) => (
          <button key={s.name} onClick={() => { setStarIdx(i); setActiveIdx(null); stopCurrent(); setSeqPlaying(false); if(seqRef.current) clearTimeout(seqRef.current); }}
            style={{
              background: i === starIdx ? "rgba(255,255,255,0.06)" : "transparent",
              border: `1px solid ${i === starIdx ? s.color : "rgba(80,85,100,0.3)"}`,
              color: i === starIdx ? s.color : "rgba(140,145,160,0.5)",
              fontFamily: "inherit", fontSize: 9, padding: "5px 10px",
              cursor: "pointer", borderRadius: 2, letterSpacing: 1, transition: "all 0.2s",
            }}>
            {s.name} <span style={{ opacity: 0.4 }}>{s.type}</span>
          </button>
        ))}

        {/* Location picker trigger */}
        <button onClick={() => setLocOpen(o => !o)}
          style={{
            background: locOpen ? "rgba(120,150,200,0.12)" : "transparent",
            border: `1px solid ${locOpen ? "rgba(120,150,200,0.6)" : "rgba(80,85,100,0.3)"}`,
            color: locOpen ? "rgba(170,195,240,0.9)" : "rgba(140,145,160,0.6)",
            fontFamily: "inherit", fontSize: 9, padding: "5px 10px",
            cursor: "pointer", borderRadius: 2, letterSpacing: 1, transition: "all 0.2s",
            marginLeft: 6,
          }}>
          ⊕ {location.name.toUpperCase()} <span style={{ opacity: 0.5 }}>{locOpen ? "▲" : "▼"}</span>
        </button>
      </div>

      {/* Location picker drawer */}
      {locOpen && (
        <div style={{
          maxWidth: 720, margin: "0 auto 14px", border: "1px solid rgba(120,150,200,0.25)",
          borderRadius: 3, background: "rgba(12,14,24,0.96)", overflow: "hidden",
        }}>
          {/* Search + region tabs */}
          <div style={{ padding: "10px 12px", borderBottom: "1px solid rgba(120,130,160,0.12)" }}>
            <input
              value={locQuery}
              onChange={e => setLocQuery(e.target.value)}
              placeholder="Search site, country, or description…"
              style={{
                width: "100%", boxSizing: "border-box", background: "rgba(8,9,16,0.8)",
                border: "1px solid rgba(80,85,100,0.3)", borderRadius: 2, color: "#c0c4d0",
                fontFamily: "inherit", fontSize: 11, padding: "6px 8px", outline: "none", marginBottom: 8,
              }}
            />
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {locRegions.map(r => (
                <button key={r} onClick={() => setLocRegion(r)}
                  style={{
                    background: r === locRegion ? "rgba(120,150,200,0.18)" : "transparent",
                    border: `1px solid ${r === locRegion ? "rgba(120,150,200,0.5)" : "rgba(80,85,100,0.25)"}`,
                    color: r === locRegion ? "rgba(180,200,240,0.9)" : "rgba(140,145,160,0.5)",
                    fontFamily: "inherit", fontSize: 8, padding: "3px 8px", letterSpacing: 1,
                    cursor: "pointer", borderRadius: 2, transition: "all 0.2s",
                  }}>
                  {r.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Site list */}
          <div style={{ maxHeight: 280, overflowY: "auto" }}>
            {filteredSites.length === 0 && (
              <div style={{ padding: "16px 12px", fontSize: 10, color: "rgba(140,145,160,0.4)", textAlign: "center" }}>
                No sites match “{locQuery}”.
              </div>
            )}
            {filteredSites.map(s => {
              const active = s.name === location.name;
              return (
                <button key={s.name} onClick={() => { setLocation(s); setLocOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                    background: active ? "rgba(120,150,200,0.10)" : "transparent",
                    border: "none", borderBottom: "1px solid rgba(120,130,160,0.06)",
                    color: "inherit", fontFamily: "inherit", padding: "8px 12px",
                    cursor: "pointer", transition: "background 0.15s",
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
                  <span style={{ width: 12, color: "rgba(120,180,230,0.9)", fontSize: 10, flexShrink: 0 }}>
                    {active ? "◉" : ""}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 11, color: active ? "rgba(180,205,245,0.95)" : "rgba(190,195,210,0.8)" }}>
                      {s.name}
                    </span>
                    <span style={{ fontSize: 9, color: "rgba(140,145,160,0.45)" }}> · {s.country}</span>
                    <span style={{ display: "block", fontSize: 9, color: "rgba(140,145,160,0.4)", marginTop: 1 }}>
                      {s.desc}
                    </span>
                  </span>
                  <span style={{ fontSize: 9, color: "rgba(120,150,200,0.5)", flexShrink: 0, textAlign: "right" }}>
                    {fmtLat(s.lat)}<br />{fmtLng(s.lng)}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Footer — current selection */}
          <div style={{
            padding: "7px 12px", borderTop: "1px solid rgba(120,130,160,0.12)",
            fontSize: 9, color: "rgba(140,150,180,0.55)", letterSpacing: 1,
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span>⊕ {location.name.toUpperCase()} · {fmtLat(location.lat)} {fmtLng(location.lng)}</span>
            <span style={{ color: "rgba(110,180,140,0.5)" }}>ATMOSPHERE OFF · NIGHT LOCKED</span>
          </div>
        </div>
      )}

      {/* Spectrum */}
      <div style={{ border: "1px solid rgba(120,130,160,0.1)", borderRadius: 2, padding: 6, background: "rgba(10,10,18,0.5)", marginBottom: 12, overflowX: "auto" }}>
        <SpectrumCanvas star={star} activeIdx={activeIdx} playingIdx={playingIdx}
          chordActiveIndices={chordActiveIndices}
          onHover={handleHover} onClick={(idx) => playLine(idx, seqOctaveRef.current)} width={720} height={260} />
      </div>

      {/* Controls row */}
      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "stretch" }}>
        <button onClick={isChord ? playChord : playSequence} disabled={playBusy}
          style={{
            background: playBusy ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)",
            border: `1px solid ${playBusy ? star.color : "rgba(120,130,160,0.25)"}`,
            color: star.color, fontFamily: "inherit", fontSize: 10, padding: "8px 16px",
            cursor: playBusy ? "wait" : "pointer", letterSpacing: 2, borderRadius: 2, transition: "all 0.3s",
          }}>
          {isChord
            ? (chordPlaying ? "◆ RESONATING..." : "◆ PLAY CHORD")
            : (seqPlaying ? "▶ TRANSMITTING..." : "▶ PLAY ALL LINES")}
        </button>

        {/* Info panel */}
        <div style={{
          flex: 1, minWidth: 200, background: "rgba(15,15,25,0.5)", border: "1px solid rgba(80,85,100,0.15)",
          borderRadius: 2, padding: "6px 10px", fontSize: 10, display: "flex", alignItems: "center",
        }}>
          {info ? (
            <span>
              <span style={{ color: star.color }}>{info.el}</span>
              <span style={{ color: "rgba(140,145,160,0.4)" }}> · </span>
              <span style={{ color: "rgba(180,185,200,0.7)" }}>{info.wl} nm</span>
              <span style={{ color: "rgba(140,145,160,0.4)" }}> · </span>
              <span>{info.profile}</span>
              <span style={{ color: "rgba(140,145,160,0.4)" }}> · </span>
              <span>EW {info.ew} mÅ</span>
              <span style={{ color: "rgba(140,145,160,0.4)" }}> · </span>
              <span>EP {info.ep} eV</span>
              <span style={{ color: "rgba(140,145,160,0.4)" }}> · </span>
              <span>w {info.width} Å</span>
            </span>
          ) : (
            <span style={{ color: "rgba(100,105,120,0.4)", fontStyle: "italic" }}>
              Hover lines to inspect · Click to sonify
            </span>
          )}
        </div>
      </div>

      {/* Line table (sorted by EW descending = play order) */}
      <div style={{ border: "1px solid rgba(120,130,160,0.08)", borderRadius: 2, overflow: "hidden", fontSize: 9 }}>
        <div style={{
          display: "grid", gridTemplateColumns: "28px 70px 55px 45px 50px 55px 50px 60px 50px",
          background: "rgba(255,255,255,0.02)", padding: "5px 8px",
          color: "rgba(140,150,170,0.4)", letterSpacing: 1, textTransform: "uppercase",
          borderBottom: "1px solid rgba(120,130,160,0.08)",
        }}>
          <div>#</div><div>Element</div><div>λ nm</div><div>Depth</div><div>Width</div><div>Profile</div><div>EW</div><div>EP eV</div><div>→ Hz</div>
        </div>
        {star.lines
          .map((line, origIdx) => ({ line, origIdx }))
          .sort((a, b) => b.line.ew - a.line.ew)
          .map(({ line, origIdx }, rank) => {
          const isP = playingIdx === origIdx;
          const [lr, lg, lb] = wlToRGB(line.wl);
          return (
            <div key={origIdx} onClick={() => playLine(origIdx, seqOctaveRef.current)}
              style={{
                display: "grid", gridTemplateColumns: "28px 70px 55px 45px 50px 55px 50px 60px 50px",
                padding: "4px 8px", cursor: "pointer",
                background: isP ? "rgba(255,220,80,0.05)" : "transparent",
                borderBottom: "1px solid rgba(60,65,80,0.1)", transition: "background 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; handleHover(origIdx); }}
              onMouseLeave={e => { e.currentTarget.style.background = isP ? "rgba(255,220,80,0.05)" : "transparent"; handleHover(null); }}
            >
              <div style={{ color: isP ? "#ffdd55" : star.color, opacity: 0.6 }}>{rank + 1}</div>
              <div style={{ color: isP ? "#ffdd55" : `rgb(${lr},${lg},${lb})` }}>{line.el}</div>
              <div style={{ color: "rgba(180,185,200,0.7)" }}>{line.wl}</div>
              <div style={{ color: "rgba(180,185,200,0.6)" }}>{line.depth.toFixed(2)}</div>
              <div style={{ color: "rgba(180,185,200,0.5)" }}>{line.width.toFixed(2)}</div>
              <div style={{ color: "rgba(160,165,180,0.4)" }}>{line.profile.slice(0, 5)}</div>
              <div style={{ color: "rgba(180,185,200,0.5)" }}>{line.ew}</div>
              <div style={{ color: "rgba(180,185,200,0.5)" }}>{line.ep.toFixed(2)}</div>
              <div style={{ color: star.color, opacity: 0.7 }}>{wlToFreq(line.wl).toFixed(0)}</div>
            </div>
          );
        })}
      </div>

      {/* Parameter mapping panel (visible when a line is active).
          Placed BELOW the table so mounting it never reflows a hover target
          above it — otherwise the table jumps under the cursor and the panel
          flickers in a layout-feedback loop. */}
      {info && (
        <div style={{
          border: "1px solid rgba(120,130,160,0.1)", borderRadius: 2, padding: "10px 14px",
          background: "rgba(12,12,20,0.5)", marginTop: 12,
        }}>
          <div style={{ fontSize: 8, letterSpacing: 3, color: "rgba(140,150,170,0.4)", marginBottom: 8, textTransform: "uppercase" }}>
            Sonification Parameter Mapping
          </div>
          <ParamBar label="λ → Pitch" value={wlToFreq(info.wl)} max={1100} unit=" Hz" color="rgba(130,170,255,0.6)" />
          <ParamBar label="Depth → Gain" value={depthToGain(info.depth)} max={0.25} unit="" color="rgba(255,200,100,0.6)" />
          <ParamBar label="Width → Filter Q" value={widthToQ(info.width)} max={18} unit="" color="rgba(100,220,180,0.6)" />
          <ParamBar label="Profile → Env" value={info.profile} max={1} unit="" color="rgba(200,140,255,0.6)" />
          <ParamBar label="EW → Reverb" value={ewToReverb(info.ew)} max={1} unit="" color="rgba(255,140,140,0.6)" />
          <ParamBar label="RV → Detune" value={rvToDetune(star.rv)} max={6} unit=" Hz" color="rgba(140,200,255,0.6)" />
          <ParamBar label="EP → Harmonics" value={epToHarmonics(info.ep)} max={1} unit="" color="rgba(255,180,220,0.6)" />
        </div>
      )}

      {/* Star description */}
      <div style={{ marginTop: 10, fontSize: 9, color: "rgba(120,125,140,0.4)", textAlign: "center", lineHeight: 1.5 }}>
        {star.desc} · 7-parameter sonification: λ→pitch, depth→gain, width→filter, profile→envelope, EW→reverb+order, RV→detune, EP→harmonics
      </div>

      {/* ── Harmonics drawer: handle tab ─────────────────────────────── */}
      <div
        onClick={() => setPanelOpen(o => !o)}
        onMouseEnter={() => setTabHover(true)}
        onMouseLeave={() => setTabHover(false)}
        style={{
          position: "fixed", right: 0, top: "50%",
          transform: `translateY(-50%) translateX(${panelOpen ? -220 : 0}px)`,
          width: 28, height: 120, padding: "8px 0", boxSizing: "border-box",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
          background: "rgba(15,15,25,0.7)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
          borderTop: `1px solid ${tabHover ? "rgba(120,130,160,0.3)" : "rgba(120,130,160,0.15)"}`,
          borderBottom: `1px solid ${tabHover ? "rgba(120,130,160,0.3)" : "rgba(120,130,160,0.15)"}`,
          borderLeft: `1px solid ${tabHover ? "rgba(120,130,160,0.3)" : "rgba(120,130,160,0.15)"}`,
          borderRight: "none",
          borderRadius: "3px 0 0 3px",
          cursor: "pointer", zIndex: 20,
          transition: "transform 0.3s ease, border-color 0.2s",
        }}>
        <div style={{ fontSize: 9, color: star.color, transition: "color 0.4s" }}>◆</div>
        <div style={{
          writingMode: "vertical-rl", textOrientation: "mixed",
          fontSize: 9, letterSpacing: 4, textTransform: "uppercase",
          color: tabHover ? "rgba(180,195,225,0.9)" : "rgba(140,160,200,0.75)",
          transition: "color 0.2s",
        }}>
          Harmonics
        </div>
      </div>

      {/* ── Harmonics drawer: sliding panel ──────────────────────────── */}
      <div style={{
        position: "fixed", right: 0, top: "50%",
        transform: `translateY(-50%) translateX(${panelOpen ? 0 : 100}%)`,
        width: 220, boxSizing: "border-box", maxHeight: "80vh", overflowY: "auto",
        background: "rgba(15,15,25,0.5)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
        border: "1px solid rgba(120,130,160,0.1)", borderRight: "none", borderRadius: "3px 0 0 3px",
        padding: "16px 14px", zIndex: 19,
        transition: "transform 0.3s ease",
        fontFamily: "'IBM Plex Mono', 'Menlo', monospace",
      }}>
        {/* ── HOVER ──────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid rgba(120,130,160,0.1)" }}>
          <div style={{ fontSize: 8, letterSpacing: 3, textTransform: "uppercase", color: "rgba(140,150,170,0.4)", marginBottom: 8 }}>
            Hover
          </div>

          {/* Hover mode on/off */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: hoverModeEnabled ? 12 : 0 }}>
            <div style={{ flex: 1, fontSize: 9, color: "rgba(160,165,180,0.6)" }}>Hover mode</div>
            <div style={{ display: "flex", gap: 6 }}>
              {[["ON", true], ["OFF", false]].map(([label, val]) => {
                const active = hoverModeEnabled === val;
                return (
                  <button key={label} onClick={() => setHoverModeEnabled(val)}
                    style={{
                      background: active ? "rgba(255,255,255,0.06)" : "transparent",
                      border: `1px solid ${active ? star.color : "rgba(80,85,100,0.3)"}`,
                      color: active ? star.color : "rgba(140,145,160,0.5)",
                      fontFamily: "inherit", fontSize: 9, letterSpacing: 1, padding: "5px 10px",
                      cursor: "pointer", borderRadius: 2, textTransform: "uppercase", transition: "all 0.2s",
                    }}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Trigger (chord | sequence) */}
          {hoverModeEnabled && (
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {["chord", "sequence"].map(t => {
                const active = hoverModeType === t;
                return (
                  <button key={t} onClick={() => setHoverModeType(t)}
                    style={{
                      flex: 1,
                      background: active ? "rgba(255,255,255,0.06)" : "transparent",
                      border: `1px solid ${active ? star.color : "rgba(80,85,100,0.3)"}`,
                      color: active ? star.color : "rgba(140,145,160,0.5)",
                      fontFamily: "inherit", fontSize: 9, letterSpacing: 1, padding: "6px 0",
                      cursor: "pointer", borderRadius: 2, textTransform: "uppercase", transition: "all 0.2s",
                    }}>
                    {t}
                  </button>
                );
              })}
            </div>
          )}

          {/* Fade out */}
          {hoverModeEnabled && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 8, letterSpacing: 3, textTransform: "uppercase", color: "rgba(140,150,170,0.4)", marginBottom: 8 }}>
                Fade out (s)
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ position: "relative", flex: 1, height: 12 }}>
                  <div style={{ position: "absolute", top: 4, left: 0, right: 0, height: 4, background: "rgba(40,42,55,0.8)", borderRadius: 2 }} />
                  <div style={{ position: "absolute", top: 4, left: 0, height: 4, width: `${((hoverFadeOut - 0.2) / 2.8) * 100}%`, background: star.color, opacity: 0.4, borderRadius: 2, transition: "background 0.4s" }} />
                  <div style={{ position: "absolute", top: 0, left: `${((hoverFadeOut - 0.2) / 2.8) * 100}%`, transform: "translateX(-50%)", width: 12, height: 12, borderRadius: "50%", background: "#0c0c14", border: `1px solid ${star.color}`, transition: "border-color 0.4s", pointerEvents: "none" }} />
                  <input type="range" min={0.2} max={3.0} step={0.1} value={hoverFadeOut}
                    onChange={e => setHoverFadeOut(parseFloat(e.target.value))}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 12, margin: 0, opacity: 0, cursor: "pointer" }} />
                </div>
                <div style={{ width: 34, textAlign: "right", fontSize: 9, color: "rgba(180,185,200,0.7)" }}>
                  {hoverFadeOut.toFixed(1)}
                </div>
              </div>
            </div>
          )}

          {/* Chord settings */}
          {hoverModeEnabled && hoverModeType === "chord" && (
            <div>
              <div style={{ fontSize: 7, letterSpacing: 2, textTransform: "uppercase", color: "rgba(140,150,170,0.3)", margin: "14px 0 8px" }}>
                chord settings
              </div>

              {/* Gain scale */}
              <div style={{ fontSize: 8, letterSpacing: 3, textTransform: "uppercase", color: "rgba(140,150,170,0.4)", marginBottom: 8 }}>
                Gain scale
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ position: "relative", flex: 1, height: 12 }}>
                  <div style={{ position: "absolute", top: 4, left: 0, right: 0, height: 4, background: "rgba(40,42,55,0.8)", borderRadius: 2 }} />
                  <div style={{ position: "absolute", top: 4, left: 0, height: 4, width: `${((chordGainScale - 0.2) / 0.8) * 100}%`, background: star.color, opacity: 0.4, borderRadius: 2, transition: "background 0.4s" }} />
                  <div style={{ position: "absolute", top: 0, left: `${((chordGainScale - 0.2) / 0.8) * 100}%`, transform: "translateX(-50%)", width: 12, height: 12, borderRadius: "50%", background: "#0c0c14", border: `1px solid ${star.color}`, transition: "border-color 0.4s", pointerEvents: "none" }} />
                  <input type="range" min={0.2} max={1.0} step={0.05} value={chordGainScale}
                    onChange={e => setChordGainScale(parseFloat(e.target.value))}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 12, margin: 0, opacity: 0, cursor: "pointer" }} />
                </div>
                <div style={{ width: 34, textAlign: "right", fontSize: 9, color: "rgba(180,185,200,0.7)" }}>
                  {chordGainScale.toFixed(2)}
                </div>
              </div>

              {/* Max voices */}
              <div style={{ fontSize: 8, letterSpacing: 3, textTransform: "uppercase", color: "rgba(140,150,170,0.4)", margin: "12px 0 8px" }}>
                Max voices
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ position: "relative", flex: 1, height: 12 }}>
                  <div style={{ position: "absolute", top: 4, left: 0, right: 0, height: 4, background: "rgba(40,42,55,0.8)", borderRadius: 2 }} />
                  <div style={{ position: "absolute", top: 4, left: 0, height: 4, width: `${((chordMaxVoices - 1) / 5) * 100}%`, background: star.color, opacity: 0.4, borderRadius: 2, transition: "background 0.4s" }} />
                  <div style={{ position: "absolute", top: 0, left: `${((chordMaxVoices - 1) / 5) * 100}%`, transform: "translateX(-50%)", width: 12, height: 12, borderRadius: "50%", background: "#0c0c14", border: `1px solid ${star.color}`, transition: "border-color 0.4s", pointerEvents: "none" }} />
                  <input type="range" min={1} max={6} step={1} value={chordMaxVoices}
                    onChange={e => setChordMaxVoices(parseInt(e.target.value, 10))}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 12, margin: 0, opacity: 0, cursor: "pointer" }} />
                </div>
                <div style={{ width: 34, textAlign: "right", fontSize: 9, color: "rgba(180,185,200,0.7)" }}>
                  {chordMaxVoices}
                </div>
              </div>

              {/* Spread detune */}
              <div style={{ fontSize: 8, letterSpacing: 3, textTransform: "uppercase", color: "rgba(140,150,170,0.4)", margin: "12px 0 8px" }}>
                Spread detune (Hz)
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ position: "relative", flex: 1, height: 12 }}>
                  <div style={{ position: "absolute", top: 4, left: 0, right: 0, height: 4, background: "rgba(40,42,55,0.8)", borderRadius: 2 }} />
                  <div style={{ position: "absolute", top: 4, left: 0, height: 4, width: `${(chordSpreadDetune / 8) * 100}%`, background: star.color, opacity: 0.4, borderRadius: 2, transition: "background 0.4s" }} />
                  <div style={{ position: "absolute", top: 0, left: `${(chordSpreadDetune / 8) * 100}%`, transform: "translateX(-50%)", width: 12, height: 12, borderRadius: "50%", background: "#0c0c14", border: `1px solid ${star.color}`, transition: "border-color 0.4s", pointerEvents: "none" }} />
                  <input type="range" min={0} max={8} step={0.5} value={chordSpreadDetune}
                    onChange={e => setChordSpreadDetune(parseFloat(e.target.value))}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 12, margin: 0, opacity: 0, cursor: "pointer" }} />
                </div>
                <div style={{ width: 34, textAlign: "right", fontSize: 9, color: "rgba(180,185,200,0.7)" }}>
                  {chordSpreadDetune.toFixed(1)}
                </div>
              </div>
            </div>
          )}

          {/* Sequence settings */}
          {hoverModeEnabled && hoverModeType === "sequence" && (
            <div>
              <div style={{ fontSize: 7, letterSpacing: 2, textTransform: "uppercase", color: "rgba(140,150,170,0.3)", margin: "14px 0 8px" }}>
                sequence settings
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, fontSize: 9, color: "rgba(160,165,180,0.6)" }}>Repeat</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {["once", "loop"].map(r => {
                    const active = seqRepeat === r;
                    return (
                      <button key={r} onClick={() => setSeqRepeat(r)}
                        style={{
                          background: active ? "rgba(255,255,255,0.06)" : "transparent",
                          border: `1px solid ${active ? star.color : "rgba(80,85,100,0.3)"}`,
                          color: active ? star.color : "rgba(140,145,160,0.5)",
                          fontFamily: "inherit", fontSize: 9, letterSpacing: 1, padding: "5px 10px",
                          cursor: "pointer", borderRadius: 2, textTransform: "uppercase", transition: "all 0.2s",
                        }}>
                        {r}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Mode toggle */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {["sequential", "chord"].map(mode => {
            const active = playMode === mode;
            return (
              <button key={mode} onClick={() => setPlayMode(mode)}
                style={{
                  flex: 1,
                  background: active ? "rgba(255,255,255,0.06)" : "transparent",
                  border: `1px solid ${active ? star.color : "rgba(80,85,100,0.3)"}`,
                  color: active ? star.color : "rgba(140,145,160,0.5)",
                  fontFamily: "inherit", fontSize: 9, letterSpacing: 1, padding: "6px 0",
                  cursor: "pointer", borderRadius: 2, textTransform: "uppercase", transition: "all 0.2s",
                }}>
                {mode}
              </button>
            );
          })}
        </div>

        {/* Sequential controls (sequential mode only) */}
        {!isChord && (
          <div style={{ marginBottom: 14 }}>
            {/* Octave shift */}
            <div style={{ fontSize: 8, letterSpacing: 3, textTransform: "uppercase", color: "rgba(140,150,170,0.4)", marginBottom: 8 }}>
              Octave
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ position: "relative", flex: 1, height: 12 }}>
                <div style={{ position: "absolute", top: 4, left: 0, right: 0, height: 4, background: "rgba(40,42,55,0.8)", borderRadius: 2 }} />
                <div style={{ position: "absolute", top: 4, left: 0, height: 4, width: `${((seqOctave + 2) / 4) * 100}%`, background: star.color, opacity: 0.4, borderRadius: 2, transition: "background 0.4s" }} />
                <div style={{ position: "absolute", top: 0, left: `${((seqOctave + 2) / 4) * 100}%`, transform: "translateX(-50%)", width: 12, height: 12, borderRadius: "50%", background: "#0c0c14", border: `1px solid ${star.color}`, transition: "border-color 0.4s", pointerEvents: "none" }} />
                <input type="range" min={-2} max={2} step={1} value={seqOctave}
                  onChange={e => setSeqOctave(parseInt(e.target.value, 10))}
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 12, margin: 0, opacity: 0, cursor: "pointer" }} />
              </div>
              <div style={{ width: 34, textAlign: "right", fontSize: 9, color: "rgba(180,185,200,0.7)" }}>
                {seqOctave > 0 ? `+${seqOctave}` : `${seqOctave}`}
              </div>
            </div>

            {/* Speed */}
            <div style={{ fontSize: 8, letterSpacing: 3, textTransform: "uppercase", color: "rgba(140,150,170,0.4)", margin: "12px 0 8px" }}>
              Speed
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ position: "relative", flex: 1, height: 12 }}>
                <div style={{ position: "absolute", top: 4, left: 0, right: 0, height: 4, background: "rgba(40,42,55,0.8)", borderRadius: 2 }} />
                <div style={{ position: "absolute", top: 4, left: 0, height: 4, width: `${((seqSpeed - 400) / 2000) * 100}%`, background: star.color, opacity: 0.4, borderRadius: 2, transition: "background 0.4s" }} />
                <div style={{ position: "absolute", top: 0, left: `${((seqSpeed - 400) / 2000) * 100}%`, transform: "translateX(-50%)", width: 12, height: 12, borderRadius: "50%", background: "#0c0c14", border: `1px solid ${star.color}`, transition: "border-color 0.4s", pointerEvents: "none" }} />
                <input type="range" min={400} max={2400} step={40} value={seqSpeed}
                  onChange={e => setSeqSpeed(parseInt(e.target.value, 10))}
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 12, margin: 0, opacity: 0, cursor: "pointer" }} />
              </div>
              <div style={{ width: 40, textAlign: "right", fontSize: 9, color: "rgba(180,185,200,0.7)" }}>
                {seqSpeed >= 2400 ? "SLOW" : seqSpeed <= 400 ? "FAST" : `${seqSpeed} ms`}
              </div>
            </div>
          </div>
        )}

        {/* Harmonize slider (chord mode only) */}
        {isChord && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 8, letterSpacing: 3, textTransform: "uppercase", color: "rgba(140,150,170,0.4)", marginBottom: 8 }}>
              Harmonize
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* Custom-drawn track + native range overlaid for interaction */}
              <div style={{ position: "relative", flex: 1, height: 12 }}>
                <div style={{
                  position: "absolute", top: 4, left: 0, right: 0, height: 4,
                  background: "rgba(40,42,55,0.8)", borderRadius: 2,
                }} />
                <div style={{
                  position: "absolute", top: 4, left: 0, height: 4, width: `${harmonizeAmt * 100}%`,
                  background: star.color, opacity: 0.4, borderRadius: 2, transition: "background 0.4s",
                }} />
                <div style={{
                  position: "absolute", top: 0, left: `${harmonizeAmt * 100}%`, transform: "translateX(-50%)",
                  width: 12, height: 12, borderRadius: "50%",
                  background: "#0c0c14", border: `1px solid ${star.color}`,
                  transition: "border-color 0.4s", pointerEvents: "none",
                }} />
                <input type="range" min={0} max={1} step={0.01} value={harmonizeAmt}
                  onChange={e => setHarmonizeAmt(parseFloat(e.target.value))}
                  style={{
                    position: "absolute", top: 0, left: 0, width: "100%", height: 12,
                    margin: 0, opacity: 0, cursor: "pointer",
                  }} />
              </div>
              <div style={{ width: 34, textAlign: "right", fontSize: 9, color: "rgba(180,185,200,0.7)" }}>
                {Math.round(harmonizeAmt * 100)}%
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
              <span style={{ fontSize: 8, color: "rgba(140,150,170,0.4)" }}>DATA</span>
              <span style={{ fontSize: 8, color: "rgba(140,150,170,0.4)" }}>HARMONY</span>
            </div>
          </div>
        )}

        {/* Chord info (chord mode only) */}
        {isChord && (
          <div>
            <div style={{ fontSize: 8, letterSpacing: 3, textTransform: "uppercase", color: "rgba(140,150,170,0.4)", marginBottom: 6 }}>
              Chord
            </div>
            <div style={{ fontSize: 10, marginBottom: 2 }}>
              <span style={{ color: "rgba(140,150,170,0.5)" }}>root: </span>
              <span style={{ color: star.color, transition: "color 0.4s" }}>{chordSummary.root}</span>
            </div>
            <div style={{ fontSize: 10, color: "rgba(180,185,200,0.7)", marginBottom: 8 }}>
              {chordSummary.quality}
            </div>
            <div>
              {chordSummary.voices.map((v, i) => {
                const [r, g, b] = wlToRGB(star.lines[i].wl);
                return (
                  <div key={i} style={{
                    display: "grid", gridTemplateColumns: "1fr 38px 32px", gap: 4, alignItems: "center",
                    fontSize: 9, padding: "2px 0 2px 6px",
                    borderLeft: `2px solid ${v.isRoot ? star.color : "transparent"}`,
                  }}>
                    <span style={{ color: `rgb(${r},${g},${b})` }}>{v.element}</span>
                    <span style={{ color: "rgba(150,160,180,0.5)" }}>{v.interval}</span>
                    <span style={{ color: "rgba(120,125,140,0.45)", textAlign: "right" }}>{v.pull}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
