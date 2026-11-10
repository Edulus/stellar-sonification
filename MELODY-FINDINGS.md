# Melody Mode — Gate 1 findings: visible star enumeration

Status: **Gate 1 reviewed (all four decisions accepted, see the end); Gate 2 implemented**
(results in §7).
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

## 6. What Gate 2 adds (proposal at Gate 1; built, see §7)

- `StellariumBridge.listVisibleStars({ maxCount })`: the §1 recipe, the §3 projection and
  the §2 filter, returning `{ starData, x, y, ptr }` sorted by magnitude.
  `StellariumBridge.projectToScreen(icrf)` for per-frame pulse tracking.
- The rest as the brief specifies: `src/melodies/presets.js`, `magToGain` in `mappings.js`,
  a `duration` param on `playLine`, pulse via the existing overlay, honest mode, and controls.

## Decisions (accepted 2026-11-06)

1. The JS forward projection (§3) is approved; no engine export.
2. D1 tie-break: `temp` → B–V desc → HIP → name.
3. D2 is accepted. Criterion 5 is tested on stars of different classes.
4. With GROUND on, below-horizon stars are excluded (alt > 0).

## 7. Gate 2 results

Built as proposed in §6. `npm run verify:melody` (browser-free, 28 checks) and
`npm run verify:melody-live` (live engine, Chromium headless) both pass. The existing
`verify:extract/seed/slice/tooltip/sky/engine` all still pass.

| # | Acceptance criterion | Result |
|---|---|---|
| 2 | Twinkle across 6 stars, coolest on the lowest note | Orion/Auriga view: Aldebaran 3550 K (C4) · Betelgeuse 3600 K · Pollux 4400 K · Capella 5778 K · Castor 9600 K · Rigel 12100 K (A4). Assign + start takes ~250 ms. |
| 3 | Each star pulses in its own colour, in sync, for the note's length | Every pulse uses its star's colour. Pulse life = note length (0.6 s / 1.2 s at 100 bpm). Onset gaps 593–602 ms against 600 expected. Pulses sit on their stars to < 1.5 px and track pans. |
| 4 | Bright star clearly louder than faint, same pitch | Offline render, same line and pitch: mag 0.0 is +12.0 dB over mag 5.0 (the mapping says 12.0). Two real stars at E4: Capella (m 0.1) is +13.0 dB over μ Aur (m 4.8). |
| 5 | Same note on two different stars sounds different | Offline render of E4 on all 6 assigned stars (6 classes). Every pair differs in harmonic profile and/or envelope: harmonic distance 0.003–0.36, envelope distance 0.6–3.4. The closest pair is Pollux (K5V) vs Capella (G2V): similar harmonics, different envelope. **Measured, not listened to** (headless). |
| 6 | Chord and sequence unchanged | The `playChord`, `playSequence` and hover code is untouched. `playLine`/`_buildVoice` defaults take the old branch. Starting a melody stops a chord; starting a chord stops the melody and clears its pulses. |
| 7 | Honest mode plays, with a drift report | Below. |
| 8 | Chromium | Headless Chromium with SwiftShader, live engine. |

**Honest-mode drift**: |sounding − melody| in semitones, over 13 views (10°–90° FOV plus
narrow ones). It varies a little run to run because the sky clock is live.

| preset | mean | worst view (mean) | max | within ±50 ¢ | stars actually used (of 6/6/12) |
|---|---|---|---|---|---|
| Twinkle | 1.3 | 1.6 | 4.7 | 31% | 2.1 |
| Ode to Joy | 1.1 | 1.5 | 2.8 | 47% | 2.0 |
| Greensleeves | 1.0 | 1.6 | 4.0 | 34% | 2.2 |

**Fallback (fewer stars than pitches)** fired in 6 of 39 runs (13 views × 3 presets), and only at
FOV ≤ 2°. At 2° about 4 stars are on screen; at 1° there are 0–1. With zero stars the
melody doesn't start, and the status line says "No stars in view". At ≥ 5° it never fired,
Greensleeves' 12 pitches included.

