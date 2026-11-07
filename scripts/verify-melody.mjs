// Unit proof for Melody mode's pure half (src/melodies/*, magToGain,
// fitEnvelope). Browser-free, like verify-seed.mjs.
//
// What has to hold:
//  1. presets         — the three named tunes, single voice, every pitch in
//                       MIDI 48–84, positive lengths; Twinkle has 6 pitches
//  2. magToGain       — mag −1.5 → 0 dB, 6.0 → −18 dB, linear in dB, clamped
//  3. fitEnvelope     — untouched when the note is long enough; A/D/R scaled
//                       together to exactly fill a short note
//  4. assignment      — N brightest, coolest on the lowest pitch; ties by
//                       B–V desc → HIP → name; same pitch → same star
//  5. fallback        — fewer stars than pitches cycles them in temp order
//  6. plan            — note length = beats·60/bpm; rests advance time; the
//                       sounding pitch is the melody's; timbre = strongest line
//  7. honest          — each note picks the globally nearest real line pitch
import { MELODY_PRESETS } from "../src/melodies/presets.js";
import {
  assignStars, distinctPitches, planMelody, driftStats, midiToFreq, strongestLine,
} from "../src/melodies/melody.js";
import { magToGain, wlToFreq, freqToWl, DEFAULT_PARAMS, profileToEnvelope } from "../src/audio/mappings.js";
import { normalizeMelody, describeNormalization, MELODY_LIMITS } from "../src/melodies/normalize.js";
import { fitEnvelope } from "../src/audio/envelope.js";

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails += 1; };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// 1. presets
const names = MELODY_PRESETS.map((p) => p.name);
ok(names.join("|") === "Twinkle Twinkle Little Star|Ode to Joy|Greensleeves|Jesu, Joy of Man's Desiring", `four presets: ${names.join(", ")}`);
for (const p of MELODY_PRESETS) {
  const inRange = p.notes.every((n) => n.midi === null || (Number.isInteger(n.midi) && n.midi >= 48 && n.midi <= 84));
  const lens = p.notes.every((n) => n.beats > 0);
  const mono = p.notes.every((n) => Object.keys(n).sort().join() === "beats,midi");
  ok(inRange && lens && mono && p.bpm > 0,
    `${p.name}: ${p.notes.length} notes, ${distinctPitches(p).length} distinct pitches, range ${Math.min(...distinctPitches(p))}–${Math.max(...distinctPitches(p))}, single voice`);
}
ok(distinctPitches(MELODY_PRESETS[0]).join() === "60,62,64,65,67,69", "Twinkle pitches are C D E F G A (6)");
const jesu = MELODY_PRESETS[3];
const jesuBeats = jesu.notes.reduce((s, n) => s + n.beats, 0);
ok(distinctPitches(jesu).join() === "62,66,67,69,71,72,74,76,78,79" && jesuBeats === 36 && jesu.notes.slice(0, -1).every((n) => n.beats === 0.5),
  `Jesu: 10 pitches (D4–G5), eighth-note triplet line, ${jesuBeats / 4.5} bars of 9/8, ends on a held G`);
ok(jesu.notes[jesu.notes.length - 1].midi === 67, "Jesu closes on G4 (tonic)");

// 1b. normalizeMelody — the landing point for imported (MIDI) melodies
ok(MELODY_PRESETS.every((p) => { const r = normalizeMelody(p); return r.ok && JSON.stringify(r.melody) === JSON.stringify(p) && describeNormalization(r.report) === "no changes needed"; }),
  "every built-in preset passes through the normalizer unchanged");
const low = normalizeMelody({ name: "Bass line", bpm: 90, notes: [{ midi: 28, beats: 1 }, { midi: 31, beats: 1 }, { midi: 35, beats: 1 }, { midi: 40, beats: 2 }] });
ok(low.ok && low.report.transposedBy === 24 && low.melody.notes.map((n) => n.midi).join() === "52,55,59,64" && low.report.folded === 0,
  `too-low tune moves up whole octaves (${describeNormalization(low.report)})`);
const wide = normalizeMelody({ name: "Wide", bpm: 120, notes: [{ midi: 40, beats: 1 }, { midi: 60, beats: 1 }, { midi: 96, beats: 1 }] });
// 40/60/96: shifting down an octave keeps 2 of 3 in range (48, 84), so that
// wins; the remaining note (28) folds up to 52.
ok(wide.ok && wide.report.transposedBy === -12 && wide.report.folded === 1 && wide.melody.notes.map((n) => n.midi).join() === "52,48,84",
  `wider than 3 octaves: octave shift keeping the most notes, then stragglers folded (${wide.melody.notes.map((n) => n.midi).join(", ")})`);
