# Round 8 — Reuse legacy font table key enumeration

Date: 2026-09-29

The legacy `DocParser` 1Table fallback now reuses one `Object.keys(fontEntries)` result for the non-empty check and diagnostic count. Font table selection and merge behavior are unchanged.

Validation: 146 focused parser, style, real-document, and performance tests passed; full suite passed with 59 files and 1324 tests; lint and production build passed.
