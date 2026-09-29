# Round 23 — Index OLE streams during chart scan

Date: 2026-09-29

`extractChartsFromDirectory` now indexes type-2 streams during its directory pass, then performs Picture and Data lookups by exact name. The index preserves the first matching entry, as `find` did previously; a regression test covers duplicate stream names.

Validation: 34 focused chart parser tests passed; full suite passed with 59 files and 1326 tests; lint and production build passed. Production main bundle gzip was approximately 108.83 kB (about 0.06 kB above the prior round); the scan reduction benefits directories with multiple chart candidates.
