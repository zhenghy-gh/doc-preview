# Round 6 — Reuse list-block level counts

Date: 2026-09-29

`computeListContinuity` now counts level-0 items while collecting each list block instead of allocating `blockItems` and filtering it afterward. List block boundaries, list ID counters, and numbering output remain unchanged.

Validation: 86 focused list/rendering tests passed; full suite passed with 59 files and 1324 tests; lint and production build passed; real-document and parsing performance tests passed.
