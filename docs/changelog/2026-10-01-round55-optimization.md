# Round 55 — Check package contents and ESM exports

Date: 2026-10-01

No source changes. Checked the `npm pack --dry-run --json` manifest to ensure it excludes tests, docs, scripts, coverage, examples, sample `.doc` files, and source maps. The package contains 13 entries (883,835 unpacked bytes). Imported the built ESM entry and verified that it exports `DocPreview` and the expected parser/worker APIs.

This validates local build output and package selection, not consumer-environment compatibility. No tarball was created and nothing was published.
