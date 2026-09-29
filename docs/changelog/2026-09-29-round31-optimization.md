# Round 31 — Avoid intermediate arrays in Markdown traversal

Date: 2026-09-29

Markdown export now iterates DOM `childNodes` directly while collecting converted output, avoiding `Array.from` snapshots and chained `map`/`filter` arrays in recursive inline and block conversion. Node order, empty-result filtering, separators, and joined output are preserved.

Validation: 34 focused Markdown export tests passed; full suite passed with 59 files and 1328 tests; lint and production build passed. Production main bundle gzip was approximately 108.82 kB.
