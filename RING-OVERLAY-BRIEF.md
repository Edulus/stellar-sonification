# Ring overlay brief — superseded

This filename is retained as a guard against stale implementation guidance.

The former thin stroked-ring design is superseded. The current overlay uses filled
radial ripple bands and chord pulse emission.

Read these instead, in order:

1. `RING-TO-BAND-BRIEF.md` — sequence-mode ring-to-band delta and tuned band geometry.
2. `BAND-FINDINGS.md` — investigation of the pre-band implementation and the chord-lifetime fork.
3. `BAND-PULSE-ADDENDUM.md` — sustained-chord pulse model, force-fade behavior, and accepted visual validation results.

Current implementation: `src/ui/RingOverlay.jsx`.

Do not restore the thin-ring rendering from historical context. Panel controls for the
band geometry or pulse period remain intentionally out of scope.
