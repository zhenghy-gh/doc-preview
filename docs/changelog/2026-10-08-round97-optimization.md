# Round 97 — Pick the target by CPU profile, then remove 30 million `bytesEqual` calls

Date: 2026-10-08

## Context

Rounds 91–96 worked through a list of suspects assembled by reading the code
(duplicate implementations, then allocation in hot loops). This round starts
from **measurement instead of inspection**: a V8 CPU profile of the real
workload.

```
node --cpu-prof  ×  10 rounds × 27 sample .doc files  (270 parses, 7.65 MB)
```

`dist-lib` is minified, so the profile was taken against a second, unminified
build (`vite build --mode lib --minify false`). Excluding
`tryBrokerFileTokenSync` — a Node filesystem shim that accounted for 33 % of
samples and belongs to the profiling environment, not the library — the real
distribution was:

| self time | function |
| --- | --- |
| 10.69 % | `extractImagesFromStream` |
| 7.00 % | `(garbage collector)` |
| 5.75 % | `createParagraphsWithRealFormats` |
| 3.92 % | `detectCharacterStyles` |
| 3.38 % | `extractShapes` |
| 3.02 % | `guessCharFormat` |
| 2.73 % | `extractFormattedText` |
| 2.52 % | `extractWordArtFromDrawingData` |
| 1.80 % | `bytesToBase64DataUrl` |

`extractImagesFromStream` was the single largest consumer, and the only one
that is a pure leaf-level scan.

## The problem

The scan walked the stream one byte at a time and called `bytesEqual` up to
**four times at every offset** (PNG, JPEG, GIF, BMP):

```ts
while (i < data.length) {
  if (bytesEqual(data, i, PNG_SIGNATURE)) { … }
  if (bytesEqual(data, i, JPEG_SOI) && …) { … }
  if (bytesEqual(data, i, GIF_SIGNATURE_87) || bytesEqual(data, i, GIF_SIGNATURE_89)) { … }
  if (bytesEqual(data, i, BMP_SIGNATURE)) { … }
  i++
}
```

Measured over the 27 sample documents (7.65 MB) that is roughly **30.6 million
`bytesEqual` calls**, while 98 % of byte offsets cannot possibly match any
signature.

## What changed

The four signatures have **distinct first bytes** — `0x89` (PNG), `0xFF`
(JPEG), `0x47` (GIF), `0x42` (BMP) — so at most one of them can match at any
offset. The scan now dispatches on the first byte and only calls `bytesEqual`
once a lead byte has matched:

```ts
for (let i = 0; i < len; i++) {
  switch (data[i]) {
    case PNG_LEAD: { … continue }
    case JPEG_LEAD: { … continue }
    case GIF_LEAD: { … continue }
    case BMP_LEAD: { … continue }
  }
}
```

Each branch ends in `continue`, so the `for`'s `i++` plays the role of the old
explicit `i++`; on a hit the branch sets `i = end - 1` so the increment lands on
`end`, exactly as the old `i = end; continue` did.

The lead bytes are module-level constants derived from the signature arrays
(`PNG_LEAD = PNG_SIGNATURE[0]`, …), so the two cannot drift apart.

### What was tried first, and rejected

The first attempt used `TypedArray#indexOf` to jump between candidate offsets
rather than walking every byte. It is a textbook technique and it is **wrong for
this data**. Measured lead-byte density over the sample corpus:

```
0x89   8 956 hits  (1 in 895)
0xFF 115 352 hits  (1 in  70)
0x47   9 828 hits  (1 in 816)
0x42  25 909 hits  (1 in 310)
candidates total: 160 045  (2.0 % of all bytes)
```

At 2 % density the native scans between candidates traverse about as many bytes
as the naive loop, and pay native call overhead on top: it measured **0.97x** —
no better than the original.

That version also had a defect worth recording. The candidate caches were
refreshed with `if (x < i) x = data.indexOf(lead, i)`, and `-1 < i` is always
true, so whenever a lead byte was **entirely absent** the loop re-searched the
whole remaining buffer on **every** iteration — O(n²). On a 1 MB buffer it did
not finish in **6 minutes**; the shipped O(n) version finishes in ~5 ms. Note
that the differential test passed on this version: it was a *performance* cliff,
not a correctness bug, and the corpus at the time was all small buffers.

