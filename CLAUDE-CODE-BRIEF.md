# FEATURE BRIEF: Chord Harmonization Mode

## Context

You are working on a stellar sonification app (`stellar-sonification.jsx`) that converts real absorption spectroscopy data from stars into audio. Currently, clicking a star plays its absorption lines **sequentially** — one tone at a time, sorted by equivalent width (EW) descending, with 80ms gaps. Each line's physical parameters map to audio parameters through 7 proven mappings (wavelength→pitch, depth→gain, width→filter Q, line profile→ADSR envelope, EW→reverb send, radial velocity→detune, excitation potential→harmonic richness).

We are adding a **chord mode** — the user can choose to hear all absorption lines played **simultaneously** as a harmonized chord instead of sequentially. A new module `harmonize.js` has already been written and tested. Your job is to integrate it into the UI and audio playback.

---

## What `harmonize.js` does

The module is a pure-function library with no Web Audio dependencies. It lives at `src/audio/harmonize.js` (place it there).

### The problem it solves

The raw `wlToFreq()` pitches from absorption lines have no harmonic relationship — they're linearly mapped from wavelength. Played simultaneously they sound like a tone cluster. `harmonize.js` pulls each pitch toward the nearest just-intonation consonant interval relative to a root note, producing a chord that is musically coherent but still driven by real spectroscopy data.

### Exports

```js
import { harmonizeChord, describeChord, CHORD_TIMING, centsBetween } from './harmonize.js';
```

**`harmonizeChord(lines, starRV, amount)`** — core algorithm
- `lines`: the star's `.lines` array (same shape as `STARS[n].lines`)
- `starRV`: star's radial velocity (number, km/s)
- `amount`: 0.0 (raw data, no harmonization) to 1.0 (fully snapped to consonant intervals)
- Returns:
  ```js
  {
    freqs: number[],       // harmonized frequency per line (Hz)
    rawFreqs: number[],    // original wlToFreq() frequencies (for comparison)
    rootIdx: number,       // index of the root line (max EW)
    intervals: Array<{ name: string, ratio: number, cents: number }>,
    pull: number[],        // 0–1 per line, how much it was displaced
    gainScale: number,     // multiply each voice's gain by this (1/√N)
  }
  ```

**`describeChord(chord, lines)`** — UI helper
- Returns `{ root: string, voices: Array<{...}>, quality: string }`
- `quality` is a human-readable label like `"minor 7th"`, `"open fifth"`, `"cluster"`

**`CHORD_TIMING`** — constants for playChord()
```js
{
  duration: 2.8,        // total chord duration (seconds)
  stagger: 0.015,       // onset delay between voices (seconds per voice)
  masterAttack: 0.20,   // chord-level envelope attack
  masterRelease: 0.80,  // chord-level envelope release
}
```

**`centsBetween(f1, f2)`** — utility, returns cent distance between two frequencies.

### Key algorithm behaviors

- The **strongest absorption line** (max EW) becomes the **root** and never moves.
- Weaker lines yield more to the harmonic grid; stronger lines resist. This is EW-weighted pull.
- At `amount = 0`, output equals raw frequencies exactly (no change).
- At `amount = 1`, frequencies are fully snapped to just intonation intervals.
- Every star produces a **unique chord shape** — verified across all 6 prototype stars.
- A voicing spread pass shifts any two voices within 30 cents of each other apart by an octave to prevent masking.

---

## New state required in `StellarSonification` component

Add to existing state:

```js
const [playMode, setPlayMode] = useState('sequential');  // 'sequential' | 'chord'
const [harmonizeAmt, setHarmonizeAmt] = useState(0.75);  // 0–1, default 0.75
const [chordPlaying, setChordPlaying] = useState(false);
const [panelOpen, setPanelOpen] = useState(false);        // right-side drawer open/closed
```

---

## New audio function: `playChord`

Add a `playChord` callback alongside the existing `playLine` and `playSequence`. It should:

