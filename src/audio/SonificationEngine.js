// SonificationEngine — turns an absorption-line list into sound via Web Audio.
//
// The per-line synthesis graph (oscillator bank by excitation potential ->
// lowpass filter by line width -> ADSR by profile -> dry/reverb buses) is ported
// directly from the proven prototype. All mapping magic numbers now come from a
// live `params` object (DEFAULT_PARAMS) so the Synth Character panel can retune
// the sound in real time — changes apply to the next note played.

import {
  wlToFreq, depthToGain, widthToQ, profileToEnvelope, ewToReverb,
  rvToDetune, epToHarmonics, DEFAULT_PARAMS,
} from "./mappings.js";
import { createReverbBus } from "./reverb.js";
import { harmonizeChord, CHORD_TIMING } from "./harmonize.js";
import { planSong } from "./seededMusic.js";

export class SonificationEngine {
  constructor() {
    this.ctx = null;
    this.activeNodes = []; // oscillators currently sounding (click / sequence path)
    this.seqTimer = null; // pending setTimeout for the next sequence step
    this.chordTimer = null; // pending setTimeout that ends a chord
    this.seedPlan = null; // last SEED arrangement played (key/bpm/measures) — UI readout
    this.onStep = null; // optional (lineIndex|null) callback for UI highlight
    this.onChord = null; // optional (lineIndices[]|null) callback for chord highlight
    this.params = { ...DEFAULT_PARAMS };

    // Hover audio is a separate world from the click/sequence path above: a
    // registry of up to MAX_HOVER_STARS stars ringing at once, each with its own
    // voice pool, faded/stopped independently. Never touched by stop().
    this.hoverStars = new Map(); // starKey -> group (see _newHoverGroup)
    this.hoverOrder = [];        // starKeys, oldest first (for force-fade-oldest)
    this.MAX_HOVER_STARS = 3;
    this._ringListeners = new Map(); // event -> Set<cb> (ring overlay subscribes)
  }

  /** Merge new tunable params (from the Synth Character panel). */
  setParams(patch) {
    this.params = { ...this.params, ...patch };
  }

  // ── ring/overlay event surface ─────────────────────────────────────────
  // The audio layer is the source of truth for what is ringing; the overlay
  // derives all visuals from these. Events: starChordStart, starLineStart,
  // starFadeStart, starStopped (see emit sites below).
  on(event, cb) {
    if (!this._ringListeners.has(event)) this._ringListeners.set(event, new Set());
    this._ringListeners.get(event).add(cb);
    return () => this._ringListeners.get(event)?.delete(cb);
  }

  _emit(event, data) {
    this._ringListeners.get(event)?.forEach((cb) => {
      try { cb(data); } catch (e) { console.error(`[SonificationEngine] ring listener "${event}" threw:`, e); }
    });
  }

  /** Create/resume the AudioContext. Must be reached from a user gesture. */
  ensureContext() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  /** Stop everything currently playing and cancel any pending sequence/chord. */
  stop() {
    if (this.seqTimer) {
      clearTimeout(this.seqTimer);
      this.seqTimer = null;
    }
    if (this.chordTimer) {
      clearTimeout(this.chordTimer);
      this.chordTimer = null;
    }
    this.activeNodes.forEach((n) => {
      try { n.stop(); } catch { /* already stopped */ }
    });
    this.activeNodes = [];
    this.onStep?.(null);
    this.onChord?.(null);
  }

  /** Play a single absorption line. Stops any currently sounding line first. */
  playLine(line, starRV = 0) {
    // stop current oscillators but DON'T clear a running sequence timer.
    this.activeNodes.forEach((n) => { try { n.stop(); } catch { /* */ } });
    this.activeNodes = [];
    this.activeNodes = this._buildVoice(line, { starRV });
  }

