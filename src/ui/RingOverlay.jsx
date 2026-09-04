import { useEffect, useRef } from "react";
import { wlToRGB } from "../audio/color.js";

// Star band animation overlay. A transparent canvas over the engine canvas that
// draws colored ripple bands emanating from a singing star — one band per
// absorption line, colored by that line's wavelength. It is a *pure visual
// function of audio state*: the SonificationEngine emits
//   starChordStart / starLineStart / starFadeStart / starStopped
// and the overlay only reacts. Sequence tones emit once; sustained chords pulse
// while held. When audio fades, every in-flight band force-fades on that same
// release curve; when it stops, the star's bands are removed. Never touches the
// engine's WebGL context, and never intercepts mouse events (pointer-events:none).

// Tuned visual values, intentionally fixed rather than exposed as panel controls.
// 200/130/16/1.5 were tuned in the sandbox for the ripple's travel, stretch,
// birth thickness, and decay. The 0.6 s chord pulse was then validated in the
// deployed six-star visual pass: a six-second hold read as continuous water
// ripples rather than a metronomic clock. Reopen these only for a deliberate
// visual retune, not as incidental cleanup.
const BASE_RADIUS = 14;
const BAND_SPEED = 200;       // px/s — leading edge travel
const BAND_STRETCH = 130;     // px/s — thickening as it travels
const BAND_THICKNESS = 16;    // px   — thickness at birth
const BAND_FADE = 1.5;        // exponent on the overall fade
const BAND_PULSE_PERIOD = 0.6; // s — spacing between bands while a chord is held

export default function RingOverlay({ engine }) {
  const canvasRef = useRef(null);
  const systemsRef = useRef(new Map()); // starKey -> band system
  const rafRef = useRef(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });

  // Size the backing store to match the engine canvas (CSS size × dpr) so bands
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

  // Subscribe to the audio layer's overlay events.
  useEffect(() => {
    if (!engine) return;
    const now = () => performance.now();

    const ensureRaf = () => {
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(draw);
    };

    const makeBand = (line, born, life, birthThickness = null) => {
      const band = {
        born,
        life,
        rgb: wlToRGB(line.wl),
        peak: 0.35 + line.depth * 0.55,
      };
      if (birthThickness != null) band.birthThickness = birthThickness;
      return band;
    };

    const emitChordPulse = (sys, born) => {
      const n = sys.lines.length;
      sys.lines.forEach((line, rank) => {
        const rankFrac = n <= 1 ? 0 : rank / (n - 1);
        const birthThickness = BAND_THICKNESS * (0.55 + 0.45 * (1 - rankFrac));
        sys.bands.push(makeBand(line, born, sys.life, birthThickness));
      });
      sys.lastPulseT = born;
    };

    const onChordStart = ({ starKey, screenPos, lines }) => {
      if (!screenPos) return;
      const born = now();
      const sys = {
        mode: "chord",
        pos: screenPos,
        lines: lines || [], // EW-desc as received
        life: engine.params.toneDuration,
        bands: [],
        lastPulseT: born,
        fadeStartT: null,
        fadeDur: 0,
      };
      systemsRef.current.set(starKey, sys);
      emitChordPulse(sys, born); // first pulse is at chord onset
      ensureRaf();
    };

    const onLineStart = ({ starKey, line, durationSec, screenPos }) => {
      let sys = systemsRef.current.get(starKey);
      if (!sys) {
        sys = { mode: "sequence", pos: screenPos, bands: [], fadeStartT: null, fadeDur: 0 };
        systemsRef.current.set(starKey, sys);
      }
      if (screenPos) sys.pos = screenPos;
      if (sys.fadeStartT != null) return; // fading: no new bands
      sys.bands.push(makeBand(line, now(), durationSec));
      ensureRaf();
    };

    const onFadeStart = ({ starKey, fadeDurationSec }) => {
      const sys = systemsRef.current.get(starKey);
      if (!sys) return;
      // This same event covers ordinary hover release and force-fade-oldest.
      // Chord pulse spawning stops immediately because draw() only pulses while
      // fadeStartT is null; every visible band then follows this audio fade.
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
      ctx.globalCompositeOperation = "lighter";

      systems.forEach((sys) => {
        // A sustained chord sheds another pulse only while audio is held. The
        // next pulse is timed from the previous actual emission, so a throttled
        // frame never causes a catch-up burst of wall-clock pulses.
        if (
          sys.mode === "chord" &&
          sys.fadeStartT == null &&
          (t - sys.lastPulseT) / 1000 >= BAND_PULSE_PERIOD
        ) {
          emitChordPulse(sys, t);
        }

        for (let k = sys.bands.length - 1; k >= 0; k -= 1) {
          const band = sys.bands[k];
          const age = (t - band.born) / 1000;
          const u = age / band.life;

          let alpha;
          if (sys.fadeStartT != null) {
            // Force-fade overrides natural life: hold the alpha the band had at
            // release, then take exactly the audio release duration to reach 0.
            const fadeAge = (t - sys.fadeStartT) / 1000;
            if (fadeAge >= sys.fadeDur) continue;
            const releaseAge = Math.max(0, (sys.fadeStartT - band.born) / 1000);
            const releaseU = Math.min(1, releaseAge / band.life);
            const releaseAlpha = Math.pow(1 - releaseU, BAND_FADE) * band.peak;
            alpha = releaseAlpha * Math.max(0, 1 - fadeAge / sys.fadeDur);
          } else {
            if (u >= 1) { sys.bands.splice(k, 1); continue; }
            alpha = Math.pow(1 - u, BAND_FADE) * band.peak;
          }

          const outer = BASE_RADIUS + BAND_SPEED * age;
          const birthThickness = band.birthThickness ?? BAND_THICKNESS;
          const inner = Math.max(0, outer - (birthThickness + BAND_STRETCH * age));
          if (alpha <= 0.002 || outer <= 0) continue;

          const [r, g, b] = band.rgb;
          const innerStop = Math.min(0.999, inner / outer);
          const grad = ctx.createRadialGradient(sys.pos.x, sys.pos.y, 0, sys.pos.x, sys.pos.y, outer);
          grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
          grad.addColorStop(innerStop, `rgba(${r},${g},${b},0)`);
          grad.addColorStop(
            Math.min(0.999, innerStop + (1 - innerStop) * 0.55),
            `rgba(${r},${g},${b},${alpha * 0.35})`
          );
          grad.addColorStop(0.985, `rgba(${r},${g},${b},${alpha})`);
          grad.addColorStop(1, `rgba(${r},${g},${b},${alpha * 0.45})`);

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(sys.pos.x, sys.pos.y, outer, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      ctx.globalCompositeOperation = "source-over";

      // Idle-aware: stop the loop when nothing is alive (no permanent per-frame cost).
      if (systems.size === 0) {
        rafRef.current = null;
      } else {
        rafRef.current = requestAnimationFrame(draw);
      }
    }

    // Debug hook name stays stable for existing tooling even though rings are now bands.
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
