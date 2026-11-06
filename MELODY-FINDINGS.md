# Melody Mode — Gate 1 findings: visible star enumeration

Status: **Gate 1 complete; Gate 2 not started** (awaiting review, per the brief).
Measured 2026-11-05 in headless Chromium (SwiftShader) against `npm run dev`, with the
engine artifacts present in `public/engine/` and `public/skydata/stars/` (Norder0–1, vmag ≤ ~7).
No engine or feature code was changed.

## Verdict

**Enumeration works with no engine changes.** All four fields the brief asks for can be
obtained from JS. Screen position is the one field that needs care: the engine exports no
forward projection, but a ~6-line JS stereographic projection built on the exported
`convertFrame(obs, "ICRF", "VIEW", v)` matches the engine's own picker pixel-for-pixel
(details in §3). **Using it is a workaround for the missing export, so it needs sign-off
before Gate 2.** The alternative is an engine change (export `project_to_win`), which the
brief rules out without direction.

Two design-level problems turned up in the brief's assignment rule (§5). They are surfaced
here, not fixed.

## 1. What the engine provides, and how

| Field | Source | Coverage on screen |
|---|---|---|
| ID | `obj.designations()` → `extractStarData().hip` / `.name` | name **or** HIP, never both (PHASE0 §11-A). **Brightest stars: 0 of 6 have a HIP in 9 of 10 views** |
| visual magnitude | `obj.getInfo("vmag")` | 100% |
| spectral type | `obj.jsonData.model_data.spect_t` | **0%** (bundled catalog has none) |
| temperature proxy | `model_data.BVMag` → resolver tier 3 → `tpl.temp` | B–V on 100%; temperature is the template's (quantized, see §5) |
| screen position | JS projection of `getInfo("radec")` (§3) | exact for 413/420 tested stars |

Access path (the established §11-B recipe; `listObjs()` itself is broken):

```js
const ptrs = [];
const cb = stel.addFunction((u, o) => { ptrs.push(o); return 0; }, "iii");
stel._module_list_objs2(core.stars.v, core.observer.v, maxMag, 0, cb);
const snapshot = ptrs.slice();               // before any `new SweObj`
```

Pointers from this list are the **same** pointers the picker returns for those stars
(checked 140/140 + 174/174 + 89/89), so a star's identity is stable between the two paths.

Every enumerated star is resolvable: `StarDataResolver.resolve()` falls through to the
default template, so "visible stars the resolver can return data for" = all visible stars.

## 2. Limits

- **Not view-limited.** `_module_list_objs2` returns every star in the loaded tiles, about
  5,190–5,300 at every FOV and yaw tested (≈ half are behind the camera). The "in view"
  filter is ours: VIEW-frame `z < 0` and the projected point inside the canvas.
- **Magnitude cutoff** comes from the catalog (vmag ≤ ~7), not from `maxMag`; `maxMag 8`
  and `7` return the same set.
- **No count cap** observed.
- **On-screen counts (1400×900):** 10° → ~36–41, 20° → ~100–170, 50° → ~650–1,400,
  90° → ~1,900–3,300. Even at 10° there are far more than the 6–~10 stars a preset needs.
  So the "fewer than N" fallback should only trigger at very narrow FOV; Gate 2 will
  measure where.
- **Ground/horizon.** With GROUND off (the default) below-horizon stars are on screen and
  will be enumerated. With GROUND on they are hidden but would still pass the filter.
  Proposal: also require altitude > 0 when the landscape is visible.

## 3. Screen position: JS forward projection

```js
const v = stel.convertFrame(obs, "ICRF", "VIEW", obj.getInfo("radec"));
if (v[2] >= 0) /* behind the camera */;
const n = Math.hypot(v[0], v[1], v[2]), h = 0.5 * (n - v[2]);
const k = (Math.min(W, H) / 2) / (2 * Math.tan(core.fov / 4));   // fov spans the SHORT side
const x = W / 2 + k * v[0] / h, y = H / 2 - k * v[1] / h;          // CSS px, canvas-relative
```

To validate, I called `core_get_obj_at(x, y, 3)` at each projected point for the 30
brightest on-screen stars:

