# Round 5 — Escape chart preview URLs

Date: 2026-09-29

`renderChartHtml` now applies `escapeHtmlAttribute` to embedded chart preview URLs before placing them in `<img src>`. This preserves normal data URLs while preventing quote and tag characters from breaking the HTML attribute boundary.

Validation: 58 focused rendering tests passed; full suite passed with 59 files and 1324 tests; lint and production build passed; real-document and parsing performance tests passed.
