# Round 86 — Single-pass table info scan + dual-package publish script

Date: 2026-10-08

## 1. `renderTableHtml` — fuse five `rowsTableInfo` scans into one

`renderTableHtml` previously walked `rowsTableInfo` five times: two `some`
(`hasCellInfo`, `hasTableBorders`) plus three `find` (table borders,
justification, indent). The five selections are independent, so they now run
in a single indexed loop with an early exit once all are resolved.

Semantics are preserved exactly: each field keeps first-match-wins, and the
three style fields may still come from different rows. `hasCellInfo` changes
type from `boolean | undefined` to `boolean`, which is only ever used in
boolean contexts.

## 2. `collectTableBlock` — drop filtered count arrays

Added a private `countNonEmptyCells(cells)` helper and replaced four
`array.filter(...).length` calls (rows loop + header heuristic + header row
render) that allocated an intermediate array purely to measure its length.

## Verification

- `tests/tableText.test.ts`: 61 tests pass (59 → 61, two new regression tests
  pinning the fused-selection contract: fields sourced from different rows,
  and first-match-wins when several rows declare borders).
- Full suite: 59 files / **1334 tests** pass.
- `npm run lint`: pass. `npm run build` (`vue-tsc` + Vite): pass.
- Main JS gzip 108.98 kB.

## 3. Publish script — dual-package release

`scripts/publish.mjs` already published both `@zhenghy/doc-preview` (scoped)
and `doc-preview` (unscoped) from one codebase, but was not wired into
`package.json`. Changes:

- Added `npm run release` / `npm run release:dry` scripts.
- Build once, then publish both names with `--ignore-scripts` to avoid
  re-running `prepublishOnly` (i.e. `build:lib`) per package name.
- Restore `package.json` on `SIGINT` / `SIGTERM` / `SIGHUP` / `exit`, not just
  on the normal path.
- Added `--tag=<dist-tag>` support; `.package.json.bak` is now gitignored.
- Verified with `npm run release:dry -- --no-build`: both targets processed,
  tarball 13 files / 883.9 kB unpacked, `package.json` restored automatically.

Note: the lib build output is name-independent (`vite.config.ts` hardcodes
`lib.name: 'DocPreview'` and `fileName: 'doc-preview'`), so both package names
correctly share a single `dist-lib`.

## 4. README rewrite (npm intro page)

Rewrote `README.md` and `README.en.md` to be short and practical, dropping the
long prose sections (comparison table, architecture walkthrough, project tree,
AI-development note).

Two real documentation bugs were fixed in the process:

- **CDN paths were wrong.** The published tarball only contains `dist-lib/`
  (`files: ["dist-lib"]`), but the README pointed at
  `unpkg.com/.../dist/style.css` and `/dist/doc-preview.js` — those 404.
  Corrected to `dist-lib/...`.
- **`parseDocFileWithFormat` signature was wrong.** The second parameter is
  `debug?: boolean`, not an options object with `onProgress`. The example and
  the export table were corrected against `src/utils/docParser.ts`.

Test count in the docs was also updated (1278 → 1334).