| viewport | views (FOV) | exact hits |
|---|---|---|
| 1400×900 | 50, 20, 90, 50 (panned), 10 | 147/150 |
| 700×1000 | 50, 20, 90 | 90/90 |
| 390×844 | 50, 20, 90 | 87/90 |
| 900×900 | 50, 20, 90 | 89/90 |

Every miss was either a neighbouring object the picker preferred, or a faint star that the
picker would not return from any nearby pixel. None of them were projection errors. My first
attempt, which spanned the long side instead, failed 0/150. That is how the short-side rule
was established.

Assumptions: stereographic projection (`core.proj`'s default) and no view flip flags. If
either changes, this breaks; the engine export would not. Because it is cheap (one
`convertFrame` per star), pulses could **re-project every frame and track the star while
panning**, which the static-position ring overlay cannot do.

## 4. Cost

A one-shot harvest at playback start is 25–110 ms: enumerate (≤ 6 ms), `extractStarData`,
project, filter, and resolve every on-screen star. That costs one dropped frame at most.
Projecting first and calling `extractStarData` only on on-screen stars will reduce it. It is
too expensive to repeat per frame, but per-frame re-projection of only the N assigned stars
is trivial.

## 5. Problems with the assignment rule (surfaced, not fixed)

Measured on the 6 / 10 brightest on-screen stars across 10 views:

| view | distinct temps among 6 | 6 brightest |
|---|---|---|
| Gemini/UMa, 50° | **2** | Pollux K5V, Castor A0V, Alioth A0V, Dubhe K5V, Alkaid A0V, Algieba K5V |
| Orion/Auriga, 50° | 6 | Capella, Rigel, Betelgeuse, Aldebaran, Pollux, Castor |
| Eridanus, 50° | 3 | |
| Sco/Sgr, 50° | 3 | |
| Boo/Oph, 50° | 4 | |
| Auriga, 30° | 3 | |
| Cetus, 20° | 4 | |
| 90° | 2 | |
| Draco, 10° | 3 | |
| Leo/CMi, 60° | 3 | |

**D1. Temperature ties are the norm, and the HIP tie-break is unavailable.** Template stars
take `tpl.temp`, and `templateForBV` maps every B–V onto a handful of classes (A0V 9600 K,
K5V 4400 K, M2V 3550 K, B5V, F5V, G2V seen). Typically only 2–4 of the 6 brightest stars
have distinct temperatures. The brief breaks ties by HIP, but bright stars are exactly the ones
with no HIP (§1). So "coolest star on the lowest note" is ambiguous within each tie group.
Suggested fix (needs your call): sort by `temp`, then by **B–V descending** (redder =
cooler; B–V is present on 100% and is continuous), then HIP, then name. This only adds a sort
key and changes no mapping or data.

**D2. Stars sharing a template sound identical apart from pitch and volume.** Same template
means the same line list, so the same strongest line, width, profile, EW and EP, and RV = 0
for templates. In the Gemini/UMa view, Castor, Alioth and Alkaid would have identical timbre.
That puts **acceptance criterion 5** ("the same note on two different stars sounds clearly
different") at risk for any pair of same-class template stars. The same applies to honest
mode, where same-template stars offer identical candidate pitches. Real fixes are out of scope
(B–V-interpolated templates in the resolver or pipeline, or a richer catalog). Options within
scope: accept it and test criterion 5 on a curated star against a template star, or choose
views where the brightest stars differ in class. **Drift item.**

## 6. What Gate 2 would add (proposal, not started)

- `StellariumBridge.listVisibleStars({ maxCount })`: the §1 recipe, the §3 projection and
  the §2 filter, returning `{ starData, x, y, ptr }` sorted by magnitude.
  `StellariumBridge.projectToScreen(icrf)` for per-frame pulse tracking.
- The rest as the brief specifies: `src/melodies/presets.js`, `magToGain` in `mappings.js`,
  a `duration` param on `playLine`, pulse via the existing overlay, honest mode, and controls.

## Decisions needed before Gate 2

1. Approve the JS forward projection (§3), or direct an engine export instead.
2. Tie-break order for D1: `temp` → B–V desc → HIP → name?
3. D2: accept, and define how criterion 5 is tested?
4. Below-horizon stars when GROUND is on: exclude (alt > 0)?
