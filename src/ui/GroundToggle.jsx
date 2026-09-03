// Ground/horizon visibility toggle. Off (the default — see config.js's
// nightSky.landscape) exposes the full celestial sphere: you can look
// "through" the ground at stars below the local horizon, which is handy for
// exploring but disorienting if you actually want to know what's up right
// now. On draws the landscape silhouette so the horizon reads as a horizon.
//
// Styled to match LocationPicker's trigger button — they sit side by side in
// App.jsx's top-left HUD row.

export default function GroundToggle({ visible, onToggle }) {
  return (
    <button
      onClick={() => onToggle(!visible)}
      style={S.trigger(visible)}
      title={visible ? "Hide the ground (see the full sky, above and below the horizon)" : "Show the ground (horizon silhouette)"}
    >
      {visible ? "⛰" : "○"} GROUND
      <span style={S.state}> {visible ? "ON" : "OFF"}</span>
    </button>
  );
}

const S = {
  trigger: (on) => ({
    background: on ? "rgba(120,150,200,0.18)" : "rgba(10,12,20,0.82)",
    border: `1px solid ${on ? "rgba(120,150,200,0.6)" : "rgba(100,110,135,0.45)"}`,
    color: on ? "rgba(190,210,250,0.98)" : "rgba(200,208,225,0.92)",
    fontFamily: "'IBM Plex Mono', 'Menlo', monospace",
    fontSize: 10,
    letterSpacing: 1,
    padding: "6px 11px",
    borderRadius: 3,
    cursor: "pointer",
    transition: "all 0.2s",
    backdropFilter: "blur(4px)",
    textShadow: "0 1px 3px rgba(0,0,0,0.8)",
    whiteSpace: "nowrap",
  }),
  state: { opacity: 0.6, marginLeft: 2 },
};