1. Call `stopCurrent()` to kill any active playback.
2. Call `harmonizeChord(star.lines, star.rv, harmonizeAmt)` to get the frequency array.
3. For each line, build the **same oscillator→filter→ADSR→reverb graph** that `playLine` already builds (lines 360–473 of current code), but with these modifications:
   - Use `chord.freqs[i]` instead of `wlToFreq(line.wl)` for the oscillator frequency.
   - Multiply the gain value by `chord.gainScale` to prevent clipping.
   - Stagger the start time: `now + i * CHORD_TIMING.stagger` instead of `now`.
   - Use `CHORD_TIMING.duration` (2.8s) instead of `TONE_DURATION` (1.2s).
4. Wrap all voices in a master GainNode with its own slow envelope:
   - Attack: ramp from 0 to 1 over `CHORD_TIMING.masterAttack` (200ms).
   - Release: ramp from sustain to 0 starting at `duration - masterRelease`.
5. Set `chordPlaying = true`, schedule `chordPlaying = false` after duration.
6. During chord playback, cycle `playingIdx` through each line index at staggered intervals so the spectrum visualization highlights each voice as it enters.

---

## Wire the play button

The existing `▶ PLAY ALL LINES` button (line 548) should respect `playMode`:

```
if playMode === 'sequential' → call playSequence() (existing behavior)
if playMode === 'chord'      → call playChord()
```

Update the button label:
- Sequential: `"▶ PLAY ALL LINES"` / `"▶ TRANSMITTING..."`
- Chord: `"◆ PLAY CHORD"` / `"◆ RESONATING..."`

---

## UI: Right-side drawer panel

### Interaction pattern

There is a **small tab** fixed to the right edge of the viewport, vertically centered. It acts as a drawer handle. Clicking it slides out a narrow panel (~220px wide) from the right edge. Clicking the tab again (or clicking outside) closes it.

### Tab appearance (closed state)

