# Round 25 — Use a set for WordArt color deduplication

Date: 2026-09-29

`extractColorsFromData` now uses a `Set` for membership checks while keeping the ordered array for output, preserving first-seen colors and the eight-color cap. Tests cover duplicate colors, ordering, and truncation beyond eight unique colors.

Validation: 24 focused WordArt parser tests passed; full suite passed with 59 files and 1328 tests; lint and production build passed. Production main bundle gzip was approximately 108.82 kB.
