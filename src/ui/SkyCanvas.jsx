import { useEffect, useRef, useState } from "react";
import { StellariumBridge } from "../engine/StellariumBridge.js";

// Phase 0 deliverable: a full-viewport canvas with the Stellarium Web Engine
// mounted into it, logging normalized star data to the console on selection.
//
// The canvas is owned entirely by the engine (WebGL context + render loop).
// We hand it to the bridge via a ref and keep React away from the node — it has
// no children and never re-renders its element. See PHASE0-FINDINGS.md §5.

export default function SkyCanvas({ onStarSelected, onDeselected, onReady, onStarHovered, onStarUnhovered }) {
  const canvasRef = useRef(null);
  const bridgeRef = useRef(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Guard against StrictMode's double-invoke spinning up two engines.
    if (bridgeRef.current) return;

    const bridge = new StellariumBridge(canvas);
    bridgeRef.current = bridge;

    bridge.on("ready", () => {
      setStatus("ready");
      // Phase 0 debug hooks: lets you poke the engine from the console
      // (e.g. `__stel.core.selection = __stel.getObj('HIP 32349')`) and is
      // used by the automated acceptance check. Harmless to keep for now.
      window.__bridge = bridge;
      window.__stel = bridge.stel;
      onReady?.(bridge);
    });
    bridge.on("starSelected", (star) => {
      // Phase 0 acceptance: log the full selection object.
      console.log("[star selected]", star);
      onStarSelected?.(star);
    });
    bridge.on("deselected", () => {
      console.log("[deselected]");
      onDeselected?.();
    });
    bridge.on("starHovered", (star) => onStarHovered?.(star));
    bridge.on("starUnhovered", (info) => onStarUnhovered?.(info));

    bridge.init().catch((e) => {
      console.error("[SkyCanvas] engine init failed:", e);
      setError(e.message || String(e));
      setStatus("error");
    });

    return () => {
      bridge.destroy();
      bridgeRef.current = null;
    };
  }, [onStarSelected, onDeselected, onReady, onStarHovered, onStarUnhovered]);

  return (
    <div style={styles.wrap}>
      <canvas ref={canvasRef} style={styles.canvas} />
      {status !== "ready" && (
        <div style={styles.overlay}>
          {status === "loading" && <span>Loading Stellarium Web Engine…</span>}
          {status === "error" && (
            <div style={styles.error}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Engine failed to load</div>
              <div style={{ opacity: 0.7, marginBottom: 8 }}>{error}</div>
              <div style={{ opacity: 0.5, fontSize: 12 }}>
                Build the engine and copy artifacts to <code>public/engine/</code>,
                and skydata to <code>public/skydata/</code>. See PHASE0-FINDINGS.md §6.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const styles = {
  wrap: { position: "fixed", inset: 0, background: "#08080e", overflow: "hidden" },
  canvas: { position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" },
  overlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "rgba(200,210,230,0.8)",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 14,
    pointerEvents: "none",
    textAlign: "center",
    padding: 24,
  },
  error: { maxWidth: 520, lineHeight: 1.5 },
};