  /**
   * Build (and start) one line's voice graph, returning its oscillators without
   * touching `activeNodes` — so callers decide monophony vs polyphony.
   *
   * Every default reproduces the original monophonic `playLine` exactly; SEED
   * mode overrides `freq` (a scale-snapped pitch instead of the raw wavelength
   * mapping), `dur` (a note value instead of `toneDuration`), `when` (a future
   * audio-clock time, for sample-accurate scheduling) and `gainScale` (voice
   * balance). The timbre — oscillator bank, filter, ADSR, reverb — always still
   * comes from the line's own physics.
   *
   * @param {object} line spectral line
   * @param {{starRV?:number, freq?:number, dur?:number, when?:number, gainScale?:number}} [o]
   * @returns {OscillatorNode[]}
   */
  _buildVoice(line, o = {}) {
    const p = this.params;
    const ctx = this.ensureContext();
    const now = o.when ?? ctx.currentTime;
    const starRV = o.starRV ?? 0;

    const freq = o.freq ?? wlToFreq(line.wl, p);
    const gain = depthToGain(line.depth, p) * p.masterVolume * (o.gainScale ?? 1);
    const filterQ = widthToQ(line.width, p);
    const env = profileToEnvelope(line.profile);
    const dur = o.dur ?? p.toneDuration;
    const detune = rvToDetune(starRV, p);
    const harmonic = epToHarmonics(line.ep, p);
    const reverbAmt = ewToReverb(line.ew, p);

    // Master gain with ADSR. The stage times are absolute, so a note shorter
    // than attack+decay+release (SEED's eighth notes can be ~0.3 s) would
    // schedule them out of order and click; squeeze the envelope to fit instead.
    // At the default 1.2 s tone nothing is clamped, so click/hover are unchanged.
    const rel = Math.min(env.r, Math.max(0.02, dur * 0.4));
    const adFit = Math.min(1, (dur - rel) * 0.9 / Math.max(env.a + env.d, 1e-4));
    const att = env.a * adFit;
    const dec = env.d * adFit;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(gain, now + att);
    masterGain.gain.linearRampToValueAtTime(gain * env.s, now + att + dec);
    masterGain.gain.setValueAtTime(gain * env.s, now + Math.max(att + dec, dur - rel));
    masterGain.gain.linearRampToValueAtTime(0, now + dur);

    // Lowpass filter (width -> Q).
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1200 + filterQ * 200;
    filter.Q.value = filterQ;

    // Reverb + dry buses (EW -> wetness).
    const { reverbBus, dryBus } = createReverbBus(ctx, reverbAmt, p);

    // Oscillator bank, mixed by excitation potential.
    const oscs = [];

    // Fundamental (always, sine).
    const osc1 = ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.value = freq;
    osc1.detune.value = detune;
    const g1 = ctx.createGain();
    g1.gain.value = 1.0 - harmonic * 0.3;
    osc1.connect(g1); g1.connect(filter);
    oscs.push(osc1);

    // 2nd harmonic (triangle, fades in with EP).
    if (harmonic > 0.1) {
      const osc2 = ctx.createOscillator();
      osc2.type = "triangle";
      osc2.frequency.value = freq * 2;
      osc2.detune.value = detune * 0.5;
      const g2 = ctx.createGain();
      g2.gain.value = Math.min(harmonic * 0.5, 0.4);
      osc2.connect(g2); g2.connect(filter);
      oscs.push(osc2);
    }

    // 3rd harmonic (sawtooth, only for high EP).
    if (harmonic > 0.4) {
      const osc3 = ctx.createOscillator();
      osc3.type = "sawtooth";
      osc3.frequency.value = freq * 3;
      osc3.detune.value = detune * 0.3;
      const g3 = ctx.createGain();
      g3.gain.value = Math.min((harmonic - 0.4) * 0.4, 0.25);
      osc3.connect(g3); g3.connect(filter);
      oscs.push(osc3);
    }

    // Sub-oscillator for low EP (dark, grounding tone).
    if (harmonic < 0.2 && freq > 200) {
      const oscSub = ctx.createOscillator();
      oscSub.type = "sine";
      oscSub.frequency.value = freq * 0.5;
      oscSub.detune.value = detune;
      const gSub = ctx.createGain();
      gSub.gain.value = 0.15;
      oscSub.connect(gSub); gSub.connect(filter);
      oscs.push(oscSub);
    }

    // filter -> masterGain -> (dry + reverb) -> destination.
    filter.connect(masterGain);
    masterGain.connect(dryBus);
    masterGain.connect(reverbBus);

    oscs.forEach((osc) => {
      osc.start(now);
      osc.stop(now + dur + 0.05);
      osc._endsAt = now + dur + 0.05; // lets playSeed prune finished voices
    });
    return oscs;
  }

