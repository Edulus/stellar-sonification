// Engine configuration: where the WASM binary, fonts, and skydata live.
//
// All paths are absolute (served from public/). Stellarium Web Engine's
// Emscripten glue and its addDataSource() resolve URLs relative to the
// document, so absolute paths avoid surprises. See PHASE0-FINDINGS.md §5.

export const ENGINE_CONFIG = {
  // Built engine artifacts (output of `make js`, copied into public/engine/).
  wasmFile: "/engine/stellarium-web-engine.wasm",
  jsFile: "/engine/stellarium-web-engine.js",

  // Runtime data, copied from the engine repo's apps/test-skydata/.
  skydataBase: "/skydata/",

  fonts: {
    regular: { url: "/engine/fonts/Roboto-Regular.ttf", scale: 1.38 },
    bold: { url: "/engine/fonts/Roboto-Bold.ttf", scale: 1.38 },
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

  // Always-night sky enforcement. Applied in StellariumBridge.init() right after
  // the data sources register. Disabling the atmosphere is the real guarantee of
  // a dark sky (no Rayleigh scattering at any sun altitude); landscape off frees
  // the full sphere; lockToNight additionally parks the clock at the observer's
  // solar midnight so the sun disc itself sits below the horizon.
  nightSky: {
    atmosphere: false,
    landscape: false,
    lockToNight: true,
  },

  // Default observer. Overridable at runtime via StellariumBridge.setLocation().
  // Signed decimal degrees (N/E positive); elevation in metres.
  defaultLocation: { name: "Montréal", lat: 45.50, lng: -73.57, elevation: 50 },
};
