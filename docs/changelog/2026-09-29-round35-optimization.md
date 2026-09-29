# Round 35 — Fuse WordArt filtering and extraction

Date: 2026-09-29

`extractWordArtFromDirectory` now filters and processes directory entries in one loop, removing the intermediate `wordArtEntries` array and its second traversal. Object-type filtering, trimmed-name matching, output order, original names, and per-entry error isolation remain unchanged.

Validation: 24 focused WordArt parser tests passed; full suite passed with 59 files and 1328 tests; lint and production build passed. Production main bundle gzip was approximately 108.80 kB.
