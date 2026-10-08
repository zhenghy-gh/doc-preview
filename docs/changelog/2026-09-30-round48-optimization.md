# Round 48 — Gate chart signature scans by first byte

Date: 2026-09-30

`extractChartsFromWordDocumentStream` now dispatches on the first signature byte and compares the remaining bytes directly, avoiding the two-pattern nested loop at ordinary stream offsets. Scan bounds, OLE/ZIP classification, zero-run termination, the 500-byte threshold, and post-match offset behavior remain unchanged. Added a large nonmatching stream case with near-signatures.

Validation: 35 focused chart parser tests passed; 9 real-document performance guards passed; full suite passed with 59 files and 1329 tests; lint and production build passed. Production main bundle gzip was approximately 108.87 kB.
