// seededMusic.js — the SEED mode's composer. Browser-free and deterministic:
// same star + same seed => an identical plan, every time. No Web Audio here;
// SonificationEngine.playSeed() renders the plan with the normal per-line voice
// graph, so the *timbre* is still the star's physics.
//
// Ported from jak_e's "Seeded Procedural Music Generator"
// (https://codepen.io/jak_e/pen/EKRarY), which supplied the musical skeleton:
//   - a seeded PRNG so a seed always yields the same song
//   - maj/min built from whole/half step words over a chromatic note library
//   - a library of note-length sequences that each fill one 4/4 bar, shuffled
//   - two voices: bass (single notes, low register) + treble (chords, high)
//   - the voicing rule that makes it sound composed rather than random: a
//     candidate is REJECTED if it, or either neighbouring scale degree, is
//     already in the chord — so chords are never clustered seconds
// Not ported: Tone.js (this project is raw Web Audio by policy), abcjs staff
// rendering, and the endless-measure streaming (our pieces are finite).
//
// Spectrum-driven: the pen rolls dice for pitches. Here every pitch comes from
// an absorption line — `wlToFreq` maps the line's wavelength to a pitch, which
// is then snapped to the nearest degree of the star's key. The PRNG only
// decides rhythm, which lines land in which slot, voicing and register. The
// melody still encodes the spectrum; the seed only rearranges it.

import { wlToFreq, DEFAULT_PARAMS } from "./mappings.js";

// ── deterministic PRNG (replaces the pen's seedrandom dependency) ──────────
// xmur3 string hash -> sfc32 generator: small, well-known, and a clean 32-bit
// stream. The returned function mirrors seedrandom's float-in-[0,1) API so the
// ported logic reads the same as the pen's.

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

export function makeRandom(seedString) {
  const seed = xmur3(String(seedString));
  let a = seed(), b = seed(), c = seed(), d = seed();
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  next.int32 = () => Math.floor(next() * 4294967296);
  return next;
}

/** Seeded Fisher–Yates (the pen's _utilShuffleArray, made deterministic). */
export function shuffle(array, rng) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── scale construction (pen: _genStepsLib / _genNotesLib / _genScale) ──────

export const PITCH_CLASSES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

// Whole/half step words. The pen shipped maj + min and left the other modes
// commented out; we keep the two it shipped.
const MODE_STEPS = {
  maj: ["W", "W", "H", "W", "W", "W", "H"],
  min: ["W", "H", "W", "W", "H", "W", "W"],
};

/** Semitone offsets of a mode's degrees from the root: maj -> [0,2,4,5,7,9,11,12]. */
export function modeSteps(mode) {
  const word = MODE_STEPS[mode] || MODE_STEPS.maj;
  const steps = [0];
  for (let i = 0; i < word.length; i++) {
    steps.push(steps[i] + (word[i] === "W" ? 2 : 1));
  }
  return steps;
}

/**
 * Every note of `root mode` between two octaves, low to high.
 * @returns {{pc:number, octave:number, midi:number, freq:number, name:string}[]}
 */
export function buildScale(rootPc, mode, minOct = 2, maxOct = 5) {
  const steps = modeSteps(mode).slice(0, 7); // the 8th entry repeats the root
  const out = [];
  for (let oct = minOct; oct <= maxOct; oct++) {
    for (const s of steps) {
      const midi = 12 * (oct + 1) + rootPc + s;
      const pc = (((rootPc + s) % 12) + 12) % 12;
      out.push({
        pc,
        octave: Math.floor(midi / 12) - 1,
        midi,
        freq: 440 * Math.pow(2, (midi - 69) / 12),
        name: PITCH_CLASSES[pc],
      });
    }
  }
  return out.sort((x, y) => x.midi - y.midi);
}

// Note-length sequences: each fills exactly one 4/4 bar at RESOLUTION.
// Values are note denominators (2 = half note, 8 = eighth), as in the pen.
export const LENGTH_SEQUENCES = [
  [1],
  [2, 2],
  [2, 4, 4],
  [2, 4, 8, 8],
  [4, 4, 4, 4],
  [2, 8, 8, 8, 8],
  [4, 4, 4, 8, 8],
  [8, 8, 8, 8, 8, 8, 8, 8],
];

export const RESOLUTION = 8; // steps per bar (eighth notes) — the pen's _res

// ── star -> key, mode, tempo ───────────────────────────────────────────────

