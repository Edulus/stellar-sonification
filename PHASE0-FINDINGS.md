# Phase 0 Findings — Stellarium Web Engine JS API

This documents the **actual** JavaScript API surface of Stellarium Web Engine
(SWE), reverse-engineered from the engine source at commit cloned on
2026-06-07. Everything below is verified against source, not guessed. Where the
`ARCHITECTURE.md` assumptions differed from reality, the corrections are called
out explicitly.

Source files inspected:
- `src/js/pre.js` — top-level `StelWebEngine` factory, helper functions, event hooks
- `src/js/obj.js` — the `SweObj` wrapper class (every sky object), `getInfo`, `designations`, `jsonData`, `change`, `getObj`
- `src/js/canvas.js` — pointer/touch event plumbing into the engine
- `src/modules/stars.c` — what a star actually exposes (`star_get_info`, `star_get_json_data`, `star_get_designations`)
- `apps/simple-html/stellarium-web-engine.html` — minimal embedding example (our template)
- `apps/web-frontend/src/` — the production Vue app (authoritative usage reference)

---

## 1. Engine bootstrap

The built `stellarium-web-engine.js` exports a single global factory,
`StelWebEngine`, that loads the `.wasm` and calls back when ready:

```js
StelWebEngine({
  wasmFile: '/engine/stellarium-web-engine.wasm', // URL to the wasm binary
  canvas:   canvasElement,                         // the <canvas> to render into
  translateFn: (domain, str) => str,               // optional i18n hook
  onReady: (stel) => { /* engine is live here */ },
});
```

`onReady(stel)` hands back the engine handle. **`stel` and the global `Module`
are the same object** — `stel.core`, `stel.getObj`, `stel.change`, `stel.on`,
`stel.convertFrame`, etc. all live on it.

### Star catalog data is NOT baked into the WASM

`ARCHITECTURE.md` assumed star data is "baked into the WASM binary." **This is
wrong.** The WASM is just the engine. Catalog/render data is fetched at runtime
from data sources you register in `onReady`:

```js
const core = stel.core;
core.stars.addDataSource({ url: BASE + 'stars' });
core.skycultures.addDataSource({ url: BASE + 'skycultures/western', key: 'western' });
core.dsos.addDataSource({ url: BASE + 'dso' });
core.landscapes.addDataSource({ url: BASE + 'landscapes/guereins', key: 'guereins' });
core.milkyway.addDataSource({ url: BASE + 'surveys/milkyway' });
// planets, comets, minor_planets, satellites ... (optional for Phase 0)
```

The reference data set ships in the repo at **`apps/test-skydata/`** (stars are
a HiPS-style tile pyramid: `stars/Norder0..N/DirN/...` plus `stars/properties`).
For our app, the **stars** source is the only hard requirement to get a clickable
sky; the rest (DSOs, landscape, milkyway, planets) are visual polish.

We must serve this skydata ourselves. Plan: copy `apps/test-skydata/` →
`public/skydata/` and point `addDataSource` at `/skydata/...`. The font files
(`Roboto-Regular.ttf`, `Roboto-Bold.ttf`) are also needed via `stel.setFont(...)`.

---

## 2. Selection: attribute **and** event-based (both)

