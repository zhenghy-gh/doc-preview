# Round 17 — Collect header paragraphs in one pass

Date: 2026-09-29

`splitHeaderTextHeuristic` now trims and filters split paragraphs in one loop, preserving their order while avoiding the separate `map` and `filter` arrays.

Validation: 141 focused header/footer, parser, real-document, and performance tests passed; full suite passed with 59 files and 1324 tests; lint and production build passed. Production main bundle gzip was approximately 108.78 kB.
