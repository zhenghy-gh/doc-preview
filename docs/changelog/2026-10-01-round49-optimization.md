# Round 49 — Normalize search highlight parents once

Date: 2026-10-01

`clearSearchHighlights` now replaces all matching spans before normalizing each distinct affected parent once. This avoids repeatedly merging a shrinking sibling list for dense search results while preserving restored text and nested-highlight cleanup. Added coverage for 100 sibling matches and nested highlights.

Validation: 22 focused search utility tests passed; full suite passed with 59 files and 1331 tests; lint and production build passed. Production main bundle gzip was approximately 108.89 kB.