### Drift items (outside scope; surfaced, not fixed)

- **D3. Honest mode collapses onto ~2 stars.** All 22 templates use only **17 distinct
  wavelengths** (Hα 656.3 and Ca II K 393.4 are in all 22, Hδ 410.2 in 17, and so on). Several
  assigned stars therefore often offer *exactly* the same pitch. The brief leaves ties open;
  the code gives them to the cooler star, so in honest mode one or two stars sing most notes.
  Recommendation: break exact ties by the line's strength in each star (highest EW wins),
  which also has a physical reading. It's a one-line change in `planMelody`, pending your call.
- **D4. Honest drift is structural.** 17 wavelengths spread over a 36-semitone range means
  about one available pitch every two semitones, so a mean drift of ~1 semitone is the floor
  with template data. Richer line lists (PHOENIX run, Phase 4) would reduce it.
- **D2 (from Gate 1) stands.** Same-template stars still share timbre. Criterion 5 was
  tested on different classes, as agreed.
- `playLine` defaults `duration` to `params.toneDuration` (1.2 s unless retuned in the Synth
  panel), not a hard-coded 1.2 s. That keeps the default path identical to before.
- `magToGain` reads its three constants from `DEFAULT_PARAMS` (`magBright`, `magFaint`,
  `magFaintDb`), following the `p` convention. They are not exposed in the Synth panel.

## 8. Gate 1 re-run (2026-11-06): two corrections

I re-ran in a fresh container (same engine artifacts, headless Chromium, 1400×900 and
390×844, FOV 10°–120°). Enumeration, data coverage and the projection formula all hold.
Two findings above need correcting.

**8-A. The enumerated list grows; it is not fixed at ~5,200.** `_module_list_objs2`
returns every star in the tiles loaded *so far*. That was 5,410 at first, then 12,000–13,900
after a few pans as the Norder1 tiles streamed in. §2's "not view-limited" still holds, and
the on-screen filter is still ours. Costs are unchanged: enumeration takes 1–12 ms, and
harvesting, projecting and resolving every on-screen star takes 50–170 ms.

**8-B. "On screen" is not the same as "drawn."** The projection is exact wherever the picker
can return the star (offset 0–2 px). But at wide FOV the engine draws only bright stars, and
the picker cannot return the rest from any pixel. Their projected positions are right; the
engine just isn't drawing those stars, or draws them too dimly to be picked. The cutoff
depends on FOV and screen size. `core.display_limit_mag` reads 99 and doesn't reflect it.

| viewport | FOV | faintest pickable | brightest unpickable |
|---|---|---|---|
| 390×844 | 120° | 2.25 | 2.27 |
| 390×844 | 90° | 2.23 | 2.39 |
| 390×844 | 60° | 3.00 | 2.84 |
| 390×844 | 30° | 4.75 | 4.81 |
| 390×844 | 10° | 6.97 | none |
| 1400×900 | 90° | 3.55 | 2.75 |
| 1400×900 | 60° | 4.31 | none |

So on a phone at wide FOV, geometric enumeration includes stars the user cannot see. Taking
the N brightest usually stays above the cutoff, but not always: Greensleeves needs 12 stars,
and on a phone at 90° only stars brighter than about magnitude 2.3 are drawn.
**Decision (accepted 2026-11-06, implemented):** count a star as visible only if, in addition, the picker
returns it at its projected pixel. That costs one picker call per candidate, checked
brightest-first until N are found. The engine already has `getObjAt` and nothing changes
there. Implemented as `listVisibleStars({ drawnOnly: true, limit: N })`, which the melody's
▶ uses. `verify:melody-live` now checks that every assigned star is drawn, including a
390×844 sweep at 120°/90°/60°/30° with Greensleeves: 12/12 stars assigned and 12/12 drawn
in every view (faintest assigned m 1.8 at 120°, m 2.9 at 60°).

