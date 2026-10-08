# Round 91 — Consolidate duplicated little-endian integer readers

Date: 2026-10-08

## What changed

### The duplication

A repo-wide scan for same-named function definitions found the little-endian
integer readers copy-pasted across the parsers:

| function | copies | files |
| --- | --- | --- |
| `readUint16` | **10** | revisionParser, equationParser, formatParser, fontParser, propertyParser, styleParser, listParser, shapeParser, pictureParser, docparser/clxReader |
| `readUint32` | **9** | fieldParser, revisionParser, equationParser, formatParser, propertyParser, listParser, shapeParser, pictureParser, docparser/clxReader |
| `readInt16` | 2 | formatParser, listParser |
| `readInt32` | 2 | propertyParser, shapeParser |

That is **23 local definitions** of four trivial functions.

### Why they could be merged safely

Only two of the 23 copies actually differed from the "canonical" body:

- `equationParser.ts` — missing the `offset < 0` guard, and its `readUint32`
  had no `>>> 0` (so it returned a *signed* value).
- `propertyParser.ts` — no bounds guard at all.

Both differences are unreachable-divergence only:

1. **Positive out-of-bounds offsets** return `0` in every variant. Reading past
   the end of a `Uint8Array` yields `undefined`, and `undefined` coerces to `0`
   under bitwise operators, so the unguarded body produces the same `0` as the
   guarded one.
2. **Negative offsets** are the only case where the bodies diverge — and every
   call site passes a non-negative offset (loop indices, validated table
   offsets, literal `0`/`24`/`44`).
3. For `equationParser.readUint32(data, 0)`: the signed result is only ever
   tested with `length > 0 && length < data.length`. When `data[3] >= 0x80`
   the signed value is negative (fails the first test) and the unsigned value
   is `>= 2^31` (fails the second, since a `Uint8Array` length is never that
   large). Both branches therefore skip identically.

The `& 0xFFFF` in `clxReader.readUint16` is redundant — the two byte terms can
only produce `0x0000`–`0xFFFF`.

### The change

- New module `src/utils/binaryReader.ts` with a single canonical
  `readUint16` / `readUint32` / `readInt16` / `readInt32`, documented with the
  boundary contract (`out-of-range → 0`, never throws).
- The 11 parser files now import from it instead of defining their own copy.
- `docparser/clxReader.ts` **re-exports** `readUint16` / `readUint32` from
  `binaryReader` so the existing import contract in `docParser.ts`
  (`readUint16 as clxReadUint16, readUint32 as clxReadUint32`) is unchanged.

23 definitions → 4.

## Deliberately not changed

The scan also surfaced two genuinely-unreferenced modules:

- `src/utils/docparser/formatRecovery.ts` (991 lines) — `BENCH.md` marks it as
  "未接线 WIP" and `docs/wip-parking/` holds snapshots of it.
- `src/components/DocStatsPanel.vue` — `docs/ui-kit/` records it as a
  "死组件，待裁决：恢复挂载 or 移除".

Both are **parked product decisions**, not optimisation targets, and neither is
reachable from an entry point, so Rollup already tree-shakes them out of the
bundle — deleting them would not shrink the package. Left untouched.

`imageExtractor.ts` / `pictureParser.ts` share `bytesEqual`, `findPngEnd`,
`findJpegEnd`, `findGifEnd`, `findBmpEnd` **by name only**: the picture-parser
versions take a `maxLen` clamp and its `findJpegEnd` has no SOS/entropy-segment
handling. Merging them would change behaviour, so they were left alone.

## Verification

- Full suite: 59 files / **1334 tests** pass.
- `npm run lint` passes; `npm run build` (`vue-tsc` + Vite) passes.

## Bundle size

App-form `npm run build` main bundle: **109.27 → 109.08 kB gzip (−0.19 kB)**.
First decrease after several rounds of small increases — the dedup removes 19
function bodies from the bundle.

(Library-form `build:lib` also shrank: `doc-preview.js` 360.8 → 350.72 kB raw.)

## Release

Version bumped `0.7.34 → 0.7.35` and published to both package names.