## Equivalence evidence

### A. Differential test against the HEAD implementation

The pre-round file was extracted with `git show HEAD:…` and imported side by
side. All exported symbols were compared over:

- hand-built valid **and** malformed images for all four formats (0/1/13/100/5000-byte PNG payloads, truncated JPEGs, GIF with and without the `0x3B` trailer, BMPs at the 54-byte minimum and below);
- concatenations and noise padding, plus **3 000 seeded-fuzz buffers** with signatures injected at random offsets;
- degenerate fills (`0x00`, `0xFF`, `0x89`, `0x47`, `0x42`, interleaved leads) — the exact inputs that expose the cliff;
- **80 real sample variants** (27 `docs/*.doc` files plus their 4 KB / 64 KB / 256 KB prefixes, mirroring the call site's bounded scan window) — **245 images, every byte compared**.

Zero differences, including `bytesToBase64DataUrl` / `imagesToDataUrls` /
`imageFormatMime` over 300 random buffers up to 200 KB.

Two **negative controls** confirmed the harness has teeth: a variant whose
jump start is off by one, and a variant that only considers the PNG/JPEG leads,
were both detected on real sample data.

### B. End-to-end parse output is bit-identical

`bench-diff.mjs` before and after: every report field except
`cycle`/`timestamp` is bit-identical, including all 13 `failures` entries and
their per-sample similarity.

```
median 0.9502433994244857 · p10 0.8968160758834334 · min 0.8115474418758475 · max 0.9999259480622746
```

### C. Micro-benchmark

Isolated, esbuild-bundled Node script (no test-runner overhead), 4 warmup
passes then 5 alternating trials, median of each:

```
                              OLD          NEW
真实样本 27 份 / 7.65 MB       40.0 ms      11.5 ms    3.49x
1 MB 稀疏（无候选）             6.3 ms       1.7 ms    3.77x
256 KB 全 0xFF（病态）          1.7 ms       0.7 ms    2.32x
512 KB 交错首字节               3.6 ms       1.8 ms    2.04x
```

No case regresses, including the degenerate ones.

## New permanent test

`tests/imageExtractor.test.ts` already had 34 cases covering the synthetic
boundaries of all four formats. This round adds
`tests/imageExtractor.golden.test.ts` for the two things synthetic fixtures
cannot cover:

1. **A golden snapshot over real data** — `tests/fixtures/imageExtractor-golden.json`
   records, for each of the 15 sample documents that contain images, the format,
   length and FNV-1a hash of all 126 extracted images. The snapshot was generated
   from the pre-round implementation, which the differential test above had
   already shown to be byte-identical.
2. **A complexity guard** — 1 MB buffers that are entirely `0xFF` / `0x89` /
   `0x47` / `0x42` / `0x00`, and one with the four leads interleaved, must all
   complete within 5000 ms. The shipped implementation takes 14 / 5 / 1 ms, so
   the bound has ~3 orders of magnitude of headroom and will not flake under
   parallel load; the O(n²) variant above exceeded it by more than 6 minutes.

## Verification

- `npx vue-tsc -p tsconfig.json --noEmit` — 0 errors
- `npm run lint` — clean
- `npm run build` — pass
- `npm run build:lib` — pass
- `npm test` — 60 files / 1338 tests pass (round 96 was 59 / 1334; the new
  golden file contributes 4)

## Metrics

Main-bundle gzip: 108.93 kB, i.e. **+0.02 kB** over round 96 (108.91 kB) — the
`switch` is a straight replacement for four `if`s, and the four new constants
are three bytes each after minification.

## Release

`0.7.40 → 0.7.41`, both packages published.

## Next round

The profile names the next targets, in order:

- `createParagraphsWithRealFormats` (5.75 %) — the paragraph-assembly layer.
- `(garbage collector)` at 7.00 % is a *symptom*; the allocators feeding it are
  worth identifying before chasing them.
- `extractShapes` (3.38 %) and `extractWordArtFromDrawingData` (2.52 %) — two
  more leaf scans in the same family as this round's target; check whether they
  repeat the per-offset-signature pattern.
- `bytesToBase64DataUrl` (1.80 %) — the chunked `String.fromCharCode.apply`
  loop could build an array of chunks and join once instead of `+=`-ing a rope.
