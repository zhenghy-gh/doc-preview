# Round 93 — Dedupe the Word palette, the SPRM spra switch and image signatures

Date: 2026-10-08

## Method

Two more scanners on top of round 92's ≥6-line block diff:

- **same-value module-level constants** — `const NAME = <array|object literal>`
  grouped by normalised *value*, which catches copies that were renamed
  (`GIF_SIGNATURE_87` vs `GIF87`). The first version of this scan had a bug:
  it did not strip trailing `//` comments, so every commented constant was
  silently missed. Fixed and re-run.
- a full listing of the ≥8-line block diff (round 92 only looked at the top 16).

## What changed

### 1. The Word 16-colour palette existed in three places

| location | form |
| --- | --- |
| `formatParser.ts` — `SHD_COLOR_MAP` | object literal, paragraph shading |
| `rendering/paragraphStyleRenderer.ts` — `BORDER_COLOR_MAP` | object literal, table borders |
| `tableText.ts` — `colorIndexToCss()` | 16 `case` arms in a `switch` |

All three were index 1–16 → the same sixteen colours in the same order. They
now share `WORD_COLOR_PALETTE` from the new `src/utils/wordPalette.ts`.

`tableText.colorIndexToCss` became
`(idx !== undefined && WORD_COLOR_PALETTE[idx]) || '#000000'` — same fallback
for `undefined` / out-of-range indices.

**Deliberately not merged:** `formatParser.highlightColor()` (the
`sprmCHighlight` palette) uses a *different* index order — 1=Yellow,
2=BrightGreen, …, 15=Black, default Yellow. The two palettes are unrelated; the
new module documents this so a future round does not "helpfully" merge them.

### 2. `getSectionSprmOperandSize` duplicated `getSprmOperandSize`'s spra switch

`sectionParser.ts` carried an 18-line copy whose own comment said
"与 formatParser.getSprmOperandSize 一致".

It is *almost* the same function: it lacks the two special cases
`sprmTDefTable` (0xD608) and `sprmPTableDepth` (0x4410). Those codes are table
SPRMs and do not occur in a section's SPRM domain — but a malformed `grpprl`
can contain any two bytes, so a blind delegation would change behaviour on such
input (`spra` for 0xD608 is 6, for 0x4410 is 2).

So instead of merging the *functions*, the pure spra switch was **moved** into
`formatParser.getSprmOperandSizeBySpra`, and both callers use it:

- `getSprmOperandSize` keeps its two special cases and delegates at the end.
- `sectionParser` calls `getSprmOperandSizeBySpra` directly, preserving its
  original (special-case-free) semantics exactly.

This is a branch-for-branch move, not a semantic merge.

### 3. Image magic-number signatures declared twice

`PNG_SIGNATURE`, `JPEG_SOI`, `GIF_SIGNATURE_87`, `GIF_SIGNATURE_89` existed in
both `imageExtractor.ts` and `pictureParser.ts` (the latter under the names
`GIF87` / `GIF89`). `imageExtractor.ts` now exports all of them plus a new
`BMP_SIGNATURE`, and `pictureParser.ts` imports them.

`imageExtractor`'s inline BMP test (`data[i] === 0x42 && data[i+1] === 0x4D`)
now uses `bytesEqual(data, i, BMP_SIGNATURE)` — equivalent, including the
past-the-end case (`bytesEqual` returns `false` when `offset + 2 > data.length`,
matching the `undefined` comparison).

## Deliberately not changed

- `escapeHtml` ×2, `findPngEnd`/`findJpegEnd`/`findGifEnd`/`findBmpEnd` ×2,
  `readUtf16leString` ×3, `twipsToPt` ×2 — see round 92's changelog; each pair
  has genuinely different semantics.
- The remaining duplicate **type** declarations (`ShapeType`/`ShapeAnchorType`
  in `shapeParser.ts` vs `docFormat.ts`; `Piece` in `docParser.ts` vs
  `pieceTable.ts`; `DocumentStories` in `docParser.ts` vs `storySplitter.ts`;
  the `PageFieldInfo` / `CrossReferenceInfo` / `DocumentProperties` field
  blocks in `fieldParser.ts` vs `docFormat.ts`). These are type-only, so they
  are erased at build time and cannot move the bundle number; they are left for
  a dedicated hygiene round.

## Verification

- Full suite: 59 files / **1334 tests** pass.
- `npm run lint` passes; `npm run build` (`vue-tsc` + Vite) passes.

## Bundle size

App-form `npm run build` main bundle: **108.76 → 108.56 kB gzip (−0.20 kB)**.

## Release

Version bumped `0.7.36 → 0.7.37` and published to both package names.
