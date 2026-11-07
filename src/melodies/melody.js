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

/**
 * Pitches sounding in one note: `midi` is a number (single note), null (rest),
 * or an array of numbers (a chord; CHORDS PROTOTYPE). Sorted, deduplicated.
 */
export function pitchesOf(note) {
  if (note == null || note.midi == null) return [];
  const list = Array.isArray(note.midi) ? note.midi : [note.midi];
  return [...new Set(list.filter((m) => m != null))].sort((a, b) => a - b);
}

/** Sorted (ascending) distinct MIDI pitches of a preset, rests excluded (chord tones included). */
export function distinctPitches(preset) {
  return [...new Set(preset.notes.flatMap(pitchesOf))].sort((a, b) => a - b);
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
  const voiceFor = (midi) => {
    const target = midiToFreq(midi);
    let star, line, freq;
    if (honest) {
      let best = null, bestD = Infinity;
      for (const c of candidates) {
        const d = Math.abs(Math.log2(c.freq / target));
        if (d < bestD) { bestD = d; best = c; } // ties keep the cooler (earlier) star
      }
      if (best) ({ star, line, freq } = best);
    } else {
      star = assignment.byPitch.get(midi);
      line = star ? strongestLine(star.lines) : null;
      freq = target;
    }
    return star && line ? { midi, star, line, freq, driftSemitones: 12 * Math.log2(freq / target) } : null;
  };
  for (const n of preset.notes) {
    const dur = n.beats * beat;
    // Each sounding pitch is one voice; a chord has several. Identical voices
    // (honest mode can map two pitches to the same line) are merged.
    const seen = new Set();
    const voices = [];
    for (const m of pitchesOf(n)) {
      const v = voiceFor(m);
      if (!v) continue;
      const k = `${v.star.key}|${v.line.wl}|${v.freq}`;
      if (seen.has(k)) continue;
      seen.add(k); voices.push(v);
    }
    if (voices.length) {
      // Top-level fields mirror the highest voice (the melody), as before chords.
      const top = voices[voices.length - 1];
      events.push({ t, dur, voices, midi: top.midi, star: top.star, line: top.line, freq: top.freq, driftSemitones: top.driftSemitones });
    }
    t += dur;
  }
  return { events, totalSec: t };
}

/** Drift summary for honest mode: how far the sounding pitch is from the melody. */
export function driftStats(events) {
  if (!events.length) return { notes: 0, meanAbs: 0, maxAbs: 0, within50c: 0, starsUsed: 0 };
  const voices = events.flatMap((e) => e.voices || [e]);
  const abs = voices.map((v) => Math.abs(v.driftSemitones));
  return {
    notes: events.length,
    meanAbs: abs.reduce((a, b) => a + b, 0) / abs.length,
    maxAbs: Math.max(...abs),
    within50c: abs.filter((d) => d <= 0.5).length / abs.length,
    starsUsed: new Set(voices.map((v) => v.star.key)).size,
  };
}
