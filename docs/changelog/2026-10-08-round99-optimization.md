# Round 99 — Jump to the next lead byte, but only when the lead byte misses

Date: 2026-10-08

## Context

The round-98 CPU profile (270 parses over the 27 sample documents, 7.65 MB,
shim samples excluded) put `extractWordArtFromDrawingData` at **5.25 %** self
time — the clearest remaining member of the leaf-scan family, and the one with
the heaviest per-offset work.

Byte densities measured over the same 7.65 MB corpus:

```
0xE0   10 681 hits   1 in 751   (0.133 %)   ← the WordArt marker lead byte
0x00  3 081 729 hits 1 in   3   (38.426 %)
0x10   24 227 hits   1 in 331
0x4B   31 095 hits   1 in 258
0x4C   10 466 hits   1 in 766
```

The scan is productive on real data, unlike round 98's target: the 27 sample
documents yield **27 WordArt entries across 15 files** when the function is fed
whole `.doc` files (the end-to-end parser passes only the WordDocument stream
and reports 5).

## What the scan did

```ts
for (let offset = 0; offset < data.length - 100; offset++) {
  let match = true
  for (let i = 0; i < wordArtMarker.length; i++) {          // 4 bytes
    if (data[offset + i] !== wordArtMarker[i]) { match = false; break }
  }
  if (!match) continue
  /* … terminator search, then the candidate body … */
}
```

Every offset paid for a loop skeleton, a `match` flag and a bounds-checked
`Uint8Array` element read to reject a lead byte that matches 0.133 % of the
time. A second inner loop (`magicPattern`, eight zero bytes) ran inside the
terminator search.

## What changed

Three things, in one loop:

1. **Flatten the marker test.** `recType`-style inner loops are replaced by
   direct comparisons against a named lead-byte constant:
   `if (data[offset] !== WORDART_MARKER_LEAD)` then the three tail bytes.
2. **Jump over runs of non-lead bytes.** When the lead byte does not match,
   `data.indexOf(WORDART_MARKER_LEAD, offset + 1)` skips straight to the next
   candidate instead of walking there one byte at a time.
3. **Flatten the terminator search** into an `isZeroRun(data, offset)` helper,
   which also drops the two `new Uint8Array` allocations per call.

The `for` loop became a `while` so that `offset++` could move into each branch,
letting the "lead byte does not match" branch skip ahead. It covers exactly the
same offset set `{0 … data.length - 101}` as before, and the `endOffset + 8`
skip-ahead became `endOffset + 9` because the old `for`'s increment used to
apply on top of it.

### Why the jump is conditional, and why that matters

The obvious version — jump on *every* iteration — is the fastest thing measured
on the corpus and a disaster on one degenerate input:

```
                        pure byte loop   jump always   jump only on miss
real corpus, 7.65 MB        11.9 ms        2.9 ms          2.9 ms
                            —              5.31x           5.20x
1 MB of 0xE0                 1.8 ms       10.2 ms          1.3 ms
                            —              0.26x           1.89x
```

When the buffer is *all* `0xE0`, every offset is a lead-byte hit, so "jump
always" pays a native call per byte and loses 5.5x against the code it replaced.
Guarding the jump on `data[offset] !== WORDART_MARKER_LEAD` removes the
regression entirely: in the dense case the loop never enters the jump branch and
degrades to the plain byte loop, and in the sparse case it jumps once per 751
bytes. Both numbers are obtained at once.

### Correction to round 98

Round 98 rejected an `indexOf`-based variant and attributed the loss to a
claimed `0x00` density of 0.39 %. That figure was wrong — `0x00` is **38.4 %**
of the corpus, so round 98's variant was paying native call overhead on nearly
every byte and the result said nothing about jumping at low density. The
`indexOf` measurement was redone here on a byte with 0.133 % density and it
wins 5.3x. Round 98's changelog carries a correction note.

## Equivalence evidence

### A. Differential test against the HEAD implementation

The pre-round file was extracted with `git show HEAD:…` and imported side by
side. `extractWordArtFromDrawingData` was compared over:

- every marker placement of interest, including the last valid offset
  (`data.length - 101`), the first invalid one (`data.length - 100`) and offsets
  where only four bytes remain;
- every single-byte deviation of the four-byte marker (wrong lead byte ×4,
  each tail byte wrong ×2) — each must yield nothing;
- terminator distances 100 / 101 / 110 / 5099 / 5100 / 5101 / beyond, plus the
  no-zero-run-at-all case where `endOffset` stops at `offset + 5000`;
- zero runs truncated by the end of the buffer (tail 0…8), which must not be
  treated as matches;
- the skip-ahead path (`endOffset + 9`) with second markers placed inside and
  after the first candidate's `artData`;
- markers every 4 bytes, all-zero buffers, all-`0xE0` buffers, every offset a
  marker;
- **3 000 seeded-fuzz buffers** (200–6 200 bytes) with markers and zero runs
  injected at random offsets;
- degenerate fills (`0x00`, `0xE0`, `0xFF`, `0x10`, `0x4B`, `0x4C`, `0x20`,
  `0x89`) and lengths 0…200;
- **80 real sample variants** (27 `.doc` + 4 KB / 64 KB / 256 KB prefixes) —
  **27 WordArt entries, every field compared**.

Also compared, unchanged but touched by the same module: `extractWordArtFromDirectory`
(including a `null` stream reader and a reader that throws) and `getEffectLabel`
for every known label plus unknown values. Zero differences.

