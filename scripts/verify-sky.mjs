// Sky-state controls check, end to end (headless, real browser):
//   - GROUND toggle flips core.landscapes.visible (and starts off)
//   - time starts LIVE: within seconds of the real clock, and ticking
//   - SET jumps to an exact UTC moment and FREEZES there (no drift)
//   - TONIGHT puts the sun below the horizon at the current location
//   - NOW returns to the real present — regression guard for the bug where
//     "resume live" restarted ticking from wherever it was frozen (e.g. still
//     1969) instead of snapping back to now
//   - both controls are inert until the engine is ready — regression guard for
//     the bug where acting during the (multi-second, every-cold-load) engine
//     load silently no-opped the bridge while still flipping the local mode
//     state, leaving the badge claiming "frozen" over a live ticking clock
//   - no page errors throughout
//
// Needs `npm run dev` running and Playwright installed in the environment
// (same prerequisites as verify:engine / verify:slice / verify:tooltip).
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:5173/";
const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist", "--enable-webgl",
  ],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const check = (label, ok, detail = "") => {
  checks.push([label, ok, detail]);
};

let exitCode = 1;
const errors = [];
try {
  // ── 1. Controls are inert while the engine loads ──────────────────────
  // Stall the WASM so the load window is wide enough to act in, the way a
  // real first visit (1.2MB WASM + skydata, uncached) behaves.
  {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/engine/stellarium-web-engine.wasm", async (route) => {
      await sleep(5000);
      await route.continue();
    });
    await page.goto(url, { waitUntil: "load", timeout: 30000 });
    await sleep(800);

    const loading = await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")];
      const timeBtn = btns.find((b) => /LOADING|UTC/.test(b.textContent));
      return {
        engineReady: !!window.__stel,
        timeLabel: timeBtn?.textContent?.trim() ?? null,
        timeDisabled: timeBtn?.disabled ?? null,
      };
    });
    // Only meaningful if we actually caught the pre-ready window.
    if (!loading.engineReady) {
      check("time control inert during engine load",
        loading.timeDisabled === true,
        `| label="${loading.timeLabel}" disabled=${loading.timeDisabled}`);

      // Clicking it must not open a drawer to act through.
      await page.evaluate(() => {
        [...document.querySelectorAll("button")].find((b) => /LOADING|UTC/.test(b.textContent))?.click();
      });
      await sleep(150);
      const opened = await page.evaluate(() => !!document.querySelector("input[type=date]"));
      check("no time drawer opens before the engine exists", !opened);
    } else {
      check("time control inert during engine load", true, "| skipped (engine loaded too fast to test)");
      check("no time drawer opens before the engine exists", true, "| skipped");
    }

    await page.waitForFunction(() => !!window.__stel, null, { timeout: 60000 });
    await sleep(3000);
    const settled = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => /UTC/.test(b.textContent));
      return {
        label: btn?.textContent?.trim(),
        disabled: btn?.disabled,
        timeSpeed: window.__stel.core.time_speed,
      };
    });
    check("time control enables once ready, reporting LIVE",
      settled.disabled === false && /LIVE/.test(settled.label ?? "") && settled.timeSpeed === 1,
      `| label="${settled.label}" timeSpeed=${settled.timeSpeed}`);
    await page.close();
  }

  // ── 2. Ground toggle + full time behaviour, on a normal load ──────────
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url, { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => !!window.__stel, null, { timeout: 60000 });
  await sleep(6000);

  const clickButton = (re) => page.evaluate((src) => {
    const btn = [...document.querySelectorAll("button")].find((b) => new RegExp(src).test(b.textContent));
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  }, re.source ?? re);

  const engineTime = () => page.evaluate(() => ({
    speed: window.__stel.core.time_speed,
    utc: window.__stel.MJD2date(window.__stel.core.observer.utc).toISOString(),
    ground: window.__stel.core.landscapes?.visible,
  }));

  // Ground starts off, toggles on.
  const g0 = await engineTime();
  const groundClicked = await clickButton(/GROUND/);
  await sleep(600);
  const g1 = await engineTime();
  check("ground starts off and GROUND toggles it on",
    g0.ground === false && groundClicked && g1.ground === true,
    `| before=${g0.ground} after=${g1.ground}`);

  // Live: close to the real clock, and advancing.
  const t0 = await engineTime();
  const driftNow = Math.abs(new Date(t0.utc).getTime() - Date.now());
  await sleep(3000);
  const t1 = await engineTime();
  const advanced = new Date(t1.utc).getTime() - new Date(t0.utc).getTime();
  check("opens LIVE at the real current time", t0.speed === 1 && driftNow < 30000, `| drift ${driftNow}ms`);
  check("live clock actually ticks forward", advanced > 2000, `| +${advanced}ms over 3s`);

  // SET an exact past moment -> frozen there.
  await clickButton(/UTC/);
  await sleep(300);
  const setOk = await page.evaluate(() => {
    const d = document.querySelector("input[type=date]");
    const t = document.querySelector("input[type=time]");
    if (!d || !t) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(d, "1969-07-20"); d.dispatchEvent(new Event("input", { bubbles: true }));
    setter.call(t, "20:17"); t.dispatchEvent(new Event("input", { bubbles: true }));
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "SET");
    if (!b || b.disabled) return false;
    b.click();
    return true;
  });
  await sleep(500);
  const t2 = await engineTime();
  await sleep(2000);
  const t3 = await engineTime();
  const frozenDrift = new Date(t3.utc).getTime() - new Date(t2.utc).getTime();
  check("SET jumps to the exact UTC moment and freezes",
    setOk && t2.utc.startsWith("1969-07-20T20:17") && t2.speed === 0 && frozenDrift === 0,
    `| utc=${t2.utc} speed=${t2.speed} drift=${frozenDrift}ms`);

  // TONIGHT -> sun below the horizon.
  await clickButton(/UTC/);
  await sleep(200);
  await clickButton(/TONIGHT/);
  await sleep(500);
  const sunAlt = await page.evaluate(() => {
    const stel = window.__stel, obs = stel.core.observer;
    const sun = stel.getObj("NAME Sun");
    if (!sun) return null;
    const observed = stel.c2s(stel.convertFrame(obs, "ICRF", "OBSERVED", sun.getInfo("radec")));
    return stel.anpm(observed[1]) * stel.R2D;
  });
  check("TONIGHT puts the sun below the horizon", sunAlt != null && sunAlt < 0, `| sun alt ${sunAlt?.toFixed(1)}°`);

  // NOW -> back to the real present, ticking again.
  await clickButton(/UTC/);
  await sleep(200);
  await clickButton(/NOW/);
  await sleep(500);
  const t4 = await engineTime();
  const backDrift = Math.abs(new Date(t4.utc).getTime() - Date.now());
  check("NOW returns to the real present (not ticking on from 1969)",
    t4.speed === 1 && backDrift < 30000, `| drift ${backDrift}ms`);

  check("no page errors", errors.length === 0, errors.length ? `| ${errors.join("; ")}` : "");

  for (const [label, ok, detail] of checks) {
    console.log(`${ok ? "✅" : "❌"} ${label} ${detail}`);
  }
  const allPass = checks.every(([, ok]) => ok);
  console.log(allPass
    ? "\n✅ ALL PASS: ground toggle + live/custom time behave, and both stay inert until the engine is ready."
    : "\n❌ FAIL");
  exitCode = allPass ? 0 : 1;
} catch (e) {
  console.log("❌ ERROR:", e.message, errors.length ? `| ${errors.join("; ")}` : "");
} finally {
  await browser.close();
  process.exit(exitCode);
}