**Drift item (not fixed, outside scope):** `verify:tooltip`'s "hides on empty sky" step is
flaky. It failed and then passed on identical code, and it fails the same way with this
change stashed. It moves the cursor to (3, 3) and assumes that corner is always starless.

## 9. Change to brief §2.6: two-colour pulses (requested 2026-11-06)

The brief has each pulse "in the star's display color." At the user's request, a melody
pulse now carries two colours:

- **Rim = tone colour.** The note's pitch is converted back to a wavelength on the app's own
  pitch scale with `freqToWl`, a new pure function in `mappings.js` that is the exact inverse
  of `wlToFreq`, clamped to 380–760 nm. It is then coloured with the shared `wlToRGB`, the
  same function the spectrum panel and the hover bands use. Over the presets' range that
  runs from C4 at 633 nm (orange) to G5 at 433 nm (violet). In honest mode the note is a real
  line at its real pitch, so the rim is exactly that line's colour.
- **Glow = star colour**, as before. That is the template's temperature colour, or the
  curated star's colour.

Hover, sequence and chord bands are unchanged: one colour, the line's. `verify:melody` checks
that `freqToWl` inverts `wlToFreq`. `verify:melody-live` checks that every pulse's rim is
its note's tone, its glow is its star's colour, and the drawn bands match both.

## 10. Jesu preset and MIDI groundwork (2026-11-07)

**Jesu, Joy of Man's Desiring** (Bach, BWV 147) is the fourth preset. It is the triplet
theme in G major, 9/8: the first four bars, then the first three again closing on a held G.
That is 64 notes and 8 bars, about 26 s at 84 bpm, with 10 distinct pitches (D4–G5), so it
needs 10 stars. It is transcribed from memory, like the other three; worth a listen against
a recording.

**MIDI groundwork, built:**
- `normalizeMelody(raw)` in `src/melodies/normalize.js` is the single landing point for
  non-preset melodies. Its rules are in the file header. Every built-in preset passes
  through unchanged.
- The selector now lists presets and then imported melodies. `addUserMelody` in `App.jsx`
  (exposed as `window.__addMelody`) normalizes a melody, adds it, selects it and reports
  what changed.
- `verify:melody` covers the normalizer's rules. `verify:melody-live` adds a melody through
  the hook and plays it.

**Not built (the MIDI brief should decide):**
1. **Parsing a Standard MIDI File.** It is about 150 lines of dependency-free JS (header,
   tracks, variable-length deltas, note on/off, tempo meta, running status). Raw Web Audio
   is a project rule; whether a parser library is acceptable is your call.
2. **Picking one voice from a multi-track or polyphonic file.** Options: highest note
   ("skyline"), let the user pick the track, or the busiest track.
3. **Quantizing note lengths** (none, or to the nearest 16th) and handling overlapping
   notes within a voice.
4. **Tempo changes mid-file.** Use the first tempo, or bake changes into the beat lengths.
5. **Many distinct pitches.** Imported tunes can have far more pitches than there are stars
   in view (a chromatic run of 30 needs 30 stars). The cycling fallback still plays, but a
   cap or a "fold to N pitches" option may be wanted.
6. **The upload UI:** a file picker in the MELODY row, a size limit, and error messages.
7. **Persistence:** imported melodies currently last only until the page reloads.

### Drift item: criterion 5 also fails for neighbouring classes

On 2026-11-07 the live sky put **Castor (A0V template) and Sirius (A1V, curated)** in the
same Twinkle assignment. At the same note they differ by only 1.4 dB, with a harmonic
distance of 0.019 and an envelope distance of 0.39, below the thresholds
`verify:melody-live` uses for "clearly different". Both are white stars whose strongest
line is a Balmer line, so this is physics, not a bug. D2 (shared templates) extends to
neighbouring classes. Earlier runs passed only because no such pair was in view. The test
is left strict, so it can fail depending on the sky, and the limitation is reported rather
than masked.

## 11. MIDI upload (2026-11-07)

