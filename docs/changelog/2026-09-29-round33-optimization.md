# Round 33 — Reuse chart stream magic patterns

Date: 2026-09-29

`extractChartsFromWordDocumentStream` now reuses module-level OLE and ZIP magic-byte patterns instead of allocating two `Uint8Array` values and their containing array for each call. Pattern order and byte matching remain unchanged.

Validation: 34 focused chart parser tests passed; full suite passed with 59 files and 1328 tests; lint and production build passed. Production main bundle gzip was approximately 108.79 kB.
