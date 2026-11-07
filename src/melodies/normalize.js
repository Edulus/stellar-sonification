// Melody normalizer — the landing point for melodies that don't come from
// presets.js (the planned MIDI upload). Pure and browser-free; verify:melody
// checks it.
//
// A MIDI importer only has to produce the preset shape,
//   { name, bpm, notes: [{ midi, beats }] }   (midi: null = rest)
// as a single voice, and hand it to normalizeMelody(). Everything that makes
// a melody playable here is decided in one place:
//   • name/bpm sanitised (bpm outside 20–300 → 100)
//   • notes with a missing, non-numeric or ≤ 0 length dropped
//   • pitches rounded to whole MIDI notes; non-numeric pitch → rest
//   • consecutive rests merged; leading and trailing rests trimmed
//   • range fit to the app's pitch range (MIDI 48–84 by default): first the
//     whole tune moves by whole octaves to fit as many notes as possible (ties:
//     the smallest shift), then any note still outside is folded in by octaves
//   • very long input truncated at maxNotes
// It never throws on bad input; it returns { ok, melody, report, errors }.
// The built-in presets pass through unchanged (verify:melody asserts that).

export const MELODY_LIMITS = {
  minMidi: 48,       // DEFAULT_PARAMS.pitchHighMidi − pitchSpanSemitones
  maxMidi: 84,       // DEFAULT_PARAMS.pitchHighMidi
  minBpm: 20,
  maxBpm: 300,
  defaultBpm: 100,
  maxNotes: 2000,
  maxNameLength: 60,
};

const isNum = (x) => typeof x === "number" && Number.isFinite(x);

/** Octave shift (multiple of 12) that puts the most pitches inside [lo, hi]. */
function bestOctaveShift(pitches, lo, hi) {
  let best = 0, bestIn = -1;
  for (let k = -6; k <= 6; k++) {
    const s = k * 12;
    const inRange = pitches.filter((m) => m + s >= lo && m + s <= hi).length;
    if (inRange > bestIn || (inRange === bestIn && Math.abs(s) < Math.abs(best))) {
      best = s; bestIn = inRange;
    }
  }
  return best;
}

/** Move one pitch into [lo, hi] by whole octaves (nearest edge if the span < 12). */
function foldIntoRange(m, lo, hi) {
  while (m < lo) m += 12;
  while (m > hi) m -= 12;
  return m < lo ? lo : m;
}

/**
 * @param {{name?:string, bpm?:number, notes?:Array<{midi?:number|null, beats?:number}>}} raw
 * @param {Partial<typeof MELODY_LIMITS>} [limits]
 * @returns {{ok:boolean, melody:object|null, errors:string[], report:object}}
 */
export function normalizeMelody(raw, limits = {}) {
  const L = { ...MELODY_LIMITS, ...limits };
  const errors = [];
  const report = {
    renamed: false, bpmDefaulted: false, dropped: 0, restsCoerced: 0, roundedPitches: 0,
    mergedRests: 0, trimmedRests: 0, truncated: 0, transposedBy: 0, folded: 0,
    notes: 0, distinctPitches: 0, durationSec: 0,
  };
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.notes)) {
    return { ok: false, melody: null, errors: ["No note list found."], report };
  }

  let name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) { name = "Untitled melody"; report.renamed = true; }
  if (name.length > L.maxNameLength) { name = name.slice(0, L.maxNameLength).trimEnd(); report.renamed = true; }

  let bpm = raw.bpm;
  if (!isNum(bpm) || bpm < L.minBpm || bpm > L.maxBpm) { bpm = L.defaultBpm; report.bpmDefaulted = true; }

  // Clean individual notes.
  let notes = [];
  for (const n of raw.notes) {
    if (!n || !isNum(n.beats) || n.beats <= 0) { report.dropped++; continue; }
    let midi = n.midi;
    if (midi === null || midi === undefined) midi = null;
    else if (!isNum(midi)) { midi = null; report.restsCoerced++; }
    else if (!Number.isInteger(midi)) { midi = Math.round(midi); report.roundedPitches++; }
    notes.push({ midi, beats: n.beats });
  }

  // Merge consecutive rests; trim rests at either end.
  const merged = [];
  for (const n of notes) {
    const last = merged[merged.length - 1];
    if (n.midi === null && last && last.midi === null) { last.beats += n.beats; report.mergedRests++; }
    else merged.push({ ...n });
  }
  while (merged.length && merged[0].midi === null) { merged.shift(); report.trimmedRests++; }
  while (merged.length && merged[merged.length - 1].midi === null) { merged.pop(); report.trimmedRests++; }
  notes = merged;

  if (notes.length > L.maxNotes) { report.truncated = notes.length - L.maxNotes; notes = notes.slice(0, L.maxNotes); }
  while (notes.length && notes[notes.length - 1].midi === null) notes.pop();

  const pitched = notes.filter((n) => n.midi !== null).map((n) => n.midi);
  if (!pitched.length) {
    return { ok: false, melody: null, errors: [...errors, "The melody has no playable notes."], report };
  }

  // Range fit: whole-octave transposition first, then fold stragglers.
  const shift = bestOctaveShift(pitched, L.minMidi, L.maxMidi);
  report.transposedBy = shift;
  notes = notes.map((n) => {
    if (n.midi === null) return n;
    let m = n.midi + shift;
    if (m < L.minMidi || m > L.maxMidi) { m = foldIntoRange(m, L.minMidi, L.maxMidi); report.folded++; }
    return { midi: m, beats: n.beats };
  });

  const melody = { name, bpm, notes };
  report.notes = notes.filter((n) => n.midi !== null).length;
  report.distinctPitches = new Set(notes.filter((n) => n.midi !== null).map((n) => n.midi)).size;
  report.durationSec = notes.reduce((s, n) => s + n.beats, 0) * 60 / bpm;
  return { ok: true, melody, errors, report };
}

/** One-line, user-facing summary of what normalizeMelody changed. */
export function describeNormalization(report) {
  const parts = [];
  if (report.transposedBy) parts.push(`moved ${report.transposedBy > 0 ? "up" : "down"} ${Math.abs(report.transposedBy / 12)} octave${Math.abs(report.transposedBy) === 12 ? "" : "s"}`);
  if (report.folded) parts.push(`${report.folded} note${report.folded === 1 ? "" : "s"} folded into range`);
  if (report.dropped) parts.push(`${report.dropped} empty note${report.dropped === 1 ? "" : "s"} dropped`);
  if (report.truncated) parts.push(`cut to the first ${MELODY_LIMITS.maxNotes} notes`);
  if (report.bpmDefaulted) parts.push(`tempo set to ${MELODY_LIMITS.defaultBpm} bpm`);
  return parts.length ? parts.join(", ") : "no changes needed";
}
