// Built-in melody presets for Melody mode. Hand-authored (not generated data, so
// it lives here rather than in src/data/). All three tunes are public domain.
//
// Format: { name, bpm, notes: [{ midi, beats }] }. `midi: null` is a rest.
// Single voice only. Every pitch is inside the app's pitch range, MIDI 48–84
// (DEFAULT_PARAMS.pitchHighMidi − pitchSpanSemitones … pitchHighMidi).
// `beats` are quarter-note beats; note length in seconds = beats * 60 / bpm.

const N = (midi, beats = 1) => ({ midi, beats });
const R = (beats) => ({ midi: null, beats });

// MIDI numbers, written as names so the tunes stay readable.
const G3 = 55;
const C4 = 60, D4 = 62, E4 = 64, F4 = 65, Fs4 = 66, G4 = 67, Gs4 = 68, A4 = 69, B4 = 71;
const C5 = 72, D5 = 74, E5 = 76, F5 = 77, Fs5 = 78, G5 = 79;

// Twinkle Twinkle Little Star (C major). Six distinct pitches: C D E F G A.
const twinklePhraseA = [N(C4), N(C4), N(G4), N(G4), N(A4), N(A4), N(G4, 2),
  N(F4), N(F4), N(E4), N(E4), N(D4), N(D4), N(C4, 2)];
const twinklePhraseB = [N(G4), N(G4), N(F4), N(F4), N(E4), N(E4), N(D4, 2)];
const twinkle = {
  name: "Twinkle Twinkle Little Star",
  bpm: 100,
  notes: [...twinklePhraseA, ...twinklePhraseB, ...twinklePhraseB, ...twinklePhraseA],
};

// Ode to Joy (Beethoven, Symphony No. 9 theme; C major). Six distinct pitches:
// G3 C D E F G.
const odeA = [N(E4), N(E4), N(F4), N(G4), N(G4), N(F4), N(E4), N(D4), N(C4), N(C4), N(D4), N(E4)];
const odeEnd1 = [N(E4, 1.5), N(D4, 0.5), N(D4, 2)];
const odeEnd2 = [N(D4, 1.5), N(C4, 0.5), N(C4, 2)];
const odeBridge = [N(D4), N(D4), N(E4), N(C4), N(D4), N(E4, 0.5), N(F4, 0.5), N(E4), N(C4),
  N(D4), N(E4, 0.5), N(F4, 0.5), N(E4), N(D4), N(C4), N(D4), N(G3, 2)];
const ode = {
  name: "Ode to Joy",
  bpm: 120,
  notes: [...odeA, ...odeEnd1, ...odeA, ...odeEnd2, ...odeBridge, ...odeA, ...odeEnd2],
};

// Greensleeves (traditional English; A minor, 3/4, quarter-note beats). Twelve
// distinct pitches: E4 F#4 G4 G#4 A4 B4 C5 D5 E5 F5 F#5 G5.
const gsVerseHead = [N(C5, 2), N(D5), N(E5, 1.5), N(F5, 0.5), N(E5), N(D5, 2), N(B4),
  N(G4, 1.5), N(A4, 0.5), N(B4)];
const gsRefrainHead = [N(G5, 3), N(G5, 1.5), N(Fs5, 0.5), N(E5), N(D5, 2), N(B4),
  N(G4, 1.5), N(A4, 0.5), N(B4)];
const gsHalfCadence = [N(C5, 2), N(A4), N(A4, 1.5), N(Gs4, 0.5), N(A4), N(B4, 2), N(Gs4), N(E4, 2)];
const gsFullCadence = [N(C5, 1.5), N(B4, 0.5), N(A4), N(Gs4, 1.5), N(Fs4, 0.5), N(Gs4), N(A4, 3)];
const greensleeves = {
  name: "Greensleeves",
  bpm: 110,
  notes: [
    N(A4), // pickup
    ...gsVerseHead, ...gsHalfCadence, N(A4),
    ...gsVerseHead, ...gsFullCadence, R(1),
    ...gsRefrainHead, ...gsHalfCadence, R(1),
    ...gsRefrainHead, ...gsFullCadence,
  ],
};

