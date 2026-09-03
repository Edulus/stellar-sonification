import { useEffect, useRef } from "react";
import { wlToRGB } from "../audio/color.js";

// Star ring animation overlay. A transparent canvas over the engine canvas that
// draws color rings emanating from a singing star — one ring per absorption line,
// colored by that line's wavelength. It is a *pure visual function of audio
// state*: it owns no lifecycle timing. The SonificationEngine emits
//   starChordStart / starLineStart / starFadeStart / starStopped
// and the overlay only reacts. If a sound rings, its ring shows; when the sound
// fades (over fadeDurationSec), the ring fades the same; when it stops, the ring
// is removed. Never touches the engine's WebGL context, and never intercepts
// mouse events (pointer-events: none).

// Visual tuning (px / px-per-sec). Radial ordering (EW-strongest innermost) is
// preserved at every instant because drift is identical across a chord's rings.
const BASE_RADIUS = 14;
const RING_SPACING = 9;
const STROKE = 2;
const CHORD_DRIFT = 6;       // slow outward drift, px/sec
const CHORD_OPACITY = 0.9;
const SEQ_EXPAND = 46;       // how far a sequence ring travels over its tone, px
const SEQ_OPACITY = 0.95;
const SPAWN_FLASH = 0.2;     // sec: opacity ramp-in (the "emanating" pop)

export default function RingOverlay({ engine }) {
  const canvasRef = useRef(null);
  const systemsRef = useRef(new Map()); // starKey -> ring system
  const rafRef = useRef(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });

  // Size the backing store to match the engine canvas (CSS size × dpr) so rings
  // land on the star at any devicePixelRatio. Draw space stays in CSS px.
  const resize = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    sizeRef.current = { w, h, dpr };
  };

  useEffect(() => {
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // Subscribe to the audio layer's ring events.
  useEffect(() => {
    if (!engine) return;
    const now = () => performance.now() / 1000;

    const ensureRaf = () => {
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(draw);
    };

    const onChordStart = ({ starKey, screenPos, lines }) => {
      if (!screenPos) return;
      systemsRef.current.set(starKey, {
        mode: "chord",
        pos: screenPos,
        colors: (lines || []).map((l) => wlToRGB(l.wl)), // EW-desc as received
        startT: now(),
        fadeStartT: null,
        fadeDur: 0,
      });
      ensureRaf();
    };

    const onLineStart = ({ starKey, line, durationSec, screenPos }) => {
      let sys = systemsRef.current.get(starKey);
      if (!sys) {
        sys = { mode: "sequence", pos: screenPos, rings: [], fadeStartT: null, fadeDur: 0 };
        systemsRef.current.set(starKey, sys);
      }
      if (screenPos) sys.pos = screenPos;
      if (sys.fadeStartT != null) return; // fading: no new rings
      sys.rings.push({ color: wlToRGB(line.wl), startT: now(), durationSec: durationSec || 1 });
      ensureRaf();
    };

    const onFadeStart = ({ starKey, fadeDurationSec }) => {
      const sys = systemsRef.current.get(starKey);
      if (!sys) return;
      sys.fadeStartT = now();
      sys.fadeDur = fadeDurationSec || 0.001;
    };

    const onStopped = ({ starKey }) => {
      systemsRef.current.delete(starKey);
    };

    const offs = [
      engine.on("starChordStart", onChordStart),
      engine.on("starLineStart", onLineStart),
      engine.on("starFadeStart", onFadeStart),
      engine.on("starStopped", onStopped),
    ];

    function draw() {
      const canvas = canvasRef.current;
      const systems = systemsRef.current;
      if (!canvas) { rafRef.current = null; return; }
      const { w, h, dpr } = sizeRef.current;
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const t = now();

      systems.forEach((sys) => {
        // Fade factor (1 while sustained → 0 across fadeDur). Pure audio-derived.
        const fadeK = sys.fadeStartT == null
          ? 1
          : Math.max(0, 1 - (t - sys.fadeStartT) / sys.fadeDur);

        if (sys.mode === "chord") {
          const drift = CHORD_DRIFT * (t - sys.startT);
          const spawn = Math.min((t - sys.startT) / SPAWN_FLASH, 1);
          sys.colors.forEach(([r, g, b], i) => {
            const radius = BASE_RADIUS + i * RING_SPACING + drift; // monotonic in i
            const alpha = CHORD_OPACITY * spawn * fadeK;
            if (alpha <= 0.001) return;
            ctx.beginPath();
            ctx.arc(sys.pos.x, sys.pos.y, radius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
            ctx.lineWidth = STROKE;
            ctx.stroke();
          });
        } else {
          // sequence: each ring expands and fades over its tone, accumulating.
          for (let k = sys.rings.length - 1; k >= 0; k -= 1) {
            const ring = sys.rings[k];
            const progress = (t - ring.startT) / ring.durationSec;
            if (progress >= 1) { sys.rings.splice(k, 1); continue; }
            const radius = BASE_RADIUS + progress * SEQ_EXPAND;
            // quick attack then linear fade through the tone's release
            const env = (progress < 0.15 ? progress / 0.15 : 1) * (1 - progress);
            const [r, g, b] = ring.color;
            const alpha = SEQ_OPACITY * env * fadeK;
            if (alpha <= 0.001) continue;
            ctx.beginPath();
            ctx.arc(sys.pos.x, sys.pos.y, radius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
            ctx.lineWidth = STROKE;
            ctx.stroke();
          }
        }
      });

      // Idle-aware: stop the loop when nothing is alive (no permanent per-frame cost).
      if (systems.size === 0) {
        rafRef.current = null;
      } else {
        rafRef.current = requestAnimationFrame(draw);
      }
    }

    // Debug hook (mirrors window.__engine / __bridge): lets tooling confirm the
    // overlay's rAF is idle when nothing is ringing.
    window.__ringOverlay = {
      isAnimating: () => rafRef.current != null,
      count: () => systemsRef.current.size,
    };

    return () => {
      offs.forEach((off) => off && off());
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      systemsRef.current.clear();
    };
  }, [engine]);

  return <canvas ref={canvasRef} style={styles.canvas} />;
}

const styles = {
  canvas: {
    position: "fixed",
    inset: 0,
    pointerEvents: "none", // never intercept engine mouse events
    zIndex: 4,             // above the engine canvas, below the HUD/labels/panels
  },
};
