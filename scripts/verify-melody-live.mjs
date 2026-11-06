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
//
// Needs `npm run dev` running + Playwright (same as verify:slice).
import { chromium } from "playwright";

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
    window.__engine.on("melodyNote", (e) => window.__notes.push({ key: e.starKey, color: e.color, dur: e.durationSec, t: performance.now() }));
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
  ok(notes.every((n) => n.color === colorOf[n.key]), "every pulse uses its star's display colour");
  ok(notes.every((n, i) => Math.abs(n.dur - m.durs[i]) < 1e-9) && Math.abs(notes[0].dur - 0.6) < 1e-9 && Math.abs(notes[6].dur - 1.2) < 1e-9,
    "pulse life = note length (0.6 s quarter, 1.2 s half at 100 bpm)");
  const gaps = notes.slice(1, 6).map((n, i) => n.t - notes[i].t);
  ok(gaps.every((g) => Math.abs(g - 600) < 60), `pulses in time with notes (onset gaps ${gaps.map((g) => g.toFixed(0)).join(", ")} ms)`);
  const osc = await page.evaluate(() => window.__oscCount);
  ok(osc > 0, `audio sounding (${osc} oscillators)`);
  const bands = await page.evaluate(() => window.__ringOverlay.bands().filter((b) => b.key.startsWith("melody:")));
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
    // 4b. two real stars at the same pitch: the brightest assigned vs a mag ~5 star in view
    const R = new StarDataResolver();
    const vis = window.__bridge.listVisibleStars();
    const faint = vis.find((s) => s.magnitude >= 4.8 && s.magnitude <= 5.5);
    const fr = R.resolve(faint);
    const bright = stars.slice().sort((a, b) => a.mag - b.mag)[0];
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
      realPair: { bright: `${bright.name} m${bright.mag.toFixed(1)}`, faint: `${fr.name} m${faint.magnitude.toFixed(1)}`, db: db(bRms / fRms) }, pairs };
  }, (await page.evaluate(() => window.__melody.assignment.stars.map((s) => ({ name: s.name, type: s.type, src: s.dataSource, mag: s.magnitude, rv: s.rv, lines: s.lines })))));
  ok(Math.abs(audio.sameLineDb - audio.magDbExpected) < 0.2 && audio.sameLineDb > 10,
    `same line + pitch: mag 0.0 is ${audio.sameLineDb.toFixed(1)} dB louder than mag 5.0 (mapping says ${audio.magDbExpected.toFixed(1)})`);
  ok(audio.realPair.db > 6, `real stars, same pitch: ${audio.realPair.bright} is ${audio.realPair.db.toFixed(1)} dB louder than ${audio.realPair.faint}`);
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

  ok(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  exitCode = fails ? 1 : 0;
} catch (e) {
  console.error("verify-melody-live crashed:", e);
} finally {
  await browser.close();
  console.log(exitCode ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(exitCode);
}
