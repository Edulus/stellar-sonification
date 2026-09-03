// Phase 0 acceptance check.
//
// Loads the running dev server in a real (headless) browser with WebGL,
// waits for the Stellarium Web Engine to come up, selects Sirius (HIP 32349)
// the same way a click would (it sets core.selection, which fires the engine's
// `selection` change that our bridge turns into a `starSelected` event), and
// verifies the normalized payload our bridge emits.
//
// Usage: node scripts/verify-phase0.mjs [url]
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:5173/";

const browser = await chromium.launch({
  headless: true,
  args: [
    // Make WebGL2 work in headless via SwiftShader.
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--enable-webgl",
  ],
});

const page = await browser.newPage();
page.on("console", (m) => console.log(`  [page:${m.type()}]`, m.text()));
page.on("pageerror", (e) => console.log("  [page:error]", e.message));

let exitCode = 1;
try {
  console.log(`> navigating to ${url}`);
  await page.goto(url, { waitUntil: "load", timeout: 30000 });

  console.log("> waiting for engine (window.__stel) ...");
  await page.waitForFunction(() => !!window.__stel, null, { timeout: 60000 });
  console.log("> engine ready.");

  const result = await page.evaluate(async () => {
    const stel = window.__stel;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // The star catalog tiles stream in via the engine's render loop; the
    // brightest stars (Sirius among them) appear quickly. Poll for the object.
    const ids = ["HIP 32349", "NAME Sirius", "Sirius"];
    let obj = null;
    let usedId = null;
    for (let i = 0; i < 150 && !obj; i++) {
      for (const id of ids) {
        obj = stel.getObj(id);
        if (obj) { usedId = id; break; }
      }
      if (!obj) await sleep(100);
    }
    if (!obj) return { error: "getObj never resolved Sirius (tiles not loaded?)" };

    const got = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ error: "no starSelected event fired" }), 5000);
      window.__bridge.on("starSelected", (s) => { clearTimeout(timeout); resolve(s); });
      stel.core.selection = obj; // <- equivalent to a user click on the star
    });

    if (got && got._obj) delete got._obj; // strip non-serializable engine handle
    return { usedId, star: got };
  });

  console.log("\n> selection result:");
  console.log(JSON.stringify(result, null, 2));

  const star = result.star;
  // Engine-integration criteria: a real selection on the live WASM engine
  // produced a normalized payload with the correct identity + magnitude.
  // (hip/spectralType depend on the loaded catalog tier — the bundled
  // test-skydata omits them; see PHASE0-FINDINGS.md §6/§9. The bridge's
  // HIP/spectral extraction is proven separately by verify-extract.mjs.)
  const ok =
    star &&
    !star.error &&
    typeof star.name === "string" &&
    star.name.toLowerCase().includes("sirius") &&
    typeof star.magnitude === "number" &&
    Math.abs(star.magnitude - -1.46) < 0.1;

  if (ok) {
    console.log("\n✅ ENGINE INTEGRATION PASS: live selection of Sirius yields", JSON.stringify({
      hip: star.hip, name: star.name, spectralType: star.spectralType, magnitude: star.magnitude,
    }));
    console.log("   (hip/spectralType are null because the bundled test-skydata catalog");
    console.log("    omits them — a data-tier gap documented in PHASE0-FINDINGS.md, not a code gap.");
    console.log("    Run `node scripts/verify-extract.mjs` for the proof the bridge yields hip/A1V.)");
    exitCode = 0;
  } else {
    console.log("\n❌ FAIL: live selection did not return the expected Sirius identity/magnitude.");
  }
} catch (e) {
  console.log("\n❌ ERROR:", e.message);
} finally {
  await browser.close();
  process.exit(exitCode);
}