const messy = normalizeMelody({ name: "  ", bpm: 9999, notes: [
  { midi: null, beats: 1 }, { midi: 60.4, beats: 1 }, { midi: 62, beats: 0 }, { midi: "x", beats: 0.5 }, { midi: null, beats: 0.5 },
  { midi: 64, beats: -1 }, { midi: 64, beats: 1 }, { beats: 2 }, null] });
ok(messy.ok && messy.melody.name === "Untitled melody" && messy.melody.bpm === 100 &&
  JSON.stringify(messy.melody.notes) === JSON.stringify([{ midi: 60, beats: 1 }, { midi: null, beats: 1 }, { midi: 64, beats: 1 }]),
  "messy input: default name/tempo, bad lengths dropped, pitch rounded, rests merged and trimmed");
ok(!normalizeMelody({ notes: [{ midi: null, beats: 1 }] }).ok && !normalizeMelody(null).ok && !normalizeMelody({ notes: "nope" }).ok,
  "no playable notes or no note list → ok:false with a reason, never a throw");
const long = normalizeMelody({ name: "Long", bpm: 120, notes: Array.from({ length: 2500 }, (_, i) => ({ midi: 60 + (i % 12), beats: 0.25 })) });
ok(long.ok && long.melody.notes.length === MELODY_LIMITS.maxNotes && long.report.truncated === 500, "over-long input truncated at maxNotes, and reported");
const big = normalizeMelody({ name: "Chromatic", bpm: 120, notes: Array.from({ length: 30 }, (_, i) => ({ midi: 50 + i, beats: 0.5 })) });
const bigAssign = assignStars(Array.from({ length: 12 }, (_, i) => ({ key: `s${i}`, name: `s${i}`, magnitude: i, temp: 3000 + i * 1000, lines: [] })), big.melody);
ok(big.ok && big.report.distinctPitches === 30 && bigAssign.fallback && bigAssign.byPitch.size === 30,
  "an imported tune with more pitches (30) than stars (12) still plays via the cycling fallback");

// 2. magToGain
const db = (g) => 20 * Math.log10(g);
ok(near(db(magToGain(-1.5)), 0), "mag −1.5 → 0 dB");
ok(near(db(magToGain(6)), -18), "mag 6.0 → −18 dB");
ok(near(db(magToGain(2.25)), -9), "mag 2.25 → −9 dB (linear in dB)");
ok(near(magToGain(-4), magToGain(-1.5)) && near(magToGain(9), magToGain(6)), "clamped outside −1.5…6.0");
ok(magToGain(0) > magToGain(1) && magToGain(1) > magToGain(4), "monotonic: brighter is louder");

// 2b. freqToWl — tone colour source (inverse of wlToFreq)
ok([380, 434, 486.1, 589, 656.3, 760].every((wl) => near(freqToWl(wlToFreq(wl)), wl, 1e-9)), "freqToWl inverts wlToFreq across the band");
ok(Math.abs(freqToWl(midiToFreq(60)) - 633.33) < 0.01 && Math.abs(freqToWl(midiToFreq(79)) - 432.78) < 0.01,
  `tone wavelengths: C4 → ${freqToWl(midiToFreq(60)).toFixed(1)} nm (orange), G5 → ${freqToWl(midiToFreq(79)).toFixed(1)} nm (violet)`);
ok(freqToWl(midiToFreq(20)) === 760 && freqToWl(midiToFreq(120)) === 380, "out-of-range pitches clamp to the visible band");

// 3. fitEnvelope
const lor = profileToEnvelope("lorentzian"); // a+d+r = 0.41
const kept = fitEnvelope(lor, 1.2);
ok(kept.a === lor.a && kept.d === lor.d && kept.r === lor.r, "1.2 s note: envelope unchanged");
const fit = fitEnvelope(lor, 0.2);
ok(near(fit.a + fit.d + fit.r, 0.2) && near(fit.a / fit.r, lor.a / lor.r) && fit.s === lor.s,
  "0.2 s note: A+D+R scaled proportionally to exactly 0.2 s, sustain level kept");

// Synthetic stars: lines at fixed wavelengths, distinguishable strongest line.
const mkLines = (wls) => wls.map((wl, i) => ({ wl, depth: 0.5, width: 1, profile: "voigt", ew: 100 + i * 10, ep: 3 }));
const star = (key, magnitude, temp, extra = {}) => ({ key, name: key, magnitude, temp, bv: null, hip: null, rv: 0, color: "#ffffff", lines: mkLines([400 + magnitude * 10, 500, 600 + temp / 1000]), ...extra });

