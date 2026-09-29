# Round 19 — Reduce font name decoding allocations

Date: 2026-09-29

`readUtf16leString` now collects UTF-16 code units and constructs the font name in one call, avoiding a temporary single-character string and string-array entry per code unit. Null termination and bounds behavior remain unchanged.

Validation: 9 focused font parser tests passed, including supplementary Unicode and null termination; full suite passed with 59 files and 1325 tests; lint and production build passed. Production main bundle gzip was approximately 108.78 kB.
