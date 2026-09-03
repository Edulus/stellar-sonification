// Engine configuration: where the WASM binary, fonts, and skydata live.
//
// Paths are rooted at Vite's BASE_URL (== "/" in dev, and == vite.config.js's
// `base` in a build — e.g. "/stellar-sonification/" under GitHub Pages, which
// serves project sites from a subpath rather than the domain root). Stellarium
// Web Engine's Emscripten glue and its addDataSource() resolve whatever URL
// string they're given as-is, so we must include the base ourselves rather
// than hardcode a domain-root-absolute path. See PHASE0-FINDINGS.md §5.
// import.meta.env only exists under Vite (dev server / build); the verify:*
// scripts import this module under plain Node to unit-test the bridge, where
// it's undefined — fall back to "/" there.
const BASE = import.meta.env?.BASE_URL ?? "/";

export const ENGINE_CONFIG = {
  // Built engine artifacts (output of `make js`, copied into public/engine/).
  wasmFile: `${BASE}engine/stellarium-web-engine.wasm`,
  jsFile: `${BASE}engine/stellarium-web-engine.js`,

  // Runtime data, copied from the engine repo's apps/test-skydata/.
  skydataBase: `${BASE}skydata/`,

  fonts: {
    regular: { url: `${BASE}engine/fonts/Roboto-Regular.ttf`, scale: 1.38 },
    bold: { url: `${BASE}engine/fonts/Roboto-Bold.ttf`, scale: 1.38 },
  },

  // Which data sources to register on startup. `stars` is the only one
  // required to get a clickable sky; the rest are visual context and can be
  // toggled off if the skydata isn't present yet.
  // Each: { module: core.<module>, url: <relative to skydataBase>, key? }
  dataSources: [
    { module: "stars", url: "stars" },
    { module: "skycultures", url: "skycultures/western", key: "western" },
    { module: "dsos", url: "dso" },
    { module: "landscapes", url: "landscapes/guereins", key: "guereins" },
    { module: "milkyway", url: "surveys/milkyway" },
    { module: "planets", url: "surveys/sso/moon", key: "moon" },
    { module: "planets", url: "surveys/sso/sun", key: "sun" },
    { module: "planets", url: "surveys/sso/moon", key: "default" },
  ],

  // Always-dark sky. Applied in StellariumBridge.init() right after the data
  // sources register. Disabling the atmosphere is what keeps every star
  // clickable at any time of day (no Rayleigh scattering hiding them behind
  // a blue daytime sky); landscape off frees the full sphere by default (the
  // ground toggle can turn it back on). The clock itself is NOT pinned here —
  // StellariumBridge.init() sets it live (real time, ticking) by default;
  // TimeControl.jsx lets the user freeze it at any date/time instead.
  nightSky: {
    atmosphere: false,
    landscape: false,
  },

  // Default observer. Overridable at runtime via StellariumBridge.setLocation().
  // Signed decimal degrees (N/E positive); elevation in metres.
  defaultLocation: { name: "Montréal", lat: 45.50, lng: -73.57, elevation: 50 },
};
