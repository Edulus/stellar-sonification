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

export const MELODY_PRESETS = [twinkle, ode, greensleeves];

export default MELODY_PRESETS;
