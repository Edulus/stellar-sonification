import { useState } from "react";
import { PARAM_GROUPS, DEFAULT_PARAMS } from "../audio/mappings.js";

// Right-side collapsible "Synth Character" tweaker. A tab on the right edge
// toggles a drawer of grouped sliders that retune the sonification mapping live.
// Changes call onChange(patch) -> the engine's setParams; they apply to the next
// note (so you can tune while a sequence plays).

// Simple mode shows only the handful of knobs that most change the character;
// Full mode shows every mapping parameter. Keys must exist in PARAM_GROUPS.
const SIMPLE_KEYS = new Set([
  "masterVolume",   // overall loudness
  "pitchHighMidi",  // how high it sits
  "reverbWet",      // space / wash
  "toneDuration",   // note length
  "sequenceGap",    // pace
  "harmonizeAmount", // chord: cluster -> snapped
]);

export default function SynthPanel({
  params, onChange, onReset,
  hoverEnabled, onHoverEnabled,
  hoverType, onHoverType,
  hoverRepeat, onHoverRepeat,
}) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false); // false = simple (curated subset)

  // In simple mode, keep only curated params and drop groups left empty.
  const groups = PARAM_GROUPS
    .map((g) => ({
      ...g,
      params: full ? g.params : g.params.filter((s) => SIMPLE_KEYS.has(s.key)),
    }))
    .filter((g) => g.params.length > 0);

  return (
    <>
      {/* Edge toggle tab — always visible */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ ...styles.tab, right: open ? PANEL_W : 0 }}
        title="Synth Character"
      >
        <span style={styles.tabText}>{open ? "›  SYNTH" : "‹  SYNTH"}</span>
      </button>

      <div style={{ ...styles.panel, transform: open ? "translateX(0)" : `translateX(${PANEL_W}px)` }}>
        <div style={styles.header}>
          <span style={styles.title}>SYNTH CHARACTER</span>
          <div style={styles.headerBtns}>
            <button
              onClick={() => setFull((f) => !f)}
              style={styles.mode}
              title={full ? "Show only the essential controls" : "Show every parameter"}
            >
              {full ? "simple" : "full"}
            </button>
            <button onClick={onReset} style={styles.reset}>reset</button>
            <button onClick={() => setOpen(false)} style={styles.close} title="Collapse panel">×</button>
          </div>
        </div>
        <div style={styles.scroll}>
          {/* ── HOVER ───────────────────────────────────────────────── */}
          <div style={{ ...styles.group, paddingBottom: 12, borderBottom: "1px solid rgba(120,140,180,0.1)", marginBottom: 14 }}>
            <div style={styles.groupTitle}>Hover</div>

            {/* On / Off */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: hoverEnabled ? 10 : 0 }}>
              <span style={{ ...styles.label, color: "rgba(170,178,196,0.7)" }}>Hover mode</span>
              <div style={{ display: "flex", gap: 4 }}>
                {[["ON", true], ["OFF", false]].map(([label, val]) => (
                  <button key={label} onClick={() => onHoverEnabled(val)}
                    style={{ ...styles.toggle, borderColor: hoverEnabled === val ? "#5b86c4" : "rgba(120,140,180,0.3)", color: hoverEnabled === val ? "#add2ff" : "rgba(170,178,196,0.5)" }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {hoverEnabled && (
              <>
                {/* Chord / Sequence / Seed trigger */}
                <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
                  {[["chord", "CHORD"], ["sequence", "SEQ"], ["seed", "SEED"]].map(([t, label]) => (
                    <button key={t} onClick={() => onHoverType(t)}
                      style={{ ...styles.toggle, flex: 1, borderColor: hoverType === t ? "#5b86c4" : "rgba(120,140,180,0.3)", color: hoverType === t ? "#add2ff" : "rgba(170,178,196,0.5)", textTransform: "uppercase", letterSpacing: 1 }}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* Fade applies to the sustained/arpeggiated hover engines. */}
                {hoverType !== "seed" && (
                  <Slider spec={{ key: "hoverFadeOut", label: "Fade out (s)", min: 0.2, max: 3.0, step: 0.1 }}
                    value={params.hoverFadeOut} changed={params.hoverFadeOut !== 0.8}
                    onChange={(v) => onChange({ hoverFadeOut: v })} />
                )}

                {hoverType === "chord" && (
                  <>
                    <div style={{ ...styles.groupTitle, marginTop: 6, fontSize: 7, opacity: 0.7 }}>chord settings</div>
                    <Slider spec={{ key: "hoverGainScale", label: "Gain scale", min: 0.2, max: 1.0, step: 0.05 }}
                      value={params.hoverGainScale} changed={params.hoverGainScale !== 0.7}
                      onChange={(v) => onChange({ hoverGainScale: v })} />
                    <Slider spec={{ key: "hoverMaxVoices", label: "Max voices", min: 1, max: 6, step: 1 }}
                      value={params.hoverMaxVoices} changed={params.hoverMaxVoices !== 6}
                      onChange={(v) => onChange({ hoverMaxVoices: v })} />
                    <Slider spec={{ key: "hoverSpreadDetune", label: "Spread detune (Hz)", min: 0, max: 8, step: 0.5 }}
                      value={params.hoverSpreadDetune} changed={params.hoverSpreadDetune !== 0}
                      onChange={(v) => onChange({ hoverSpreadDetune: v })} />
                  </>
                )}

                {hoverType === "sequence" && (
                  <>
                    <div style={{ ...styles.groupTitle, marginTop: 6, fontSize: 7, opacity: 0.7 }}>sequence settings</div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ ...styles.label, color: "rgba(170,178,196,0.7)" }}>Repeat</span>
                      <div style={{ display: "flex", gap: 4 }}>
                        {["once", "loop"].map((r) => (
                          <button key={r} onClick={() => onHoverRepeat(r)}
                            style={{ ...styles.toggle, borderColor: hoverRepeat === r ? "#5b86c4" : "rgba(120,140,180,0.3)", color: hoverRepeat === r ? "#add2ff" : "rgba(170,178,196,0.5)", textTransform: "uppercase", letterSpacing: 1 }}>
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {hoverType === "seed" && (
                  <div style={{ ...styles.foot, marginTop: 2 }}>
                    Plays this star's deterministic SEED arrangement while hovered.
                  </div>
                )}
              </>
            )}
          </div>

          {groups.map((group) => (
            <div key={group.title} style={styles.group}>
              <div style={styles.groupTitle}>{group.title}</div>
              {group.params.map((spec) => (
                <Slider
                  key={spec.key}
                  spec={spec}
                  value={params[spec.key]}
                  changed={params[spec.key] !== DEFAULT_PARAMS[spec.key]}
                  onChange={(v) => onChange({ [spec.key]: v })}
                />
              ))}
            </div>
          ))}
          <div style={styles.foot}>
            Tweaks apply to the next note. Re-click a star to hear the full sequence retuned.
            {!full && " · “full” reveals every parameter."}
          </div>
        </div>
      </div>
    </>
  );
}

function Slider({ spec, value, changed, onChange }) {
  const decimals = spec.step < 1 ? (spec.step < 0.01 ? 3 : 2) : 0;
  return (
    <label style={styles.row}>
      <div style={styles.labelRow}>
        <span style={{ ...styles.label, color: changed ? "#add2ff" : "rgba(170,178,196,0.7)" }}>
          {spec.label}
        </span>
        <span style={styles.value}>{Number(value).toFixed(decimals)}</span>
      </div>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={styles.range}
      />
    </label>
  );
}

const PANEL_W = 270;

const styles = {
  tab: {
    position: "fixed",
    top: 84,
    height: 96,
    width: 26,
    border: "1px solid rgba(120,140,180,0.3)",
    borderRight: "none",
    borderRadius: "6px 0 0 6px",
    background: "rgba(14,16,26,0.85)",
    color: "rgba(180,200,235,0.85)",
    cursor: "pointer",
    zIndex: 20,
    transition: "right 0.28s ease",
    padding: 0,
    backdropFilter: "blur(6px)",
  },
  tabText: {
    writingMode: "vertical-rl",
    transform: "rotate(180deg)",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    letterSpacing: 2,
  },
  panel: {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    width: PANEL_W,
    background: "rgba(10,12,20,0.92)",
    borderLeft: "1px solid rgba(120,140,180,0.22)",
    backdropFilter: "blur(8px)",
    color: "#c0c4d0",
    fontFamily: "'IBM Plex Mono', monospace",
    zIndex: 19,
    transition: "transform 0.28s ease",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 14px 10px",
    borderBottom: "1px solid rgba(120,140,180,0.15)",
  },
  title: { fontSize: 11, letterSpacing: 3, color: "rgba(190,205,235,0.9)" },
  headerBtns: { display: "flex", alignItems: "center", gap: 6 },
  mode: {
    background: "transparent",
    border: "1px solid rgba(120,150,200,0.35)",
    color: "rgba(170,195,240,0.8)",
    fontFamily: "inherit",
    fontSize: 9,
    letterSpacing: 1,
    padding: "3px 8px",
    borderRadius: 3,
    cursor: "pointer",
  },
  reset: {
    background: "transparent",
    border: "1px solid rgba(120,140,180,0.3)",
    color: "rgba(170,180,200,0.7)",
    fontFamily: "inherit",
    fontSize: 9,
    letterSpacing: 1,
    padding: "3px 8px",
    borderRadius: 3,
    cursor: "pointer",
  },
  close: {
    background: "transparent",
    border: "1px solid rgba(120,140,180,0.3)",
    color: "rgba(180,190,210,0.8)",
    fontFamily: "inherit",
    fontSize: 13,
    lineHeight: 1,
    padding: "1px 7px",
    borderRadius: 3,
    cursor: "pointer",
  },
  scroll: { overflowY: "auto", padding: "10px 14px 24px", flex: 1 },
  group: { marginBottom: 14 },
  groupTitle: {
    fontSize: 8,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: "rgba(140,150,170,0.5)",
    marginBottom: 6,
  },
  row: { display: "block", marginBottom: 9 },
  labelRow: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 },
  label: { fontSize: 10 },
  value: { fontSize: 10, color: "rgba(200,210,230,0.85)" },
  range: { width: "100%", accentColor: "#5b86c4", cursor: "pointer" },
  foot: { fontSize: 9, color: "rgba(120,130,150,0.5)", lineHeight: 1.5, marginTop: 6 },
  toggle: {
    background: "transparent",
    border: "1px solid",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 9,
    padding: "3px 9px",
    borderRadius: 3,
    cursor: "pointer",
  },
};