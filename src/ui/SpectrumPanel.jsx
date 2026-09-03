import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SPEC_MIN, SPEC_MAX } from "../audio/mappings.js";
import { wlToRGB } from "../audio/color.js";

// Spectrum visualization (Phase 3) — ported from the prototype's SpectrumCanvas.
// Renders the star's blackbody continuum with absorption dips, a visible-color
// strip, and labelled line markers. Hovering a line highlights it; clicking it
// plays that single line. The currently-sequencing line is highlighted via
// `playingIdx`. Shows as a dismissible panel along the bottom.

// wlToRGB is a physically-motivated mapping (violet and deep red are
// genuinely dark), but that accuracy is wasted on text — a label rendered in
// near-black purple is just unreadable. This lightens a color toward white
// only as much as needed to clear a minimum luma, keeping its hue so the
// wavelength-colored label is still recognizably that color, just legible.
// The classic Ca II H&K / Hdelta / Ca I cluster (~390-430nm) is exactly the
// case this fixes: wlToRGB's own darkening factor for that range plus a
// naturally dark violet hue combine to a near-black text color otherwise.
function legibleRGB([r, g, b], minLuma = 150) {
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  if (luma >= minLuma) return [r, g, b];
  const t = (minLuma - luma) / (255 - luma || 1);
  const mix = (c) => Math.round(c + (255 - c) * t);
  return [mix(r), mix(g), mix(b)];
}

// Label layout constants, shared by the layout pass and the paint pass.
const EL_FONT_LIT = "bold 10px monospace", EL_FONT = "9px monospace", WL_FONT = "8.5px monospace";
// Each label is itself two lines (the wl number sits WL_DY-EL_DY = 11px above
// its element symbol) — ROW_H must clear THAT plus the wl number's own glyph
// height, or a stacked row's element symbol collides with the row below's wl
// number. 14 didn't; 22 does (11px gap + ~8px ascender + pad).
const ROW_H = 22, WL_DY = 17, EL_DY = 6, TOP_PAD = 13;
const PLOT_H = 168, MARGIN_B = 42, MARGIN_L = 44, MARGIN_R = 16;

// Text measurement needs a 2D context but not the on-screen one — using a
// detached canvas keeps the layout pass a pure function of (lines, width), so
// it can run in a memo and feed the canvas height instead of being computed
// mid-paint (which forced the plot to absorb the label rows).
let _measureCtx = null;
function measureCtx() {
  if (!_measureCtx) _measureCtx = document.createElement("canvas").getContext("2d");
  return _measureCtx;
}

/**
 * Assign each line's label to a row, stacking any that would collide.
 *
 * Hot/solar-type templates cluster up to 5 lines (the Balmer series + Ca II
 * H&K) within ~20nm — tighter than a single label at a readable size, let
 * alone one per line, so on one row they print as an illegible smear. Labels
 * are measured at the larger "lit" font so the layout never shifts when
 * hover/chord lights one up mid-view.
 *
 * @returns {{rowOf: number[], maxRow: number}}
 */
function computeLabelLayout(lines, width) {
  const rowOf = new Array(lines.length).fill(0);
  if (!lines.length) return { rowOf, maxRow: 0 };
  const ctx = measureCtx();
  const pw = width - MARGIN_L - MARGIN_R;
  const toX = (wl) => MARGIN_L + ((wl - SPEC_MIN) / (SPEC_MAX - SPEC_MIN)) * pw;

  ctx.font = EL_FONT_LIT;
  const elW = lines.map((l) => ctx.measureText(l.el).width);
  ctx.font = WL_FONT;
  const wlW = lines.map((l) => ctx.measureText(`${l.wl}`).width);

  const order = lines
    .map((line, i) => ({ i, x: toX(line.wl), halfW: Math.max(elW[i], wlW[i]) / 2 + 3 }))
    .sort((a, b) => a.x - b.x);
  const rowLast = []; // rowLast[row] = { x, halfW } of the last label placed there
  order.forEach(({ i, x, halfW }) => {
    let row = 0;
    while (row < 6 && rowLast[row] && x - rowLast[row].x < rowLast[row].halfW + halfW) row++;
    rowLast[row] = { x, halfW };
    rowOf[i] = row;
  });
  return { rowOf, maxRow: Math.max(...rowOf) };
}

function blackbody(wl_nm, T) {
  const wl = wl_nm * 1e-9;
  const h = 6.626e-34, c = 3e8, k = 1.381e-23;
  return (2 * h * c * c) / (Math.pow(wl, 5) * (Math.exp((h * c) / (wl * k * T)) - 1));
}

