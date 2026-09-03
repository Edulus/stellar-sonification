import { useCallback, useEffect, useRef, useState } from "react";
import SkyCanvas from "./SkyCanvas.jsx";
import SynthPanel from "./SynthPanel.jsx";
import SpectrumPanel from "./SpectrumPanel.jsx";
import LocationPicker from "./LocationPicker.jsx";
import GroundToggle from "./GroundToggle.jsx";
import RingOverlay from "./RingOverlay.jsx";
import ObjectTooltip from "./ObjectTooltip.jsx";
import { SonificationEngine } from "../audio/SonificationEngine.js";
import { StarDataResolver } from "../data/StarDataResolver.js";
import { DEFAULT_PARAMS } from "../audio/mappings.js";
import { keyForStar } from "../audio/seededMusic.js";
import { ALL_SITES } from "../data/locations.js";

// App shell: click a star -> resolve spectral data (curated or template) -> hear
// it sing + see its spectrum. The Synth Character panel (right) retunes the
// sonification live; the Spectrum panel (bottom) visualizes and lets you click
// individual lines.

export default function App() {
  const engineRef = useRef(null);
  const resolverRef = useRef(null);
  if (!engineRef.current) engineRef.current = new SonificationEngine();
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

  // Hover mode: when enabled, mousing over a star in the sky triggers audio.
  const [hoverEnabled, setHoverEnabled] = useState(false);
  const [hoverType, setHoverType] = useState("chord");   // 'chord' | 'sequence'
  const [hoverRepeat, setHoverRepeat] = useState("once"); // 'once' | 'loop'
  const [hoveredStar, setHoveredStar] = useState(null);   // star currently singing under the cursor
  // Hover *tooltip* — independent of hover audio: pointing at anything in the
  // sky always identifies it, whether or not hover mode is on.
  const [hoverTarget, setHoverTarget] = useState(null);   // {info, x, y, key}

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
  // via the panel's ▶ button. (Hover mode is the other, deliberately automatic
  // path; it is unaffected by this.) Any previous star's melody is cut so the
  // sound never outlives the spectrum that produced it.
  const handleStarSelected = useCallback((star) => {
    const resolved = resolverRef.current.resolve(star);
    engineRef.current.stop();
    setData(resolved);
    setSeed(""); // back to this star's own seed; a reroll was for the old star
  }, []);

  // Hover enter: resolve the hovered star and start hover audio, keyed by the
  // star's stable id so up to 3 can ring at once (the engine caps + force-fades
  // the oldest). Chord = sustained; sequence = arpeggio (looping if set).
  const handleStarHovered = useCallback((star) => {
    // Tooltip first — it is not gated on hover audio.
    if (star.info) {
      setHoverTarget({ info: star.info, x: star.screenX, y: star.screenY, key: star.starKey });
    }
    if (!hoverEnabledRef.current) return;
    const resolved = resolverRef.current.resolve(star);
    const key = star.starKey;
    const pos = { x: star.screenX, y: star.screenY };
    // resolve() returns a fresh object; carry the star's screen position through
    // so the label can be drawn on the star.
    setHoveredStar({ ...resolved, starKey: key, screenX: star.screenX, screenY: star.screenY }); // surface which star is singing
    if (hoverTypeRef.current === "chord") {
      engineRef.current.startHoverChord(key, resolved, pos);
    } else {
      engineRef.current.startHoverSequence(key, resolved, pos, {
        loop: hoverRepeatRef.current === "loop",
      });
    }
  }, []);

  // Cursor left all stars → wind every ringing star down with the rapid fade.
  const handleStarUnhovered = useCallback(() => {
    setHoverTarget(null);
    setHoveredStar(null);
    engineRef.current.fadeAllHover(engineRef.current.params.hoverFadeOut);
  }, []);

  // Turning hover mode off fades any stars still ringing.
  useEffect(() => {
    if (!hoverEnabled) engineRef.current.fadeAllHover(engineRef.current.params.hoverFadeOut);
  }, [hoverEnabled]);

  const handleDeselected = useCallback(() => {
    engineRef.current.stop();
    setData(null);
    setPlayingIdx(null);
    setChordIndices(null);
  }, []);

  // The panel's ▶: play the current star in the current mode. This is the only
  // way a click-selected star makes sound.
  const handleReplay = useCallback(() => {
    engineRef.current.ensureContext(); // this click is the user gesture
    playInMode(dataRef.current);
  }, [playInMode]);

  // The panel's ■: cut playback without dismissing the spectrum.
  const handleStop = useCallback(() => {
    engineRef.current.stop();
  }, []);

  // Switch sequence <-> chord. Silent, like selection: it arms the next ▶ press
  // rather than starting a melody the user didn't ask for.
  const handleModeChange = useCallback((next) => {
    setMode(next);
    modeRef.current = next;
    engineRef.current.stop();
  }, []);

  // Play one line (from clicking it in the spectrum panel).
  const handlePlayLine = useCallback((idx) => {
    const d = data;
    if (!d) return;
    engineRef.current.playLine(d.lines[idx], d.rv ?? 0);
    setPlayingIdx(idx);
    clearTimeout(singleClearRef.current);
    singleClearRef.current = setTimeout(
      () => setPlayingIdx(null),
      engineRef.current.params.toneDuration * 1000
    );
  }, [data]);

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

      <div style={styles.topLeftBar}>
        <LocationPicker location={location} onSelect={handleLocationSelect} />
        <GroundToggle visible={groundVisible} onToggle={handleGroundToggle} />
      </div>

      <div style={styles.hud}>
        <div style={styles.hint}>
          {hoverEnabled ? "Hover a star to hear it sing" : "Click a star for its spectrum · ▶ to hear it sing"}
        </div>
      </div>

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
  topLeftBar: {
    position: "fixed",
    top: 16,
    left: 16,
    zIndex: 20,
    display: "flex",
    alignItems: "flex-start", // the drawer opening below LocationPicker must not push GroundToggle down
    gap: 8,
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
