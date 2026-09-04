# Addendum: chord-mode pulse emission

Amends `RING-TO-BAND-BRIEF.md` after the findings in `BAND-FINDINGS.md`. Sections 2–7
of that brief stand as written for sequence mode. This addendum adds chord mode, which
has no per-tone lifetime to inherit.

## Constants

```js
const BAND_PULSE_PERIOD = 0.6; // s — spacing between bands while a chord is held
```

A visual constant. It is deliberately not derived from tone duration; chord mode has no
tone-duration event.

## Emission

**Sequence mode** — unchanged. One band per tone at tone onset, `life = toneDuration`.

**Chord mode** — while a star's chord is held, emit a band set every
`BAND_PULSE_PERIOD`, the first at chord onset, not after one period. Each band still
carries `life = toneDuration`, so a band that is never force-faded dies on its own and
the pulse stays visually bounded.

Emission is driven off audio state, not a free-running timer: the pulse advances only
while the star's chord is sounding, and the next pulse is scheduled from the previous
emission, not from wall-clock start.

## What one pulse emits

A chord sounds every line at once, so one pulse emits **one band per line**, all born at
the same instant, sharing an outer edge:

- `rgb` — `wlToRGB(line.wl)`, per line
- `peak` — `0.35 + line.depth * 0.55`, per line
- birth thickness — scaled by EW rank, root thickest:
  `BAND_THICKNESS * (0.55 + 0.45 * (1 - rank / (n - 1)))` for rank 0..n-1, EW descending

Under `lighter` these blend into a single band whose colour is the chord's colour, with
the strongest line reaching deepest toward the star. Highest EW reads as the thickest,
most present colour in the band.

### Visual validation result

The per-line chord blend was accepted after a manual pass across all six prototype
stars. It retained recognisable star-specific colour, including the Betelgeuse/Sirius
extremes, without washing to white. Keep the per-line blend; the root-colour-only
fallback considered during implementation is retired.

A six-second sustained chord hold also validated `BAND_PULSE_PERIOD = 0.6`: the pulse
read as continuous water-ripple motion rather than a metronomic clock. Keep 0.6 s unless
a future visual redesign deliberately reopens tuning.

## Force-fade on release

On `starFadeStart` for a star:

1. Stop spawning for that star immediately.
2. Force-fade every in-flight band belonging to it, using the existing audio fade
   duration and the existing force-fade path already used for oldest-star eviction.

A force-faded band keeps expanding — geometry is untouched — and only its alpha is
overridden: it decays from whatever alpha it had at the moment of release to zero across
the audio fade duration. It does not run out its remaining natural life.

On `starStopped`, drop any bands still held for that star.

## Acceptance (in addition to the base brief)

- Holding a chord produces bands leaving the star every 0.6 s for as long as it sounds.
- Releasing the chord stops new bands on the same frame, and every visible band is gone
  by the time the audio is silent — no band outlives its sound at any point.
- A chord released mid-pulse fades its in-flight bands out; none of them snap off.
- Sequence mode is unchanged from the base brief.
- Evicting the oldest star under the 3-star limit behaves as it does today.

The deployed visual pass accepted all five checks above, including shallow Vega Fe I
visibility and equivalence between normal release and oldest-star eviction.

## Out of scope

Everything in section 5 of the base brief, plus: no control for the pulse period, and no
change to chord voicing, gain scaling, or `harmonize.js`.

## Order

1. Chord pulse emission + per-line band set
2. Force-fade wiring on `starFadeStart` / `starStopped`
3. Manual pass: all six stars, chord and sequence, including release mid-pulse
