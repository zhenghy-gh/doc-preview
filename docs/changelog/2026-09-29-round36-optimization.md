# Round 36 — Fuse equation directory indexing

Date: 2026-09-29

`extractEquationsFromDirectory` now collects equation storages and indexes type-2 streams in one directory traversal. Duplicate stream names still keep the first entry, equation order is preserved, and equation processing still begins only after the complete stream index is built.

Validation: 28 focused equation parser tests passed; full suite passed with 59 files and 1328 tests; lint and production build passed. Production main bundle gzip was approximately 108.79 kB.