  /**
   * Play all lines of a star in sequence (strongest equivalent width first).
   * @param {{lines:Array, rv?:number}} data
   * @param {{ loop?: boolean, shouldContinue?: () => boolean }} [opts]
   *   loop: restart the sequence when it finishes (hover loop mode).
   *   shouldContinue: predicate checked before each restart; stops looping when false.
   */
  playSequence(data, opts = {}) {
    this.stop();
    if (!data?.lines?.length) return;
    const loop = !!opts.loop;
    const shouldContinue = typeof opts.shouldContinue === "function" ? opts.shouldContinue : null;
    const order = data.lines
      .map((line, idx) => ({ line, idx }))
      .sort((a, b) => b.line.ew - a.line.ew);

    let i = 0;
    const step = () => {
      if (i >= order.length) {
        if (loop && (!shouldContinue || shouldContinue())) {
          i = 0;
          this.seqTimer = setTimeout(step, this.params.toneDuration * 1000 + this.params.sequenceGap);
          return;
        }
        this.seqTimer = null;
        this.onStep?.(null);
        return;
      }
      const { line, idx } = order[i];
      this.playLine(line, data.rv ?? 0);
      this.onStep?.(idx);
      i += 1;
      this.seqTimer = setTimeout(step, this.params.toneDuration * 1000 + this.params.sequenceGap);
    };
    step();
  }

  // ── Hover audio: per-star registry (max 3 concurrent) ──────────────────

  _newHoverGroup(key, mode) {
    return {
      key,
      mode,                 // 'chord' | 'sequence'
      voices: [],           // { osc, masterGain }[] for every oscillator started
      seqTimer: null,       // sequence: pending setTimeout for the next tone
      fading: false,        // true once a fade has begun
      stopTimer: null,      // timeout that finalizes removal after a fade
    };
  }

  /** Count stars actively ringing (not yet fading) — what the cap applies to. */
  _activeHoverCount() {
    let n = 0;
    this.hoverStars.forEach((g) => { if (!g.fading) n += 1; });
    return n;
  }

  /**
   * Admit `key` as a new ringing star. Returns false if it should be skipped
   * (already ringing and not fading — idempotent re-hover). Enforces the cap by
   * force-fading the oldest active star(s) via the same fade path as hover-off.
   */
  _admitHoverStar(key) {
    const existing = this.hoverStars.get(key);
    if (existing) {
      if (!existing.fading) return false;   // already ringing → don't double-trigger
      this._hardStopHoverStar(key);         // was fading → clear, then restart fresh
    }
    while (this._activeHoverCount() >= this.MAX_HOVER_STARS) {
      const oldest = this.hoverOrder.find((k) => this.hoverStars.get(k) && !this.hoverStars.get(k).fading);
      if (!oldest) break;
      this.fadeHoverStar(oldest, this.params.hoverFadeOut); // force-fade oldest
    }
    return true;
  }

  /** Immediately silence + remove a star (no fade), emitting starStopped. */
  _hardStopHoverStar(key) {
    const g = this.hoverStars.get(key);
    if (!g) return;
    if (g.seqTimer) clearTimeout(g.seqTimer);
    if (g.stopTimer) clearTimeout(g.stopTimer);
    g.voices.forEach(({ osc }) => { try { osc.stop(); } catch { /* */ } });
    this.hoverStars.delete(key);
    this.hoverOrder = this.hoverOrder.filter((k) => k !== key);
    this._emit("starStopped", { starKey: key });
  }

  /**
   * Rapid-fade a ringing star to silence over durationSec, then remove it. This
   * is the single fade path used by both hover-off and force-fade-oldest. Stops
   * the sequence from spawning further tones. Emits starFadeStart now, starStopped
   * when silent.
   */
  fadeHoverStar(key, durationSec) {
    const g = this.hoverStars.get(key);
    if (!g || g.fading) return;
    g.fading = true;
    if (g.seqTimer) { clearTimeout(g.seqTimer); g.seqTimer = null; }
    const ctx = this.ctx;
    if (ctx) {
      const now = ctx.currentTime;
      g.voices.forEach(({ osc, masterGain }) => {
        try {
          masterGain.gain.cancelScheduledValues(now);
          masterGain.gain.setValueAtTime(masterGain.gain.value, now);
          masterGain.gain.linearRampToValueAtTime(0, now + durationSec);
          osc.stop(now + durationSec + 0.05);
        } catch { /* already stopped */ }
      });
    }
    this._emit("starFadeStart", { starKey: key, fadeDurationSec: durationSec });
    g.stopTimer = setTimeout(() => {
      this.hoverStars.delete(key);
      this.hoverOrder = this.hoverOrder.filter((k) => k !== key);
      this._emit("starStopped", { starKey: key });
    }, durationSec * 1000 + 60);
  }

