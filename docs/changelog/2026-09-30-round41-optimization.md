# Round 41 — Reuse section break mapping

Date: 2026-09-30

`parseSepx` now reuses a module-level section-break mapping instead of allocating the same four-item array whenever a section-break SPRM is parsed. Unknown values still fall back to `nextPage`, and all section parsing semantics remain unchanged.

Validation: 25 focused section parser tests passed; full suite passed with 59 files and 1328 tests; lint and production build passed. Production main bundle gzip was approximately 108.87 kB.