/** The (possibly fractional) MIDI note `wlToFreq` gives this line. */
function lineMidi(line, p) {
  return 69 + 12 * Math.log2(wlToFreq(line.wl, p) / 440);
}

/**
 * The star's own key. The tonic is the pitch class of its STRONGEST line (the
 * deepest feature by equivalent width), so the note you hear most is the note
 * the star's dominant absorption line actually maps to. Mode and tempo come
 * from effective temperature: hot stars major and quick, cool minor and slow.
 */
export function keyForStar(data, p = DEFAULT_PARAMS) {
  const lines = data?.lines || [];
  const strongest = lines.reduce((best, l) => (!best || l.ew > best.ew ? l : best), null);
  const rootPc = strongest ? (((Math.round(lineMidi(strongest, p)) % 12) + 12) % 12) : 0;
  const temp = data?.temp ?? 5500;
  const mode = temp >= 5500 ? "maj" : "min";
  // log-temperature 3000..30000 K -> 60..120 bpm, the pen's tempo range.
  const span = Math.log10(30000) - Math.log10(3000);
  const t = Math.min(1, Math.max(0, (Math.log10(Math.max(temp, 1)) - Math.log10(3000)) / span));
  return { rootPc, root: PITCH_CLASSES[rootPc], mode, bpm: Math.round(60 + t * 60), tonicLine: strongest };
}

/** Default seed for a star: stable identity, so one star always plays one song. */
export function seedForStar(data) {
  return String(data?.name || data?.type || "unknown star");
}

// ── the composer ───────────────────────────────────────────────────────────

/**
 * Which scale degree a line lands on: the nearest pitch class in the key,
 * measured in semitones. Returns an index into one octave of the scale (0..6).
 */
