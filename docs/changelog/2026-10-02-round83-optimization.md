# Round 83 — Collect list number text before joining

Date: 2026-10-02

Changed `parseLvlf` to collect decoded UTF-16LE list number-template characters and join once, avoiding repeated prefix concatenation. Character bounds, null termination, and output remain unchanged.

The focused list parser suite passed (44 tests); lint and production build (`vue-tsc` + Vite) passed. Main JS gzip: 108.91 kB.

The parser and its tracked test were clean before editing. The shared worktree contains unrelated edits, so no commit was made.