`ARCHITECTURE.md`/`ROADMAP.md` framed this as an open question ("attribute-based
polling vs event-based"). The answer: **both mechanisms exist, and the
event/callback path is the right one.** No polling loop is needed.

### Reading the current selection (attribute)
```js
const sel = stel.core.selection; // a SweObj, or a falsy value (0/null) when nothing selected
```

### Setting / clearing selection (attribute)
```js
stel.core.selection = obj;  // select
stel.core.selection = 0;    // clear (note: 0, the web-frontend uses 0)
stel.pointAndLock(obj, 0.5); // optional: slew the view to it and lock
```

### Listening for changes (event — preferred)
`stel.change(callback)` registers a **global** listener invoked on every
attribute change anywhere in the engine. The callback gets `(obj, attr)`:

```js
stel.change((obj, attr) => {
  if (attr === 'selection') {
    const sel = stel.core.selection; // read the new value
    // ... handle selected / deselected
  }
});
```

Mechanism (from `obj.js`): C calls a global listener registered via
`_module_add_global_listener`; JS fans it out to every listener pushed by
`stel.change(...)`. `attr === 'hovered'` fires very frequently on mouse-move —
**filter it out** (the simple-html example explicitly ignores `"hovered"`).

There is also a per-object form `obj.change(attr, cb)` and convenience wrappers
`stel.onValueChanged(path, value)`. For selection we only need the global form.

> Bottom line for the bridge: **register `stel.change`, filter to
> `attr === 'selection'`, read `stel.core.selection`.** No `requestAnimationFrame`
> polling loop (the `_pollSelection` sketch in `ARCHITECTURE.md` is unnecessary).

### Click events (secondary)
`stel.on('click', ({point:{x,y}}) => boolean)` exists for raw canvas clicks
(return value controls default handling). We do **not** need this for selection —
the engine already turns a click on a star into a `selection` change. Useful
later for "click empty sky → deselect" semantics.

---

## 3. The SweObj API (what a selected star gives us)

Every sky object is a `SweObj`. The relevant members:

| Member | Returns | Notes |
|---|---|---|
| `obj.designations()` | `string[]` | catalog IDs/names, de-duped. e.g. `["* alf CMa", "HIP 32349", "HD 48915", "HR 2491", "NAME Sirius", "GAIA <id>", ...]` |
| `obj.getInfo('vmag')` | `number` | visual magnitude |
| `obj.getInfo('distance')` | `number` | distance (AU; engine units) |
| `obj.getInfo('radec')` | `[x,y,z]` | **ICRF cartesian unit vector**, NOT `[ra,dec]` — convert with `stel.c2s` |
| `obj.getInfo('pvo')` | pos/vel | observed position/velocity |
| `obj.jsonData` | `object` | `{ model_data: { spect_t, plx, BVMag } }` for stars |
| `obj.culturalDesignations()` | `object[]` | sky-culture names |
| `obj.id` | `string` | object id, falls back to `designations()[0]` |

### Spectral type lives in `jsonData`, NOT `getInfo`
This is the single most important correction to `ARCHITECTURE.md`, which
guessed `obj.spect_t` / `obj.getInfo('spect_t')`. **Neither exists.**

From `stars.c::star_get_json_data`, a star's JSON is:
```json
{ "model_data": { "plx": <mas>, "BVMag": <B-V>, "spect_t": "A1V" } }
```
So:
```js
const spectralType = obj.jsonData?.model_data?.spect_t; // "A1V" or undefined
const bv           = obj.jsonData?.model_data?.BVMag;
const parallaxMas  = obj.jsonData?.model_data?.plx;
```
(`spect_t` is only present if the catalog tile carried a spectral type for that
star. Bright stars have it; faint Gaia-only stars may not — matches the
ROADMAP's expectation. Our template fallback covers the gaps.)

### `getInfo` only supports a fixed set for stars
From `stars.c::star_get_info`, a **star** answers only: `INFO_PVO`, `INFO_VMAG`,
`INFO_DISTANCE`. Other info keys (e.g. `radec`) are computed by the base object
machinery from `pvo`. There is **no** `spect_t` / `hip` / `hd` info key — those
come from `designations()` and `jsonData`.

### Identifiers: parse from `designations()`
There is no `obj.hip` / `obj.hd`. HIP/HD/Gaia must be parsed out of the
`designations()` string array. Gaia is appended by `star_get_designations` as
`"GAIA <number>"`. HIP/HD/HR/Bayer names come from the catalog `names` blob.

```js
function pick(designations, prefix) {
  const m = designations.find(d => d.startsWith(prefix + ' '));
  return m ? m.slice(prefix.length + 1) : null;
}
const hip = pick(designations, 'HIP');   // "32349"
const hd  = pick(designations, 'HD');    // "48915"
const gaia = pick(designations, 'GAIA');
```
A human name, if any, appears as `"NAME Sirius"` (strip the `NAME ` prefix) or as
a Bayer/Flamsteed designation. The web-frontend's `getTitle` does
`designations()[0].replace(/^NAME /, '')`.

---

## 4. Coordinate helpers (for later phases)

The engine exposes math helpers on `stel` we'll want when we display RA/Dec or
do anything spatial:
- `stel.c2s([x,y,z])` → `[lng, lat]` (cartesian → spherical)
- `stel.convertFrame(observer, 'ICRF', 'CIRS'|'OBSERVED'|'JNOW', vec)` → frame conversion
- `stel.anp(a)` / `stel.anpm(a)` → normalize angle to `[0,2π)` / `[-π,π)`
- `stel.a2tf(a, n)` / `stel.a2af(a, n)` → format angle as h:m:s / d:m:s
- `stel.core.observer` — has `.longitude`, `.latitude`, `.tt`, `.pitch`, `.yaw`, etc. (settable)

`obj.getInfo('radec')` returns an ICRF **unit vector**; to get actual RA/Dec you
convert frame then `c2s` then `anp/anpm` (see `selected-object-info.vue`).

---

## 5. React/canvas integration notes

- The engine fully owns the `<canvas>` and its WebGL context + render loop. Use a
  React `ref`, init once, and keep React's reconciler away from that node
  (no children, stable element). The Vue app proves a framework wrapper is fine.
- `canvas.js` wires its own pointer/touch listeners on the canvas for pan/zoom,
  so basic navigation is free — we don't implement drag/zoom ourselves.
- Emscripten historically resolves some URLs relative to the document, not the
  module. Pass an **absolute** `wasmFile` URL and absolute `addDataSource` URLs to
  be safe (the examples build a `getBaseUrl()` for this reason).
- StrictMode double-mount: guard the init so a second invocation doesn't spin up
  a second engine on the same canvas.

---

## 6. Build status (Step 3)

`make js` runs `emscons scons mode=release`, which requires **Emscripten SDK**
and **SCons**. Neither was present in the environment:

```
$ emcc --version   → command not found
$ scons --version  → command not found
```
No prebuilt artifact is published either: `npm view @stellarium/web-engine` and
`npm view stellarium-web-engine` both return **404** (not on npm). The
`.js`/`.wasm` are build outputs only (`apps/web-frontend/src/assets/js/README`
confirms that folder "must contain stellarium-web-engine.js and ...wasm").

**Action taken:** installing the toolchain from scratch —
`pip install scons` + `emsdk install/activate latest` — then `make js`.
See the "Build log" section below for the actual outcome, errors, and any
patches required. The integration code (SkyCanvas + StellariumBridge) was
written against the verified API above so it is ready the moment the artifacts
land in `public/engine/`.

### Build log — SUCCESS ✅

Artifacts built and copied to `public/engine/`:
`stellarium-web-engine.js` (104 KB) + `stellarium-web-engine.wasm` (1.2 MB).

Getting there required pinning the toolchain and bypassing SCons. The issues, in
the order hit, and their fixes:

1. **No toolchain present.** Installed via `emsdk`: `pip install scons`, then
   `git clone emsdk && python emsdk.py install latest && activate latest`.

2. **Wrong Emscripten version.** Building with `latest` (4.x) compiled all 144
   objects but **failed at link**:
   `EXTRA_EXPORTED_RUNTIME_METHODS ... No longer supported, use EXPORTED_RUNTIME_METHODS`.
   The engine's JS glue also relies on runtime methods removed in modern
   Emscripten (`writeAsciiToMemory`, `allocate`, `ALLOC_NORMAL`). The project
   pins its toolchain in `apps/web-frontend/Dockerfile.jsbuild`:
   **`FROM emscripten/emsdk:1.39.17`**. Fix: `emsdk install 1.39.17 && activate
   1.39.17`, then **clean `build/obj`** (objects from the newer LLVM won't link
   with 1.39.17) and rebuild.

3. **SConstruct can't exec a `.py` on Windows.**
   `call('./tools/make-assets.py')` →
   `[WinError 193] %1 is not a valid Win32 application`.
   Patched to `call([sys.executable, './tools/make-assets.py'])`.
   (Also: `make-assets.py`'s `os.path.dirname(__file__) != "./tools"` guard fails
   under Python ≥3.9 because `__file__` is absolute — but it doesn't matter, the
   asset `.inl` files are already committed in `src/assets/`, so make-assets is
   not needed at all.)

4. **SCons is unusable for this build on native Windows.** Even with the patch,
   SCons defaults to the **MSVC** toolset, so it emits MSVC-style command lines
   (`/Fo`, `/c`, `/nologo`, `/I…`) and feeds them to `emcc`, which doesn't
   understand them. It also routes the command through `cmd.exe`, which then
   chokes on the **spaces** in this project's path
   (`'W:\Coding' is not recognized as an internal or external command`). The
   emscripten SCons site-tool only swaps `CC=emcc`; it never resets the gcc-style
   command templates.
   **Fix: bypass SCons entirely** with `stellarium-web-engine/build-direct.sh`,
   which drives `emcc` from bash (correct quoting → spaces are fine; gcc-style
   flags) using the exact source list + flags mirrored from `SConstruct`.
   `-Werror` was dropped (the pinned clang still emits harmless K&R-prototype
   warnings from bundled zlib that would otherwise be fatal).

5. **1.39.17's `emcc` launcher couldn't find Python.** The extensionless `emcc`
   is a `/bin/sh` wrapper that does `PYTHON=$(which python3)` and otherwise falls
   back to `python` → the Windows Store alias stub ("Python was not found").
   Fix: `export PYTHON=<emsdk>/python/<ver>/python.exe` before building.

**Reproducible build** (from repo root, in bash):
```bash
EMSDK="/w/Coding Projects/Stellar Sonification/emsdk"
export EM_CONFIG="$EMSDK/.emscripten"
export PYTHON="$EMSDK/python/3.13.3_64bit/python.exe"
export PATH="$EMSDK/python/3.13.3_64bit:$EMSDK/upstream/emscripten:$EMSDK/upstream/bin:$EMSDK/node/22.16.0_64bit/bin:$PATH"
cd stellarium-web-engine && rm -rf build/obj && bash build-direct.sh
cp build/stellarium-web-engine.{js,wasm} ../public/engine/
```

---

## 9. CRITICAL DATA FINDING — bundled catalog lacks HIP & spectral type

> **Partly superseded — see §11-A.** The "no HIP" half of this is too strong: HIP ids *are* present in
> the bundled catalog, just never on the same star as a name. Everything below about Sirius, and the whole
> spectral-type finding, still stands.

This is the most important discovery for downstream phases. The engine runs and
selection works end-to-end (verified — see §10), **but the catalog shipped in
the repo (`apps/test-skydata/`) is a minimal sample** (`stars/properties`:
`max_vmag = 7.0`) whose star records carry only common/Bayer/Flamsteed names —
**no HIP, no HD, no Gaia id, no `spect_t`.**

Live selection of Sirius from the bundled catalog returns:
```json
{ "name": "Sirius", "magnitude": -1.4375, "bv": 0.009,
  "designations": ["Sirius", "* alf CMa", "* 9 CMa"],
  "hip": null, "hd": null, "gaia": null, "spectralType": null }
```
Name, magnitude, B–V, distance, and ICRF position are all correct. Only the
cross-IDs and spectral type are missing — **because the data doesn't contain
them**, not because of any bug. The bridge reads them correctly when present
(proven by `scripts/verify-extract.mjs`, which feeds a HIP/spectral-bearing mock
and gets back exactly `hip: 32349, hd: 48915, spectralType: "A1V",
magnitude: -1.46`).

The public Stellarium Web catalog (`…cloudfront.net/skydata/stars`,
`…digitaloceanspaces.com/...`) is **no longer fetchable** at the old paths
(SPA fallback / `AccessDenied`), so it can't simply be pointed at.

**Implication for Phase 1 / Phase 4:** to key our `StarDataResolver` on HIP we
need a catalog that carries HIP + spectral type. Options:
- Build the full catalog with the `Stellarium/stellarium_star_catalogs` pipeline
  (Hipparcos + Gaia DR3 + SIMBAD cross-match) — this is exactly the pipeline the
  ARCHITECTURE/ROADMAP already references.
- Or maintain our own minimal HIP→data map and match selected stars by
  name/position when the engine catalog lacks HIP.

Either way: **Phase 0's job — proving the engine integration and documenting the
exact selection data — is done. The HIP/spectral availability is a data-tier
task, now scoped with hard evidence.**

---

## 10. Verification (automated)

- `scripts/verify-phase0.mjs` — Playwright loads the dev server in headless
  Chromium (SwiftShader WebGL), waits for the engine, selects Sirius
  (`core.selection = getObj('Sirius')`, the programmatic equivalent of a click),
  and captures the bridge's emitted payload. **Result: ENGINE INTEGRATION PASS**
  (Sirius identity + magnitude −1.44 from the live WASM engine).
- `scripts/verify-extract.mjs` — feeds `extractStarData` a fully-populated mock
  star. **Result: UNIT PASS** — yields `hip: 32349, hd: 48915,
  spectralType: "A1V", magnitude: -1.46`, i.e. the literal acceptance payload.

Together these prove: the engine builds + renders + emits selections, and the
bridge produces the Phase 0 acceptance object whenever the catalog supplies the
fields.

---

## 7. Corrections to ARCHITECTURE.md (summary)

| ARCHITECTURE.md assumption | Reality |
|---|---|
| Selection requires polling (`requestAnimationFrame` loop) | `stel.change((obj,attr)=>…)` callback; filter `attr==='selection'` |
| `obj.spect_t` / `obj.getInfo('spect_t')` | `obj.jsonData.model_data.spect_t` |
| `obj.vmag` / `obj.v` | `obj.getInfo('vmag')` |
| `obj.designations` (array property) | `obj.designations()` (method) |
| `obj.ra` / `obj.dec` | `obj.getInfo('radec')` → ICRF vector → `convertFrame`+`c2s` |
| Star data baked into WASM | Fetched at runtime via `core.stars.addDataSource({url})` |
| `obj.hip` / `obj.hd` properties | parse from `designations()` strings |

---

## 8. Shape of the object the bridge emits

Given the above, the bridge normalizes a selected star to:
```js
{
  hip: 32349,            // number | null  (parsed from designations)
  hd: 48915,             // number | null
  gaia: "<id>",          // string | null
  name: "Sirius",        // best human-readable name
  designations: [...],   // raw array, for debugging / fallback lookups
  spectralType: "A1V",   // jsonData.model_data.spect_t | null
  magnitude: -1.46,      // getInfo('vmag')
  bv: 0.00,              // jsonData.model_data.BVMag | null
  distanceAU: ...,       // getInfo('distance')
  radecICRF: [x,y,z],    // getInfo('radec') raw vector
}
```
This satisfies the Phase 0 acceptance log and gives Phase 1's `StarDataResolver`
the HIP key it needs.

---

## 11. Amendment (2026-09-02) — bulk object access, and a correction to §9

Findings from wiring the hover tooltip. All numbers measured live in headless
Chromium against the running dev server, default view, 50° FOV.

### 11-A. Correction to §9 — HIP ids ARE present, on the *unnamed* stars

§9 concluded the bundled catalog carries "no HIP, no HD, no Gaia id, no
`spect_t`". Three quarters of that holds. HIP is the exception: it is there, but
the catalog gives a star **either** a name **or** a HIP, never both.

| designations seen | example |
|---|---|
| proper + Bayer + Flamsteed, no HIP | `["Capella", "* alf Aur", "* 13 Aur"]` |
| Bayer + Flamsteed, no HIP | `["* sig02 UMa", "* 13 UMa"]` |
| HIP only, no name | `["HIP 52425"]` |

Census of the 5,301 stars a live view enumerates to mag 8: **~1,500** carry a
proper/Bayer/Flamsteed designation, **~3,760** are HIP-only, **100%** carry
`BVMag`, **95%** carry `plx`, **0%** carry `spect_t`.

So the Sirius evidence in §9 is real but unrepresentative: the bright stars we
would most want to key by HIP are exactly the ones the catalog denies it to.
**Implication is unchanged** — name-matching stays the correct tier 1, and HIP
keying for bright stars still needs the richer catalog §9 describes — but the
reason is "ids are split", not "ids are absent".

### 11-B. `SweObj.listObjs()` is broken in the engine glue — returns at most 1

The engine exposes bulk enumeration as `module.listObjs(obs, maxMag, filter)`.
**It always returns 0 or 1 objects, whatever is actually in view.** The cause is
global-state reentrancy in the hand-written JS glue (`src/js/obj.js`), which
survives into `public/engine/stellarium-web-engine.js`:

```js
SweObj.prototype.listObjs = function (obs, maxMag, filter) {
  let ret = [];
  g_ret = [];                                   // collector for the C callback
  Module._module_list_objs2(this.v, obs.v, maxMag, 0, g_module_list_obj2);
  for (let i = 0; i < g_ret.length; i++) {
    let obj = new SweObj(g_ret[i]);             // ← the ctor ALSO does `g_ret = []`
    if (filter(obj)) { obj.retain(); ret.push(obj); }
  }                                             //   …so the loop ends after i = 0
  return ret;
};
```

`new SweObj(...)` resets the same `g_ret` the loop is iterating (it reuses it for
`_obj_foreach_attr`), so `g_ret.length` collapses to 0 on the first pass. This is
an upstream bug, not a build artifact of ours — do not "fix" it by patching the
generated file, which is git-ignored and regenerated by `build-direct.sh`.

**Workaround — snapshot the pointers before constructing any SweObj:**

```js
const ptrs = [];
const cb = stel.addFunction((user, obj) => { ptrs.push(obj); return 0; }, "iii");
stel._module_list_objs2(stel.core.stars.v, stel.core.observer.v, 8, 0, cb);
const snapshot = ptrs.slice();          // ← copy out before any `new SweObj`
for (const p of snapshot) {
  const o = new stel.SweObj(p);
  // … o.designations(), o.getInfo('vmag'), o.jsonData …
}
```

`Module.addFunction`, `Module.SweObj` and `Module._module_list_objs2` are all
exported by this build (verified), so no engine rebuild is needed.

**Measured cost** (mag ≤ 8, 50° FOV): 5,301 stars enumerated in **2 ms**;
reading `vmag` for 400 of them, **3 ms**; a full harvest of every star's
`designations()` + `jsonData` + `vmag`, **243 ms** for all 5,301. Cheap enough
for a one-shot index; too slow to redo per frame.

Other modules answer the same call: **353** dsos (names, `Vmag`, `dimx/dimy` in
arcmin), **64** solar-system bodies (`vmag`, distance in AU, `phase`), **88**
constellations.

### 11-C. Bulk data is reachable; bulk *placement* is not

Enumeration gives data, not screen positions. There is still **no forward
RA/Dec → screen projection exported to JS** (RING-OVERLAY-FINDINGS.md §2): the
only position source is the inverse picker `core_get_obj_at`. That is why hover
works and mass on-screen labelling does not. Two ways to unlock it:

1. Export `project_to_win` from `core.c` behind an `EMSCRIPTEN_KEEPALIVE`
   wrapper and rebuild (the same move already made for `core_get_obj_at`), or
2. Reimplement the stereographic projection in JS from `core.fov`,
   `convertFrame(obs, "ICRF", "VIEW", v)` and the window size — the math is in
   `src/projection.c` (`project_to_win`) and `src/projections/`.

Option 1 is the reliable one; option 2 must track `core->proj`
(`PROJ_STEREOGRAPHIC` by default, set in `core.c`) and the flip flags.

### 11-D. The picker is not star-only

`core_get_obj_at` returns whatever is under the cursor across all modules — a
grid probe of a default view returned types `*` (star), `Sy2` (galaxy), `GlC`,
`OpC` and `Pla`. `StellariumBridge.extractObjectInfo()` therefore reads
type-agnostically and feeds `src/ui/ObjectTooltip.jsx`; `stel.otypeToStr(t)`
turns the raw otype into a label ("Star", "Open Cluster", "Seyfert 2 Galaxy").
