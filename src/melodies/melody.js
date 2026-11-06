// Melody mode — the pure half. Browser-free, so `npm run verify:melody` checks
// the musical contract without an AudioContext or the engine.
//
// The rule (MELODY-MODE-BRIEF + MELODY-FINDINGS decisions):
//   • the melody sets pitch, the star sets timbre (its strongest line's physics)
//   • stars are auto-assigned from the current view when playback starts:
//       N = distinct pitches; take the N brightest; sort them coolest → hottest;
//       pair with the distinct pitches sorted low → high. Locked for the run.
//   • temperature ties (the norm with template stars, see MELODY-FINDINGS §5 D1)
//     break by B–V descending (redder = cooler), then HIP, then name.
//   • fewer stars than pitches → cycle the available stars in temperature order.
//   • honest mode: each note is played by whichever assigned star has a line
//     whose real (wlToFreq) pitch is nearest the note, at that real pitch.

import { wlToFreq, DEFAULT_PARAMS } from "../audio/mappings.js";

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);

/** Sorted (ascending) distinct MIDI pitches of a preset, rests excluded. */
export function distinctPitches(preset) {
  return [...new Set(preset.notes.filter((n) => n.midi != null).map((n) => n.midi))].sort((a, b) => a - b);
}

const nullsLast = (a, b, cmp) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : cmp(a, b));

/** Coolest first. temp ↑, then B–V ↓ (redder = cooler), then HIP ↑, then name. */
export function compareByTemperature(a, b) {
  return (
    nullsLast(a.temp, b.temp, (x, y) => x - y) ||
    nullsLast(a.bv, b.bv, (x, y) => y - x) ||
    nullsLast(a.hip, b.hip, (x, y) => x - y) ||
    String(a.name ?? a.key ?? "").localeCompare(String(b.name ?? b.key ?? ""))
  );
}

/** Brightest first (smaller magnitude); unknown magnitudes last; ties by key. */
export function compareByBrightness(a, b) {
  return nullsLast(a.magnitude, b.magnitude, (x, y) => x - y) ||
    String(a.key ?? "").localeCompare(String(b.key ?? ""));
}

/**
 * Lock a star to every distinct pitch of the melody.
 * @param {Array<{key:string, magnitude:number, temp:number, bv?:number, hip?:number, name?:string}>} candidates
 *   visible, resolvable stars (any order)
 * @param {{notes:Array}} preset
 * @returns {{pitches:number[], stars:object[], byPitch:Map<number,object>, needed:number,
 *            available:number, fallback:boolean}}
 *   `stars` is the assigned set in temperature order (coolest first).
 */
export function assignStars(candidates, preset) {
  const pitches = distinctPitches(preset);
  const needed = pitches.length;
  const stars = [...candidates].sort(compareByBrightness).slice(0, needed).sort(compareByTemperature);
  const byPitch = new Map();
  if (stars.length) {
    // Normal case: one star per pitch, in order. Fallback (fewer stars than
    // pitches): cycle the stars in temperature order.
    pitches.forEach((m, i) => byPitch.set(m, stars[i % stars.length]));
  }
  return { pitches, stars, byPitch, needed, available: stars.length, fallback: stars.length > 0 && stars.length < needed };
}

/** The line that sets a star's timbre: highest equivalent width. */
export function strongestLine(lines) {
  let best = null;
  for (const l of lines || []) if (!best || l.ew > best.ew) best = l;
  return best;
}

/**
 * Turn a preset + a locked assignment into a timed note list.
 * Each event: { t, dur, midi, star, line, freq, driftSemitones }
 *   t/dur in seconds from the start; freq is what actually sounds.
 * Rests produce no event but still advance time.
 */
export function planMelody(preset, assignment, { honest = false, params = DEFAULT_PARAMS } = {}) {
  const beat = 60 / preset.bpm;
  const events = [];
  let t = 0;
  // Honest-mode candidates: every line of every assigned star, at its real pitch.
  const candidates = honest
    ? assignment.stars.flatMap((star) => (star.lines || []).map((line) => ({ star, line, freq: wlToFreq(line.wl, params) })))
    : null;
  for (const n of preset.notes) {
    const dur = n.beats * beat;
    if (n.midi != null) {
      const target = midiToFreq(n.midi);
      let star, line, freq;
      if (honest) {
        let best = null, bestD = Infinity;
        for (const c of candidates) {
          const d = Math.abs(Math.log2(c.freq / target));
          if (d < bestD) { bestD = d; best = c; } // ties keep the cooler (earlier) star
        }
        if (best) ({ star, line, freq } = best);
      } else {
        star = assignment.byPitch.get(n.midi);
        line = star ? strongestLine(star.lines) : null;
        freq = target;
      }
      if (star && line) {
        events.push({ t, dur, midi: n.midi, star, line, freq, driftSemitones: 12 * Math.log2(freq / target) });
      }
    }
    t += dur;
  }
  return { events, totalSec: t };
}

/** Drift summary for honest mode: how far the sounding pitch is from the melody. */
export function driftStats(events) {
  if (!events.length) return { notes: 0, meanAbs: 0, maxAbs: 0, within50c: 0, starsUsed: 0 };
  const abs = events.map((e) => Math.abs(e.driftSemitones));
  return {
    notes: events.length,
    meanAbs: abs.reduce((a, b) => a + b, 0) / abs.length,
    maxAbs: Math.max(...abs),
    within50c: abs.filter((d) => d <= 0.5).length / abs.length,
    starsUsed: new Set(events.map((e) => e.star.key)).size,
  };
}
