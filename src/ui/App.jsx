import { useCallback, useEffect, useRef, useState } from "react";
import SkyCanvas from "./SkyCanvas.jsx";
import SynthPanel from "./SynthPanel.jsx";
import SpectrumPanel from "./SpectrumPanel.jsx";
import LocationPicker from "./LocationPicker.jsx";
import GroundToggle from "./GroundToggle.jsx";
import TimeControl from "./TimeControl.jsx";
import RingOverlay from "./RingOverlay.jsx";
import ObjectTooltip from "./ObjectTooltip.jsx";
import MelodyControl from "./MelodyControl.jsx";
import useMinWidth from "./useMinWidth.js";
import { MELODY_PRESETS } from "../melodies/presets.js";
import { assignStars, distinctPitches, planMelody, driftStats } from "../melodies/melody.js";
import { SonificationEngine } from "../audio/SonificationEngine.js";
import { StarDataResolver } from "../data/StarDataResolver.js";
import { DEFAULT_PARAMS } from "../audio/mappings.js";
import { keyForStar } from "../audio/seededMusic.js";
import { ALL_SITES } from "../data/locations.js";

// App shell: click a star -> resolve spectral data (curated or template) -> hear
// it sing + see its spectrum. The Synth Character panel (right edge; a bottom
// sheet on phones) retunes the
// sonification live; the Spectrum panel (bottom) visualizes and lets you click
// individual lines.

const WIDE_HUD_MIN_PX = 1440;

