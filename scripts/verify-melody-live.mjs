// Melody mode, end to end (headless Chromium, live engine). Covers the brief's
// acceptance criteria that need a browser:
//   2  Twinkle assigns six stars in view, coolest star on the lowest note
//   3  each note pulses its star, in the star's colour, for the note's length;
//      pulses track the star when the view pans
//   4  brightness → loudness (offline render, same line + pitch, bright vs faint;
//      and two real stars at the same pitch)
//   5  the same note on two different-class stars differs (offline render)
//   6  ■ clears audio + pulses; starting melody stops chord; chord stops melody
//   7  honest mode plays; drift report per preset across views
//   +  how often the "fewer stars than pitches" fallback fires
//   +  every assigned star is one the engine actually draws (picker returns it),
//      including on a phone viewport at wide FOV (MELODY-FINDINGS §8-B)
//
// Needs `npm run dev` running + Playwright (same as verify:slice).
import { chromium } from "playwright";
import { smf, tempo, name as trackName, on, off } from "./lib/smf.mjs";
import { binhex } from "./lib/binhex.mjs";

const url = process.argv[2] || "http://localhost:5173/";
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist", "--enable-webgl", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails += 1; };

const click = (label) => page.evaluate((label) => {
  const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === label);
  if (!b) return false; b.click(); return true;
}, label);
const setHonest = (on) => page.evaluate((on) => {
  const b = [...document.querySelectorAll("button")].find((x) => x.hasAttribute("aria-pressed"));
  if ((b.getAttribute("aria-pressed") === "true") !== on) b.click();
}, on);
const setPreset = (i) => page.selectOption('select[aria-label="Melody preset"]', String(i));
const setView = (fov, yaw, pitch) => page.evaluate(([f, y, p]) => {
  const s = window.__stel; s.core.fov = f * Math.PI / 180; s.core.observer.yaw = y; s.core.observer.pitch = p;
}, [fov, yaw, pitch]);
const melodySummary = () => page.evaluate(() => {
  const m = window.__melody;
  if (!m) return null;
  return {
    preset: m.preset, honest: m.honest, visible: m.visible,
    needed: m.assignment.needed, available: m.assignment.available, fallback: m.assignment.fallback,
    stars: m.assignment.stars.map((s) => ({ key: s.key, name: s.name, temp: s.temp, bv: s.bv, mag: s.magnitude, color: s.color, type: s.type, src: s.dataSource })),
    pitchToStar: [...m.assignment.byPitch.entries()].map(([p, s]) => [p, s.key]),
    drift: m.drift,
    durs: m.plan ? m.plan.events.map((e) => e.dur) : [],
  };
});


// How many assigned stars the engine's picker returns near their projected pixel.
const assignedDrawn = (pg) => pg.evaluate(() => {
  const m = window.__melody, b = window.__bridge, stel = window.__stel;
  if (!m?.assignment?.stars?.length) return { n: 0, drawn: 0 };
  const vis = b.listVisibleStars();
  let drawn = 0;
  for (const s of m.assignment.stars) {
    const pos = b.projectToScreen(s.radecICRF);
    if (!pos) continue;
    let hit = false;
    for (let dy = -4; dy <= 4 && !hit; dy += 2) for (let dx = -4; dx <= 4 && !hit; dx += 2) {
      const q = stel.ccall("core_get_obj_at", "number", ["number", "number", "number"], [pos.x + dx, pos.y + dy, 3]);
      if (q) { const o = new stel.SweObj(q); const d = (o.designations() || []); if (d.some((x) => x.replace(/^NAME /, "") === s.name || x === s.name || x === `HIP ${s.hip}`)) hit = true; stel._obj_release(q); }
    }
    if (hit) drawn++;
  }
  return { n: m.assignment.stars.length, drawn, onScreen: vis.length };
});

