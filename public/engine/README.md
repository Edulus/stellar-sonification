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

These are the output of `make js` in the stellarium-web-engine repo (see
`PHASE0-FINDINGS.md` §6). They are NOT committed — build them locally.

The runtime star catalog + sky data goes in `public/skydata/` (copy the engine
repo's `apps/test-skydata/` contents there). `stars/` is the only subtree
required for a clickable sky.
