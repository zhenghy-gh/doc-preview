# Round 7 — Reuse font table key enumeration

Date: 2026-09-29

The format recovery fallback now reuses one `Object.keys(fontEntries)` result for both the non-empty check and diagnostic count. Font table selection and merging behavior are unchanged.

Validation: 191 focused parser, formatting, real-document, and performance tests passed; full suite passed with 59 files and 1324 tests; lint and production build passed.
