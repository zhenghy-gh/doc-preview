# Round 30 — Reuse chart name pattern keys

Date: 2026-09-29

`detectChartType` now iterates the existing `CHART_NAME_PATTERNS_KEYS` array instead of allocating `Object.entries(CHART_NAME_PATTERNS)` on every call. Key order, case-sensitive matching, and fallback behavior remain unchanged.

Validation: 34 focused chart parser tests passed; full suite passed with 59 files and 1328 tests; lint and production build passed. Production main bundle gzip was approximately 108.80 kB.
