# Round 42 — Limit PlcfHdd CP scan

Date: 2026-09-30

`parsePlcfHdd` only extracts the first section's header/footer ranges, so it now reads only the CP values needed for that section instead of collecting every section boundary. Active-part ordering, empty-range filtering, short-data handling, and output semantics remain unchanged.

Validation: 32 focused header/footer parser tests passed; full suite passed with 59 files and 1328 tests; lint and production build passed. Production main bundle gzip was approximately 108.88 kB.
