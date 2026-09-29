# Round 22 — Avoid copying WordArt drawing slices

Date: 2026-09-29

`extractWordArtFromDrawingData` now passes a `subarray` view to its effect, text, and color readers instead of copying each candidate range with `slice`. The view shares the source buffer; current consumers are read-only, and offsets and bounds are unchanged.

Validation: 23 focused WordArt parser tests passed; full suite passed with 59 files and 1325 tests; lint and production build passed. Production main bundle gzip was approximately 108.77 kB.
