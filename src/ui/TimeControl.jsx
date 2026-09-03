import { useEffect, useState } from "react";

// Date/time control — the third top-left HUD button, beside the location
// picker and ground toggle. Two modes:
//   LIVE   (default): the clock ticks forward in real time (StellariumBridge
//          sets core.time_speed = 1; the engine already seeds its observer
//          from the real system clock at init, so "live" needs nothing else).
//   custom: frozen at whatever date/time was picked (time_speed = 0).
// Picking a date/time always freezes it there — a chosen moment that kept
// drifting away the instant you set it would defeat the point of picking it.
// "NOW" jumps back to live ticking; "TONIGHT" is a one-click "guaranteed dark
// sky, right now" shortcut (solar midnight at the current location).
//
// Everything is UTC. The engine has no per-location timezone database, so
// UTC is the one unambiguous choice for "any point on Earth" — labeled as
// such rather than silently assumed.

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** "2026-09-03 14:32" from a UTC Date — never the browser's local getters. */
function fmt(d) {
  if (!d) return "--";
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function toDateInput(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function toTimeInput(d) {
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** Parse the two native inputs (each timezone-naive) as UTC. */
function fromInputs(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const d = new Date(`${dateStr}T${timeStr}:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default function TimeControl({ bridge }) {
  const [open, setOpen] = useState(false);
  const [live, setLiveState] = useState(true); // mirrors bridge.init()'s default
  const [now, setNow] = useState(null);         // polled display value
  const [dateStr, setDateStr] = useState("");    // pending edit, date input
  const [timeStr, setTimeStr] = useState("");    // pending edit, time input

  // Poll the observer clock for display. Cheap (a JS Date construction) and
  // simplest to always run — while frozen the value just doesn't change.
  useEffect(() => {
    if (!bridge) return;
    const tick = () => setNow(bridge.getDateTime());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [bridge]);

  // Seed the edit fields from the current time whenever the drawer opens.
  useEffect(() => {
    if (open && now) {
      setDateStr(toDateInput(now));
      setTimeStr(toTimeInput(now));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Until the engine exists there is nothing to drive. Acting anyway would
  // silently no-op the bridge call while still flipping the local mode state
  // — leaving the badge claiming "frozen" over a clock that is in fact live
  // and ticking. The engine takes seconds to come up on a cold load (1.2MB of
  // WASM + skydata), so this window is every first visit, not a rare race.
  const ready = !!bridge;
  const pending = fromInputs(dateStr, timeStr); // null while a field is blank/invalid

  const goLive = () => {
    if (!ready) return;
    bridge.setLive(true);
    setLiveState(true);
    setOpen(false);
  };

  const goTonight = () => {
    if (!ready) return;
    bridge.goToTonight();
    setLiveState(false);
    setOpen(false);
  };

  const applyCustom = () => {
    if (!ready || !pending) return;
    bridge.setDateTime(pending);
    setLiveState(false);
    setNow(pending);
    setOpen(false);
  };

  return (
    <div style={S.root}>
      <button
        onClick={() => ready && setOpen((o) => !o)}
        style={S.trigger(open, ready)}
        disabled={!ready}
        title={ready ? "Set the date and time (UTC)" : "Waiting for the sky engine to load"}
      >
        <span style={{ ...S.dot, background: !ready ? "#7d8496" : live ? "#6fe0a0" : "#ffb85c" }} />
        {!ready ? "SKY LOADING…" : `${live ? "LIVE" : "SET"} ${fmt(now)} UTC`}
        {ready && <span style={{ opacity: 0.5, marginLeft: 4 }}>{open ? "▲" : "▼"}</span>}
      </button>

      {open && (
        <div style={S.drawer}>
          <div style={S.row}>
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              style={S.input}
            />
            <input
              type="time"
              value={timeStr}
              onChange={(e) => setTimeStr(e.target.value)}
              style={S.input}
            />
          </div>

          <div style={S.actions}>
            <button
              onClick={applyCustom}
              style={{ ...S.btn, ...(pending ? null : S.btnDisabled) }}
              disabled={!pending}
              title={pending ? "Jump to this exact date/time and freeze there" : "Fill in both date and time first"}
            >
              SET
            </button>
            <button onClick={goTonight} style={S.btn} title="Solar midnight at the current location, right now">
              TONIGHT
            </button>
            <button onClick={goLive} style={{ ...S.btn, ...S.btnLive }} title="Back to the real, ticking present">
              ▶ NOW
            </button>
          </div>

          <div style={S.foot}>
            <span>{live ? "ticking in real time" : "frozen — pick NOW to resume"}</span>
            <span style={{ color: "rgba(140,215,175,0.85)" }}>ATMOSPHERE OFF · UTC</span>
          </div>
        </div>
      )}
    </div>
  );
}

const S = {
  root: {
    position: "relative",
    zIndex: 20,
    fontFamily: "'IBM Plex Mono', 'Menlo', monospace",
    pointerEvents: "auto",
  },
  trigger: (open, ready = true) => ({
    background: open ? "rgba(120,150,200,0.18)" : "rgba(10,12,20,0.82)",
    border: `1px solid ${open ? "rgba(120,150,200,0.6)" : "rgba(100,110,135,0.45)"}`,
    color: ready
      ? (open ? "rgba(190,210,250,0.98)" : "rgba(200,208,225,0.92)")
      : "rgba(170,178,198,0.55)",
    fontFamily: "inherit",
    fontSize: 10,
    letterSpacing: 1,
    padding: "6px 11px",
    borderRadius: 3,
    cursor: ready ? "pointer" : "default",
    transition: "all 0.2s",
    backdropFilter: "blur(4px)",
    textShadow: "0 1px 3px rgba(0,0,0,0.8)",
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
  }),
  dot: {
    width: 6, height: 6, borderRadius: "50%",
    marginRight: 7, flexShrink: 0,
    boxShadow: "0 0 6px currentColor",
  },
  drawer: {
    position: "absolute",
    top: "calc(100% + 6px)",
    left: 0,
    width: 240,
    border: "1px solid rgba(120,150,200,0.25)",
    borderRadius: 3,
    background: "rgba(12,14,24,0.97)",
    overflow: "hidden",
    boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
    backdropFilter: "blur(6px)",
    padding: "10px 12px",
  },
  row: { display: "flex", gap: 6, marginBottom: 8 },
  input: {
    flex: 1,
    minWidth: 0,
    background: "rgba(8,9,16,0.8)",
    border: "1px solid rgba(100,110,135,0.4)",
    borderRadius: 2,
    color: "rgba(210,216,232,0.95)",
    fontFamily: "inherit",
    fontSize: 11,
    padding: "5px 6px",
    outline: "none",
    colorScheme: "dark",
  },
  actions: { display: "flex", gap: 5 },
  btn: {
    flex: 1,
    background: "rgba(120,150,200,0.12)",
    border: "1px solid rgba(120,150,200,0.4)",
    color: "rgba(195,212,248,0.95)",
    fontFamily: "inherit",
    fontSize: 9,
    letterSpacing: 1,
    padding: "6px 4px",
    borderRadius: 2,
    cursor: "pointer",
    transition: "all 0.15s",
  },
  btnLive: {
    background: "rgba(110,224,160,0.14)",
    borderColor: "rgba(110,224,160,0.5)",
    color: "rgba(170,240,200,0.95)",
  },
  btnDisabled: {
    background: "rgba(90,96,112,0.10)",
    borderColor: "rgba(100,110,135,0.25)",
    color: "rgba(160,166,184,0.45)",
    cursor: "default",
  },
  foot: {
    marginTop: 8,
    paddingTop: 7,
    borderTop: "1px solid rgba(120,130,160,0.12)",
    fontSize: 9,
    letterSpacing: 0.5,
    color: "rgba(170,178,198,0.6)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
};