// Jesu, Joy of Man's Desiring (J. S. Bach, BWV 147, 1723; G major, 9/8).
// The flowing triplet theme: its first four bars, then the first three again
// closing on a held G, so the excerpt ends at home. An excerpt, not the full
// movement. Each note is an eighth (0.5 quarter-note beats); bpm counts
// quarters, so a 9/8 bar of three triplet groups is 4.5 beats. Ten distinct
// pitches: D4 F#4 G4 A4 B4 C5 D5 E5 F#5 G5.
const jesuBar1 = [N(G4, 0.5), N(A4, 0.5), N(B4, 0.5), N(D5, 0.5), N(C5, 0.5), N(C5, 0.5), N(E5, 0.5), N(D5, 0.5), N(D5, 0.5)];
const jesuBar2 = [N(G5, 0.5), N(Fs5, 0.5), N(G5, 0.5), N(D5, 0.5), N(B4, 0.5), N(G4, 0.5), N(A4, 0.5), N(B4, 0.5), N(C5, 0.5)];
const jesuBar3 = [N(D5, 0.5), N(E5, 0.5), N(D5, 0.5), N(C5, 0.5), N(B4, 0.5), N(A4, 0.5), N(B4, 0.5), N(G4, 0.5), N(Fs4, 0.5)];
const jesuBar4 = [N(G4, 0.5), N(A4, 0.5), N(D4, 0.5), N(Fs4, 0.5), N(A4, 0.5), N(C5, 0.5), N(B4, 0.5), N(A4, 0.5), N(B4, 0.5)];
const jesu = {
  name: "Jesu, Joy of Man's Desiring",
  bpm: 84,
  notes: [...jesuBar1, ...jesuBar2, ...jesuBar3, ...jesuBar4, ...jesuBar1, ...jesuBar2, ...jesuBar3, N(G4, 4.5)],
};

export const MELODY_PRESETS = [twinkle, ode, greensleeves, jesu];

// ── CHORDS PROTOTYPE ─────────────────────────────────────────────────────
// Samples for trying "chords across stars": a note whose `midi` is an array
// sounds as a chord, each tone on its own star. Kept apart from MELODY_PRESETS
// (which stay single-voice, as the brief requires) until the feature is approved.
const C = (midis, beats) => ({ midi: midis, beats });
const I_C = [60, 64, 67], V_C = [59, 62, 67], vi_C = [57, 60, 64], IV_C = [57, 60, 65];
const i_Am = [57, 60, 64], VI_Am = [57, 60, 65], III_Am = [55, 60, 64], VII_Am = [55, 59, 62];
const cC = [48, 52, 55], cF = [53, 57, 60], cG = [50, 55, 59]; // left-hand block chords for Twinkle
export const CHORD_SAMPLES = [
  {
    name: "Chords: I–V–vi–IV in C",
    bpm: 80,
    notes: [C(I_C, 4), C(V_C, 4), C(vi_C, 4), C(IV_C, 4), C(I_C, 4), C(V_C, 4), C(vi_C, 4), C(IV_C, 4), C(I_C, 4)],
  },
  {
    name: "Chords: i–VI–III–VII in A minor",
    bpm: 76,
    notes: [C(i_Am, 4), C(VI_Am, 4), C(III_Am, 4), C(VII_Am, 4), C(i_Am, 4), C(VI_Am, 4), C(III_Am, 4), C(VII_Am, 4), C(i_Am, 4)],
  },
  {
    name: "Chords: Twinkle with block chords",
    bpm: 100,
    notes: [
      C([...cC, C4], 1), C([...cC, C4], 1), C([...cC, G4], 1), C([...cC, G4], 1),
      C([...cF, A4], 1), C([...cF, A4], 1), C([...cC, G4], 2),
      C([...cF, F4], 1), C([...cF, F4], 1), C([...cC, E4], 1), C([...cC, E4], 1),
      C([...cG, D4], 1), C([...cG, D4], 1), C([...cC, C4], 2),
    ],
  },
];

export default MELODY_PRESETS;
