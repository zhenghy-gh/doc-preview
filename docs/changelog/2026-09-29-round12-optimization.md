# Round 12 — Reuse chart directory scan values

Date: 2026-09-29

Chart directory filtering now reuses a module-level list of known chart-name patterns and lowercases each directory name once. Recognition conditions and directory order remain unchanged.

Validation: 142 focused chart, parser, real-document, and performance tests passed; full suite passed with 59 files and 1324 tests; lint and production build passed. Production main bundle gzip was approximately 109.30 kB.
