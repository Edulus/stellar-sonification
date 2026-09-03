# public/engine/

Drop the **built** Stellarium Web Engine artifacts here:

```
public/engine/
├── stellarium-web-engine.js     # Emscripten glue (defines global StelWebEngine)
├── stellarium-web-engine.wasm   # the compiled engine
└── fonts/
    ├── Roboto-Regular.ttf
    └── Roboto-Bold.ttf
```

These are the output of `build-direct.sh` in the stellarium-web-engine repo
(see `docs/BUILD.md`; not `make js`/SCons — see CLAUDE.md for why). They
**are committed** in this repo (see `NOTICE.md` — this is a modified,
AGPL-3.0 build) so the app builds and deploys without the ~2 GB Emscripten
toolchain. Rebuild locally only if you need to change the engine itself.

The runtime star catalog + sky data goes in `public/skydata/` (copy the engine
repo's `apps/test-skydata/` contents there). `stars/` is the only subtree
required for a clickable sky.