export default function App() {
  const engineRef = useRef(null);
  const resolverRef = useRef(null);
  if (!engineRef.current) {
    engineRef.current = new SonificationEngine();
    // Product invariant: only one star may sing at a time. Keep the engine's
    // own hover admission cap at one as a second line of defense.
    engineRef.current.MAX_HOVER_STARS = 1;
  }
  if (!resolverRef.current) resolverRef.current = new StarDataResolver();

  const [data, setData] = useState(null); // resolved spectral data for selection
  const [playingIdx, setPlayingIdx] = useState(null); // line index highlighted (sequence)
  const [chordIndices, setChordIndices] = useState(null); // lines lit together (chord)
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [location, setLocation] = useState(ALL_SITES[0]); // observing site
  // Ground/horizon visibility. Off by default, matching config.js's
  // nightSky.landscape (the engine's own starting state) so this toggle never
  // has to "catch up" to a mismatched initial render.
  const [groundVisible, setGroundVisible] = useState(false);
  const groundVisibleRef = useRef(groundVisible);
  useEffect(() => { groundVisibleRef.current = groundVisible; }, [groundVisible]);
  const [mode, setMode] = useState("seed"); // 'sequential' | 'chord' | 'seed'
  // SEED mode: "" means derive the seed from the star itself, so a given star
  // always plays the same piece. Typing (or rerolling) overrides it.
  const [seed, setSeed] = useState("");
  const bridgeRef = useRef(null); // set once the engine is ready
  // Re-render trigger for children (TimeControl) that need the live bridge
  // instance itself, not just a fire-and-forget ref call — bridgeRef.current
  // is already assigned by the time this flips true (same tick, see below).
  const [bridgeReady, setBridgeReady] = useState(false);

  // Hover mode: when enabled, mousing over a star in the sky triggers audio.
  const [hoverEnabled, setHoverEnabled] = useState(false);
  const [hoverType, setHoverType] = useState("chord");   // 'chord' | 'sequence' | 'seed'
  const [hoverRepeat, setHoverRepeat] = useState("once"); // 'once' | 'loop' (sequence only)
  const [hoveredStar, setHoveredStar] = useState(null);   // star currently singing under the cursor
  // Hover *tooltip* — independent of hover audio: pointing at anything in the
  // sky always identifies it, whether or not hover mode is on.
  const [hoverTarget, setHoverTarget] = useState(null);   // {info, x, y, key}

  // Melody mode: a preset played across the brightest stars in view.
  const [melodyPreset, setMelodyPreset] = useState(0);
  const [melodyHonest, setMelodyHonest] = useState(false);
  const [melodyPlaying, setMelodyPlaying] = useState(false);
  const [melodyStatus, setMelodyStatus] = useState(null); // {text, warn}
  const hoverStarKeyRef = useRef(null); // the one star currently admitted to hover audio
  const hoverPlaybackTypeRef = useRef(null); // actual mode started for that star

  // Refs mirror state so the SkyCanvas handlers (and engine callbacks) can read
  // current values while staying referentially stable — changing their identity
  // would re-run SkyCanvas's effect and tear down/rebuild the engine.
  const locationRef = useRef(location);
  const modeRef = useRef(mode);
  const dataRef = useRef(data);
  const seedRef = useRef(seed);
  const singleClearRef = useRef(null);
  useEffect(() => { locationRef.current = location; }, [location]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { seedRef.current = seed; }, [seed]);

  // Refs for hover state — same stable-identity reason as above.
  const hoverEnabledRef = useRef(hoverEnabled);
  const hoverTypeRef = useRef(hoverType);
  const hoverRepeatRef = useRef(hoverRepeat);
  useEffect(() => { hoverEnabledRef.current = hoverEnabled; }, [hoverEnabled]);
  useEffect(() => { hoverTypeRef.current = hoverType; }, [hoverType]);
  useEffect(() => { hoverRepeatRef.current = hoverRepeat; }, [hoverRepeat]);

  // Immediate hover cutoff used when another star is about to start sounding.
  // Normal cursor-leave still uses the configured fade for CHORD/SEQ; replacement
  // cannot overlap because only one star may sing at a time. SEED uses the normal
  // click-playback pool, so it is explicitly stopped here.
  const cutHoverAudio = useCallback(() => {
    const engine = engineRef.current;
    [...engine.hoverStars.keys()].forEach((key) => engine._hardStopHoverStar(key));
    if (hoverPlaybackTypeRef.current === "seed") engine.stop();
    hoverStarKeyRef.current = null;
    hoverPlaybackTypeRef.current = null;
    setHoveredStar(null);
  }, []);

  // Play resolved star data in the currently-selected mode.
  const playInMode = useCallback((resolved) => {
    if (!resolved) return;
    if (modeRef.current === "chord") engineRef.current.playChord(resolved);
    else if (modeRef.current === "seed") {
      // An empty override means "seed from the star" (seededMusic.seedForStar).
      engineRef.current.playSeed(resolved, { seed: seedRef.current || undefined });
    } else engineRef.current.playSequence(resolved);
  }, []);

  // The engine applies config.defaultLocation itself on init; if the user had
  // already picked a different site before the engine finished loading, sync it.
  const handleBridgeReady = useCallback((bridge) => {
    bridgeRef.current = bridge;
    const loc = locationRef.current;
    if (loc.name !== ALL_SITES[0].name) {
      bridge.setLocation(loc.lat, loc.lng, loc.elevation);
    }
    // Same reasoning: the user may have flipped the ground toggle before the
    // engine finished loading. Default is false, matching the engine's own
    // starting state, so this is only ever needed when it's true.
    if (groundVisibleRef.current) bridge.setLandscapeVisible(true);
    setBridgeReady(true);
  }, []);

  const handleGroundToggle = useCallback((next) => {
    setGroundVisible(next);
    bridgeRef.current?.setLandscapeVisible(next);
  }, []);

  const handleLocationSelect = useCallback((site) => {
    setLocation(site);
    bridgeRef.current?.setLocation(site.lat, site.lng, site.elevation);
  }, []);

  // Playback highlight: sequence steps drive playingIdx; chords light all lines.
  useEffect(() => {
    engineRef.current.onStep = (idx) => setPlayingIdx(idx);
    engineRef.current.onChord = (idxs) => setChordIndices(idxs);
    engineRef.current.onMelodyEnd = () => setMelodyPlaying(false);
    // Debug hook (mirrors window.__bridge / __stel in SkyCanvas).
    window.__engine = engineRef.current;
  }, []);

  // Unlock audio on the first user gesture (autoplay policy).
  useEffect(() => {
    const unlock = () => engineRef.current?.ensureContext();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  // Clicking a star opens its spectrum but stays silent — playback is explicit,
  // via the panel's ▶ button. Any previous star, including hover audio, is cut so
  // sound never outlives the spectrum that produced it.
  const handleStarSelected = useCallback((star) => {
    const resolved = resolverRef.current.resolve(star);
    cutHoverAudio();
    engineRef.current.stop();
    setData(resolved);
    setSeed(""); // back to this star's own seed; a reroll was for the old star
  }, [cutHoverAudio]);

  // Hover enter: resolve the hovered star and make it the sole sounding star.
  // A new hover star immediately replaces any prior hover or panel playback.
  // CHORD = sustained, SEQ = arpeggio, SEED = the star's deterministic piece.
  const handleStarHovered = useCallback((star) => {
    // Tooltip first — it is not gated on hover audio.
    if (star.info) {
      setHoverTarget({ info: star.info, x: star.screenX, y: star.screenY, key: star.starKey });
    }
    if (!hoverEnabledRef.current) return;
    const resolved = resolverRef.current.resolve(star);
    const key = star.starKey;
    const pos = { x: star.screenX, y: star.screenY };

    // Repeated events for the same still-ringing star are idempotent. Moving to
    // another star cuts the previous one before the new star starts, so there is
    // never an audible cross-star overlap.
    if (hoverStarKeyRef.current === key) return;

    cutHoverAudio();
    engineRef.current.stop();
    hoverStarKeyRef.current = key;
    hoverPlaybackTypeRef.current = hoverTypeRef.current;

    // resolve() returns a fresh object; carry the star's screen position through
    // so the label can be drawn on the star.
    setHoveredStar({ ...resolved, starKey: key, screenX: star.screenX, screenY: star.screenY });
    if (hoverTypeRef.current === "chord") {
      engineRef.current.startHoverChord(key, resolved, pos);
    } else if (hoverTypeRef.current === "sequence") {
      engineRef.current.startHoverSequence(key, resolved, pos, {
        loop: hoverRepeatRef.current === "loop",
      });
    } else {
      // Hover SEED uses the existing deterministic composer. With no override,
      // the star's own stable identity is its seed, matching normal SEED mode.
      engineRef.current.playSeed(resolved);
    }
  }, [cutHoverAudio]);

  // Cursor left all stars → wind CHORD/SEQ down with the normal configured fade.
  // Hover SEED uses the click-playback pool, so it is stopped on leave.
  const handleStarUnhovered = useCallback(() => {
    setHoverTarget(null);
    setHoveredStar(null);
    const activeType = hoverPlaybackTypeRef.current;
    hoverStarKeyRef.current = null;
    hoverPlaybackTypeRef.current = null;
    if (activeType === "seed") engineRef.current.stop();
    else engineRef.current.fadeAllHover(engineRef.current.params.hoverFadeOut);
  }, []);

  // Turning hover mode off silences whichever hover mode is currently active.
  useEffect(() => {
    if (!hoverEnabled) {
      const activeType = hoverPlaybackTypeRef.current;
      hoverStarKeyRef.current = null;
      hoverPlaybackTypeRef.current = null;
      setHoveredStar(null);
      if (activeType === "seed") engineRef.current.stop();
      else engineRef.current.fadeAllHover(engineRef.current.params.hoverFadeOut);
    }
  }, [hoverEnabled]);

  const handleDeselected = useCallback(() => {
    cutHoverAudio();
    engineRef.current.stop();
    setData(null);
    setPlayingIdx(null);
    setChordIndices(null);
  }, [cutHoverAudio]);

  // The panel's ▶: play the current star in the current mode. This is the only
  // way a click-selected star makes sound; it replaces any hover star first.
  const handleReplay = useCallback(() => {
    cutHoverAudio();
    engineRef.current.ensureContext(); // this click is the user gesture
    playInMode(dataRef.current);
  }, [cutHoverAudio, playInMode]);

  // The panel's ■: cut all playback without dismissing the spectrum.
  const handleStop = useCallback(() => {
    cutHoverAudio();
    engineRef.current.stop();
  }, [cutHoverAudio]);

  // Switch sequence <-> chord. Silent, like selection: it arms the next ▶ press
  // rather than starting a melody the user didn't ask for.
  const handleModeChange = useCallback((next) => {
    setMode(next);
    modeRef.current = next;
    engineRef.current.stop();
  }, []);

  // Play one line (from clicking it in the spectrum panel). A hover star is cut
  // first so this selected star remains the sole source of audio.
  const handlePlayLine = useCallback((idx) => {
    const d = data;
    if (!d) return;
    cutHoverAudio();
    engineRef.current.playLine(d.lines[idx], d.rv ?? 0);
    setPlayingIdx(idx);
    clearTimeout(singleClearRef.current);
    singleClearRef.current = setTimeout(
      () => setPlayingIdx(null),
      engineRef.current.params.toneDuration * 1000
    );
  }, [cutHoverAudio, data]);

  // Melody ▶: lock stars to pitches from the current view, then play. Starting
  // a melody stops any chord / sequence / SEED / hover playback first (stop()).
  const handleMelodyPlay = useCallback(() => {
    const bridge = bridgeRef.current;
    const engine = engineRef.current;
    if (!bridge) return;
    cutHoverAudio();
    engine.stop();
    engine.ensureContext(); // this click is the user gesture

    const preset = MELODY_PRESETS[melodyPreset];
    const n = distinctPitches(preset).length;
    // The N brightest stars the engine is actually drawing (on screen is not
    // enough at wide FOV — MELODY-FINDINGS §8-B). Only those N can be assigned,
    // so only they are resolved (every star resolves: tier 4 is a catch-all).
    const visible = bridge.listVisibleStars({
      aboveHorizonOnly: groundVisibleRef.current, drawnOnly: true, limit: n,
    });
    const candidates = visible.map((s, i) => {
      const r = resolverRef.current.resolve(s);
      return {
        key: `melody:${s.name ?? (s.hip != null ? `HIP ${s.hip}` : i)}`,
        name: r.name, hip: s.hip, bv: s.bv, magnitude: s.magnitude,
        temp: r.temp, rv: r.rv ?? 0, color: r.color, lines: r.lines,
        type: r.type, dataSource: r.dataSource, radecICRF: s.radecICRF,
      };
    });
    const assignment = assignStars(candidates, preset);
    if (!assignment.stars.length) {
      window.__melody = { preset: preset.name, honest: melodyHonest, visible: visible.onScreen ?? 0, drawn: 0, assignment, plan: null, drift: null };
      console.warn(`[melody] no stars in view for ${assignment.needed} pitches`);
      setMelodyStatus({ text: "No stars in view", warn: true });
      return;
    }
    const plan = planMelody(preset, assignment, { honest: melodyHonest, params: engine.params });
    const drift = melodyHonest ? driftStats(plan.events) : null;
    if (assignment.fallback) {
      console.warn(`[melody] ${assignment.available} stars for ${assignment.needed} pitches — cycling in temperature order`);
    }
    window.__melody = { preset: preset.name, honest: melodyHonest, visible: visible.onScreen, drawn: visible.length, assignment, plan, drift };

    engine.playMelody(plan, { getPos: (star) => bridge.projectToScreen(star.radecICRF) });
    setMelodyPlaying(true);
    const base = assignment.fallback
      ? `Only ${assignment.available} stars for ${assignment.needed} pitches — cycling`
      : `${assignment.available} stars · coolest ${assignment.stars[0].name} → hottest ${assignment.stars[assignment.stars.length - 1].name}`;
    const extra = drift ? ` · drift avg ${drift.meanAbs.toFixed(1)} st, max ${drift.maxAbs.toFixed(1)}` : "";
    setMelodyStatus({ text: base + extra, warn: assignment.fallback });
  }, [cutHoverAudio, melodyPreset, melodyHonest]);

  // Melody ■: halt audio and clear every pulse (stop() → starStopped per star).
  const handleMelodyStop = useCallback(() => {
    engineRef.current.stop();
    setMelodyPlaying(false);
  }, []);

  // The centred hint only fits beside the top-left buttons on wide screens
  // (~460 px of hint centred against ~470 px of buttons → needs ≥ 1440 px).
  const wideHud = useMinWidth(WIDE_HUD_MIN_PX);
  const hintText = hoverEnabled ? "Hover a star to hear it sing" : "Click a star for its spectrum · ▶ to hear it sing";

  const handleParamChange = useCallback((patch) => {
    engineRef.current.setParams(patch);
    setParams((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleParamReset = useCallback(() => {
    engineRef.current.setParams(DEFAULT_PARAMS);
    setParams(DEFAULT_PARAMS);
  }, []);

  return (
    <>
      <SkyCanvas
        onStarSelected={handleStarSelected}
        onDeselected={handleDeselected}
        onReady={handleBridgeReady}
        onStarHovered={handleStarHovered}
        onStarUnhovered={handleStarUnhovered}
      />

      <RingOverlay engine={engineRef.current} />

      {/* Top-left HUD: one column that flows on any width. Row 1 (site, ground,
          clock) wraps on phones; melody gets its own row below; the hint joins
          the column when there is no room to centre it clear of the buttons. */}
      <div style={styles.hudLeft}>
        <div style={styles.topLeftBar}>
          {/* Stacking wrappers: when the row wraps, the clock button lands under
              the site picker, so the picker (and its drawer) must sit higher. */}
          <div style={styles.layerTop}>
            <LocationPicker location={location} onSelect={handleLocationSelect} />
          </div>
          <GroundToggle visible={groundVisible} onToggle={handleGroundToggle} />
          <div style={styles.layerMid}>
            <TimeControl bridge={bridgeReady ? bridgeRef.current : null} />
          </div>
        </div>

        <div style={styles.melodyBar}>
          <MelodyControl
          disabled={!bridgeReady}
          presetIndex={melodyPreset}
          onPresetChange={setMelodyPreset}
          honest={melodyHonest}
          onHonestChange={setMelodyHonest}
          playing={melodyPlaying}
          onPlay={handleMelodyPlay}
          onStop={handleMelodyStop}
            status={melodyStatus}
          />
        </div>

        {!wideHud && <div style={styles.hintInline}>{hintText}</div>}
      </div>

      {wideHud && (
        <div style={styles.hud}>
          <div style={styles.hint}>{hintText}</div>
        </div>
      )}

      {/* Hover readout, pinned beside whatever the cursor is over. The ♪ marks a
          star that is currently singing (hover audio), so the old standalone
          singing label folds into this one card. */}
      {hoverTarget && (
        <ObjectTooltip
          info={hoverTarget.info}
          x={hoverTarget.x}
          y={hoverTarget.y}
          singing={!!hoveredStar && hoveredStar.starKey === hoverTarget.key}
        />
      )}

      {data && (
        <SpectrumPanel
          data={data}
          playingIdx={playingIdx}
          chordIndices={chordIndices}
          playing={playingIdx != null || chordIndices != null}
          mode={mode}
          onModeChange={handleModeChange}
          seed={seed}
          onSeedChange={setSeed}
          seedInfo={mode === "seed" ? keyForStar(data, params) : null}
          onReplay={handleReplay}
          onStop={handleStop}
          onPlayLine={handlePlayLine}
          onClose={handleDeselected}
        />
      )}

      <SynthPanel
        params={params}
        onChange={handleParamChange}
        onReset={handleParamReset}
        hoverEnabled={hoverEnabled}
        onHoverEnabled={setHoverEnabled}
        hoverType={hoverType}
        onHoverType={setHoverType}
        hoverRepeat={hoverRepeat}
        onHoverRepeat={setHoverRepeat}
      />
    </>
  );
}

const styles = {
  hudLeft: {
    position: "fixed",
    top: 16,
    left: 16,
    right: 44, // stay clear of the SYNTH edge tab (26 px) on narrow screens
    zIndex: 20,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 8,
    pointerEvents: "none", // the column's empty area must not block the sky
  },
  topLeftBar: {
    position: "relative",
    zIndex: 2, // above the melody row, so the site/clock drawers open over it
    display: "flex",
    flexWrap: "wrap", // phones: the clock button drops to a second line
    alignItems: "flex-start", // the drawer opening below LocationPicker must not push GroundToggle down
    gap: 8,
    pointerEvents: "auto",
  },
  layerTop: { position: "relative", zIndex: 3 },
  layerMid: { position: "relative", zIndex: 2 },
  melodyBar: {
    position: "relative",
    zIndex: 1,
    maxWidth: "100%",
    pointerEvents: "auto",
  },
  hintInline: {
    fontFamily: "'IBM Plex Mono', 'Menlo', monospace",
    fontSize: 10,
    letterSpacing: 1.5,
    color: "rgba(225,232,245,0.8)",
    textTransform: "uppercase",
    textShadow: "0 1px 2px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.85), 0 0 14px rgba(0,0,0,0.6)",
    paddingLeft: 2,
  },
  hud: {
    position: "fixed",
    left: 0,
    right: 0,
    top: 16,
    display: "flex",
    justifyContent: "center",
    pointerEvents: "none",
    fontFamily: "'IBM Plex Mono', 'Menlo', monospace",
    // Two-layer halo: a tight, near-opaque shadow to hold an edge against a
    // bright star or cluster sitting right behind the text, plus a wider soft
    // one for the general case. A single soft blur (the old rule) turns to
    // fog over anything brighter than empty sky.
    textShadow: "0 1px 2px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.85), 0 0 14px rgba(0,0,0,0.6)",
  },
  hint: {
    fontSize: 12,
    letterSpacing: 2,
    color: "rgba(225,232,245,0.85)",
    textTransform: "uppercase",
  },
};