  /** Fade every ringing star (e.g. hover mode toggled off). */
  fadeAllHover(durationSec) {
    [...this.hoverStars.keys()].forEach((k) => this.fadeHoverStar(k, durationSec));
  }

  /**
   * Build one sustained hover voice (oscillator bank → filter → ADSR → reverb)
   * into group `g`. `held` true = no release/stop (chord, sustained until fade);
   * false = a finite tone with release and a scheduled stop (sequence arpeggio).
   * Returns the tone's audible end time (for held=false).
   */
  _buildHoverVoice(g, line, { detune, gain, startAt, held }) {
    const p = this.params;
    const ctx = this.ctx;
    const freq = wlToFreq(line.wl, p);
    const filterQ = widthToQ(line.width, p);
    const env = profileToEnvelope(line.profile);
    const harmonic = epToHarmonics(line.ep, p);
    const reverbAmt = ewToReverb(line.ew, p);
    const dur = p.toneDuration;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0, startAt);
    masterGain.gain.linearRampToValueAtTime(gain, startAt + env.a);
    masterGain.gain.linearRampToValueAtTime(gain * env.s, startAt + env.a + env.d);
    if (!held) {
      // Finite tone: hold sustain then release (the arpeggio note).
      masterGain.gain.setValueAtTime(gain * env.s, startAt + dur - env.r);
      masterGain.gain.linearRampToValueAtTime(0, startAt + dur);
    }

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1200 + filterQ * 200;
    filter.Q.value = filterQ;

    const { reverbBus, dryBus } = createReverbBus(ctx, reverbAmt, p);

    const oscs = [];
    const osc1 = ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.value = freq;
    osc1.detune.value = detune;
    const g1 = ctx.createGain();
    g1.gain.value = 1.0 - harmonic * 0.3;
    osc1.connect(g1); g1.connect(filter);
    oscs.push(osc1);

    if (harmonic > 0.1) {
      const osc2 = ctx.createOscillator();
      osc2.type = "triangle";
      osc2.frequency.value = freq * 2;
      osc2.detune.value = detune * 0.5;
      const g2 = ctx.createGain();
      g2.gain.value = Math.min(harmonic * 0.5, 0.4);
      osc2.connect(g2); g2.connect(filter);
      oscs.push(osc2);
    }
    if (harmonic > 0.4) {
      const osc3 = ctx.createOscillator();
      osc3.type = "sawtooth";
      osc3.frequency.value = freq * 3;
      osc3.detune.value = detune * 0.3;
      const g3 = ctx.createGain();
      g3.gain.value = Math.min((harmonic - 0.4) * 0.4, 0.25);
      osc3.connect(g3); g3.connect(filter);
      oscs.push(osc3);
    }
    if (harmonic < 0.2 && freq > 200) {
      const oscSub = ctx.createOscillator();
      oscSub.type = "sine";
      oscSub.frequency.value = freq * 0.5;
      oscSub.detune.value = detune;
      const gSub = ctx.createGain();
      gSub.gain.value = 0.15;
      oscSub.connect(gSub); gSub.connect(filter);
      oscs.push(oscSub);
    }

    filter.connect(masterGain);
    masterGain.connect(dryBus);
    masterGain.connect(reverbBus);

