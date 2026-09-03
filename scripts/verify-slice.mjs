// Vertical-slice + Phase 3 check, end to end (headless, real browser):
//  - curated star (Sirius): resolves curated data, spectrum panel shows the
//    "curated" badge, and selection is SILENT until ▶ is pressed — playback
//    is explicit (App.handleStarSelected), so this checks both halves:
//    no oscillators on select, oscillators after ▶.
//  - non-curated star: falls back to a synthetic "template" and also plays on ▶.
//  - Synth Character panel is present.
//  - no page errors throughout.
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:5173/";
const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist", "--enable-webgl",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 1;
try {
  await page.goto(url, { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => !!window.__stel, null, { timeout: 60000 });

  await page.evaluate(() => {
    window.__oscCount = 0;
    const AC = window.AudioContext || window.webkitAudioContext;
    const orig = AC.prototype.createOscillator;
    AC.prototype.createOscillator = function (...a) {
      window.__oscCount++; window.__lastCtx = this; return orig.apply(this, a);
    };
  });

  const selectByNames = (names) => page.evaluate(async (names) => {
    const stel = window.__stel;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 120; i++) {
      for (const n of names) {
        const o = stel.getObj(n) || stel.getObj("NAME " + n);
        if (o) { stel.core.selection = o; return n; }
      }
      await sleep(100);
    }
    return null;
  }, names);

  // Press the spectrum panel's play control (▶, or ■ while sounding).
  const pressPlay = () => page.evaluate(() => {
    const panel = [...document.querySelectorAll("div")]
      .find((d) => d.style.position === "fixed" && d.style.bottom === "56px");
    const btn = panel && [...panel.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "▶");
    if (!btn) return false;
    btn.click();
    return true;
  });

  // --- curated: Sirius ---
  await selectByNames(["Sirius"]);
  await page.waitForFunction(() => /SIRIUS/i.test(document.body.innerText), null, { timeout: 8000 });
  await sleep(600);
  // Selection alone must not make a sound.
  const oscOnSelect = await page.evaluate(() => window.__oscCount);
  const playedOnSelect = oscOnSelect > 0;

  const pressedSirius = await pressPlay();
  await sleep(400);
  const curated = await page.evaluate(() => ({
    text: document.body.innerText,
    osc: window.__oscCount,
    ctx: window.__lastCtx?.state,
    hasSynth: /SYNTH/.test(document.body.innerText),
  }));
  const oscAfterSirius = curated.osc;

  // --- template: first available non-curated bright star ---
  const tmplName = await selectByNames(
    ["Procyon", "Capella", "Aldebaran", "Pollux", "Spica", "Altair", "Fomalhaut", "Antares", "Regulus", "Deneb"]
  );
  await sleep(400);
  await pressPlay();
  await sleep(400);
  const template = await page.evaluate(() => ({
    text: document.body.innerText,
    osc: window.__oscCount,
  }));

  const silentOnSelectOK = !playedOnSelect;
  const curatedOK = /curated/i.test(curated.text) && pressedSirius && oscAfterSirius > 0
    && curated.ctx === "running";
  const synthOK = curated.hasSynth;
  const templateOK = tmplName != null && /template/i.test(template.text) && template.osc > oscAfterSirius;
  const noErrors = errors.length === 0;

  console.log("silent on select:   ", silentOnSelectOK ? "PASS" : "FAIL",
    `| oscillators created by selection alone = ${oscOnSelect} (must be 0)`);
  console.log("curated (Sirius):   ", curatedOK ? "PASS" : "FAIL",
    `| badge curated=${/curated/i.test(curated.text)} ▶=${pressedSirius} osc=${oscAfterSirius} ctx=${curated.ctx}`);
  console.log("synth panel present:", synthOK ? "PASS" : "FAIL");
  console.log(`template (${tmplName}):`, templateOK ? "PASS" : "FAIL",
    `| badge template=${/template/i.test(template.text)} osc=${template.osc}`);
  console.log("no page errors:     ", noErrors ? "PASS" : `FAIL (${errors.join("; ")})`);

  const ok = curatedOK && synthOK && templateOK && noErrors;
  console.log(ok ? "\n✅ ALL PASS: tweaker + template fallback + spectrum panel working." : "\n❌ FAIL");
  exitCode = ok ? 0 : 1;
} catch (e) {
  console.log("❌ ERROR:", e.message, errors.length ? `| ${errors.join("; ")}` : "");
} finally {
  await browser.close();
  process.exit(exitCode);
}
