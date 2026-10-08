# Round 62 — Verify npm pack lifecycle and package self-reference

Date: 2026-10-01

No configuration changes. `npm pack --dry-run --foreground-scripts` did not run the only package-related lifecycle script, `prepublishOnly: npm run build:lib`. A Node self-reference import through the package `exports` map succeeded and exposed the expected component/parser APIs.

The dry-run packages existing `dist-lib` contents; a stale local build could therefore be inspected or packed unless rebuilt. `package.json` already has worktree modifications, so this round did not change lifecycle scripts.
