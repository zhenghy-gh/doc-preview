# Round 20 — Traverse search DOM without snapshots

Date: 2026-09-29

`collectTextNodes` now iterates each node's `childNodes` by index instead of allocating an `Array.from` snapshot at every visited DOM node. Document order and skipping existing search-highlight elements are unchanged; DOM mutation still occurs only after collection finishes.

Validation: 20 focused search utility tests passed; full suite passed with 59 files and 1325 tests; lint and production build passed. Production main bundle gzip was approximately 108.79 kB.