function lineToDegree(line, scaleOneOctave, p) {
  const pc = (((Math.round(lineMidi(line, p)) % 12) + 12) % 12);
  let best = 0;
  let bestDist = Infinity;
  scaleOneOctave.forEach((n, i) => {
    const up = (((n.pc - pc) % 12) + 12) % 12;
    const d = Math.min(up, 12 - up); // circular semitone distance
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

// How often an event is a rest rather than a note. The pen never rests — it
// fills every slot of every bar — and neither did we, which measured out at
// literally 0 rests across 5,554 events. Music needs somewhere to breathe;
// this is the cheapest way to give a 4-bar piece phrasing.
const REST_CHANCE = 0.16;

/**
 * Pick a position in the EW-descending line order, biased toward the strong
 * lines — they should dominate the piece the way they dominate the spectrum.
 *
 * The exponent is the strength of that bias. It was 1.7, which put ~29% of all
 * picks on the single strongest line and measured 39.8% average pitch-class
 * dominance (one piece hit 64% — a drone, not a melody). 1.25 keeps the
 * spectral hierarchy audible (strong lines still lead) while letting the rest
 * of the spectrum be heard.
 */
function pickLinePos(rng, n) {
  return Math.min(n - 1, Math.floor(Math.pow(rng(), 1.25) * n));
}

/**
 * Build one voice's bar: a RESOLUTION-long array whose entries are either a
 * note event or null (the pen's "HOLD" — a step covered by the note before it).
 *
 * The pen's neighbour-rejection rule lives here: a degree is refused if it, or
 * either adjacent degree, is already sounding in this chord.
 */
function buildBar(rng, { order, lines, scaleOneOctave, octaves, maxNotes, p, state }) {
  const seq = shuffle(LENGTH_SEQUENCES[Math.floor(rng() * LENGTH_SEQUENCES.length)], rng);
  const bar = [];
  for (const len of seq) {
    // Rest — but never on the very first event of the piece, where silence
    // just reads as "the play button didn't work".
    if (!state.firstEvent && rng() < REST_CHANCE) {
      bar.push(null);
      for (let h = 0; h < RESOLUTION / len - 1; h++) bar.push(null);
      state.lastDegree = null; // a rest breaks the repeat chain
      continue;
    }
    state.firstEvent = false;
    const noteCount = Math.ceil(rng() * maxNotes);
    const usedDegrees = [];
    const notes = [];
    for (let n = 0; n < noteCount; n++) {
      // Up to 8 attempts to find a non-clustered degree, then drop this note.
      // (The pen recursed until it found one; a bound keeps a 3-line star from
      // hanging when every degree is already taken or adjacent.)
      for (let attempt = 0; attempt < 8; attempt++) {
        const lineIdx = order[pickLinePos(rng, order.length)];
        const degree = lineToDegree(lines[lineIdx], scaleOneOctave, p);
        if (usedDegrees.some((d) => Math.abs(d - degree) <= 1)) continue;
        // Don't immediately repeat the previous event's lead degree — that is
        // what produced runs of up to 6 identical top notes. Only enforced
        // while alternatives remain (a 3-line star has few) and only for the
        // first attempts, so the loop always terminates.
        if (n === 0 && attempt < 5 && order.length >= 4 && degree === state.lastDegree) continue;
        usedDegrees.push(degree);
        if (n === 0) state.lastDegree = degree;
        // Voice leading — the one place we go beyond the pen. The pen drew a
        // register at random, which leaps by sevenths constantly. Here the
        // degree is fixed by the spectrum, so the only freedom left is WHICH
        // octave of it to sing: take the one nearest the last note, and let the
        // seed force a deliberate leap a quarter of the time so lines still
        // have shape. `state.last` carries the previous pitch across the bar.
        const base = scaleOneOctave[degree];
        const candidates = octaves.map((o) => base.midi + 12 * (o - base.octave));
        let midi;
        if (state.last == null || rng() < 0.25) {
          midi = candidates[Math.floor(rng() * candidates.length)];
        } else {
          midi = candidates.reduce((bestC, c) =>
            Math.abs(c - state.last) < Math.abs(bestC - state.last) ? c : bestC);
        }
        state.last = midi;
        notes.push({ lineIdx, degree, midi, freq: 440 * Math.pow(2, (midi - 69) / 12) });
        break;
      }
    }
    bar.push(notes.length ? { notes, len } : null); // no fit -> a rest
    // The event occupies RESOLUTION/len steps; the remainder are holds.
    for (let h = 0; h < RESOLUTION / len - 1; h++) bar.push(null);
  }
  return bar.slice(0, RESOLUTION);
}

/**
 * Compose a finite piece for a star.
 *
 * @param {{lines:Array, temp?:number, rv?:number, name?:string}} data resolved star data
 * @param {{seed?:string, params?:object, bars?:number}} [opts]
 * @returns {null | {seed:string, root:string, rootPc:number, mode:string, bpm:number,
 *                   bars:number, resolution:number, scale:Array, measures:Array}}
 *   measures[i] = { treb: (event|null)[RESOLUTION], bass: (event|null)[RESOLUTION] }
 *   event      = { notes: [{lineIdx, degree, midi, freq}], len }
 */
export function planSong(data, opts = {}) {
  const p = opts.params || DEFAULT_PARAMS;
  const bars = opts.bars ?? 4;
  const lines = data?.lines || [];
  if (!lines.length) return null;
  const seed = opts.seed || seedForStar(data);

  const key = keyForStar(data, p);
  const rng = makeRandom(`${seed}::${key.root}${key.mode}`);
  const scale = buildScale(key.rootPc, key.mode, 2, 5);
  const scaleOneOctave = buildScale(key.rootPc, key.mode, 4, 4); // degree reference

  // EW-descending line order — the same ranking SEQ and CHORD already use.
  const order = lines
    .map((line, idx) => ({ line, idx }))
    .sort((a, b) => b.line.ew - a.line.ew)
    .map((x) => x.idx);

  const measures = [];
  // Per-voice pitch memory, so voice leading carries across bar lines.
  const trebState = { last: null, lastDegree: null, firstEvent: true };
  const bassState = { last: null, lastDegree: null, firstEvent: true };
  for (let m = 0; m < bars; m++) {
    // Each voice gets its own sub-stream, as the pen did with a per-clef
    // generator seeded from the main one — so the voices stay independent.
    const trebRng = makeRandom(String(rng.int32()));
    const bassRng = makeRandom(String(rng.int32()));
    measures.push({
      treb: buildBar(trebRng, { order, lines, scaleOneOctave, octaves: [4, 5], maxNotes: 3, p, state: trebState }),
      bass: buildBar(bassRng, { order, lines, scaleOneOctave, octaves: [2, 3], maxNotes: 1, p, state: bassState }),
    });
  }

  return {
    seed,
    root: key.root,
    rootPc: key.rootPc,
    mode: key.mode,
    bpm: key.bpm,
    bars,
    resolution: RESOLUTION,
    scale,
    measures,
  };
}

export default planSong;
