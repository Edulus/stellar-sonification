# Build & Setup

How to build the Stellarium Web Engine from source and run the app. This
supersedes the optimistic `make js` instructions in the older docs — those do
**not** work as-is on Windows. The full investigation behind every step here is
in [`../PHASE0-FINDINGS.md`](../PHASE0-FINDINGS.md) §6.

> TL;DR: the engine must be compiled to WASM with a **pinned, old** Emscripten
> (1.39.17) using a **custom build script** (`build-direct.sh`), because SCons
> is unusable on a Windows path with spaces. The app itself is a normal Vite
> project once the engine artifacts exist.

---

## Prerequisites

| Tool | Version used | Notes |
|---|---|---|
| Node.js | 18+ (24 used) | for the Vite app |
| Python | 3.x | for emsdk + the build script |
| Emscripten SDK | **1.39.17** (pinned) | newer versions break the engine — see below |
| SCons | not required | we bypass it (see below) |
| git, bash | — | bash drives the build (MSYS/Git-Bash on Windows) |

### Why Emscripten 1.39.17 (not "latest")

The engine pins its toolchain in
`stellarium-web-engine/apps/web-frontend/Dockerfile.jsbuild`:
`FROM emscripten/emsdk:1.39.17`. Modern Emscripten (3.x/4.x) **removes** runtime
methods the engine's JS glue depends on (`EXTRA_EXPORTED_RUNTIME_METHODS`,
`writeAsciiToMemory`, `allocate`, `ALLOC_NORMAL`). Building with `latest`
compiles all objects but fails at link. Use 1.39.17.

---

## One-time: install the toolchain

```bash
# From the project root.
git clone https://github.com/Stellarium/stellarium-web-engine.git   # if not present
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
python emsdk.py install 1.39.17
python emsdk.py activate 1.39.17
cd ..
```

`emsdk` (~2 GB) and `stellarium-web-engine/` are git-ignored; they are build
inputs, not part of the repo.

---

## Build the engine

A ready-made script, `stellarium-web-engine/build-direct.sh`, compiles all 144
sources and links the module. **Do not use `make js` / SCons** — see "Why not
SCons" below.

```bash
# From the project root, in bash. Adjust the drive path if your checkout differs.
EMSDK="/w/Coding Projects/Stellar Sonification/emsdk"
export EM_CONFIG="$EMSDK/.emscripten"
export PYTHON="$EMSDK/python/3.13.3_64bit/python.exe"   # 1.39.17's emcc launcher needs this
export PATH="$EMSDK/python/3.13.3_64bit:$EMSDK/upstream/emscripten:$EMSDK/upstream/bin:$EMSDK/node/22.16.0_64bit/bin:$PATH"

cd "stellarium-web-engine"
rm -rf build/obj            # always clean if you switched emcc versions
bash build-direct.sh
```

Output:
```
build/stellarium-web-engine.js     (~104 KB)
build/stellarium-web-engine.wasm   (~1.2 MB)
```

### Copy artifacts + data into the app

```bash
# From the project root.
cp stellarium-web-engine/build/stellarium-web-engine.js  public/engine/
cp stellarium-web-engine/build/stellarium-web-engine.wasm public/engine/
cp -r stellarium-web-engine/apps/test-skydata/*           public/skydata/
cp stellarium-web-engine/apps/simple-html/static/fonts/Roboto-*.ttf public/engine/fonts/
```

The app loads these from `public/` (see `src/engine/config.js`).

---

## Run the app

```bash
npm install
npm run dev        # http://localhost:5173
```

Click a star → the normalized selection object is logged to the browser console
(`[star selected] {...}`).

---

## Verify

```bash
npm run verify:engine     # Playwright: live engine renders + Sirius selection (needs dev server running)
npm run verify:extract    # unit: bridge yields hip/HD/spectralType/magnitude from a populated star
```

The first needs Playwright's Chromium (`npx playwright install chromium`) and a
running `npm run dev`.

---

## Why not SCons (the gotchas)

All documented with errors in [`../PHASE0-FINDINGS.md`](../PHASE0-FINDINGS.md) §6.
Short version, in case you try `make js` anyway:

1. **`make-assets.py` exec** — `SConstruct` does `call('./tools/make-assets.py')`,
   which Windows can't run (`WinError 193`). Patched to
   `call([sys.executable, …])`, but it's unnecessary: the asset `.inl` files are
   already committed in `src/assets/`.
2. **MSVC flag templates** — SCons on Windows defaults to the MSVC toolset and
   emits `/Fo /c /nologo /I…`, which `emcc` doesn't understand. The emscripten
   site-tool only swaps `CC=emcc`, not the command templates.
3. **Spaces in the path** — SCons routes commands through `cmd.exe`, which breaks
   on `W:\Coding Projects\…` (`'W:\Coding' is not recognized…`).

`build-direct.sh` sidesteps all three by driving `emcc` directly from bash with
gcc-style flags and proper quoting.

---

## Known data limitation

The bundled `apps/test-skydata/` catalog (vmag ≤ 7) carries **no HIP/HD/Gaia ids
and no spectral types** — only common/Bayer names. Selecting Sirius live returns
correct name + magnitude but `hip: null, spectralType: null`. Resolving stars by
HIP (Phase 1) needs a richer catalog from the
[`stellarium_star_catalogs`](https://github.com/Stellarium/stellarium_star_catalogs)
pipeline. Details: [`../PHASE0-FINDINGS.md`](../PHASE0-FINDINGS.md) §9.
