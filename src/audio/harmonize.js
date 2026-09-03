// Re-export of the proven, browser-free harmonizer that lives at the repo root
// (co-located with the prototype, and covered by `npm run verify:slice`). The
// app imports it through this tree-local path; keeping a single source of truth
// avoids the two copies drifting. See ../../harmonize.js for the implementation.
export { harmonizeChord, describeChord, centsBetween, CHORD_TIMING } from "../../harmonize.js";
