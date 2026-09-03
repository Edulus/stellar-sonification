// Hover-tooltip check, end to end (headless, real browser):
//  - hovering a star shows the readout card with a name and stats
//  - it works for NON-star objects too (galaxy / cluster / planet), with a
//    human-readable type label from stel.otypeToStr
//  - a card near the right edge flips to stay fully on screen
//  - leaving to empty sky hides it
//  - no page errors throughout
//
// Needs `npm run dev` running and Playwright installed in the environment
// (same prerequisites as verify:engine / verify:slice).
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:5173/";
const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist", "--enable-webgl",
  ],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 1;
try {
  await page.goto(url, { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => !!window.__stel, null, { timeout: 60000 });
  await sleep(8000); // let catalog tiles stream in

  // Read the tooltip card, identified by its own inline style (it is the only
  // fixed element with this minWidth). Returns null when no card is mounted.
  const readCard = () => page.evaluate(() => {
    const el = [...document.querySelectorAll("div")]
      .find((d) => d.style.position === "fixed" && d.style.minWidth === "148px");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { text: el.innerText, left: r.left, right: r.right, top: r.top, bottom: r.bottom,
             vw: window.innerWidth, vh: window.innerHeight };
  });

  // One pickable screen position per object type, found with the engine's own picker.
  const targets = await page.evaluate(() => {
    const stel = window.__stel;
    const seen = new Set(), out = [];
    for (let y = 15; y < window.innerHeight; y += 12) {
      for (let x = 15; x < window.innerWidth; x += 12) {
        let p = 0;
        try { p = stel.ccall("core_get_obj_at", "number", ["number","number","number"], [x, y, 10]); } catch { /* */ }
        if (!p) continue;
        const o = new stel.SweObj(p);
        let t = "?";
        try { t = (o.jsonData?.types || ["?"])[0]; } catch { /* */ }
        if (!seen.has(t)) { seen.add(t); out.push({ x, y, type: t }); }
        try { stel._obj_release(p); } catch { /* */ }
      }
    }
    return out;
  });

  const hover = async (t) => {
    await page.mouse.move(t.x - 5, t.y - 5); // force a pick change
    await page.mouse.move(t.x, t.y);
    await sleep(400);
    return readCard();
  };

  const star = targets.find((t) => t.type === "*");
  const other = targets.find((t) => t.type !== "*");
  const starCard = star ? await hover(star) : null;
  const otherCard = other ? await hover(other) : null;

  // Rightmost target: the card must flip to the cursor's left rather than clip.
  const rightmost = [...targets].sort((a, b) => b.x - a.x)[0];
  const edgeCard = rightmost ? await hover(rightmost) : null;

  // Empty sky (top-left corner is reliably starless at any view).
  await page.mouse.move(3, 3);
  await sleep(400);
  const afterLeave = await readCard();

  const starOK = !!starCard && /\w/.test(starCard.text.split("\n")[0])
    && /\bSTAR\b/i.test(starCard.text) && /MAG/.test(starCard.text) && /ALT/.test(starCard.text);
  // A non-star must still get a named type (not the raw otype code).
  const otherOK = !!otherCard && otherCard.text.split("\n").length > 2
    && /(GALAXY|CLUSTER|NEBULA|PLANET|MOON|STAR)/i.test(otherCard.text);
  const edgeOK = !!edgeCard && edgeCard.left >= 0 && edgeCard.right <= edgeCard.vw
    && edgeCard.top >= 0 && edgeCard.bottom <= edgeCard.vh;
  const hideOK = afterLeave === null;
  const noErrors = errors.length === 0;

  const first = (c) => (c ? c.text.split("\n").slice(0, 3).join(" | ") : "no card");
  console.log("star tooltip:       ", starOK ? "PASS" : "FAIL", `| ${first(starCard)}`);
  console.log(`non-star (${other?.type ?? "none"}):`.padEnd(21), otherOK ? "PASS" : "FAIL", `| ${first(otherCard)}`);
  console.log("stays on screen:    ", edgeOK ? "PASS" : "FAIL",
    edgeCard ? `| card ${Math.round(edgeCard.left)}..${Math.round(edgeCard.right)} of ${edgeCard.vw}px` : "| no card");
  console.log("hides on empty sky: ", hideOK ? "PASS" : "FAIL");
  console.log("no page errors:     ", noErrors ? "PASS" : `FAIL (${errors.join("; ")})`);

  const ok = starOK && otherOK && edgeOK && hideOK && noErrors;
  console.log(ok ? "\n✅ ALL PASS: hover tooltip identifies any object and stays on screen."
                 : "\n❌ FAIL");
  exitCode = ok ? 0 : 1;
} catch (e) {
  console.log("❌ ERROR:", e.message, errors.length ? `| ${errors.join("; ")}` : "");
} finally {
  await browser.close();
  process.exit(exitCode);
}