let exitCode = 1;
try {
  await page.goto(url, { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => !!window.__stel && !!window.__bridge, null, { timeout: 60000 });
  await sleep(9000);
  await page.evaluate(() => {
    window.__oscCount = 0;
    const AC = window.AudioContext || window.webkitAudioContext;
    const orig = AC.prototype.createOscillator;
    AC.prototype.createOscillator = function (...a) { window.__oscCount++; return orig.apply(this, a); };
    window.__notes = [];
    window.__engine.on("melodyNote", (e) => window.__notes.push({ key: e.starKey, color: e.color, wl: e.toneWl, dur: e.durationSec, t: performance.now() }));
  });

  // ── 2. Twinkle: six stars, coolest → lowest ─────────────────────────────
  await setView(50, 1.2, 0); await sleep(2500);
  await setPreset(0); await setHonest(false);
  const t0 = Date.now();
  ok(await click("Play melody"), "▶ pressed");
  const m = await melodySummary();
  console.log(`      assign+start ${Date.now() - t0} ms; ${m.visible} stars on screen`);
  ok(m.preset === "Twinkle Twinkle Little Star" && m.available === 6 && !m.fallback, `Twinkle assigned ${m.available}/6 stars`);
  console.log("      " + m.stars.map((s) => `${s.name} ${s.temp}K bv${s.bv?.toFixed(2)} m${s.mag.toFixed(1)}`).join(" | "));
  const lowestKey = m.pitchToStar.sort((a, b) => a[0] - b[0])[0][1];
  const sortedOk = m.stars.every((s, i, arr) => i === 0 || arr[i - 1].temp <= s.temp);
  ok(lowestKey === m.stars[0].key && sortedOk, `coolest (${m.stars[0].name}, ${m.stars[0].temp} K) plays the lowest note (C4)`);

  // ── 3. pulses: colour, duration, tracking ──────────────────────────────
  await sleep(4500);
  const notes = await page.evaluate(() => window.__notes.slice());
  const colorOf = Object.fromEntries(m.stars.map((s) => [s.key, s.color]));
  ok(notes.length >= 7, `${notes.length} melody notes pulsed in 4.5 s`);
  ok(notes.every((n) => n.color === colorOf[n.key]), "every pulse's glow uses its star's display colour");
  // Tone colour: the rim is the note's pitch as a wavelength, through wlToRGB.
  const toneOk = await page.evaluate(async (notes) => {
    const { freqToWl } = await import("/src/audio/mappings.js");
    const ev = window.__melody.plan.events;
    return notes.every((n, i) => Math.abs(n.wl - freqToWl(ev[i].freq, window.__engine.params)) < 1e-9);
  }, notes);
  ok(toneOk, `every pulse's rim is its note's tone colour (first notes at ${notes.slice(0, 3).map((n) => n.wl.toFixed(0) + " nm").join(", ")})`);
  ok(notes.every((n, i) => Math.abs(n.dur - m.durs[i]) < 1e-9) && Math.abs(notes[0].dur - 0.6) < 1e-9 && Math.abs(notes[6].dur - 1.2) < 1e-9,
    "pulse life = note length (0.6 s quarter, 1.2 s half at 100 bpm)");
  const gaps = notes.slice(1, 6).map((n, i) => n.t - notes[i].t);
  ok(gaps.every((g) => Math.abs(g - 600) < 60), `pulses in time with notes (onset gaps ${gaps.map((g) => g.toFixed(0)).join(", ")} ms)`);
  // After the timing checks: this probe blocks the page for a few hundred ms.
  const d0 = await assignedDrawn(page);
  ok(d0.n === 6 && d0.drawn === 6, `all ${d0.n} assigned stars are drawn by the engine (${d0.drawn}/${d0.n})`);
  const osc = await page.evaluate(() => window.__oscCount);
  ok(osc > 0, `audio sounding (${osc} oscillators)`);
  const bands = await page.evaluate(() => window.__ringOverlay.bands().filter((b) => b.key.startsWith("melody:")));
  const bandColours = await page.evaluate(async () => {
    const { wlToRGB } = await import("/src/audio/color.js");
    // Read bands and the note log in the same synchronous step (no race).
    const bands = window.__ringOverlay.bands().filter((b) => b.key.startsWith("melody:") && b.n > 0);
    const last = {};
    for (const n of window.__notes) last[n.key] = n;
    const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    return bands.every((b) => last[b.key] && JSON.stringify(b.rim) === JSON.stringify(wlToRGB(last[b.key].wl))
      && JSON.stringify(b.rgb) === JSON.stringify(hex(last[b.key].color))) && bands.length > 0;
  });
  ok(bands.length > 0 && bandColours, "drawn bands: tone-coloured rim, star-coloured glow");
  const proj = await page.evaluate((keys) => keys.map((k) => {
    const s = window.__melody.assignment.stars.find((x) => x.key === k);
    return window.__bridge.projectToScreen(s.radecICRF);
  }), bands.map((b) => b.key));
  ok(bands.length > 0 && bands.every((b, i) => Math.hypot(b.pos.x - proj[i].x, b.pos.y - proj[i].y) < 1.5),
    `pulses sit on their stars (${bands.length} systems)`);
  // Pan and confirm a pulse follows its star.
  const before = bands[0]?.pos;
  await page.evaluate(() => { window.__stel.core.observer.yaw += 0.05; });
  await sleep(400);
  const after = await page.evaluate((k) => window.__ringOverlay.bands().find((b) => b.key === k)?.pos, bands[0]?.key);
  const exp = await page.evaluate((k) => window.__bridge.projectToScreen(window.__melody.assignment.stars.find((x) => x.key === k).radecICRF), bands[0]?.key);
  ok(before && after && Math.hypot(after.x - before.x, after.y - before.y) > 20 && Math.hypot(after.x - exp.x, after.y - exp.y) < 2,
    `pulse tracks its star while panning (moved ${after ? Math.hypot(after.x - before.x, after.y - before.y).toFixed(0) : "?"} px)`);
  const m2 = await melodySummary();
  ok(JSON.stringify(m2.pitchToStar) === JSON.stringify(m.pitchToStar), "panning during playback does not reassign");

  // ── 6. stop clears everything ──────────────────────────────────────────
  ok(await click("Stop melody"), "■ pressed");
  await sleep(150);
  const cleared = await page.evaluate(() => ({
    bands: window.__ringOverlay.bands().filter((b) => b.key.startsWith("melody:")).length,
    keys: window.__engine.melodyKeys.size, nodes: window.__engine.activeNodes.length, timer: !!window.__engine.seqTimer,
    notesBefore: window.__notes.length,
  }));
  await sleep(1500);
  const notesAfter = await page.evaluate(() => window.__notes.length);
  ok(!cleared.bands && !cleared.keys && !cleared.nodes && !cleared.timer && notesAfter === cleared.notesBefore,
    "stop: no pulses, no voices, no pending notes");
  ok(await page.evaluate(() => !!document.querySelector('button[aria-label="Play melody"]')), "button back to ▶");

  // Chord ↔ melody exclusivity. Select Sirius, ▶ in the spectrum panel = chord/seed.
  const pressPanelPlay = () => page.evaluate(() => {
    const panel = [...document.querySelectorAll("div")].find((d) => d.style.position === "fixed" && d.style.bottom === "56px");
    const b = panel && [...panel.querySelectorAll("button")].find((x) => x.textContent.trim() === "▶");
    if (b) b.click(); return !!b;
  });
  await page.evaluate(() => { const s = window.__stel; s.core.selection = s.getObj("NAME Sirius") || s.getObj("Sirius"); });
  await sleep(800);
  const modeBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "CHORD");
    if (b) b.click(); return !!b;
  });
  await sleep(200);
  ok(modeBtn && await pressPanelPlay(), "chord started on Sirius");
  await sleep(300);
  const chordNodes = await page.evaluate(() => window.__engine.activeNodes.length);
  await click("Play melody");
  await sleep(400);
  const afterMelody = await page.evaluate(() => ({ chordTimer: !!window.__engine.chordTimer, melody: window.__engine.melodyKeys.size }));
  ok(chordNodes > 0 && !afterMelody.chordTimer && afterMelody.melody > 0, "starting melody stops chord playback");
  await pressPanelPlay();
  await sleep(300);
  const afterChord = await page.evaluate(() => ({ keys: window.__engine.melodyKeys.size, btn: !!document.querySelector('button[aria-label="Play melody"]'), chord: !!window.__engine.chordTimer }));
  ok(afterChord.keys === 0 && afterChord.btn && afterChord.chord, "starting chord stops the melody (and its pulses)");
  await page.evaluate(() => { window.__engine.stop(); window.__stel.core.selection = 0; });
  await sleep(300);

  // ── 4 & 5. offline renders ─────────────────────────────────────────────
  const audio = await page.evaluate(async (stars) => {
    const { SonificationEngine } = await import("/src/audio/SonificationEngine.js");
    const { magToGain } = await import("/src/audio/mappings.js");
    const { strongestLine, midiToFreq } = await import("/src/melodies/melody.js");
    const { StarDataResolver } = await import("/src/data/StarDataResolver.js");
    const SR = 44100;
    const render = async (line, rv, freq, gainScale, dur = 0.6) => {
      const off = new OfflineAudioContext(1, Math.round(SR * (dur + 0.6)), SR);
      const e = new SonificationEngine(); e.ctx = off; e.ensureContext = () => off;
      e._buildVoice(line, { freq, dur, when: 0, starRV: rv, gainScale, envFit: "proportional" });
      return (await off.startRendering()).getChannelData(0);
    };
    const rms = (x) => Math.sqrt(x.reduce((a, b) => a + b * b, 0) / x.length);
    const goertzel = (x, f) => { const w = 2 * Math.PI * f / SR, c = 2 * Math.cos(w); let s1 = 0, s2 = 0;
      for (let i = 0; i < x.length; i++) { const s = x[i] + c * s1 - s2; s2 = s1; s1 = s; }
      return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / x.length; };
    const profile = (x, f) => { const h = [0.5, 1, 2, 3].map((k) => goertzel(x, f * k)); const n = Math.hypot(...h); return h.map((v) => v / n); };
    // Envelope: 10 ms RMS frames, normalized.
    const env = (x) => { const fr = 441, out = []; for (let i = 0; i + fr <= x.length; i += fr) out.push(rms(x.subarray(i, i + fr))); const mx = Math.max(...out); return out.map((v) => v / mx); };
    const dist = (a, b) => Math.hypot(...a.map((v, i) => v - (b[i] ?? 0)));
    const db = (r) => 20 * Math.log10(r);
    const f = midiToFreq(64);

    // 4a. same line + pitch, mag 0.0 vs mag 5.0
    const line0 = strongestLine(stars[0].lines);
    const loud = rms(await render(line0, 0, f, magToGain(0.0)));
    const quiet = rms(await render(line0, 0, f, magToGain(5.0)));
    // 4b. two real stars at the same pitch. Same template class, so line depth and
    // timbre match and only brightness differs: the brightest drawn star vs a
    // mag 4.5-5.5 star in view. (The sky is live, so the pair varies run to run.)
    const R = new StarDataResolver();
    const vis = window.__bridge.listVisibleStars().map((s) => ({ s, r: R.resolve(s) }));
    const brightV = window.__bridge.listVisibleStars({ drawnOnly: true, limit: 1 })[0];
    const br = R.resolve(brightV);
    const faintV = vis.find(({ s, r }) => s.magnitude >= 4.5 && s.magnitude <= 5.5 && r.type === br.type) || vis.find(({ s }) => s.magnitude >= 4.5 && s.magnitude <= 5.5);
    const faint = faintV.s, fr = faintV.r;
    const bright = { name: br.name, mag: brightV.magnitude, rv: br.rv ?? 0, lines: br.lines, type: br.type };
    const bRms = rms(await render(strongestLine(bright.lines), bright.rv, f, magToGain(bright.mag)));
    const fRms = rms(await render(strongestLine(fr.lines), fr.rv ?? 0, f, magToGain(faint.magnitude)));

    // 5. same note, stars of different classes (curated vs template, and two templates)
    const byType = {};
    for (const s of stars) if (!byType[s.type]) byType[s.type] = s;
    const types = Object.values(byType);
    const sig = async (s) => { const x = await render(strongestLine(s.lines), s.rv ?? 0, f, 1); return { p: profile(x, f), e: env(x), r: rms(x) }; };
    const sigs = [];
    for (const s of types) sigs.push({ name: s.name, type: s.type, src: s.src, ...(await sig(s)) });
    const pairs = [];
    for (let i = 0; i < sigs.length; i++) for (let j = i + 1; j < sigs.length; j++) {
      pairs.push({ a: `${sigs[i].name} (${sigs[i].type})`, b: `${sigs[j].name} (${sigs[j].type})`,
        harmonicDist: +dist(sigs[i].p, sigs[j].p).toFixed(3), envDist: +dist(sigs[i].e, sigs[j].e).toFixed(3),
        levelDb: +db(sigs[i].r / sigs[j].r).toFixed(1) });
    }
    // Same-template control: two different stars that share a template should be identical apart from level.
    return { sameLineDb: db(loud / quiet), magDbExpected: db(magToGain(0) / magToGain(5)),
      realPair: { bright: `${bright.name} m${bright.mag.toFixed(1)} (${bright.type})`, faint: `${fr.name} m${faint.magnitude.toFixed(1)} (${fr.type})`,
        db: db(bRms / fRms), expected: db(magToGain(bright.mag) / magToGain(faint.magnitude)), sameClass: fr.type === bright.type }, pairs };
  }, (await page.evaluate(() => window.__melody.assignment.stars.map((s) => ({ name: s.name, type: s.type, src: s.dataSource, mag: s.magnitude, rv: s.rv, lines: s.lines })))));
  ok(Math.abs(audio.sameLineDb - audio.magDbExpected) < 0.2 && audio.sameLineDb > 10,
    `same line + pitch: mag 0.0 is ${audio.sameLineDb.toFixed(1)} dB louder than mag 5.0 (mapping says ${audio.magDbExpected.toFixed(1)})`);
  ok(audio.realPair.sameClass ? Math.abs(audio.realPair.db - audio.realPair.expected) < 0.5 && audio.realPair.db > 6 : audio.realPair.db > 3,
    `real stars, same pitch${audio.realPair.sameClass ? ", same class" : ""}: ${audio.realPair.bright} is ${audio.realPair.db.toFixed(1)} dB louder than ${audio.realPair.faint} (brightness alone predicts ${audio.realPair.expected.toFixed(1)})`);
  console.log("      timbre, same note (E4), different-class stars:");
  for (const p of audio.pairs) console.log(`        ${p.a} vs ${p.b}: harmonic-profile dist ${p.harmonicDist}, envelope dist ${p.envDist}, level ${p.levelDb} dB`);
  ok(audio.pairs.length > 0 && audio.pairs.every((p) => p.harmonicDist > 0.05 || p.envDist > 0.5),
    "every different-class pair differs measurably in harmonic profile or envelope");

  // ── 7 + fallback: sweep views × presets ────────────────────────────────
  const views = [[50, 0, 0], [50, 1.2, 0], [50, 2.4, 0], [50, 3.6, 0], [50, 4.8, 0], [30, 0.6, 0.3],
    [20, 1.8, 0.2], [90, 3, 0.4], [10, 5.5, 0.5], [60, 0, -0.4], [5, 1.0, 0.3], [2, 2.0, 0.2], [1, 4.0, 0.1]];
  const report = { 0: [], 1: [], 2: [] };
  const fallbackRows = [];
  await setHonest(true);
  for (const [fov, yaw, pitch] of views) {
    await setView(fov, yaw, pitch); await sleep(1500);
    for (const pi of [0, 1, 2]) {
      await setPreset(pi); await sleep(50);
      await click("Play melody"); await sleep(150);
      const s = await melodySummary();
      await click("Stop melody");
      if (!s) continue;
      if (s.preset !== ["Twinkle Twinkle Little Star", "Ode to Joy", "Greensleeves"][pi]) { ok(false, `preset ${pi} did not start @${fov}°`); continue; }
      if (s.fallback || s.available < s.needed) fallbackRows.push(`${s.preset} @${fov}°: ${s.available}/${s.needed} (on screen ${s.visible})`);
      if (s.drift) report[pi].push({ fov, ...s.drift });
    }
  }
  await setHonest(false);
  const pnames = ["Twinkle", "Ode to Joy", "Greensleeves"];
  console.log("      honest-mode drift (|sounding − melody|, semitones), per preset over " + views.length + " views:");
  for (const pi of [0, 1, 2]) {
    const rows = report[pi];
    const mean = rows.reduce((a, r) => a + r.meanAbs, 0) / rows.length;
    const max = Math.max(...rows.map((r) => r.maxAbs));
    const w50 = rows.reduce((a, r) => a + r.within50c, 0) / rows.length;
    const used = rows.reduce((a, r) => a + r.starsUsed, 0) / rows.length;
    console.log(`        ${pnames[pi].padEnd(13)} mean ${mean.toFixed(2)}  worst-view mean ${Math.max(...rows.map((r) => r.meanAbs)).toFixed(2)}  max ${max.toFixed(2)}  within ±50c ${(w50 * 100).toFixed(0)}%  stars used ${used.toFixed(1)}`);
  }
  const playable = views.length - new Set(fallbackRows.filter((r) => r.includes(" 0/")).map((r) => r.split("@")[1])).size;
  ok(Object.values(report).every((r) => r.length >= playable), `honest mode played every preset in every view with stars (${playable}/${views.length})`);
  console.log(`      fallback fired ${fallbackRows.length}/${views.length * 3} runs${fallbackRows.length ? ":" : ""}`);
  for (const r of fallbackRows) console.log("        " + r);


  // ── Jesu preset + the import path (groundwork for MIDI upload) ──────────
  await setView(50, 1.2, 0); await sleep(2000);
  await setHonest(false);
  await setPreset(3); await sleep(100);
  await click("Play melody"); await sleep(400);
  const js = await melodySummary();
  const jd = await assignedDrawn(page);
  ok(js.preset === "Jesu, Joy of Man's Desiring" && js.available === 10 && jd.drawn === 10,
    `Jesu plays across ${js.available}/10 stars, ${jd.drawn} drawn; first note ${js.durs[0].toFixed(3)} s (eighth at 84 bpm)`);
  await click("Stop melody"); await sleep(200);
  const added = await page.evaluate(() => {
    const r = window.__addMelody({ name: "Imported bass line", bpm: 90, notes: [
      { midi: 28, beats: 1 }, { midi: 31, beats: 1 }, { midi: 35, beats: 1 }, { midi: null, beats: 0.5 }, { midi: 40, beats: 2 }] });
    return { ok: r.ok, shift: r.report.transposedBy };
  });
  await sleep(300);
  const ui = await page.evaluate(() => {
    const sel = document.querySelector('select[aria-label="Melody preset"]');
    const group = [...sel.querySelectorAll("optgroup")].map((g) => g.label);
    return { value: sel.value, selected: sel.options[sel.selectedIndex]?.textContent, group,
      status: [...document.querySelectorAll("div")].map((d) => d.textContent).find((t) => /^Added "Imported bass line"/.test(t)) || "" };
  });
  ok(added.ok && added.shift === 24 && ui.selected === "Imported bass line" && ui.group.join() === "Built-in,Chords (preview),Imported" && /moved up 2 octaves/.test(ui.status),
    `import hook: melody normalized (up 2 octaves), listed under "Imported" and selected; status "${ui.status}"`);
  await click("Play melody"); await sleep(400);
  const im = await melodySummary();
  ok(im.preset === "Imported bass line" && im.needed === 4 && im.available === 4 && im.pitchToStar.map(([p]) => p).sort((a, b) => a - b).join() === "52,55,59,64",
    "imported melody plays: 4 pitches (E3 G3 B3 E4 after the shift) on 4 stars");
  await click("Stop melody"); await sleep(200);

  // ── MIDI upload through the real file picker ───────────────────────────
  {
    const Q = 480;
    const piano = [[0, ...trackName("Piano")]];
    for (const [a, b, c] of [[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 72]]) {
      piano.push([0, ...on(0, a)], [0, ...on(0, b)], [0, ...on(0, c)], [Q, ...off(0, a)], [0, ...off(0, b)], [0, ...off(0, c)]);
    }
    const flute = [[0, ...trackName("Flute")]];
    for (const p of [79, 81, 83]) flute.push([0, ...on(1, p)], [Q, ...off(1, p)]);
    const drums = [[0, ...trackName("Drums")]];
    for (let i = 0; i < 16; i++) drums.push([0, ...on(9, 36)], [Q / 4, ...off(9, 36)]);
    const file = Buffer.from(smf({ format: 1, ppq: Q, tracks: [[[0, ...tempo(96)]], piano, flute, drums] }));
    await page.setInputFiles('input[aria-label="MIDI file"]', { name: "Test Song.mid", mimeType: "audio/midi", buffer: file });
    await sleep(500);
    const after = await page.evaluate(() => {
      const sel = document.querySelector('select[aria-label="Melody preset"]');
      const voice = document.querySelector('select[aria-label="MIDI voice"]');
      return { selected: sel.options[sel.selectedIndex]?.textContent,
        voices: voice ? [...voice.options].map((o) => o.textContent) : null, voice: voice?.value,
        status: [...document.querySelectorAll("div")].map((d) => d.textContent).find((t) => /^Added "Test Song"/.test(t)) || "" };
    });
    ok(after.selected === "Test Song" && after.voices?.join("|") === "Piano · 12 notes|Flute · 3 notes|All tracks (top note)" && /voice: Piano/.test(after.status),
      `MIDI upload: "${after.selected}" added and selected, voice picker ${JSON.stringify(after.voices)}, drums excluded`);
    console.log(`      status: ${after.status}`);
    await click("Play melody"); await sleep(400);
    const pm = await melodySummary();
    ok(pm.preset === "Test Song" && pm.pitchToStar.map(([p]) => p).sort((a, b) => a - b).join() === "67,72,74", "uploaded piano voice plays its top notes (G4 C5 D5)");
    await click("Stop melody"); await sleep(200);
    await page.selectOption('select[aria-label="MIDI voice"]', "2"); await sleep(300);
    const switched = await page.evaluate(() => [...document.querySelectorAll("div")].map((d) => d.textContent).find((t) => /^Voice changed for "Test Song"/.test(t)) || "");
    await click("Play melody"); await sleep(400);
    const fm = await melodySummary();
    ok(fm.pitchToStar.map(([p]) => p).sort((a, b) => a - b).join() === "79,81,83" && /voice: Flute/.test(switched),
      "switching the voice to Flute re-extracts the melody in place (G5 A5 B5)");
    await click("Stop melody"); await sleep(200);
    // A BinHex-wrapped file (classic Mac .hqx), through the same picker.
    const hqx = Buffer.from(binhex(smf({ format: 0, ppq: Q, tracks: [[[0, ...tempo(80)], [0, ...on(0, 64)], [Q, ...off(0, 64)], [0, ...on(0, 67)], [Q, ...off(0, 67)]]] }), { name: "Old Song.mid" }));
    await page.setInputFiles('input[aria-label="MIDI file"]', { name: "Old Song.hqx", mimeType: "application/mac-binhex40", buffer: hqx });
    await sleep(400);
    const hq = await page.evaluate(() => {
      const sel = document.querySelector('select[aria-label="Melody preset"]');
      return { selected: sel.options[sel.selectedIndex]?.textContent,
        status: [...document.querySelectorAll("div")].map((d) => d.textContent).find((t) => /^Added "Old Song"/.test(t)) || "" };
    });
    ok(hq.selected === "Old Song" && /unwrapped from BinHex 4\.0 \(Old Song\.mid\)/.test(hq.status), `BinHex .hqx upload unwrapped and added: "${hq.status}"`);
    await page.setInputFiles('input[aria-label="MIDI file"]', { name: "notes.txt.mid", mimeType: "audio/midi", buffer: Buffer.from("not a midi file at all") });
    await sleep(400);
    const bad = await page.evaluate(() => [...document.querySelectorAll("div")].map((d) => d.textContent).find((t) => /^Couldn't import/.test(t)) || "");
    ok(/isn't a MIDI file/.test(bad), `a bad file is refused with a reason: "${bad}"`);
  }

  // ── drawn-only on a phone viewport at wide FOV (12-pitch Greensleeves) ──
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  phone.on("pageerror", (e) => errors.push("phone: " + e.message));
  await phone.goto(url, { waitUntil: "load", timeout: 30000 });
  await phone.waitForFunction(() => !!window.__stel && !!window.__bridge, null, { timeout: 60000 });
  await sleep(9000);
  await phone.selectOption('select[aria-label="Melody preset"]', "2");
  const phoneRows = [];
  for (const [fov, yaw, pitch] of [[120, 1, 0.2], [90, 3.6, 0.3], [90, 0, 0], [60, 3.6, 0.3], [60, 1.2, 0], [30, 2.4, 0.2]]) {
    await phone.evaluate(([f, y, p]) => { const s = window.__stel; s.core.fov = f * Math.PI / 180; s.core.observer.yaw = y; s.core.observer.pitch = p; }, [fov, yaw, pitch]);
    await sleep(2000);
    await phone.evaluate(() => document.querySelector('button[aria-label="Play melody"]')?.click());
    await sleep(300);
    const info = await phone.evaluate(() => ({ needed: window.__melody.assignment.needed, available: window.__melody.assignment.available, fallback: window.__melody.assignment.fallback, faintest: Math.max(...window.__melody.assignment.stars.map((s) => s.magnitude)) }));
    const d = await assignedDrawn(phone);
    await phone.evaluate(() => document.querySelector('button[aria-label="Stop melody"]')?.click());
    phoneRows.push({ fov, ...info, ...d });
  }
  for (const r of phoneRows) console.log(`      phone ${r.fov}°: ${r.available}/${r.needed} stars assigned, ${r.drawn}/${r.n} drawn, faintest m${r.faintest.toFixed(2)}${r.fallback ? " (fallback)" : ""}`);
  ok(phoneRows.every((r) => r.drawn === r.n), "phone, wide FOV: every assigned star is drawn by the engine");
  await phone.close();

  ok(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  exitCode = fails ? 1 : 0;
} catch (e) {
  console.error("verify-melody-live crashed:", e);
} finally {
  await browser.close();
  console.log(exitCode ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(exitCode);
}