Built, using these defaults for the five open decisions in §10 (each is easy to change):

1. **Parser:** our own, dependency-free (`src/melodies/midi.js`, about 250 lines). It
   handles formats 0, 1 and 2, PPQ and SMPTE timing, running status, note-on velocity 0
   as note-off, notes never switched off (ended at the track's last event), sysex and meta
   events, and a 1 MB limit.
2. **Voice:** the busiest pitched track by default. A VOICE picker appears when a file has
   several pitched tracks, with an "All tracks (top note)" option. Channel 10 (percussion)
   is excluded. Overlaps become one line: the highest note wins at each onset, and a new
   onset ends the note before it.
3. **Timing:** not quantized. Gaps under 1/64 beat are absorbed. Tempo changes are kept:
   each note's real duration is re-expressed in exact beats of the first tempo.
4. **Pitch count:** no cap. The status line shows how many stars the tune needs, and
   assignment cycles stars if fewer are in view. Range fitting is `normalizeMelody`'s
   octave shift and fold.
5. **UI and persistence:** "+ MIDI" in the MELODY row opens a file picker. Imports are
   listed under "Imported" and last until the page reloads.

**Tested:** `verify:melody` checks the parser and voice extraction on files built byte by
byte (`scripts/lib/smf.mjs`): format 0 with running status, velocity-0 note-offs and rests;
format 1 with conductor, chordal piano, flute and drums; a mid-file tempo change; overlaps
and unterminated notes; SMPTE timing; and bad files (not MIDI, truncated, drums only, no
notes). `verify:melody-live` uploads a three-track file through the real file picker,
checks the voice picker, plays it, switches voice, and refuses a bad file. No real-world
MIDI files were tested: this session can't download them, and the site the user linked
(wendycarlos.com) is blocked by the session's network settings.

**Known limits:**
- **Pitch bend is ignored**, so a file that uses bends for microtonal or alternative
  tunings plays in 12-TET. This matters for Wendy Carlos's Alpha, Beta and Gamma scale
  pieces, if those are what the linked page offers.
- Imports don't survive a reload.

## 12. BinHex and staggered chords; free-midi-chords reviewed (2026-11-07)

**BinHex `.hqx` and other wrappers.** `src/melodies/container.js` peels old wrappers before
the MIDI parser runs:
- BinHex 4.0: 6-bit text, run-length decoding, header and data-fork CRC-16/XMODEM checks
  (the CRC matches the published "123456789" → 0x31C3 vector). It keeps the data fork,
  where a Mac MIDI file keeps its notes.
- RIFF MIDI (`.rmi`).
- A MacBinary header or other short prefix before `MThd`.

StuffIt archives (`.sit`, often found inside `.hqx` downloads) are recognised and refused,
with a message to unpack them first (The Unarchiver or StuffIt Expander). StuffIt uses
several compression schemes, which is a much larger job; I'd only take it on after seeing
real files. The status line reports what was unwrapped. Python's stdlib `binhex` module is
gone (removed in 3.11), so the decoder is checked against our own test encoder (with run and
0x90-escape cases) and the CRC test vector, not a third-party encoder.

**Staggered chords.** Real-world MIDI often staggers or strums chord notes by a few
milliseconds. Before, each slightly later note cut the previous one, producing a stutter.
Now onsets within 1/16 beat of a chord's first note count as one chord and keep its highest
note. A 16th-note melody (1/4 beat apart) is unaffected.

**ldrolez/free-midi-chords (MIT)**, reviewed at the user's request: about 13,000 generated MIDI
files, 195 chord progressions per key, mood-tagged ("nostalgic but hopeful"). The files are
built by a Python generator, not committed. Running the repo's generator here was blocked by
the session's safety policy (code from an external repository), so I read the generator source
instead (`src/chords2midi/c2m.py`). It writes one track on channel 0, with every chord note
starting at the same time (humanize defaults to 0) and an optional bass note two octaves down.
The importer therefore plays the top note of each chord as the melody, and the harmony is
dropped. These files are chords, not melodies, so they fit a feature we don't have:
**polyphonic playback across stars** (each chord tone on its own star, several stars sounding
and pulsing together; ROADMAP Phase 6 "multi-star chords"). Assignment already locks one star
per distinct pitch, so the remaining work is a polyphonic event plan (chord events instead of
single notes), simultaneous voices with 1/√N gain scaling (as `playChord` does), and an import
option to keep chords instead of the top note. A design decision for the user.

## 13. Spectrum-halo waves (requested 2026-11-10; on the branch, not merged)

The user asked for the waves stars send out to "colorfully display their spectrograph data",
with radial-spectrum concept notes and three mockups. Built for melody mode:

- **Wavelength → radius**, linear over the app's 380–760 nm band: violet at the inner edge,
  red at the outer. A dark gap separates the star from the ring. Angle carries no data.
- **Absorption lines → dark rings**, from the singing star's own line list (curated or
  template). Darkness follows line depth. Ring width follows line width, with a floor of
  about 1 px, because real lines are far below a pixel at this scale.
