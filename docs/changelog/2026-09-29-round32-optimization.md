# Round 32 — Detect Markdown table headers during cell traversal

Date: 2026-09-29

`convertTableToMd` now detects whether a row contains any `<th>` during its existing cell traversal, removing a second scan of that row. The any-header-cell rule and separator placement remain unchanged.

Validation: 34 focused Markdown export tests passed; full suite passed with 59 files and 1328 tests; lint and production build passed. Production main bundle gzip was approximately 108.80 kB.
