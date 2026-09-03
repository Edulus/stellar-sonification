// The 7 spectral-parameter -> audio-parameter mappings.
//
// Ported from the proven prototype, but the magic numbers are now collected in a
// tunable DEFAULT_PARAMS object so the Synth Character panel can adjust them
// live. Every mapping takes an optional `p` (params) argument; pass the engine's
// current params to apply tweaks. PARAM_GROUPS describes the UI controls.

export const SPEC_MIN = 380;
export const SPEC_MAX = 760;

export const DEFAULT_PARAMS = {
  // pitch
  pitchHighMidi: 84,        // MIDI note at SPEC_MIN (short wavelength = high pitch)
  pitchSpanSemitones: 36,   // descends this many semitones across the band
  // amplitude
  gainBase: 0.03,
  gainScale: 0.19,
  masterVolume: 1.0,
  // filter
  qMax: 18,
  qScale: 6,
  // reverb
  reverbEwDivisor: 1500,
  reverbWet: 0.45,
  reverbDry: 0.2,
  // voice
  detuneScale: 0.2,
  harmonicsEpDivisor: 21,
  // timing
  toneDuration: 1.2,        // seconds per tone
  sequenceGap: 80,          // ms between tones in a sequence
  // chord
  harmonizeAmount: 0.75,    // 0 = raw cluster, 1 = fully snapped to just-intonation
  // hover (used by SonificationEngine.playHoverChord / fadeOutHover)
  hoverFadeOut: 0.8,        // seconds to fade when mouse leaves a star
  hoverGainScale: 0.7,      // overall gain multiplier for the hover chord
  hoverMaxVoices: 6,        // cap on simultaneous voices (1–6, strongest EW first)
  hoverSpreadDetune: 0,     // Hz to fan voices apart for a chorus effect (0–8)
};

// Declarative spec for the Synth Character UI (grouped sliders).
export const PARAM_GROUPS = [
  { title: "Pitch", params: [
    { key: "pitchHighMidi", label: "High note (MIDI)", min: 48, max: 108, step: 1 },
    { key: "pitchSpanSemitones", label: "Range (semitones)", min: 0, max: 60, step: 1 },
  ]},
  { title: "Amplitude", params: [
    { key: "gainBase", label: "Floor gain", min: 0, max: 0.2, step: 0.005 },
    { key: "gainScale", label: "Depth → gain", min: 0, max: 0.5, step: 0.005 },
    { key: "masterVolume", label: "Master volume", min: 0, max: 1.5, step: 0.05 },
  ]},
  { title: "Filter", params: [
    { key: "qMax", label: "Max Q (narrow line)", min: 1, max: 30, step: 0.5 },
    { key: "qScale", label: "Width → Q falloff", min: 0, max: 15, step: 0.5 },
  ]},
  { title: "Reverb", params: [
    { key: "reverbEwDivisor", label: "EW → reverb divisor", min: 200, max: 3000, step: 50 },
    { key: "reverbWet", label: "Wet send", min: 0, max: 1, step: 0.05 },
    { key: "reverbDry", label: "Dry duck", min: 0, max: 1, step: 0.05 },
  ]},
  { title: "Voice", params: [
    { key: "detuneScale", label: "RV → detune (Hz·km/s)", min: 0, max: 1, step: 0.02 },
    { key: "harmonicsEpDivisor", label: "EP → harmonics divisor", min: 5, max: 40, step: 1 },
  ]},
  { title: "Timing", params: [
    { key: "toneDuration", label: "Tone length (s)", min: 0.3, max: 3, step: 0.1 },
    { key: "sequenceGap", label: "Sequence gap (ms)", min: 0, max: 500, step: 10 },
  ]},
  { title: "Chord", params: [
    { key: "harmonizeAmount", label: "Harmonize (cluster → snapped)", min: 0, max: 1, step: 0.05 },
  ]},
];

// 1. wavelength -> pitch (shorter λ = higher pitch)
export function wlToFreq(wl, p = DEFAULT_PARAMS) {
  const midi = p.pitchHighMidi - ((wl - SPEC_MIN) / (SPEC_MAX - SPEC_MIN)) * p.pitchSpanSemitones;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// 2. depth -> amplitude
export function depthToGain(d, p = DEFAULT_PARAMS) {
  return p.gainBase + d * p.gainScale;
}

// 3. width -> filter Q (narrow line = tight resonance)
export function widthToQ(w, p = DEFAULT_PARAMS) {
  return Math.max(0.5, p.qMax - w * p.qScale);
}

// 4. profile -> ADSR envelope shape {attack, decay, sustain_level, release}
export function profileToEnvelope(profile) {
  switch (profile) {
    case "gaussian":   return { a: 0.06, d: 0.1, s: 0.7, r: 0.06 };
    case "lorentzian": return { a: 0.01, d: 0.05, s: 0.8, r: 0.35 };
    case "voigt":      return { a: 0.03, d: 0.08, s: 0.75, r: 0.18 };
    default:           return { a: 0.05, d: 0.1, s: 0.7, r: 0.1 };
  }
}

// 5. equivalent width -> reverb send
export function ewToReverb(ew, p = DEFAULT_PARAMS) {
  return Math.min(ew / p.reverbEwDivisor, 1);
}

// 6. radial velocity -> detune in Hz
export function rvToDetune(rv, p = DEFAULT_PARAMS) {
  return rv * p.detuneScale;
}

// 7. excitation potential -> harmonic richness (0 = sine, 1 = rich)
export function epToHarmonics(ep, p = DEFAULT_PARAMS) {
  return Math.min(ep / p.harmonicsEpDivisor, 1);
}