- **The sung note → one bright ring** at its wavelength on the same scale. In honest mode it
  lands exactly on the absorption line being sung.
- The halo eases out to 150 px (or 30% of the short screen side) and holds, so long notes
  and chords don't flood the sky. It keeps its colour for most of the note, then fades.

This replaces the earlier two-colour wave (§9: tone-coloured rim, star-coloured glow). The
star's display colour is no longer in the wave. Hover, sequence and chord bands are unchanged.

Limits: it shows the app's line list for the star (6–8 lines), not a measured spectrum. The
mockups' labels, radial ruler and inspector card are not built, and close violet lines (Ca II
H and K) merge at this size. `verify:melody` covers the mapping and the dark rings;
`verify:melody-live` checks that each wave uses its own star's lines.

### 13-A. Bright-ring style (2026-11-10)

The user found that the dark rings, which are what make each star unique, were hard to see,
so every star's wave read as the same rainbow. They asked to try the inverse. Built as a
second style with a switch (RINGS: BRIGHT / DARK in the MELODY row) so the two can be
compared on the same stars:

- **Bright (now the default):** the continuum is a faint wash (10%) and each absorption line
  glows in its own colour. Rings are wider than in the dark style (2.6–6 px half-width) and
  brighter for deeper lines. The sung note is a thin white ring, so it can't be mistaken for
  one of the star's lines.
- **Dark:** the rainbow with dark line rings, as in §13.

Side by side (Rigel B8, Sirius A1, Sol G2, Betelgeuse M1), the bright style gives four
visibly different ring patterns; the dark style gives four near-identical rainbows. Which one
stays, or whether the switch stays, is the user's call after seeing it. Strictly, bright rings
look like emission lines; here they mark where the star's light is *missing*.

### 13-B. Decision: bright rings, refined (2026-11-10)

The user compared both styles and chose the bright rings: they keep the starfield visible
and make each star's line pattern readable, where the rainbow drowned the differences. The
RINGS switch is removed. Refinements they asked for, all built:

- **Fainter haze:** the continuum between rings is 4% (was 10%), so the rings carry the colour.
- **Distinct note ring:** the white ring pulses gently (1.6 Hz) and a white marker travels
  round it (one lap per 2.6 s). It is drawn as true white over any coloured ring it overlaps.
  Under "reduce motion" the ring is steady and the marker stays put.
- **The star's own colour:** a soft glow in the star's display colour fills the gap at the
  centre, tying the pattern to the star that is sounding.
- **Scientific labelling:** while a melody plays, a caption reads "Coloured rings:
  highlighted absorption lines (not emission) · White ring: the sung note", with a fuller
  tooltip. The glow is a display choice; the rings mark where light is absorbed. The white
  ring is a musical interpretation layered on the spectrum.

The result has three layers: the star at the centre, its chemical pattern around it, and
its current note moving through that pattern.
