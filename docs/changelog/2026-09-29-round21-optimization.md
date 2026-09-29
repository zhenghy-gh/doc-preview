# Round 21 — Reuse chart picture stream lookup

Date: 2026-09-29

`extractChartsFromDirectory` now looks up each candidate chart's Picture stream once and reuses that entry for `hasPicture` and preview extraction, avoiding a second full directory scan. Matching, first-entry selection, minimum-size checks, and read failure handling are unchanged.

Validation: 33 focused chart parser tests passed; full suite passed with 59 files and 1325 tests; lint and production build passed. Production main bundle gzip was approximately 108.77 kB.