- Fixed position, right edge of screen, vertically centered.
- A narrow vertical strip: ~28px wide × ~90px tall.
- Background: `rgba(15, 15, 25, 0.7)` with `backdrop-filter: blur(8px)`.
- Border: `1px solid rgba(120,130,160,0.15)` on left, top, bottom edges (not right, since it's flush).
- Border-radius: `3px 0 0 3px` (rounded on left side only).
- Contains vertical text reading `"HARMONICS"` in the app's standard style: `font-size: 8px`, `letter-spacing: 3px`, `text-transform: uppercase`, `color: rgba(140,160,200,0.4)`.
- A small icon or indicator: a subtle `◆` or similar glyph above the text, in `star.color`, to hint that it's mode-related.
- On hover: border brightens to `rgba(120,130,160,0.3)`, text brightens slightly. Cursor: pointer.
- Transition: smooth slide, `transform: translateX()` with `transition: transform 0.3s ease`.

### Panel appearance (open state)

- Slides out from the right. The tab stays visible as the leftmost edge of the panel (so it acts as both handle and part of the panel border).
- Panel width: ~220px. Same dark background and border style as other panels in the app.
- Panel contents, from top to bottom:

#### 1. Mode toggle

A pair of buttons (not a native toggle) styled consistently with the star selector buttons:

```
┌────────────┐ ┌────────────┐
│ SEQUENTIAL │ │   CHORD    │
└────────────┘ └────────────┘
```

- Active mode gets `background: rgba(255,255,255,0.06)`, `border-color: star.color`, `color: star.color`.
- Inactive mode gets the same dimmed style as unselected star buttons.
- Font: 9px, letterspacing 1, same as star selector.

#### 2. Harmonize slider (only visible when mode is 'chord')

- Label above: `"HARMONIZE"` in the standard micro-label style (8px, letterspacing 3, uppercase, dim).
- A horizontal slider (`<input type="range">`) styled to match the app:
  - Track: 4px tall, `rgba(40,42,55,0.8)` background, rounded.
  - Fill (left of thumb): `star.color` at ~40% opacity.
  - Thumb: 12px circle, `star.color` border, dark fill.
- Value display to the right: `"{Math.round(harmonizeAmt * 100)}%"` in 9px monospace.
- Below the slider, two labels at the extremes:
  - Left: `"DATA"` (8px, dim)
  - Right: `"HARMONY"` (8px, dim)

#### 3. Chord info (only visible when mode is 'chord')

Call `describeChord(harmonizeChord(star.lines, star.rv, harmonizeAmt), star.lines)` and display:

- **Root line**: e.g. `"root: Ca II K"` — highlighted in `star.color`.
- **Quality**: e.g. `"minor 7th"` — in the standard text color.
- **Voice list**: For each line, a compact row showing:
  ```
  Ca II K    root     0%
  Hβ         m3      37%
  Mg I b₁    P1      43%
  Fe I       M7      44%
  Na I D₁    TT      35%
  Hα         M7      36%
  ```
  - Element name in its wavelength color (use `wlToRGB`).
  - Interval name in dim text.
  - Pull percentage in dimmer text.
  - The root line's row should have a subtle left-border or dot indicator in `star.color`.

#### 4. Frequency comparison (optional, nice to have)

A mini visual showing raw vs harmonized frequencies as dots on a horizontal pitch axis. Raw dots as dim outlines, harmonized dots as filled, with thin lines connecting each pair to show displacement. Skip this if it's too complex — the voice list above is sufficient.

### Transitions and reactivity

- The panel re-computes chord info whenever `starIdx` or `harmonizeAmt` changes. This computation is cheap (pure math, no audio) — fine to run on every render.
- When `playMode` changes, the main play button updates its label and behavior immediately.
- Changing the harmonize slider does NOT re-trigger playback. It only affects the next play.
- The slider's `star.color` tinting should transition when switching stars (matching how the header star name color transitions).

---

## Design system reference

All styling in this app uses inline `style={{}}` objects. There is no CSS file. Follow the existing conventions exactly:

- **Background**: `#08080e` (app), `rgba(12,12,20,0.5)` or `rgba(15,15,25,0.5)` (panels)
- **Borders**: `1px solid rgba(120,130,160,0.1)` (panels), `rgba(80,85,100,0.15)` (lighter)
- **Text colors**: `rgba(140,150,170,0.4)` (labels), `rgba(180,185,200,0.7)` (values), `rgba(100,105,120,0.4)` (placeholder/italic)
- **Accent color**: `star.color` (changes per star, used for highlights and active states)
- **Fonts**: `'IBM Plex Mono', 'Menlo', monospace` (body), `'Outfit'` (headers) — already loaded via Google Fonts link in the component
- **Micro-labels**: `fontSize: 8, letterSpacing: 3, textTransform: 'uppercase', color: 'rgba(140,150,170,0.4)'`
- **Button style**: see star selector buttons (lines 527–537) for the canonical button pattern
- **Border-radius**: `2` for everything (very subtle rounding, almost sharp)
- **Transitions**: `transition: "all 0.2s"` on interactive elements, `"color 0.4s"` on star-color-dependent elements

---

## Files to modify

1. **`stellar-sonification.jsx`** — add state, `playChord` callback, drawer panel UI, wire play button
2. **`src/audio/harmonize.js`** — place the provided module here (no modifications needed)

## Files NOT to modify

- The `STARS` data array, `wlToFreq`, `depthToGain`, `widthToQ`, `profileToEnvelope`, `ewToReverb`, `rvToDetune`, `epToHarmonics` — these are proven and must not change.
- `SpectrumCanvas` — no changes needed. It already highlights `playingIdx` correctly.
- `ParamBar` — no changes needed.

---

## Acceptance criteria

1. A tab labeled "HARMONICS" is visible on the right edge of the screen.
2. Clicking it opens a drawer panel with a Sequential/Chord mode toggle.
3. In chord mode, a harmonize slider appears (0–100%) and chord info displays (root, quality, voice list with intervals and pull percentages).
4. The play button says "◆ PLAY CHORD" in chord mode and plays all lines simultaneously.
5. At harmonize 0%, the chord sounds like a dissonant cluster (all raw frequencies).
6. At harmonize 100%, the chord sounds consonant and pleasant.
7. Different stars produce audibly different chords.
8. Switching stars while the panel is open updates the chord info immediately.
9. Sequential mode is completely unchanged from current behavior.
10. All styling matches the existing design system — the panel should look native, not bolted on.
