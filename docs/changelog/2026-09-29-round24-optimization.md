# Round 24 — Index equation streams once

Date: 2026-09-29

`extractEquationsFromDirectory` now indexes object-type-2 stream entries once and looks up each equation's `EquationText` and `Picture` streams by exact composite name. Duplicate names retain the first entry, matching the previous `find` behavior; a regression test verifies it.

Validation: 28 focused equation parser tests passed; full suite passed with 59 files and 1327 tests; lint and production build passed. Production main bundle gzip was approximately 108.82 kB.
