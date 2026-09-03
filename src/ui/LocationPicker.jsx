import { useState } from "react";
import { OBSERVING_LOCATIONS, ALL_SITES, fmtLat, fmtLng } from "../data/locations.js";

// Observing-location picker. A compact trigger in the top-left HUD opens a
// drawer of curated sites (search + region filter). Selecting one calls
// onSelect(site); App pipes that into StellariumBridge.setLocation so the
// engine recomputes the visible sky (and re-parks the night-locked clock).

export default function LocationPicker({ location, onSelect }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("All");

  const regions = ["All", ...OBSERVING_LOCATIONS.map((g) => g.region)];
  const q = query.trim().toLowerCase();
  const sites = ALL_SITES.filter(
    (s) =>
      (region === "All" || s.region === region) &&
      (!q ||
        s.name.toLowerCase().includes(q) ||
        s.country.toLowerCase().includes(q) ||
        s.desc.toLowerCase().includes(q))
  );

  return (
    <div style={S.root}>
      <button onClick={() => setOpen((o) => !o)} style={S.trigger(open)}>
        ⊕ {location.name.toUpperCase()}
        <span style={{ opacity: 0.5, marginLeft: 4 }}>{open ? "▲" : "▼"}</span>
        <span style={S.lock}> · NIGHT LOCKED</span>
      </button>

      {open && (
        <div style={S.drawer}>
          <div style={S.head}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search site, country, or description…"
              style={S.search}
              autoFocus
            />
            <div style={S.tabs}>
              {regions.map((r) => (
                <button key={r} onClick={() => setRegion(r)} style={S.tab(r === region)}>
                  {r.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div style={S.list}>
            {sites.length === 0 && (
              <div style={S.empty}>No sites match “{query}”.</div>
            )}
            {sites.map((s) => {
              const active = s.name === location.name;
              return (
                <button
                  key={s.name}
                  onClick={() => { onSelect(s); setOpen(false); }}
                  style={S.row(active)}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={S.dot}>{active ? "◉" : ""}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={S.name(active)}>{s.name}</span>
                    <span style={S.country}> · {s.country}</span>
                    <span style={S.desc}>{s.desc}</span>
                  </span>
                  <span style={S.coords}>
                    {fmtLat(s.lat)}
                    <br />
                    {fmtLng(s.lng)}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={S.foot}>
            <span>⊕ {location.name.toUpperCase()} · {fmtLat(location.lat)} {fmtLng(location.lng)}</span>
            <span style={{ color: "rgba(110,180,140,0.55)" }}>ATMOSPHERE OFF · NIGHT LOCKED</span>
          </div>
        </div>
      )}
    </div>
  );
}

const S = {
  root: {
    position: "fixed",
    top: 16,
    left: 16,
    zIndex: 20,
    fontFamily: "'IBM Plex Mono', 'Menlo', monospace",
    pointerEvents: "auto",
  },
  trigger: (open) => ({
    background: open ? "rgba(120,150,200,0.14)" : "rgba(12,14,24,0.7)",
    border: `1px solid ${open ? "rgba(120,150,200,0.6)" : "rgba(80,85,100,0.35)"}`,
    color: open ? "rgba(170,195,240,0.95)" : "rgba(150,160,185,0.75)",
    fontFamily: "inherit",
    fontSize: 10,
    letterSpacing: 1,
    padding: "6px 11px",
    borderRadius: 3,
    cursor: "pointer",
    transition: "all 0.2s",
    backdropFilter: "blur(4px)",
  }),
  lock: { color: "rgba(110,180,140,0.55)", marginLeft: 8, fontSize: 8 },
  drawer: {
    marginTop: 6,
    width: 360,
    border: "1px solid rgba(120,150,200,0.25)",
    borderRadius: 3,
    background: "rgba(12,14,24,0.97)",
    overflow: "hidden",
    boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
    backdropFilter: "blur(6px)",
  },
  head: { padding: "10px 12px", borderBottom: "1px solid rgba(120,130,160,0.12)" },
  search: {
    width: "100%",
    boxSizing: "border-box",
    background: "rgba(8,9,16,0.8)",
    border: "1px solid rgba(80,85,100,0.3)",
    borderRadius: 2,
    color: "#c0c4d0",
    fontFamily: "inherit",
    fontSize: 11,
    padding: "6px 8px",
    outline: "none",
    marginBottom: 8,
  },
  tabs: { display: "flex", gap: 5, flexWrap: "wrap" },
  tab: (on) => ({
    background: on ? "rgba(120,150,200,0.18)" : "transparent",
    border: `1px solid ${on ? "rgba(120,150,200,0.5)" : "rgba(80,85,100,0.25)"}`,
    color: on ? "rgba(180,200,240,0.9)" : "rgba(140,145,160,0.5)",
    fontFamily: "inherit",
    fontSize: 8,
    padding: "3px 8px",
    letterSpacing: 1,
    cursor: "pointer",
    borderRadius: 2,
    transition: "all 0.2s",
  }),
  list: { maxHeight: 300, overflowY: "auto" },
  empty: { padding: "16px 12px", fontSize: 10, color: "rgba(140,145,160,0.4)", textAlign: "center" },
  row: (active) => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    textAlign: "left",
    background: active ? "rgba(120,150,200,0.10)" : "transparent",
    border: "none",
    borderBottom: "1px solid rgba(120,130,160,0.06)",
    color: "inherit",
    fontFamily: "inherit",
    padding: "8px 12px",
    cursor: "pointer",
    transition: "background 0.15s",
  }),
  dot: { width: 12, color: "rgba(120,180,230,0.9)", fontSize: 10, flexShrink: 0 },
  name: (active) => ({ fontSize: 11, color: active ? "rgba(180,205,245,0.95)" : "rgba(190,195,210,0.8)" }),
  country: { fontSize: 9, color: "rgba(140,145,160,0.45)" },
  desc: { display: "block", fontSize: 9, color: "rgba(140,145,160,0.4)", marginTop: 1 },
  coords: { fontSize: 9, color: "rgba(120,150,200,0.5)", flexShrink: 0, textAlign: "right" },
  foot: {
    padding: "7px 12px",
    borderTop: "1px solid rgba(120,130,160,0.12)",
    fontSize: 9,
    color: "rgba(140,150,180,0.55)",
    letterSpacing: 1,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
};