### B. Negative controls

Three deliberately-broken scans (lead byte only, start offset shifted by one,
terminator shortened to four zeros) were built as a full copy of the pre-round
module. All three are caught on the real corpus — the differential test has
teeth here, which is exactly what round 98 could not achieve.

One control initially failed for an instructive reason. A synthetic sample of
pure `0xE0` does **not** discriminate the "lead byte only" bug, because a
candidate is only kept when `text || effects.length > 1 || colors.length > 0`,
and a run of `0xE0` satisfies none of the three — so the buggy version produces
the same empty result. The control was redesigned around an `0xFF`-filled
buffer with bare `0xE0` bytes, where `extractColorsFromData` recognises
`#ffffff` and the false candidates survive. The non-discriminating sample is
kept as its own assertion, so the trap is documented rather than just avoided.

### C. End-to-end parse output is bit-identical

`bench-diff.mjs` cycle-990 versus cycle-980: every field except
`cycle`/`timestamp` is bit-identical.

```
median 0.9502433994244857 · p10 0.8968160758834334 · min 0.8115474418758475 · max 0.9999259480622746
```

### D. Micro-benchmark

Isolated, esbuild-bundled Node script, 4 warmup passes then 5 alternating
trials, median of each:

```
                                        OLD        NEW
real corpus 27 files / 7.65 MB         13.9 ms     2.6 ms    5.34x
real corpus prefixes 4K/64K/256K        6.5 ms     1.1 ms    5.76x
1 MB sparse random                      1.8 ms     0.3 ms    5.29x
1 MB all 0xFF                           1.8 ms     0.3 ms    6.76x
1 MB all 0xE0                           2.5 ms     1.3 ms    1.89x
1 MB all 0x00                           1.8 ms     0.3 ms    6.97x
1 MB marker every 16 bytes             17.1 ms    16.6 ms    1.03x
1 MB bare 0xE0 every 16 bytes           2.4 ms     1.0 ms    2.46x
256 KB marker every 4 bytes          2707 ms    2651 ms      1.02x
```

No case regresses. The two near-flat rows are dominated by per-candidate work
(`detectDataEffectMask`, `extractTextFromData`, `extractColorsFromData`), which
this round does not touch.

## A pre-existing worst case, found and not fixed

The `256 KB marker every 4 bytes` row takes **2.6 seconds in every variant**,
old and new. The cause is structural: the terminator search scans up to 5 000
bytes forward from each candidate, and the skip-ahead only fires when the
candidate is *kept*. A buffer dense with `E0 00 00 00` markers that never
satisfy the keep condition therefore costs O(n/4 × 5 000) — 328 million inner
iterations for 256 KB. On a 1 MB WordDocument stream that is roughly 11 seconds.

Real documents do not trigger it: the marker requires four specific bytes and
`0xE0` is 0.133 % of the corpus, so only 42 candidate offsets exist across all
7.65 MB. It is a robustness concern for a publicly exported function, not a
practical one. Fixing it means making the terminator search amortised (the
search windows are monotone in `offset`, so a forward-only pointer over the zero
runs would work), which is a new algorithmic structure rather than a
local rewrite. Recorded, not attempted.

## New permanent test

`tests/wordArtParser.golden.test.ts` (5 cases) covers what
`tests/wordArtParser.test.ts` cannot:

1. **A golden snapshot over real data** — `tests/fixtures/wordArtParser-golden.json`
   records all 27 WordArt entries extracted from the 27 sample documents, field
   by field. It was generated from the pre-round implementation, which the
   differential test had already shown to be byte-identical, and it is the
   permanent guard against the jump skipping or mis-placing a candidate.
2. **A complexity guard** — 1 MB buffers (uniform fills including the densest
   possible lead byte, a real marker every 16 bytes, a bare `0xE0` every 16
   bytes, and a buffer with no candidates at all) must each complete within
   5000 ms. The shipped implementation takes 1–17 ms, so the bound has two to
   three orders of magnitude of headroom and will not flake under parallel load.

## Verification

- `npx vue-tsc -p tsconfig.json --noEmit` — 0 errors
- `npm run lint` — clean
- `npm run build` — pass
- `npm run build:lib` — pass
- `npm test` — 62 files / 1350 tests pass

## Metrics

Main-bundle gzip: 108.95 kB, i.e. **+0.01 kB** over round 98 (108.94 kB) — the
`while`/`indexOf` rewrite is a few bytes, and the removed inner loops offset the
added helper.

## Release

`0.7.42 → 0.7.43`, both packages published.

## Next round

- `createParagraphsWithRealFormats` (9.83 %) is the largest single library
  function. It is an assembly layer, not a scan, and needs a different kind of
  analysis.
- `extractEquationsFromWordDocumentStream` (3.78 %) yields **zero** equations
  across all 27 samples, exactly like round 98's target did for shapes — another
  scan that burns CPU producing nothing. Worth checking whether its gate is
  similarly over-strict before optimising it.
- Four functions (`extractShapes`, `extractWordArtFromDrawingData`,
  `extractEquationsFromWordDocumentStream`, `extractChartsFromWordDocumentStream`)
  each make an independent full pass over the *same* WordDocument stream. One
  merged pass would remove three of them, but it is a large refactor; measure
  the combined cost first.
- `bytesToBase64DataUrl` (1.73 %) still builds a rope with `+=`.
- `(garbage collector)` at 12.76 % remains a symptom; the heap profile has not
  yet pointed at a single dominant allocator inside the library.
