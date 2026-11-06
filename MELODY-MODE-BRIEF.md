# Melody Mode: Implementation Brief (Presets)

## Goal

Play a preset melody across the stars in the current view. Each star plays one pitch of the melody and pulses in its own color while its note sounds.

MIDI import is a follow-up brief. Do not build any part of it here.

## Settled design decisions

These are decided. Do not revisit them; surface concerns instead.

1. **Melody sets pitch, the star sets timbre.** The melody note decides the frequency. Everything else comes from the star's spectral data through the existing mappings.
2. **Stars are auto-assigned from the current view.** No user picking, no constellation selection.
3. **Pitches are assigned by temperature.** The coolest assigned star plays the lowest pitch, the hottest plays the highest.
4. **Star brightness sets tone volume.** Applied as a per-star master level on top of the existing depth → gain mapping.
5. **Honest mode** is an optional toggle. When on, each melody note is played by whichever assigned star has a real line pitch nearest to it, at that line's real pitch.
6. **Melody source for this brief: built-in presets only.**

## Gate 1: Visible star enumeration (investigate before writing feature code)

Determine whether the Stellarium bridge can return the list of stars currently in view, with for each star:

- HIP number (or other ID the resolver accepts)
- visual magnitude
- spectral type or temperature
- screen position (needed to draw the pulse)

Report what the engine provides, how it is accessed, and any limits (count caps, magnitude cutoffs, performance cost). If enumeration is not possible or requires engine changes, stop and report. Do not patch the engine or work around it without direction.

The Phase 0 WASM artifacts may still be missing. If so, report that Gate 1 is blocked and state what can be built and tested without the engine.

## Gate 2: Feature implementation (after Gate 1 is reviewed)

### 2.1 Presets

Hand-authored file at `src/melodies/presets.js` (this is not generated data and does not belong in `src/data/`).

Format:

```js
{
  name: "Twinkle Twinkle Little Star",
  bpm: 100,
  notes: [ { midi: 60, beats: 1 }, { midi: null, beats: 0.5 } /* rest */, ... ]
}
```

Include three public domain melodies: Twinkle Twinkle Little Star, Ode to Joy, Greensleeves. Single voice only. All notes must fall within the existing pitch range (MIDI 48 to 84).

### 2.2 Star assignment

At the moment playback starts:

1. Collect visible stars that the resolver can return data for.
2. Count the melody's distinct pitches (N).
3. Take the N brightest resolvable stars.
4. Sort those stars by temperature, ascending. Break ties by HIP number.
5. Sort the distinct pitches ascending and pair them in order with the sorted stars.

The same pitch always goes to the same star for the whole melody. Assignment is locked when playback starts; panning during playback does not reassign.

If fewer than N stars are available, surface the case and use this fallback: cycle through the available stars in temperature order. Report how often this happens in testing.

### 2.3 Timbre source

For each star, use its strongest line (highest EW) as the timbre source: width → filter Q, profile → envelope, EW → reverb, EP → harmonics, depth → gain. Star RV → detune as today. Override only the frequency with the melody note.

### 2.4 Brightness → volume

Map visual magnitude linearly to decibels, then to a gain multiplier:

- magnitude -1.5 → 0 dB
- magnitude 6.0 → -18 dB
- clamp outside that range

Multiply this into the note's gain. Put the mapping in `mappings.js` as a pure function (`magToGain`).

### 2.5 Variable note duration

`TONE_DURATION` is fixed at 1.2 s today. Add a `duration` parameter to the line playback function, defaulting to 1.2 s so chord mode and sequence mode are unchanged.

Note duration = `beats * 60 / bpm`. If the duration is shorter than attack + decay + release, scale those three proportionally to fit.

### 2.6 Visual pulse

When a note plays, trigger the existing ring/band ripple on that star, in the star's display color, synced to the note's duration (not the fixed 1.2 s). Template stars use the existing temperature → color mapping.

### 2.7 Honest mode

Toggle, off by default. When on:

- For each melody note, find the assigned star with a line whose `wlToFreq` pitch is nearest to the note.
- Play that line at its real pitch with its own parameters.
- That star pulses.

No pitch tolerance threshold in this brief. Report how far notes drift from the melody for each preset.

### 2.8 Controls

Minimal UI: preset selector, play/stop button, honest mode toggle. Stop halts audio and clears all pulses. Starting melody mode stops any chord or sequence playback.

## Out of scope

- MIDI import (next brief)
- Note entry or melody editing
- Constellation-based assignment
- Changes to any existing mapping function other than adding the `duration` parameter and `magToGain`
- Changes to the data pipeline, `bright-stars.json`, `spectral-templates.json`, or any generated file in `src/data/`
- Changes to the six prototype stars
- Crossfades, ambient pads, tempo control

Surface anything outside this scope as a drift item rather than fixing it.

## Acceptance criteria

1. Gate 1 report delivered and reviewed before Gate 2 begins.
2. Twinkle Twinkle plays across six stars in view (six distinct pitches), coolest star on the lowest note.
3. Each star pulses in its own color, in sync with its note, for that note's duration.
4. A bright star is clearly louder than a faint one playing the same pitch.
5. The same note on two different stars sounds clearly different.
6. Chord mode and sequence mode behave exactly as before.
7. Honest mode plays, and the drift report is included.
8. Tested in Chromium.