export default function SpectrumPanel({
  data, playingIdx, chordIndices, playing, mode, onModeChange,
  seed, onSeedChange, seedInfo, onReplay, onStop, onPlayLine, onClose,
}) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [width, setWidth] = useState(720);
  const [activeIdx, setActiveIdx] = useState(null);

  // Label rows are computed before paint so the CANVAS can grow to fit them.
  // Previously this ran mid-paint and the plot area absorbed every stacked row
  // — a line-rich star (exactly the interesting kind) lost up to half its
  // flux-curve height to its own labels.
  const { rowOf, maxRow } = useMemo(
    () => computeLabelLayout(data?.lines ?? [], width),
    [data, width]
  );
  const marginTop = TOP_PAD + WL_DY + maxRow * ROW_H;
  const height = marginTop + PLOT_H + MARGIN_B;

  // Responsive width from the wrapper.
  useLayoutEffect(() => {
    const measure = () => {
      const w = wrapRef.current?.clientWidth;
      if (w) setWidth(Math.max(340, w - 24));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Draw.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !data) return;
    const ctx = c.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr; c.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const m = { t: marginTop, r: MARGIN_R, b: MARGIN_B, l: MARGIN_L };
    const pw = width - m.l - m.r;
    const ph = PLOT_H; // constant now — the canvas grew for the labels instead
    const toX = (wl) => m.l + ((wl - SPEC_MIN) / (SPEC_MAX - SPEC_MIN)) * pw;

    let maxBB = 0;
    for (let wl = SPEC_MIN; wl <= SPEC_MAX; wl += 1) {
      const v = blackbody(wl, data.temp); if (v > maxBB) maxBB = v;
    }
    const getFlux = (wl) => {
      let flux = blackbody(wl, data.temp) / maxBB;
      data.lines.forEach((line) => {
        const sigma = line.width * 0.12;
        const dist = (wl - line.wl) / Math.max(sigma, 0.05);
        if (line.profile === "lorentzian") flux *= 1 - line.depth * 0.75 / (1 + dist * dist);
        else if (line.profile === "voigt") {
          const gauss = Math.exp(-0.5 * dist * dist), lor = 1 / (1 + dist * dist);
          flux *= 1 - line.depth * 0.7 * (0.6 * gauss + 0.4 * lor);
        } else flux *= 1 - line.depth * 0.75 * Math.exp(-0.5 * dist * dist);
      });
      return flux;
    };

    ctx.clearRect(0, 0, width, height);

    // Grid.
    ctx.strokeStyle = "rgba(60,70,90,0.2)"; ctx.lineWidth = 0.5;
    for (let wl = 400; wl <= 750; wl += 50) {
      const x = toX(wl);
      ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, m.t + ph); ctx.stroke();
    }

    // Visible spectrum strip + absorption notches.
    const stripH = 10, stripY = m.t + ph + 4;
    for (let px = 0; px < pw; px++) {
      const wl = SPEC_MIN + (px / pw) * (SPEC_MAX - SPEC_MIN);
      const [r, g, b] = wlToRGB(wl);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(m.l + px, stripY, 1, stripH);
    }
    data.lines.forEach((line) => {
      const x = toX(line.wl), w = Math.max(2, line.width * 2);
      ctx.fillStyle = `rgba(0,0,0,${line.depth * 0.8})`;
      ctx.fillRect(x - w / 2, stripY, w, stripH);
    });

    // Spectral fill under the flux curve.
    for (let px = 0; px < pw; px++) {
      const wl = SPEC_MIN + (px / pw) * (SPEC_MAX - SPEC_MIN);
      const y = m.t + ph - getFlux(wl) * ph;
      const [r, g, b] = wlToRGB(wl);
      const grad = ctx.createLinearGradient(0, y, 0, m.t + ph);
      grad.addColorStop(0, `rgba(${r},${g},${b},0.12)`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(m.l + px, y, 1, m.t + ph - y);
    }

    // Flux curve.
    ctx.beginPath(); ctx.strokeStyle = "rgba(200,210,230,0.7)"; ctx.lineWidth = 1;
    for (let px = 0; px < pw; px++) {
      const wl = SPEC_MIN + (px / pw) * (SPEC_MAX - SPEC_MIN);
      const x = m.l + px, y = m.t + ph - getFlux(wl) * ph;
      px === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Line markers + labels.
    data.lines.forEach((line, i) => {
      const x = toX(line.wl);
      const isA = activeIdx === i, isP = playingIdx === i;
      const isC = chordIndices?.includes(i); // lit as part of a sounding chord
      const colored = isA || isC; // wavelength-colored highlight (vs. yellow seq)
      const lit = isA || isP || isC;
      const [lr, lg, lb] = wlToRGB(line.wl);
      ctx.strokeStyle = isP ? "rgba(255,220,80,0.9)" : colored ? `rgba(${lr},${lg},${lb},0.9)` : `rgba(${lr},${lg},${lb},0.4)`;
      ctx.lineWidth = lit ? 1.5 : 0.8;
      ctx.setLineDash([3, 2]); ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, m.t + ph); ctx.stroke(); ctx.setLineDash([]);
      if (lit) {
        const glow = ctx.createRadialGradient(x, m.t + ph * 0.5, 0, x, m.t + ph * 0.5, 34);
        glow.addColorStop(0, isP ? "rgba(255,220,80,0.12)" : `rgba(${lr},${lg},${lb},0.1)`);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow; ctx.fillRect(x - 34, m.t, 68, ph);
      }
      const [tr, tg, tb] = legibleRGB([lr, lg, lb]);
      const rowY = rowOf[i] * ROW_H;
      ctx.fillStyle = isP ? "#ffdd55" : colored ? `rgb(${tr},${tg},${tb})` : "rgba(205,210,225,0.75)";
      ctx.font = lit ? EL_FONT_LIT : EL_FONT;
      ctx.textAlign = "center";
      ctx.fillText(line.el, x, m.t - EL_DY - rowY);
      ctx.font = WL_FONT;
      ctx.fillStyle = colored ? `rgba(${tr},${tg},${tb},0.85)` : "rgba(190,195,212,0.6)";
      ctx.fillText(`${line.wl}`, x, m.t - WL_DY - rowY);
    });

    // Axis.
    ctx.fillStyle = "rgba(195,200,218,0.7)"; ctx.font = "9.5px monospace"; ctx.textAlign = "center";
    for (let wl = 400; wl <= 750; wl += 50) ctx.fillText(`${wl}`, toX(wl), stripY + stripH + 14);
    ctx.fillText("wavelength (nm)", m.l + pw / 2, stripY + stripH + 26);
  }, [data, activeIdx, playingIdx, chordIndices, width, rowOf, marginTop, height]);

  const nearestLine = useCallback((clientX) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = clientX - rect.left;
    // Same margins the paint pass uses — read from the shared constants so
    // hit-testing can't silently drift out of step with what's drawn.
    const pw = width - MARGIN_L - MARGIN_R;
    const m = { l: MARGIN_L };
    const wl = SPEC_MIN + ((mx - m.l) / pw) * (SPEC_MAX - SPEC_MIN);
    const nmPerPx = (SPEC_MAX - SPEC_MIN) / pw;
    let best = null, bestD = Infinity;
    data.lines.forEach((line, i) => {
      const d = Math.abs(wl - line.wl) / nmPerPx;
      if (d < 18 && d < bestD) { best = i; bestD = d; }
    });
    return best;
  }, [data, width]);

  if (!data) return null;
  const info = activeIdx != null ? data.lines[activeIdx] : null;

  return (
    <div ref={wrapRef} style={styles.wrap}>
      <div style={styles.header}>
        <div style={styles.headLeft}>
          <span style={{ ...styles.name, color: data.color }}>{data.name.toUpperCase()}</span>
          <span style={styles.meta}>{data.type} · {data.temp}K{data.rv ? ` · RV ${data.rv > 0 ? "+" : ""}${data.rv}` : ""}</span>
          <span style={{ ...styles.badge, ...(data.dataSource === "curated" ? styles.badgeCurated : styles.badgeTemplate) }}>
            {data.dataSource}
          </span>
        </div>
        <div style={styles.right}>
          <span style={styles.lineInfo}>
            {info
              ? `${info.el} · ${info.wl}nm · ${info.profile} · EW ${info.ew} · EP ${info.ep}eV`
              : "hover a line to inspect · click to sonify"}
          </span>
          <div style={styles.modeToggle}>
            <button
              onClick={() => onModeChange?.("sequential")}
              style={{ ...styles.modeBtn, ...(mode === "sequential" ? styles.modeOn : null) }}
              title="Play lines one after another"
            >SEQ</button>
            <button
              onClick={() => onModeChange?.("chord")}
              style={{ ...styles.modeBtn, ...(mode === "chord" ? styles.modeOn : null) }}
              title="Play all lines at once, harmonized"
            >CHORD</button>
            <button
              onClick={() => onModeChange?.("seed")}
              style={{ ...styles.modeBtn, ...(mode === "seed" ? styles.modeOn : null) }}
              title="Compose a short piece from the lines, in the star's own key"
            >SEED</button>
          </div>

          {/* SEED controls: the star's key/tempo, and the seed that arranges it.
              Blank = the star's own seed, so it always plays the same piece. */}
          {mode === "seed" && (
            <div style={styles.seedBox}>
              {seedInfo && (
                <span style={styles.seedKey} title="Key from the strongest line; mode and tempo from temperature">
                  {seedInfo.root} {seedInfo.mode} · {seedInfo.bpm}bpm
                </span>
              )}
              <input
                value={seed}
                onChange={(e) => onSeedChange?.(e.target.value)}
                placeholder={data.name}
                spellCheck={false}
                style={styles.seedInput}
                title="Seed — blank uses the star's name. Same seed, same piece."
              />
              <button
                onClick={() => onSeedChange?.(Math.random().toString(36).slice(2, 8))}
                style={styles.replay}
                title="Reroll the arrangement (same key, same lines)"
              >↻</button>
            </div>
          )}
          {/* Selection is silent (App.handleStarSelected) — this is the play
              control. It flips to a stop while the star is sounding. */}
          <button
            onClick={playing ? onStop : onReplay}
            style={{ ...styles.replay, ...(playing ? styles.replayOn : null) }}
            title={playing ? "Stop" : "Play this star"}
          >{playing ? "■" : "▶"}</button>
          <button onClick={onClose} style={styles.close}>✕</button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        style={{ width, height, display: "block", cursor: activeIdx != null ? "pointer" : "crosshair" }}
        onMouseMove={(e) => setActiveIdx(nearestLine(e.clientX))}
        onMouseLeave={() => setActiveIdx(null)}
        onClick={() => { if (activeIdx != null) onPlayLine(activeIdx); }}
      />
    </div>
  );
}

