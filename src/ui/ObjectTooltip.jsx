import { useLayoutEffect, useRef, useState } from "react";
import { tempToHex } from "../data/spectral-templates.js";

// Hover tooltip — a small readout pinned to whatever the cursor is over in the
// sky. It is deliberately independent of hover *audio*: pointing at something
// always tells you what it is, whether or not the star is singing.
//
// The payload comes from StellariumBridge.extractObjectInfo() and works for any
// object the engine's picker returns — star, cluster, galaxy, planet, moon.
// Every field is optional; rows for missing data are simply not rendered.

/** Ballesteros' B–V → effective temperature, so a star's name can wear its colour. */
function bvToTemp(bv) {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}

function fmtMag(m) {
  if (m == null || !Number.isFinite(m)) return null;
  // Typographic minus, so a negative magnitude lines up with the ALT row.
  return m < 0 ? `−${Math.abs(m).toFixed(2)}` : m.toFixed(2);
}

function fmtDistance(info) {
  const { distanceAU, distanceLy } = info;
  if (distanceLy != null && distanceLy >= 0.01) {
    return distanceLy >= 100 ? `${Math.round(distanceLy)} ly` : `${distanceLy.toFixed(1)} ly`;
  }
  if (distanceAU != null && Number.isFinite(distanceAU)) {
    return distanceAU >= 0.01 ? `${distanceAU.toFixed(2)} AU` : `${Math.round(distanceAU * 149597870.7).toLocaleString()} km`;
  }
  return null;
}

function fmtSize(arcmin) {
  if (arcmin == null || !Number.isFinite(arcmin) || arcmin <= 0) return null;
  return arcmin >= 60 ? `${(arcmin / 60).toFixed(1)}\u00b0` : `${arcmin.toFixed(0)}\u2032`;
}

function fmtAlt(deg) {
  if (deg == null || !Number.isFinite(deg)) return null;
  return `${deg >= 0 ? "+" : "\u2212"}${Math.abs(deg).toFixed(1)}\u00b0`;
}

/** "05h 18.7m  +46\u00b0 01\u2032" — classic equatorial readout, of date. */
function fmtRaDec(raHours, decDeg) {
  if (raHours == null || decDeg == null) return null;
  const h = Math.floor(raHours);
  const m = (raHours - h) * 60;
  const sign = decDeg >= 0 ? "+" : "\u2212";
  const ad = Math.abs(decDeg);
  const d = Math.floor(ad);
  const am = Math.round((ad - d) * 60);
  return `${String(h).padStart(2, "0")}h ${m.toFixed(1)}m  ${sign}${String(d).padStart(2, "0")}\u00b0 ${String(am).padStart(2, "0")}\u2032`;
}

const OFFSET = 20; // px gap between the object and the card

export default function ObjectTooltip({ info, x, y, singing }) {
  const ref = useRef(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  // Measure after render so the card can flip/clamp instead of falling off the
  // viewport edge. Re-measured whenever the content changes.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setBox({ w: el.offsetWidth, h: el.offsetHeight });
  }, [info]);

  if (!info || x == null || y == null) return null;

  const flipX = x + OFFSET + box.w > window.innerWidth - 8;
  const left = flipX ? x - OFFSET - box.w : x + OFFSET;
  const top = Math.max(8, Math.min(y - box.h / 2, window.innerHeight - box.h - 8));

  const accent = info.bv != null ? tempToHex(bvToTemp(info.bv)) : "#cfe3ff";

  const stats = [
    ["mag", fmtMag(info.magnitude)],
    ["dist", fmtDistance(info)],
    ["size", fmtSize(info.sizeArcmin)],
    ["spec", info.spectralType],
    ["B\u2013V", info.bv != null ? info.bv.toFixed(2) : null],
    ["alt", fmtAlt(info.altDeg)],
  ].filter(([, v]) => v != null);

  const radec = fmtRaDec(info.raHours, info.decDeg);
  const belowHorizon = info.altDeg != null && info.altDeg < 0;

  return (
    <div ref={ref} style={{ ...styles.card, left, top }}>
      <div style={styles.headRow}>
        <span style={{ ...styles.name, color: accent, textShadow: `0 0 10px ${accent}55` }}>
          {info.name}
        </span>
        {singing && <span style={{ ...styles.note, color: accent }}>{"♪"}</span>}
      </div>

      {info.alts?.length > 0 && (
        <div style={styles.alts}>{info.alts.join("  \u00b7  ")}</div>
      )}

      {(info.typeLabel || stats.length > 0) && <div style={styles.rule} />}

      {info.typeLabel && <div style={styles.type}>{info.typeLabel}</div>}

      {stats.length > 0 && (
        <div style={styles.grid}>
          {stats.map(([label, value]) => (
            <div key={label} style={styles.stat}>
              <span style={styles.statLabel}>{label}</span>
              <span style={styles.statValue}>{value}</span>
            </div>
          ))}
        </div>
      )}

      {radec && (
        <div style={styles.radec}>
          {radec}
          {belowHorizon && <span style={styles.below}>  below horizon</span>}
        </div>
      )}
    </div>
  );
}

const styles = {
  card: {
    position: "fixed",
    // left/top set inline from the object's screen position (CSS px).
    minWidth: 148,
    maxWidth: 260,
    // Kept translucent on purpose: when a star is singing, the ring animation
    // radiates out from under the card and should still read through it.
    background: "rgba(8,9,16,0.68)",
    border: "1px solid rgba(120,140,180,0.2)",
    borderRadius: 6,
    backdropFilter: "blur(6px) saturate(1.1)",
    padding: "8px 10px 9px",
    fontFamily: "'IBM Plex Mono', 'Menlo', monospace",
    pointerEvents: "none", // never steal the hover from the canvas
    zIndex: 20,
    boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
  },
  headRow: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  name: { fontSize: 13, letterSpacing: 1.5, fontWeight: 700, whiteSpace: "nowrap" },
  note: { fontSize: 12, opacity: 0.9 },
  alts: { fontSize: 10, letterSpacing: 0.6, color: "rgba(190,197,215,0.8)", marginTop: 2 },
  rule: { height: 1, background: "rgba(120,140,180,0.18)", margin: "7px 0 6px" },
  type: {
    fontSize: 9, letterSpacing: 1.4, textTransform: "uppercase",
    color: "rgba(175,197,235,0.85)", marginBottom: 5,
  },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 12, rowGap: 3 },
  stat: { display: "flex", justifyContent: "space-between", gap: 6 },
  statLabel: {
    fontSize: 9, letterSpacing: 1, textTransform: "uppercase",
    color: "rgba(185,193,213,0.75)", alignSelf: "center",
  },
  statValue: { fontSize: 11, color: "rgba(225,232,248,0.97)" },
  radec: {
    marginTop: 6, fontSize: 9.5, letterSpacing: 0.5,
    color: "rgba(180,187,207,0.7)", whiteSpace: "nowrap",
  },
  below: { color: "rgba(240,170,170,0.85)" },
};
