// ── harmonize.js ─────────────────────────────────────────────────────
// Pure-function module: spectroscopy data → harmonized chord frequencies.
// No Web Audio dependencies. Takes absorption line arrays in, returns
// frequency arrays out. Designed for unit testing without a browser.
//
// Usage:
//   import { harmonizeChord } from './harmonize.js';
//   const chord = harmonizeChord(star.lines, star.rv, 0.75);
//   // chord.freqs[i]      → frequency in Hz for line i
//   // chord.rootIdx       → index of the root line (max EW)
//   // chord.intervals[i]  → { name, ratio, cents } of snapped interval
//   // chord.pull[i]       → 0–1, how far the line was displaced
//   // chord.rawFreqs[i]   → original unharmonized frequencies

// ── Constants (must match mappings.js / stellar-sonification.jsx) ────
const SPEC_MIN = 380;
const SPEC_MAX = 760;

function wlToFreq(wl) {
  const midi = 84 - ((wl - SPEC_MIN) / (SPEC_MAX - SPEC_MIN)) * 36;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ── Just intonation consonance ladder ────────────────────────────────
// Ordered by perceptual consonance (most consonant first). The snap
// algorithm walks this list and picks the nearest interval, but the
// ordering also serves as a tiebreaker: if two intervals are equally
// close in cents, the more consonant one wins.
//
// Ratios are expressed within a single octave (1.0 – 2.0). The
// algorithm octave-reduces raw intervals before matching, then
// reconstructs the original octave afterward.

const CONSONANCE_LADDER = [
  { ratio: 1 / 1,   cents: 0,      name: "P1"  },  // unison
  { ratio: 2 / 1,   cents: 1200,   name: "P8"  },  // octave (used as endpoint)
  { ratio: 3 / 2,   cents: 701.96, name: "P5"  },  // perfect fifth
  { ratio: 4 / 3,   cents: 498.04, name: "P4"  },  // perfect fourth
  { ratio: 5 / 4,   cents: 386.31, name: "M3"  },  // major third
  { ratio: 6 / 5,   cents: 315.64, name: "m3"  },  // minor third
  { ratio: 5 / 3,   cents: 884.36, name: "M6"  },  // major sixth
  { ratio: 8 / 5,   cents: 813.69, name: "m6"  },  // minor sixth
  { ratio: 9 / 8,   cents: 203.91, name: "M2"  },  // major second
  { ratio: 7 / 4,   cents: 968.83, name: "m7h" },  // harmonic seventh
  { ratio: 15 / 8,  cents: 1088.27, name: "M7" },  // major seventh
  { ratio: 7 / 6,   cents: 266.87, name: "m3h" },  // septimal minor third
  { ratio: 11 / 8,  cents: 551.32, name: "TT"  },  // undecimal tritone
  { ratio: 7 / 5,   cents: 582.51, name: "d5h" },  // septimal diminished fifth
  { ratio: 16 / 15, cents: 111.73, name: "m2"  },  // minor second (least consonant)
];

// Pre-compute cents for the within-octave ratios (excluding the octave
// endpoint itself — that's handled by the unison after octave-folding).
const SNAP_TARGETS = CONSONANCE_LADDER.filter(c => c.cents < 1200);

// ── Helpers ──────────────────────────────────────────────────────────

function ratioToCents(r) {
  return 1200 * Math.log2(r);
}

/**
 * Find the nearest consonant interval for a given within-octave cent value.
 * Returns the best-matching entry from SNAP_TARGETS.
 * Tiebreak: lower index (= more consonant) wins.
 */
function findNearestConsonant(cents) {
  let best = SNAP_TARGETS[0];
  let bestDist = Infinity;

  for (const target of SNAP_TARGETS) {
    // Distance on the cent circle (wrapping 0↔1200)
    let dist = Math.abs(cents - target.cents);
    dist = Math.min(dist, 1200 - dist);

    if (dist < bestDist - 0.5) {
      // Clear winner (0.5 cent tolerance for tiebreak)
      best = target;
      bestDist = dist;
    }
  }

  return { interval: best, distance: bestDist };
}

// ── Core algorithm ───────────────────────────────────────────────────

/**
 * harmonizeChord — produce a harmonized chord from absorption line data.
 *
 * @param {Array} lines       — star.lines array (each has .wl, .ew, etc.)
 * @param {number} starRV     — star radial velocity in km/s (for reference; not
 *                               applied here — SonificationEngine applies detune)
 * @param {number} amount     — harmonize amount, 0.0 (raw) to 1.0 (fully snapped)
 * @returns {Object}          — { freqs, rawFreqs, rootIdx, intervals, pull, gainScale }
 */
export function harmonizeChord(lines, starRV, amount) {
  const n = lines.length;
  if (n === 0) {
    return { freqs: [], rawFreqs: [], rootIdx: -1, intervals: [], pull: [], gainScale: 1 };
  }

  // 1. Compute raw pitches from wavelength
  const rawFreqs = lines.map(l => wlToFreq(l.wl));

  // 2. Select root: line with maximum equivalent width
  let rootIdx = 0;
  let maxEW = lines[0].ew;
  for (let i = 1; i < n; i++) {
    if (lines[i].ew > maxEW) {
      maxEW = lines[i].ew;
      rootIdx = i;
    }
  }
  const rootFreq = rawFreqs[rootIdx];

  // 3. For each line, compute snapped frequency and blend
  const freqs = new Array(n);
  const intervals = new Array(n);
  const pull = new Array(n);

  for (let i = 0; i < n; i++) {
    if (i === rootIdx) {
      // Root always stays exact
      freqs[i] = rootFreq;
      intervals[i] = { name: "root", ratio: 1, cents: 0 };
      pull[i] = 0;
      continue;
    }

    const raw = rawFreqs[i];

    // a. Compute interval ratio relative to root
    let ratio = raw / rootFreq;

    // b. Octave-reduce: bring into [1.0, 2.0) range, track octave offset
    let octaveShift = 0;
    if (ratio <= 0) {
      // Degenerate — shouldn't happen with valid wavelengths
      freqs[i] = raw;
      intervals[i] = { name: "?", ratio: 1, cents: 0 };
      pull[i] = 0;
      continue;
    }
    while (ratio < 1.0) { ratio *= 2; octaveShift--; }
    while (ratio >= 2.0) { ratio /= 2; octaveShift++; }

    // c. Convert to cents within the octave
    const rawCents = ratioToCents(ratio);

    // d. Find nearest consonant interval
    const { interval: nearest, distance } = findNearestConsonant(rawCents);

    // e. Reconstruct the snapped frequency at the original octave
    const snappedRatio = nearest.ratio * Math.pow(2, octaveShift);
    const snappedFreq = rootFreq * snappedRatio;

    // f. Compute pull weight — stronger lines (higher EW) resist pull,
    //    weaker lines yield more to the harmonic grid.
    //    lineResistance: 0 (weakest line, fully yielding) to 0.6 (root-strength, resistant)
    const lineResistance = (lines[i].ew / maxEW) * 0.6;
    const effectivePull = amount * (1.0 - lineResistance);

    // g. Blend: log-domain interpolation for perceptually linear pitch blend
    const logRaw = Math.log2(raw);
    const logSnapped = Math.log2(snappedFreq);
    const logBlended = logRaw + (logSnapped - logRaw) * effectivePull;
    freqs[i] = Math.pow(2, logBlended);

    intervals[i] = {
      name: nearest.name,
      ratio: nearest.ratio,
      cents: nearest.cents,
    };
    pull[i] = effectivePull;
  }

  // 4. Voicing spread: if two voices are within 30 cents of each other,
  //    shift the weaker one (lower EW) by an octave to prevent masking.
  const MASKING_THRESHOLD_CENTS = 30;
  const freqOrder = lines
    .map((l, i) => ({ idx: i, ew: l.ew, freq: freqs[i] }))
    .sort((a, b) => b.ew - a.ew); // strongest first = protected

  for (let a = 0; a < freqOrder.length; a++) {
    for (let b = a + 1; b < freqOrder.length; b++) {
      const idxA = freqOrder[a].idx;
      const idxB = freqOrder[b].idx; // weaker line
      const centsApart = Math.abs(1200 * Math.log2(freqs[idxA] / freqs[idxB]));

      if (centsApart < MASKING_THRESHOLD_CENTS) {
        // Shift weaker line: prefer up if we're in the lower half of range, down otherwise
        const midFreq = wlToFreq((SPEC_MIN + SPEC_MAX) / 2);
        if (freqs[idxB] < midFreq) {
          freqs[idxB] *= 2;   // up an octave
        } else {
          freqs[idxB] /= 2;   // down an octave
        }
        // Update the interval name to note the octave displacement
        if (intervals[idxB]) {
          intervals[idxB].name += freqs[idxB] > rawFreqs[idxB] ? "↑" : "↓";
        }
      }
    }
  }

  // 5. Gain scaling factor: prevent clipping when all lines play simultaneously.
  //    1/sqrt(N) is the standard equal-power sum rule.
  const gainScale = 1.0 / Math.sqrt(n);

  return {
    freqs,        // harmonized frequencies, one per line
    rawFreqs,     // original data-derived frequencies (for comparison display)
    rootIdx,      // index of the root line in the lines array
    intervals,    // { name, ratio, cents } per line — the interval it snapped toward
    pull,         // 0–1 per line — how much displacement was applied
    gainScale,    // multiply each line's depthToGain result by this
  };
}

// ── Chord timing parameters ──────────────────────────────────────────
// Exported constants for SonificationEngine.playChord() to reference.

export const CHORD_TIMING = {
  duration:     2.8,     // total chord duration in seconds
  stagger:      0.015,   // onset delay between voices (seconds per voice index)
  masterAttack: 0.20,    // master envelope attack (slow bloom)
  masterRelease: 0.80,   // master envelope release (long tail)
};

// ── Utility: chord summary for UI display ────────────────────────────
// Returns a human-readable description of the chord structure.

/**
 * describeChord — produce a compact text summary of the harmonized chord.
 *
 * @param {Object} chord — output of harmonizeChord()
 * @param {Array}  lines — star.lines array (for element labels)
 * @returns {Object}     — { root, voices, quality }
 */
export function describeChord(chord, lines) {
  if (chord.rootIdx < 0) return { root: "—", voices: [], quality: "none" };

  const root = lines[chord.rootIdx].el;

  const voices = lines.map((line, i) => ({
    element:  line.el,
    interval: chord.intervals[i].name,
    cents:    Math.round(1200 * Math.log2(chord.freqs[i] / chord.freqs[chord.rootIdx])),
    pull:     Math.round(chord.pull[i] * 100),
    isRoot:   i === chord.rootIdx,
    freq:     Math.round(chord.freqs[i]),
    rawFreq:  Math.round(chord.rawFreqs[i]),
  }));

  // Infer a rough chord quality from the intervals present
  const intervalNames = new Set(chord.intervals.map(iv => iv.name));
  let quality = "cluster";
  if (intervalNames.has("M3") && intervalNames.has("P5"))      quality = "major";
  else if (intervalNames.has("m3") && intervalNames.has("P5")) quality = "minor";
  else if (intervalNames.has("P5") && intervalNames.has("P4")) quality = "suspended";
  else if (intervalNames.has("P5"))                            quality = "open fifth";
  else if (intervalNames.has("M3") || intervalNames.has("m3")) quality = "triad fragment";

  if (intervalNames.has("m7h") || intervalNames.has("M7"))     quality += " 7th";

  return { root, voices, quality };
}

// ── Utility: cents distance between two frequencies ──────────────────

export function centsBetween(f1, f2) {
  if (f1 <= 0 || f2 <= 0) return 0;
  return 1200 * Math.log2(f2 / f1);
}
