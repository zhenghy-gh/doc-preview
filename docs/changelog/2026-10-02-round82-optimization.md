# Round 82 — Share OfficeArt shape scanning

Date: 2026-10-02

Extracted the identical OfficeArt byte scan and SPID de-duplication loop into a private `extractShapes` helper used by both the Data-stream and WordDocument-stream APIs. Scan bounds, record parsing, first-seen SPID ordering, and public API names are unchanged.

The focused shape parser suite passed (31 tests); lint and production build (`vue-tsc` + Vite) passed. Main JS gzip: 108.90 kB. The parser and its test were clean before editing. No commit was made because the shared worktree still has extensive unrelated changes.
