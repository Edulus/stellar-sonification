// Unit proof for StellariumBridge.extractStarData().
//
// The live engine test proves the integration (WASM renders, selection events
// fire, the bridge reads the selected star). But the bundled test-skydata
// catalog omits HIP numbers and spectral types, so the live payload can't show
// them. This test feeds extractStarData a mock SweObj shaped exactly like a
// real catalog star that DOES carry those fields (verified against
// src/modules/stars.c: designations() + getInfo('vmag') + jsonData.model_data),
// and confirms the bridge yields the full Phase 0 acceptance payload.

import { StellariumBridge } from "../src/engine/StellariumBridge.js";

// Mock of a fully-populated Sirius, as the production catalog would provide it.
const mockSirius = {
  designations: () => ["HIP 32349", "HD 48915", "* alf CMa", "NAME Sirius", "GAIA 2947050466531873024"],
  getInfo: (k) => ({ vmag: -1.46, distance: 544000 }[k]),
  jsonData: { model_data: { spect_t: "A1V", BVMag: 0.0, plx: 379.21 } },
};

const bridge = new StellariumBridge(null); // canvas unused by extractStarData
const star = bridge.extractStarData(mockSirius);
delete star._obj;

console.log("extractStarData(mockSirius) =>");
console.log(JSON.stringify(star, null, 2));

const checks = [
  ["hip === 32349", star.hip === 32349],
  ["hd === 48915", star.hd === 48915],
  ['name === "Sirius"', star.name === "Sirius"],
  ['spectralType === "A1V"', star.spectralType === "A1V"],
  ["magnitude === -1.46", star.magnitude === -1.46],
  ['gaia parsed', star.gaia === "2947050466531873024"],
];

let allPass = true;
console.log("\nassertions:");
for (const [label, ok] of checks) {
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok) allPass = false;
}

console.log(allPass
  ? "\n✅ UNIT PASS: bridge produces the exact Phase 0 acceptance payload given a HIP/spectral-bearing catalog."
  : "\n❌ UNIT FAIL");
process.exit(allPass ? 0 : 1);
