# Round 81 — Avoid repeated bookmark name concatenation

Date: 2026-10-02

Changed UTF-16LE and 8-bit bookmark name decoding to collect decoded characters and join once, avoiding repeated prefix concatenation while preserving loop bounds, terminator offsets, and truncation behavior. The focused bookmark parser suite passed (11 tests); lint and production build (`vue-tsc` + Vite) passed. Main JS gzip: 108.91 kB.

The parser and its tracked test were clean before this change. The shared worktree contains unrelated edits from another session, so no commit was made.
