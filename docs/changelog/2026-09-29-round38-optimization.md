# Round 38 — Reuse chart pattern matches

Date: 2026-09-29

`extractChartsFromDirectory` now retains the first fixed chart-name pattern found while filtering each directory entry. The internal type classifier reuses that match instead of scanning the fixed pattern list a second time, while the public `detectChartType` API continues to perform the complete classification. LibreOffice, SmartArt, keyword fallback, directory ordering, and first-duplicate stream semantics remain unchanged.

Validation: 34 focused chart parser tests passed; full suite passed with 59 files and 1328 tests; lint and production build passed. Production main bundle gzip was approximately 108.85 kB.
