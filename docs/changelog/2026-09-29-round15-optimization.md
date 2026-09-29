# Round 15 — Read bookmark starts without a temporary array

Date: 2026-09-29

`parsePlcfBkf` now reads each start CP directly from the source buffer while building its BKF result, avoiding a separate CP array and its additional pass. CP ordering and BKF index association remain unchanged.

Validation: 120 focused bookmark, parser, real-document, and performance tests passed; full suite passed with 59 files and 1324 tests; lint and production build passed. Production main bundle gzip was approximately 108.80 kB.
