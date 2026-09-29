# Round 16 — Read section CP ranges in place

Date: 2026-09-29

`parsePlcfSed` now reads each section's adjacent start/end CP values directly from the source buffer while assembling the SED entry, avoiding a separate `cpStarts` array and pass. CP pairing and SED ordering are unchanged.

Validation: 134 focused section, parser, real-document, and performance tests passed; full suite passed with 59 files and 1324 tests; lint and production build passed. Production main bundle gzip was approximately 108.78 kB.
