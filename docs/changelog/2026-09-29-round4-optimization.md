# Round 4 — Reuse escaped chart names

Date: 2026-09-29

`renderChartHtml` now escapes a chart name once and reuses the result in both the accessible label and visible fallback card name. This preserves XSS-safe output while avoiding duplicate work.

Validation: 57 focused rendering tests passed; full suite passed with 59 files and 1323 tests; lint and production build passed; real-document and performance tests passed.
