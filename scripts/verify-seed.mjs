// Unit proof for SEED mode's composer (src/audio/seededMusic.js). Browser-free,
// like verify-extract.mjs — planSong() is pure, so the musical contract can be
// checked without an AudioContext.
//
// What has to hold:
//  1. deterministic      — same star + same seed => identical plan
//  2. seed rearranges    — a different seed changes the music but NOT the key,
//                          because the key belongs to the star, not the seed
//  3. in key             — every pitch is a degree of the star's scale
//  4. no clusters        — the pen's rule: no two notes of a chord on adjacent
//                          scale degrees (that is what keeps voicings consonant)
//  5. bars are full      — every bar is exactly RESOLUTION steps
//  6. lines are real     — every note points at an actual line of the star
//  7. star drives key    — hot star => major and faster, cool => minor, slower
//  8. sparse stars       — a 1-line star still terminates (bounded retry)
//  9. it breathes        — pieces contain rests. The pen fills every slot of
//                          every bar and so did we, which measured out at 0
//                          rests in 5,554 events; music needs somewhere to
//                          breathe, so a regression back to wall-to-wall
//                          notes should fail rather than pass quietly.
// 10. no droning         — the lead voice doesn't repeat one degree forever
import { planSong, keyForStar, RESOLUTION } from "../src/audio/seededMusic.js";

const lines = [
  { wl: 656.3, ew: 4.2, depth: 0.8, width: 2.0, profile: "voigt", ep: 10.2, el: "H" },
  { wl: 486.1, ew: 2.8, depth: 0.6, width: 1.5, profile: "voigt", ep: 10.2, el: "H" },
  { wl: 434.0, ew: 1.9, depth: 0.5, width: 1.2, profile: "gaussian", ep: 10.2, el: "H" },
  { wl: 589.0, ew: 1.1, depth: 0.4, width: 1.0, profile: "gaussian", ep: 0.0, el: "Na" },
  { wl: 517.3, ew: 0.7, depth: 0.3, width: 0.8, profile: "gaussian", ep: 2.7, el: "Mg" },
];
const hot = { name: "Sirius", temp: 9940, rv: 0, lines };
const cool = { name: "Betelgeuse", temp: 3600, rv: 0, lines };

const a = planSong(hot);
const b = planSong(hot);
const reseeded = planSong(hot, { seed: "a-different-seed" });
const coolPlan = planSong(cool);
const sparse = planSong({ name: "One Line", temp: 6000, lines: [lines[0]] });

/** Walk every note event of a plan. */
function events(plan) {
  const out = [];
  for (const m of plan.measures) {
    for (const voice of ["treb", "bass"]) {
      for (const e of m[voice]) if (e) out.push({ ...e, voice });
    }
  }
  return out;
}

const pcsInKey = new Set(a.scale.map((n) => n.pc));
const evs = events(a);
const outOfKey = evs.flatMap((e) => e.notes).filter((n) => !pcsInKey.has(((n.midi % 12) + 12) % 12));
const clustered = evs.filter((e) => {
  const d = e.notes.map((n) => n.degree).sort((x, y) => x - y);
  return d.some((v, i) => i > 0 && v - d[i - 1] <= 1);
});
const badLineRefs = evs.flatMap((e) => e.notes).filter((n) => !lines[n.lineIdx]);
const barsFull = a.measures.every((m) => m.treb.length === RESOLUTION && m.bass.length === RESOLUTION);
const hotKey = keyForStar(hot);
const coolKey = keyForStar(cool);

console.log(`plan: ${a.root} ${a.mode} ${a.bpm}bpm, ${a.bars} bars, ${evs.length} events, ` +
  `${evs.flatMap((e) => e.notes).length} notes`);
console.log(`cool: ${coolPlan.root} ${coolPlan.mode} ${coolPlan.bpm}bpm`);

// A rest is a null run that does NOT follow a sounding event (those are holds).
function restSlots(plan) {
  let rests = 0;
  for (const m of plan.measures) {
    for (const voice of ["treb", "bass"]) {
      let sounding = false;
      for (const e of m[voice]) {
        if (e) sounding = true;
        else if (!sounding) rests++;
      }
    }
  }
  return rests;
}

// Longest run of the same lead (top) degree in one voice, across the piece.
function longestDegreeRun(plan, voice) {
  let run = 1, best = 1, prev = null;
  for (const m of plan.measures) {
    for (const e of m[voice]) {
      if (!e || !e.notes.length) { prev = null; run = 1; continue; }
      const lead = e.notes[0].degree;
      if (lead === prev) best = Math.max(best, ++run); else run = 1;
      prev = lead;
    }
  }
  return best;
}

// Across several seeds, so one lucky piece can't carry the assertion.
const manySeeds = ["Vega", "Capella", "Dubhe", "alpha", "beta", "gamma"];
const plans = manySeeds.map((seed) => planSong(hot, { seed }));
const withRests = plans.filter((pl) => restSlots(pl) > 0).length;
const worstRun = Math.max(...plans.map((pl) => Math.max(longestDegreeRun(pl, "treb"), longestDegreeRun(pl, "bass"))));

const checks = [
  ["deterministic (same seed => same plan)", JSON.stringify(a) === JSON.stringify(b)],
  ["reseed changes the arrangement", JSON.stringify(a.measures) !== JSON.stringify(reseeded.measures)],
  ["reseed keeps the star's key + tempo",
    a.root === reseeded.root && a.mode === reseeded.mode && a.bpm === reseeded.bpm],
  ["every pitch is in key", outOfKey.length === 0],
  ["no clustered voicings (adjacent degrees)", clustered.length === 0],
  ["every bar is exactly RESOLUTION steps", barsFull],
  ["every note maps to a real spectral line", badLineRefs.length === 0],
  ["hot star => major", hotKey.mode === "maj"],
  ["cool star => minor", coolKey.mode === "min"],
  ["hot star is faster than cool", hotKey.bpm > coolKey.bpm],
  ["tempo inside the pen's 60-120 range", a.bpm >= 60 && a.bpm <= 120 && coolPlan.bpm >= 60 && coolPlan.bpm <= 120],
  ["a 1-line star still composes", !!sparse && sparse.measures.length === 4],
  ["a star with no lines returns null", planSong({ name: "Empty", lines: [] }) === null],
  [`pieces breathe (rests in ${withRests}/${plans.length} seeds)`, withRests >= plans.length - 1],
  [`lead voice doesn't drone (longest same-degree run ${worstRun}, want <= 4)`, worstRun <= 4],
];

console.log("\nassertions:");
let allPass = true;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok) allPass = false;
}

console.log(allPass
  ? "\n✅ UNIT PASS: SEED composes deterministically, in key, without clustered voicings."
  : "\n❌ UNIT FAIL");
process.exit(allPass ? 0 : 1);