// 4. assignment
const twinkle = MELODY_PRESETS[0];
const pool = [
  star("hot", 0.5, 12000), star("cool", 1.0, 3500), star("mid", 1.5, 6000),
  star("warm", 2.0, 4500), star("white", 2.5, 9600), star("blue", 3.0, 20000),
  star("faint1", 5.5, 3000), star("faint2", 6.0, 30000),
];
const a = assignStars(pool, twinkle);
ok(a.stars.length === 6 && !a.stars.some((s) => s.key.startsWith("faint")), "takes the 6 brightest (faint stars left out)");
ok(a.stars.map((s) => s.key).join() === "cool,warm,mid,white,hot,blue", `coolest → hottest: ${a.stars.map((s) => s.key).join(" ")}`);
ok(a.byPitch.get(60).key === "cool" && a.byPitch.get(69).key === "blue", "lowest pitch → coolest, highest → hottest");
ok(!a.fallback, "no fallback with enough stars");

const ties = assignStars([
  star("Zed", 1, 9600, { bv: 0.10 }), star("Alpha", 1.1, 9600, { bv: 0.30 }),
  star("HIPb", 1.2, 9600, { bv: null, hip: 200 }), star("HIPa", 1.3, 9600, { bv: null, hip: 100 }),
  star("Nb", 1.4, 9600), star("Na", 1.5, 9600),
], twinkle);
ok(ties.stars.map((s) => s.key).join() === "Alpha,Zed,HIPa,HIPb,Na,Nb",
  `ties: B–V desc → HIP → name: ${ties.stars.map((s) => s.key).join(" ")}`);

// 5. fallback
const few = assignStars(pool.slice(0, 3), twinkle);
ok(few.fallback && few.available === 3 && few.needed === 6, "3 stars for 6 pitches → fallback flagged");
ok([60, 62, 64, 65, 67, 69].map((m) => few.byPitch.get(m).key).join() === "cool,mid,hot,cool,mid,hot",
  "fallback cycles stars in temperature order");
ok(assignStars([], twinkle).byPitch.size === 0, "no stars → empty assignment");

// 6. plan
const plan = planMelody(twinkle, a);
const beat = 60 / twinkle.bpm;
ok(plan.events.length === twinkle.notes.length, "one event per note");
ok(plan.events.every((e) => near(e.freq, midiToFreq(e.midi)) && e.driftSemitones === 0), "melody pitch is what sounds");
ok(plan.events.every((e) => e.line === strongestLine(e.star.lines)), "timbre comes from the star's strongest (highest-EW) line");
ok(plan.events.every((e) => a.byPitch.get(e.midi) === e.star), "the same pitch always goes to the same star");
ok(near(plan.events[6].dur, 2 * beat) && near(plan.totalSec, twinkle.notes.reduce((s, n) => s + n.beats, 0) * beat),
  `durations = beats·60/bpm (half note ${plan.events[6].dur.toFixed(2)} s, total ${plan.totalSec.toFixed(1)} s)`);
const withRest = { name: "r", bpm: 60, notes: [{ midi: 60, beats: 1 }, { midi: null, beats: 0.5 }, { midi: 62, beats: 1 }] };
const pr = planMelody(withRest, assignStars(pool, withRest));
ok(pr.events.length === 2 && near(pr.events[1].t, 1.5) && near(pr.totalSec, 2.5), "rests are silent but advance time");

// 7. honest
const hp = planMelody(twinkle, a, { honest: true });
const all = a.stars.flatMap((s) => s.lines.map((line) => ({ s, line, f: wlToFreq(line.wl, DEFAULT_PARAMS) })));
const honestOk = hp.events.every((e) => {
  const best = Math.min(...all.map((c) => Math.abs(Math.log2(c.f / midiToFreq(e.midi)))));
  return near(Math.abs(Math.log2(e.freq / midiToFreq(e.midi))), best) && near(e.freq, wlToFreq(e.line.wl)) && e.star.lines.includes(e.line);
});
ok(honestOk, "honest: every note plays the nearest real line pitch among assigned stars, at that pitch");
const ds = driftStats(hp.events);
ok(ds.notes === twinkle.notes.length && ds.maxAbs >= ds.meanAbs, `honest drift computed (synthetic stars): mean ${ds.meanAbs.toFixed(2)} st, max ${ds.maxAbs.toFixed(2)} st`);

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
