// Algorithmic reverb: 4 parallel delay lines with feedback + LP damping.
// Ported from the prototype. Returns two input buses (dry + wet) already wired
// to ctx.destination; the caller connects its source into both.

const DELAYS = [0.029, 0.037, 0.053, 0.067]; // seconds
const BASE_FEEDBACKS = [0.6, 0.55, 0.5, 0.45];

/**
 * Build a reverb send for a single voice.
 * @param {AudioContext} ctx
 * @param {number} reverbAmt 0..1 (from ewToReverb)
 * @param {{reverbWet:number, reverbDry:number}} p tunable params (wet send / dry duck)
 * @returns {{ reverbBus: GainNode, dryBus: GainNode }} connect your source to both.
 */
export function createReverbBus(ctx, reverbAmt, p = { reverbWet: 0.45, reverbDry: 0.2 }) {
  const reverbBus = ctx.createGain();
  reverbBus.gain.value = reverbAmt * p.reverbWet;

  const dryBus = ctx.createGain();
  dryBus.gain.value = 1.0 - reverbAmt * p.reverbDry;

  const feedbacks = BASE_FEEDBACKS.map((f) => f + reverbAmt * 0.2);
  DELAYS.forEach((t, i) => {
    const delay = ctx.createDelay(0.1);
    delay.delayTime.value = t;
    const fb = ctx.createGain();
    fb.gain.value = feedbacks[i];
    const lpf = ctx.createBiquadFilter();
    lpf.type = "lowpass";
    lpf.frequency.value = 2500 - reverbAmt * 800;

    reverbBus.connect(delay);
    delay.connect(lpf);
    lpf.connect(fb);
    fb.connect(delay); // feedback loop
    lpf.connect(ctx.destination);
  });

  dryBus.connect(ctx.destination);
  return { reverbBus, dryBus };
}
