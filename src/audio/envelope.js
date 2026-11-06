// Fit an ADSR envelope to a note length (melody mode / playLine's `duration`).
//
// If the note is shorter than attack + decay + release, those three are scaled
// by the same factor so they sum to exactly the note length (sustain hold → 0).
// Otherwise the envelope is returned unchanged. Pure; sustain level untouched.
export function fitEnvelope(env, dur) {
  const total = env.a + env.d + env.r;
  if (!(dur > 0) || total <= dur) return { ...env };
  const k = dur / total;
  return { ...env, a: env.a * k, d: env.d * k, r: env.r * k };
}
