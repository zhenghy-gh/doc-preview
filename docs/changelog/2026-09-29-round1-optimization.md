# Round 1 — Rendering and format hot paths

Date: 2026-09-29

- Cached repeated PAPX style inheritance resolution by `istd`.
- Normalized legacy image sources once per render pass instead of rebuilding them in paragraph/list/tail paths.
- Added monotonic CP cursors for textbox and inline-picture placement, with binary-search fallback for non-monotonic input.
- Added regression coverage for non-monotonic paragraph CPs.
- Validation: 59 test files / 1323 tests passed, lint passed, production build passed, dev-server homepage smoke reached the Vite entrypoint.