const styles = {
  wrap: {
    position: "fixed",
    left: 12,
    right: 12,
    bottom: 56,
    maxWidth: 980,
    margin: "0 auto",
    background: "rgba(8,9,16,0.86)",
    border: "1px solid rgba(120,140,180,0.2)",
    borderRadius: 6,
    backdropFilter: "blur(8px)",
    padding: "6px 10px 8px",
    zIndex: 15,
    fontFamily: "'IBM Plex Mono', monospace",
  },
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    gap: 12, padding: "2px 2px 6px", flexWrap: "nowrap",
  },
  // The identity block truncates; the controls never do.
  headLeft: { minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 1 },
  name: { fontSize: 14, letterSpacing: 2, fontWeight: 700, marginRight: 8 },
  meta: { fontSize: 10, color: "rgba(160,170,190,0.55)", letterSpacing: 1 },
  badge: { fontSize: 8, letterSpacing: 1, textTransform: "uppercase", padding: "2px 6px", borderRadius: 3, marginLeft: 8 },
  badgeCurated: { background: "rgba(120,220,170,0.12)", color: "rgba(150,235,195,0.9)", border: "1px solid rgba(120,220,170,0.3)" },
  badgeTemplate: { background: "rgba(255,200,120,0.1)", color: "rgba(255,210,150,0.85)", border: "1px solid rgba(255,200,120,0.28)" },
  right: { display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: "0 1 auto", justifyContent: "flex-end" },
  // The only element allowed to give up space when the header is tight.
  lineInfo: {
    fontSize: 9, color: "rgba(180,188,205,0.6)",
    flex: "0 1 auto", minWidth: 0, overflow: "hidden",
    textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  modeToggle: {
    display: "flex", border: "1px solid rgba(120,140,180,0.3)",
    borderRadius: 3, overflow: "hidden", flexShrink: 0,
  },
  modeBtn: {
    background: "transparent", border: "none", color: "rgba(160,170,195,0.6)",
    fontFamily: "inherit", fontSize: 9, letterSpacing: 1, padding: "4px 8px",
    cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
  },
  modeOn: { background: "rgba(120,150,200,0.22)", color: "rgba(185,205,245,0.95)" },
  replay: {
    flexShrink: 0,
    background: "transparent", border: "1px solid rgba(120,140,180,0.3)",
    color: "rgba(180,200,235,0.85)", fontFamily: "inherit", fontSize: 10,
    width: 22, height: 22, borderRadius: 3, cursor: "pointer", lineHeight: 1,
  },
  seedBox: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 },
  seedKey: {
    fontSize: 9, letterSpacing: 1, color: "rgba(150,175,220,0.75)",
    whiteSpace: "nowrap", textTransform: "uppercase",
  },
  seedInput: {
    background: "rgba(20,24,36,0.8)", border: "1px solid rgba(120,140,180,0.3)",
    borderRadius: 3, color: "rgba(210,220,240,0.9)", fontFamily: "inherit",
    fontSize: 10, letterSpacing: 1, padding: "3px 6px", width: 84, outline: "none",
  },
  replayOn: {
    background: "rgba(120,150,200,0.22)", borderColor: "#5b86c4",
    color: "rgba(200,220,255,0.95)",
  },
  close: {
    flexShrink: 0,
    background: "transparent", border: "1px solid rgba(120,140,180,0.3)",
    color: "rgba(170,180,200,0.7)", fontFamily: "inherit", fontSize: 10,
    width: 22, height: 22, borderRadius: 3, cursor: "pointer", lineHeight: 1,
  },
};
