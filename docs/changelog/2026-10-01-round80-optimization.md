# Round 80 — Remove no-op equation substitutions

Date: 2026-10-02

Removed the no-op `\\frac{…}{…}` and `\\sqrt{…}` replacements from `eqnToLatex`; those forms were already emitted unchanged. The focused equation parser suite passed (28 tests), as did lint and the production build (`vue-tsc` + Vite). Main JS gzip decreased from 108.93 kB to 108.91 kB.

The source and test files for this narrow change were clean before editing. The shared worktree still contains extensive unrelated modifications, so no commit was created.
