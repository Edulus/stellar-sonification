// Melody mode controls (top-left HUD): preset selector, ▶/■, HONEST toggle.
// Styled to match GroundToggle / LocationPicker — they share the same HUD row.
//
// Pressing ▶ assigns the stars in view to the melody's pitches (App.jsx →
// melodies/melody.js) and plays it; ■ stops audio and clears every pulse.
// A one-line status shows how many stars were assigned and flags the
// "fewer stars than pitches" fallback.
//
// "+ MIDI" opens a file picker for a Standard MIDI File (App.handleImportMidi).
// When the selected melody came from a MIDI file with several pitched tracks,
// a VOICE picker appears so a different track (or all, top note) can be used.

import { useRef } from "react";

// `melodies` is presets first, then imported melodies (presetCount splits
// them); imported ones appear under their own heading in the selector.
export default function MelodyControl({
  disabled, melodies, presetCount, presetIndex, onPresetChange, honest, onHonestChange, playing, onPlay, onStop, status,
  onImportMidi, trackOptions, track, onTrackChange,
  chordSampleStart = presetCount, midiChords, onMidiChordsChange,
  haloStyle, onHaloStyleChange,
}) {
  const fileRef = useRef(null);
  const presets = melodies.slice(0, chordSampleStart);
  const samples = melodies.slice(chordSampleStart, presetCount); // CHORDS PROTOTYPE
  const imported = melodies.slice(presetCount);
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
          {imported.length || samples.length ? (
            <>
              <optgroup label="Built-in">
                {presets.map((p, i) => <option key={`p${i}`} value={i}>{p.name}</option>)}
              </optgroup>
              {samples.length > 0 && (
                <optgroup label="Chords (preview)">
                  {samples.map((p, i) => <option key={`c${i}`} value={chordSampleStart + i}>{p.name}</option>)}
                </optgroup>
              )}
              {imported.length > 0 && (
                <optgroup label="Imported">
                  {imported.map((p, i) => <option key={`u${i}`} value={presetCount + i}>{p.name}</option>)}
                </optgroup>
              )}
            </>
          ) : (
            presets.map((p, i) => <option key={`p${i}`} value={i}>{p.name}</option>)
          )}
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
        <button
          onClick={() => fileRef.current?.click()}
          style={S.button(false, false)}
          title="Import a melody from a MIDI file (.mid; also .rmi and BinHex .hqx)"
          aria-label="Import MIDI file"
        >
          + MIDI
        </button>
        {onMidiChordsChange && (
          <button
            onClick={() => onMidiChordsChange(!midiChords)}
            style={S.button(midiChords, false)}
            title="MIDI imports: keep whole chords (each tone on its own star) instead of only the top note"
            aria-pressed={midiChords}
            aria-label="Keep chords from MIDI"
          >
            CHORDS <span style={S.state}>{midiChords ? "ON" : "OFF"}</span>
          </button>
        )}
        {onHaloStyleChange && (
          <button
            onClick={() => onHaloStyleChange(haloStyle === "bright" ? "dark" : "bright")}
            style={S.button(false, false)}
            title="Wave style: the star's lines as BRIGHT rings on a faint spectrum, or as DARK rings on a full rainbow"
            aria-label="Wave ring style"
          >
            RINGS <span style={S.state}>{haloStyle === "bright" ? "BRIGHT" : "DARK"}</span>
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".mid,.midi,.kar,.rmi,.hqx,audio/midi,audio/x-midi"
          style={{ display: "none" }}
          aria-label="MIDI file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = ""; // same file can be picked again
            if (f) onImportMidi?.(f);
          }}
        />
        {trackOptions && trackOptions.length > 1 && (
          <label style={S.voice}>
            VOICE
            <select
              value={String(track)}
              onChange={(e) => onTrackChange?.(e.target.value === "all" ? "all" : Number(e.target.value))}
              style={S.select}
              aria-label="MIDI voice"
            >
              {trackOptions.map((t) => (
                <option key={t.index} value={t.index}>{t.name} · {t.count} notes</option>
              ))}
              <option value="all">All tracks (top note)</option>
            </select>
          </label>
        )}
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
  label: { fontFamily: mono, fontSize: 12, letterSpacing: 1, color: "rgba(200,208,225,0.92)", whiteSpace: "nowrap" },
  select: {
    background: "rgba(20,24,36,0.9)", color: "rgba(220,226,240,0.95)",
    border: "1px solid rgba(100,110,135,0.45)", borderRadius: 2,
    fontFamily: mono, fontSize: 12, padding: "2px 4px", maxWidth: 170, minWidth: 0, flexShrink: 1,
  },
  button: (on, disabled) => ({
    background: on ? "rgba(120,150,200,0.18)" : "transparent",
    border: `1px solid ${on ? "rgba(120,150,200,0.6)" : "rgba(100,110,135,0.45)"}`,
    color: disabled ? "rgba(150,155,170,0.5)" : on ? "rgba(190,210,250,0.98)" : "rgba(200,208,225,0.92)",
    fontFamily: mono, fontSize: 12, letterSpacing: 1,
    padding: "3px 8px", borderRadius: 2,
    cursor: disabled ? "default" : "pointer", whiteSpace: "nowrap",
  }),
  state: { opacity: 0.6, marginLeft: 2 },
  voice: { display: "flex", alignItems: "center", gap: 4, fontFamily: mono, fontSize: 12, letterSpacing: 1, color: "rgba(200,208,225,0.8)" },
  status: (warn) => ({
    fontFamily: mono, fontSize: 12, letterSpacing: 0.5,
    color: warn ? "rgba(255,200,120,0.95)" : "rgba(200,208,225,0.75)",
    textShadow: "0 1px 2px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.85)",
    paddingLeft: 2, maxWidth: 360,
  }),
};
