// Melody mode controls (top-left HUD): preset selector, ▶/■, HONEST toggle.
// Styled to match GroundToggle / LocationPicker — they share the same HUD row.
//
// Pressing ▶ assigns the stars in view to the melody's pitches (App.jsx →
// melodies/melody.js) and plays it; ■ stops audio and clears every pulse.
// A one-line status shows how many stars were assigned and flags the
// "fewer stars than pitches" fallback.

import { MELODY_PRESETS } from "../melodies/presets.js";

export default function MelodyControl({
  disabled, presetIndex, onPresetChange, honest, onHonestChange, playing, onPlay, onStop, status,
}) {
  return (
    <div style={S.wrap}>
      <div style={S.row}>
        <span style={S.label}>♫ MELODY</span>
        <select
          value={presetIndex}
          onChange={(e) => onPresetChange(Number(e.target.value))}
          style={S.select}
          aria-label="Melody preset"
        >
          {MELODY_PRESETS.map((p, i) => <option key={p.name} value={i}>{p.name}</option>)}
        </select>
        <button
          onClick={playing ? onStop : onPlay}
          disabled={disabled}
          style={S.button(playing, disabled)}
          title={playing ? "Stop the melody" : "Play the melody across the brightest stars in view"}
          aria-label={playing ? "Stop melody" : "Play melody"}
        >
          {playing ? "■" : "▶"}
        </button>
        <button
          onClick={() => onHonestChange(!honest)}
          style={S.button(honest, false)}
          title="Honest: each note is sung by the assigned star with a real line nearest that pitch, at the line's true pitch"
          aria-pressed={honest}
        >
          HONEST <span style={S.state}>{honest ? "ON" : "OFF"}</span>
        </button>
      </div>
      {status && <div style={S.status(status.warn)}>{status.text}</div>}
    </div>
  );
}

const mono = "'IBM Plex Mono', 'Menlo', monospace";
const S = {
  wrap: { display: "flex", flexDirection: "column", gap: 4 },
  row: {
    display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6,
    background: "rgba(10,12,20,0.82)",
    border: "1px solid rgba(100,110,135,0.45)",
    borderRadius: 3, padding: "3px 6px",
    backdropFilter: "blur(4px)",
  },
  label: { fontFamily: mono, fontSize: 10, letterSpacing: 1, color: "rgba(200,208,225,0.92)", whiteSpace: "nowrap" },
  select: {
    background: "rgba(20,24,36,0.9)", color: "rgba(220,226,240,0.95)",
    border: "1px solid rgba(100,110,135,0.45)", borderRadius: 2,
    fontFamily: mono, fontSize: 10, padding: "2px 4px", maxWidth: 170, minWidth: 0, flexShrink: 1,
  },
  button: (on, disabled) => ({
    background: on ? "rgba(120,150,200,0.18)" : "transparent",
    border: `1px solid ${on ? "rgba(120,150,200,0.6)" : "rgba(100,110,135,0.45)"}`,
    color: disabled ? "rgba(150,155,170,0.5)" : on ? "rgba(190,210,250,0.98)" : "rgba(200,208,225,0.92)",
    fontFamily: mono, fontSize: 10, letterSpacing: 1,
    padding: "3px 8px", borderRadius: 2,
    cursor: disabled ? "default" : "pointer", whiteSpace: "nowrap",
  }),
  state: { opacity: 0.6, marginLeft: 2 },
  status: (warn) => ({
    fontFamily: mono, fontSize: 10, letterSpacing: 0.5,
    color: warn ? "rgba(255,200,120,0.95)" : "rgba(200,208,225,0.75)",
    textShadow: "0 1px 2px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.85)",
    paddingLeft: 2, maxWidth: 360,
  }),
};