    oscs.forEach((osc) => {
      osc.start(startAt);
      if (!held) osc.stop(startAt + dur + 0.05);
      g.voices.push({ osc, masterGain });
    });
  }

  /**
   * Start (or skip, if already ringing) a star's chord under hover. All its
   * strongest lines sound at once, sustained until fadeHoverStar(). Emits
   * starChordStart with the EW-descending line list + screen position.
   * @param {string} key  stable star id (hover key)
   * @param {{lines:Array, rv?:number, color?:string}} data
   * @param {{x:number,y:number}} screenPos
   */
  startHoverChord(key, data, screenPos) {
    if (!this._admitHoverStar(key)) return;
    if (!data?.lines?.length) return;
    const p = this.params;
    const ctx = this.ensureContext();
    const now = ctx.currentTime;

    const g = this._newHoverGroup(key, "chord");
    this.hoverStars.set(key, g);
    this.hoverOrder.push(key);

    const voices = data.lines
      .map((line) => line)
      .sort((a, b) => b.ew - a.ew)
      .slice(0, Math.max(1, Math.round(p.hoverMaxVoices)));
    const n = voices.length;
    const loudnessComp = 1 / Math.sqrt(n);
    const rv = data.rv ?? 0;

    voices.forEach((line, i) => {
      const spread = (i / Math.max(n - 1, 1) - 0.5) * p.hoverSpreadDetune * 2;
      const gain = depthToGain(line.depth, p) * p.masterVolume * p.hoverGainScale * loudnessComp;
      this._buildHoverVoice(g, line, {
        detune: rvToDetune(rv, p) + spread,
        gain,
        startAt: now,
        held: true,
      });
    });

    // Rings: one per line, EW-strongest first. (All lines, even beyond the voice
    // cap — the overlay draws the full spectrum; audio plays the loudest voices.)
    const sortedLines = data.lines.slice().sort((a, b) => b.ew - a.ew);
    this._emit("starChordStart", { starKey: key, screenPos, lines: sortedLines });
  }

  /**
   * Start (or skip) a star's sequence under hover: its lines arpeggiate
   * EW-descending, one tone at a time, looping if opts.loop. Emits starLineStart
   * per tone (with screenPos so the overlay can place the ring).
   * @param {string} key
   * @param {{lines:Array, rv?:number}} data
   * @param {{x:number,y:number}} screenPos
   * @param {{loop?:boolean}} opts
   */
  startHoverSequence(key, data, screenPos, opts = {}) {
    if (!this._admitHoverStar(key)) return;
    if (!data?.lines?.length) return;
    const p = this.params;
    this.ensureContext();

    const g = this._newHoverGroup(key, "sequence");
    this.hoverStars.set(key, g);
    this.hoverOrder.push(key);

    const order = data.lines.slice().sort((a, b) => b.ew - a.ew);
    const rv = data.rv ?? 0;
    const loop = !!opts.loop;
    let i = 0;

    const step = () => {
      if (g.fading) return;
      if (i >= order.length) {
        if (loop) { i = 0; } else { g.seqTimer = null; return; }
      }
      const line = order[i];
      const gain = depthToGain(line.depth, p) * p.masterVolume * p.hoverGainScale;
      this._buildHoverVoice(g, line, {
        detune: rvToDetune(rv, p),
        gain,
        startAt: this.ctx.currentTime,
        held: false,
      });
      this._emit("starLineStart", {
        starKey: key, line, index: i, durationSec: p.toneDuration, screenPos,
      });
      i += 1;
      g.seqTimer = setTimeout(step, p.toneDuration * 1000 + p.sequenceGap);
    };
    step();
  }

  /**
   * Play all of a star's lines at once as a harmonized chord. Pitches come from
   * harmonize.js (snapped toward a just-intonation ladder by `amount`); the
   * per-voice synth graph is the same bank used by playLine, but with a chord
   * master envelope and an amount-driven flavor sweep: at amount 0 a harsh, wet,
   * dark cluster; at amount 1 a clean, dry, bright chord. Ported from the
   * prototype's playChord. See harmonize.js + PHASE 2.5 in docs/ROADMAP.md.
   * @param {{lines:Array, rv?:number}} data
   * @param {number} amount  0..1 harmonize amount (default: params.harmonizeAmount)
   */
  playChord(data, amount = this.params.harmonizeAmount) {
    this.stop();
    if (!data?.lines?.length) return;

    const p = this.params;
    const ctx = this.ensureContext();
    const now = ctx.currentTime;
    const lines = data.lines;
    const rv = data.rv ?? 0;
    const chord = harmonizeChord(lines, rv, amount);
    const dur = CHORD_TIMING.duration;

    // Chord-level master envelope: slow swell in, slow release out.
    const chordMaster = ctx.createGain();
    chordMaster.gain.setValueAtTime(0, now);
    chordMaster.gain.linearRampToValueAtTime(1, now + CHORD_TIMING.masterAttack);
    chordMaster.gain.setValueAtTime(1, now + dur - CHORD_TIMING.masterRelease);
    chordMaster.gain.linearRampToValueAtTime(0, now + dur);
    chordMaster.connect(ctx.destination);

    const allOscs = [];

    lines.forEach((line, i) => {
      const voiceStart = now + i * CHORD_TIMING.stagger;

      // Pitch from the harmonized chord; gain scaled (1/√N) to avoid clipping.
      const freq = chord.freqs[i];
      const gain = depthToGain(line.depth, p) * chord.gainScale * p.masterVolume;
      const filterQ = widthToQ(line.width, p);
      const env = profileToEnvelope(line.profile);
      const detune = rvToDetune(rv, p);
      const harmonic = epToHarmonics(line.ep, p);
      // Amount-driven flavor: harsh/dark/wet at 0 → clean/bright/dry at 1.
      const randDetune = (Math.random() - 0.5) * 120 * (1 - amount); // fundamental only
      const filterFreq = (600 + filterQ * 100) + amount * (1200 + filterQ * 100);
      const reverbAmt = ewToReverb(line.ew, p) * (0.7 - amount * 0.4);

      // Per-voice gain with ADSR, relative to this voice's staggered onset.
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0, voiceStart);
      masterGain.gain.linearRampToValueAtTime(gain, voiceStart + env.a);
      masterGain.gain.linearRampToValueAtTime(gain * env.s, voiceStart + env.a + env.d);
      masterGain.gain.setValueAtTime(gain * env.s, voiceStart + dur - env.r);
      masterGain.gain.linearRampToValueAtTime(0, voiceStart + dur);

      // Filter (width → Q), cutoff also driven by amount (dark → bright).
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = filterFreq;
      filter.Q.value = filterQ;

      // Algorithmic reverb: parallel delay lines with feedback + diffusion,
      // wetness tracking amount. (Self-contained per voice, like the prototype —
      // intentionally distinct from playLine's createReverbBus.)
      const reverbBus = ctx.createGain();
      reverbBus.gain.value = reverbAmt * 0.45;
      const dryBus = ctx.createGain();
      dryBus.gain.value = 1.0 - reverbAmt * 0.2;

      const delays = [0.029, 0.037, 0.053, 0.067];
      const feedbacks = [0.6, 0.55, 0.5, 0.45].map((f) => f + reverbAmt * 0.2);
      delays.forEach((t, di) => {
        const delay = ctx.createDelay(0.1);
        delay.delayTime.value = t;
        const fb = ctx.createGain();
        fb.gain.value = feedbacks[di];
        const lpf = ctx.createBiquadFilter();
        lpf.type = "lowpass";
        lpf.frequency.value = 2500 - reverbAmt * 800;
        reverbBus.connect(delay);
        delay.connect(lpf);
        lpf.connect(fb);
        fb.connect(delay);
        lpf.connect(chordMaster); // wet → chord master
      });

      // Oscillator bank by excitation potential (identical to playLine).
      const oscs = [];

      const osc1 = ctx.createOscillator();
      osc1.type = "sine";
      osc1.frequency.value = freq;
      osc1.detune.value = detune + randDetune;
      const g1 = ctx.createGain();
      g1.gain.value = 1.0 - harmonic * 0.3;
      osc1.connect(g1); g1.connect(filter);
      oscs.push(osc1);

      if (harmonic > 0.1) {
        const osc2 = ctx.createOscillator();
        osc2.type = "triangle";
        osc2.frequency.value = freq * 2;
        osc2.detune.value = detune * 0.5;
        const g2 = ctx.createGain();
        g2.gain.value = Math.min(harmonic * 0.5, 0.4);
        osc2.connect(g2); g2.connect(filter);
        oscs.push(osc2);
      }

      if (harmonic > 0.4) {
        const osc3 = ctx.createOscillator();
        osc3.type = "sawtooth";
        osc3.frequency.value = freq * 3;
        osc3.detune.value = detune * 0.3;
        const g3 = ctx.createGain();
        g3.gain.value = Math.min((harmonic - 0.4) * 0.4, 0.25);
        osc3.connect(g3); g3.connect(filter);
        oscs.push(osc3);
      }

      if (harmonic < 0.2 && freq > 200) {
        const oscSub = ctx.createOscillator();
        oscSub.type = "sine";
        oscSub.frequency.value = freq * 0.5;
        oscSub.detune.value = detune;
        const gSub = ctx.createGain();
        gSub.gain.value = 0.15;
        oscSub.connect(gSub); gSub.connect(filter);
        oscs.push(oscSub);
      }

      // Routing: filter → per-voice ADSR → dry + reverb → chord master.
      filter.connect(masterGain);
      masterGain.connect(dryBus);
      masterGain.connect(reverbBus);
      dryBus.connect(chordMaster);

      oscs.forEach((o) => { o.start(voiceStart); o.stop(voiceStart + dur + 0.05); });
      allOscs.push(...oscs);
    });

    this.activeNodes = allOscs;

    // Light every voice for the chord's duration; clear when it ends.
    this.onChord?.(lines.map((_, i) => i));
    this.chordTimer = setTimeout(() => {
      this.chordTimer = null;
      this.onChord?.(null);
    }, dur * 1000);
  }

  /**
   * SEED mode — play the star as a short seeded piece.
   *
   * The arrangement comes from seededMusic.planSong (a port of jak_e's
   * "Seeded Procedural Music Generator", see that file); this method only
   * renders it. Two voices sound at once, so unlike playSequence this path is
   * polyphonic: each note builds its own voice via `_buildVoice` and the
   * oscillators accumulate in `activeNodes` (pruned as they finish) so `stop()`
   * still silences everything.
   *
   * Timing is anchored to one absolute audio-clock `start`, and every note's
   * onset is computed from it — so a late timer callback cannot make the piece
   * drift; it only makes that step's lead-in shorter.
   *
   * @param {{lines:Array, rv?:number, temp?:number, name?:string}} data
   * @param {{seed?:string, bars?:number}} [opts]
   * @returns {object|null} the plan that is now playing (key, bpm, measures)
   */
  playSeed(data, opts = {}) {
    this.stop();
    if (!data?.lines?.length) return null;

    const plan = planSong(data, { seed: opts.seed, params: this.params, bars: opts.bars ?? 4 });
    if (!plan) return null;
    this.seedPlan = plan;

    const ctx = this.ensureContext();
    const beatSec = 60 / plan.bpm;
    const stepSec = (beatSec * 4) / plan.resolution; // one eighth in 4/4
    const totalSteps = plan.bars * plan.resolution;
    const start = ctx.currentTime + 0.12; // small lead-in so step 0 isn't clipped

    let i = 0;
    const step = () => {
      if (i >= totalSteps) {
        this.seqTimer = null;
        // The last notes are still ringing out their release; keep only those,
        // so `stop()` can still cut them but finished voices aren't retained.
        const end = ctx.currentTime;
        this.activeNodes = this.activeNodes.filter((n) => (n._endsAt ?? Infinity) > end);
        this.onChord?.(null);
        this.onStep?.(null);
        return;
      }
      const when = start + i * stepSec;
      const measure = plan.measures[Math.floor(i / plan.resolution)];
      const slot = i % plan.resolution;
      const lit = [];

      // Bass first, then treble — voice balance keeps 3-note chords from
      // swamping the bass, and both together from clipping.
      for (const [voice, gainScale] of [["bass", 0.85], ["treb", 0.55]]) {
        const ev = measure[voice][slot];
        if (!ev) continue;
        const dur = (4 / ev.len) * beatSec; // note value -> seconds
        for (const note of ev.notes) {
          const line = data.lines[note.lineIdx];
          if (!line) continue;
          this.activeNodes.push(
            ...this._buildVoice(line, { freq: note.freq, dur, when, starRV: data.rv ?? 0, gainScale })
          );
          lit.push(note.lineIdx);
        }
      }

      // Drop references to voices that have already finished, so a long piece
      // doesn't grow an unbounded array (they self-stop; stop() only needs the
      // ones still sounding).
      const t = ctx.currentTime;
      this.activeNodes = this.activeNodes.filter((n) => (n._endsAt ?? Infinity) > t);

      if (lit.length) this.onChord?.([...new Set(lit)]);
      i += 1;
      const nextWhen = start + i * stepSec;
      this.seqTimer = setTimeout(step, Math.max(0, (nextWhen - ctx.currentTime - 0.05) * 1000));
    };
    step();
    return plan;
  }

  /** Computed audio params for a line — for future UI readout (no audio). */
  getParams(line, starRV = 0) {
    const p = this.params;
    return {
      freq: wlToFreq(line.wl, p),
      gain: depthToGain(line.depth, p),
      filterQ: widthToQ(line.width, p),
      env: profileToEnvelope(line.profile),
      reverb: ewToReverb(line.ew, p),
      detune: rvToDetune(starRV, p),
      harmonics: epToHarmonics(line.ep, p),
    };
  }
}

export default SonificationEngine;
