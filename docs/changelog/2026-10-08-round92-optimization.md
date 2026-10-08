# Round 92 — Dedupe live scoring/formatting/byte helpers and chart type family

Date: 2026-10-08

## Method

Round 91 removed the same-named *function* duplicates. This round widened the
net: a normalised (whitespace/comment-stripped) **≥6-line block** scan across
`src/`, cross-referenced by file, to find duplicated *logic* even when the
surrounding function names differ.

`src/utils/docparser/formatRecovery.ts` was excluded from the scan: it is the
parked, unreferenced WIP module (see round 91), and most of its "duplicates"
are simply a stale mirror of `docParser.ts`.

## What changed

### 1. `scorePlainText` — duplicated verbatim in the live path

`encodingDetector.ts:191` (`export function scorePlainText`) and
`DocParser.prototype.scorePlainText` (`docParser.ts:1765`) were **line-for-line
identical** — the same paragraph-splitting, English-word / CJK counting and
scoring weights.

`docParser.ts` already delegates to `encodingDetector` through `enc*`-prefixed
aliases (`encDetectEncodingFromBinary`, `encScoreRawParagraphs`, …). The method
now follows that same pattern:

```ts
scorePlainText(text: string): number {
  return encScorePlainText(text)
}
```

The method stays public — `tests/docParser.test.ts` calls it directly.

### 2. `formatRevisionTime` — duplicated verbatim across the UI/parser boundary

`revisionRender.ts:47` (exported) and `DocPreview.vue:455` (local) were
identical. `DocPreview.vue` only imported the *type* `RevisionMode` from
`revisionRender`; it now imports the function too and the local copy is gone.
`revisionRender` was already in the bundle via
`rendering/documentRenderer.ts`, so this adds no module.

### 3. `bytesEqual` — duplicated between the two image modules

`imageExtractor.ts` and `pictureParser.ts` each had a private `bytesEqual`.
`pictureParser.ts` already imported from `imageExtractor`, so the function is
now exported from `imageExtractor` and imported.

### 4. `readWordAt` / `readDwordAt` — unguarded twins of `readUint16` / `readUint32`

`sectionParser.ts` defined `readWordAt` (`(d[o] | d[o+1] << 8) >>> 0`) and
`readDwordAt` (`(…) >>> 0`); `fibParser.ts` defined another `readDwordAt`.
All three are exactly `readUint16` / `readUint32` minus the bounds guard, which
only differs on **negative** offsets (positive out-of-range reads give
`undefined` → `0` under bitwise ops in both variants).

Every call site is provably non-negative:

- `fibParser`: offsets are the literals `24`/`28`, `fibRgLwStart + 12…40`, or
  `blobStart + pair * 8` with `pair >= 0`. Tracing the chain:
  `csw = data[32] | (data[33] << 8)` ∈ [0, 65535] ⇒ `fibRgWEnd = 34 + csw*2 >= 34`
  ⇒ `fibRgLwStart >= 36` ⇒ `fibRgLwEnd >= fibRgLwStart + 4` ⇒ `blobStart >= 42`.
- `sectionParser`: `parsePlcfSed` returns early on `fc < 0`; every other offset
  is `fc + (i+1)*4` (`i >= 0`), `offset + 2` (`offset = fc + (n+1)*4`, `n > 0`),
  or `fcSepx` — itself produced by an *unsigned* `readDwordAt`.

Both files now import `readUint16` / `readUint32` from `binaryReader` and the
three local helpers are gone.

### 5. `ChartType` / `ChartSubtype` / `ChartInfo` — declared twice

`chartParser.ts` re-declared all three, structurally identical to
`docFormat.ts` (only the JSDoc differed). `docFormat.ts` imports nothing from
`chartParser`, so there is no cycle. `chartParser.ts` now does

```ts
import type { ChartType, ChartSubtype, ChartInfo } from './docFormat'
export type { ChartType, ChartSubtype, ChartInfo }
```

which keeps `docParser.ts`'s `import type { ChartInfo } from './chartParser'`
working unchanged.

## Deliberately not changed

These look like duplicates but are not:

| pair | why it stays |
| --- | --- |
| `escapeHtml` (`textRender.ts` vs `tableText.ts`) | DOM-based `div.innerHTML` escapes only `&<>`; the string version also escapes `"` and `'` (it is used inside attributes). Merging would change output. |
| `findPngEnd` / `findJpegEnd` / `findGifEnd` / `findBmpEnd` (`imageExtractor` vs `pictureParser`) | the `pictureParser` versions take a `maxLen` clamp, and its `findJpegEnd` has no SOS / entropy-segment handling. |
| `readUtf16leString` ×3 (`revisionParser` / `fontParser` / `styleParser`) | third parameter means *character count* in two of them and *byte length* in `styleParser`. |
| `twipsToPt` ×2 (`formatParser` vs `sectionParser`) | `Math.round((twips/20)*100)/100` vs plain `twips/20`. |

## Verification

- Full suite: 59 files / **1334 tests** pass.
- `npm run lint` passes; `npm run build` (`vue-tsc` + Vite) passes.

## Bundle size

App-form `npm run build` main bundle: **109.08 → 108.76 kB gzip (−0.32 kB)**.

## Release

Version bumped `0.7.35 → 0.7.36` and published to both package names.
