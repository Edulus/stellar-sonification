import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Stellarium Web Engine ships as a JS glue file + a .wasm binary.
// We serve those statically from public/engine/ so the browser fetches
// them directly (Vite copies public/ verbatim into the build).
//
// The engine glue does its own fetch() of the .wasm; Vite's dev server
// already serves .wasm with the correct application/wasm MIME type.
// GitHub Pages serves a project site (one not named <user>.github.io) from
// https://<user>.github.io/<repo>/ — a subpath, not the domain root — so every
// asset reference must be prefixed with that subpath. Vite does this itself
// for anything it processes (JS imports, index.html's /src/main.jsx), but the
// engine's own runtime paths in src/engine/config.js are plain strings it
// reads at request time, so they read `base` back via import.meta.env.BASE_URL.
//
// `npm run dev` and the verify:* scripts are all hardcoded to
// http://localhost:5173/ (no subpath) — forcing the subpath there would 404
// the whole app locally. `build` and `preview` (serves the built dist/, so it
// should mirror what Pages will actually do) both get it.
export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview ? (process.env.VITE_BASE || "/stellar-sonification/") : "/",
  plugins: [react()],
  server: {
    // Some Emscripten builds want cross-origin isolation for threads /
    // SharedArrayBuffer. The default single-threaded build does not, but
    // enabling these headers is harmless and future-proofs a threaded build.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  // Don't let Vite try to pre-bundle or transform the engine glue.
  optimizeDeps: {
    exclude: ["stellarium-web-engine"],
  },
}));
