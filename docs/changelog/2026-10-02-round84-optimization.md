# Round 84 — Single-pass revision HTML escaping

Date: 2026-10-02

Changed `escapeHtmlSimple` from five sequential full-string replacements to one character scan with a lookup map. Escaped output and entity-safety semantics remain unchanged.

The focused revision rendering suite passed (29 tests); lint and production build (`vue-tsc` + Vite) passed. Main JS gzip: 108.95 kB, up 0.04 kB from the prior build; the change trades a small bundle increase for reducing five scans to one.

The renderer and its tracked test were clean before editing. The shared worktree contains unrelated edits, so no commit was made.
