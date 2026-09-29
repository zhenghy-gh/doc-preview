# Round 9 — Reuse field result trimming

Date: 2026-09-29

TOC and INDEX field result parsing now trims each split line once during the main loop instead of filtering with `trim()` and trimming again. Empty-line handling, INDEX indentation detection, ordering, and output shape are unchanged.

Validation: 181 focused field, document, and rendering tests passed; full suite passed with 59 files and 1324 tests; lint and production build passed; real-document and parsing performance tests passed.
