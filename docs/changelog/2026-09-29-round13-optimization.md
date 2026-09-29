# Round 13 — Cache WordArt name pattern keys

Date: 2026-09-29

WordArt directory filtering now reuses a module-level list of the fixed name-pattern keys instead of enumerating them for every candidate storage. Matching order and recognition behavior are unchanged.

Validation: 132 focused WordArt, parser, real-document, and performance tests passed; lint and production build passed. Production main bundle gzip was approximately 109.30 kB.
