import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Stellarium Web Engine ships as a JS glue file + a .wasm binary.
// We serve those statically from public/engine/ so the browser fetches
// them directly (Vite copies public/ verbatim into the build).
//
// The engine glue does its own fetch() of the .wasm; Vite's dev server
// already serves .wasm with the correct application/wasm MIME type.
export default defineConfig({
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
});
