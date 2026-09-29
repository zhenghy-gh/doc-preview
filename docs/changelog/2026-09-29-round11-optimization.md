# Round 11 — Remove redundant paragraph length filtering

Date: 2026-09-29

The generic paragraph filter no longer performs a second `length >= 2` pass immediately after consecutive deduplication. No operation between the first length check and deduplication shortens text, so the removed pass was redundant; placeholder handling and later cleanup remain unchanged.

Validation: 147 focused list, deduplication, document, real-document, and performance tests passed; full suite passed with 59 files and 1324 tests; lint and production build passed.
