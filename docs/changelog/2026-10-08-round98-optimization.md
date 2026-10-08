# Round 98 — Reorder the FDG gates, and find out why the shapes feature never fires

Date: 2026-10-08

## Context

Round 97 introduced CPU-profile-driven target selection. Re-running it for this
round (270 parses over the 27 sample documents, 7.65 MB) reproduced the same
picture, with `extractImagesFromStream` now down from 10.69 % to 3.28 % of
non-shim samples after round 97's lead-byte dispatch:

| self time (excl. shim) | function |
| --- | --- |
| 12.76 % | `(garbage collector)` |
| 9.83 % | `createParagraphsWithRealFormats` |
| 7.21 % | `detectCharacterStyles` |
| **6.56 %** | **`extractShapes`** |
| 5.60 % | `applyStructuralFormats` |
| 5.25 % | `extractWordArtFromDrawingData` |
| 4.74 % | `extractFormattedText` |
| 4.64 % | `guessCharFormat` |
| 3.78 % | `extractEquationsFromWordDocumentStream` |
| 3.53 % | `detectParagraphFormat` |
| 3.28 % | `extractImagesFromStream` |

A sampling heap profile (`--heap-prof --heap-prof-interval=2048`) was also taken
to attack the `(garbage collector)` line, which is a symptom rather than a
cause. Module loading dominated it (`readFileSync` 18.7 %, `decode` 13.1 %,
`wrapSafe` 6.4 %); the largest library allocators were `parsePapxGrpprl`
(182 KB), `parseFdg` (166 KB) and `parseFormatRuns` (90 KB). Nothing there
justified a round on its own, so the round went to `extractShapes`.

## What the scan does

```ts
for (let offset = 0; offset < data.length - 8; offset++) {
  const magic = readUint16(data, offset)
  if ((magic & 0xC000) !== 0xC000) continue

  const header = parseOfficeArtRecordHeader(data, offset)
  if (!header) continue

  if (header.recType === OFFICE_ART_FDG) { /* parseFdg(data, offset) */ }
}
```

Measured over the 27 sample documents (8.0 MB scanned across the Data and
WordDocument streams):

```
(0xC000 gate)  passes 678 221 offsets   8.457 %
recType==0xF000 passes     751 offsets   0.0094 %
offsets passing both:       49
```

So the 16-bit mask admits 8.457 % of offsets, and each admitted offset pays for
a full record-header parse — **678 221 header parses to reach 49 real
candidates**.

## What changed

`OFFICE_ART_FDG` is `0xF000`, and `recType` is read as
`data[o + 2] | (data[o + 3] << 8)`. Therefore
`recType === OFFICE_ART_FDG` is *exactly*
`data[o + 2] === 0x00 && data[o + 3] === 0xF0` — and that is a **necessary
condition** of the existing `header.recType === OFFICE_ART_FDG` test.

Adding it as a pre-filter ahead of the 16-bit mask therefore cannot change
which offsets reach `parseFdg`: it only decides who pays for the header parse.
The equivalence argument is one line — the added predicate is implied by a
predicate that was already required.

```ts
const FDG_TYPE_LO = OFFICE_ART_FDG & 0xff        // 0x00
const FDG_TYPE_HI = (OFFICE_ART_FDG >> 8) & 0xff // 0xF0

for (let offset = 0; offset < data.length - 8; offset++) {
  if (data[offset + 2] !== FDG_TYPE_LO || data[offset + 3] !== FDG_TYPE_HI) continue
  const magic = readUint16(data, offset)
  if ((magic & 0xC000) !== 0xC000) continue
  /* … unchanged … */
}
```

The two constants are derived from `OFFICE_ART_FDG` rather than written as
literals, so they cannot drift apart.

### The 0xC000 mask is not a necessary condition — do not delete it

The mask tests `(data[offset + 1] & 0xC0) === 0xC0`, i.e. the top two bits of
`recInstance`'s low byte. MS-ODRAW specifies `recInstance = 0` for
`OfficeArtFDG`, so **the mask rejects spec-conformant FDG records**. It is a
historical over-filter, and deleting it is a behaviour change, not an
optimisation. That is why the round *adds* a pre-filter instead of *replacing*
the mask.

This is not a new discovery — `tests/shapeParser.test.ts` has always documented
the workaround in its fixture builder:

```ts
// FDG — recInstance bit 6-7 set (0x00C0) so the little-endian magic scan
// `(readUint16 & 0xC000) === 0xC000` in extractShapesFrom* matches.
writeRecHeader(buffer, off, 3, 0x00C0, 0xF000, fdgLen)
```

### Rejected: `indexOf` jumping

The first variant to be measured jumped between candidate offsets with
`Uint8Array#indexOf(0x00, …)`. `0x00` has a density of 0.39 % in the corpus —
well under the ~2 % threshold that made `indexOf` jumping lose in round 97 — so
it looked promising. It is not:

```
                           OLD        NEW        IDX
real corpus, 7.65 MB      18.6 ms    13.9 ms    30.3 ms
                           —          1.34x      0.61x
1 MB uniform fills        ~5.8 ms    ~1.9 ms    ~0.3 ms
                           —          ~3.1x      ~22x
1 MB FDG header every 16B   3.2 ms     2.6 ms     9.5 ms
                           —          1.19x      0.34x
```

The `indexOf` variant is **faster than the old code on nothing that resembles
real data** — 0.61x on the corpus, 0.34x on dense headers — and only looks
spectacular on uniform fills, where a single native call can skip the whole
buffer. Same lesson as round 97, one round later: *the headline number of a
jump-based scan comes from the inputs it is worst at.* Rejected.

## Equivalence evidence

### A. Differential test against the HEAD implementation

The pre-round file was extracted with `git show HEAD:…` and imported side by
side; `extractShapesFromDataStream` and `extractShapesFromWordDocumentStream`
were compared over:

- a parameter matrix of synthetic `FDG → DG → SP` chains (5 spids × 3 `grfSp` ×
  2 ClientData × 2 picture sets × 6 `spRecLen` = 360 buffers), including the
  `spRecLen < 72` cases that produce nothing;
- FDG-shaped records that the 16-bit mask **rejects** (`recInstance` low byte
  `0x00/0x3F/0x7F/0x80`) — these are exactly the offsets the new pre-filter
  newly lets through, so they are the load-bearing cases;
- `recVer` / `recType` / `recLen` variants, including `recLen = 0xffffffff`;
- concatenated chains with duplicate spids (dedup path);
- **3 000 seeded-fuzz buffers** (64–4 096 bytes, random content) with 0–3 FDG
  headers injected at random offsets and random `recInstance`s;
- degenerate fills (`0x00`, `0x0F`, `0x3F`, `0xC0`, `0xF0`, `0xFF`, `0x89`,
  `0x47`, `0x42`), an FDG header every 4 bytes, and FDG headers flush against
  the buffer end;
- **80 real sample variants** (27 `.doc` + 4 KB / 64 KB / 256 KB prefixes).

Zero differences.

### B. Negative controls — and a finding about the corpus

Four deliberately-broken scan loops were built (byte positions swapped, an extra
necessary condition added, and the 16-bit mask dropped) and compared against the
shipped implementation. Two of them are caught on synthetic chains. **All three
produce output identical to the shipped code on the real corpus**, because the
corpus yields `[]` no matter what the predicate says:

```
real corpus, 27 samples:
  swap     diverged 0/27
  strict   diverged 0/27
  nomask   diverged 0/27
```

That is the round's most important methodological result: **the real corpus has
zero discriminating power for this function.** Any change to the FDG predicate
— including the "obviously correct" removal of the over-strict mask — is
invisible end-to-end, because the mask makes the whole scan a no-op. Equivalence
evidence here has to be carried by synthetic structures, and the round's
negative controls are built accordingly. `tests/shapeParser.fdgScan.test.ts`
pins the behaviour so a future fix has to be a deliberate, visible decision.

### C. End-to-end parse output is bit-identical

`bench-diff.mjs` cycle-980 versus cycle-970: every field except
`cycle`/`timestamp` is bit-identical.

```
median 0.9502433994244857 · p10 0.8968160758834334 · min 0.8115474418758475 · max 0.9999259480622746
```

### D. Micro-benchmark

Isolated, esbuild-bundled Node script, 4 warmup passes then 5 alternating
trials, median of each:

```
                                        OLD        NEW
real corpus 27 files / 7.65 MB         18.6 ms    13.9 ms    1.34x
real corpus prefixes 4K/64K/256K        8.5 ms     6.7 ms    1.27x
synthetic FDG chain (enters parseFdg)   0.18 ms    0.18 ms   1.00x
1 MB uniform fill (0x00/0xF0/0xC0/0xFF) ~5.8 ms   ~1.9 ms    ~3.1x
1 MB FDG header every 16 bytes          3.2 ms     2.6 ms    1.19x
256 KB FDG header every 4 bytes         2.5 ms     1.6 ms    1.54x
```

No case regresses. The synthetic-chain case is flat by construction — it is
dominated by `parseFdg`, which this round does not touch.

## New permanent test

`tests/shapeParser.fdgScan.test.ts` (7 cases) covers what
`tests/shapeParser.test.ts` cannot:

1. **The gate's existing contract** — `recInstance` low byte with the top two
   bits set is extracted; spec-conformant `recInstance = 0` is **not**, with a
   comment stating that this records current behaviour rather than desired
   behaviour, so a future fix fails loudly and deliberately.
2. **A complexity guard** — 1 MB buffers (uniform fills, an FDG header every
   16 bytes) and a 256 KB buffer with a header every 4 bytes must each complete
   within 5000 ms. The shipped implementation takes 2–3 ms, so the bound has
   roughly three orders of magnitude of headroom and will not flake under
   parallel load, while still catching any super-linear regression.

## Verification

- `npx vue-tsc -p tsconfig.json --noEmit` — 0 errors
- `npm run lint` — clean
- `npm run build` — pass
- `npm run build:lib` — pass
- `npm test` — 61 files / 1345 tests pass

## Metrics

Main-bundle gzip: 108.94 kB, i.e. **+0.01 kB** over round 97 (108.93 kB) — two
`data[offset + n] !== CONST` tests replacing a `readUint16` call in the common
path, and two constants that fold to immediate operands.

## Release

`0.7.41 → 0.7.42`, both packages published.

## Next round

The profile, minus what rounds 97–98 removed:

- `createParagraphsWithRealFormats` (9.83 %) is now the largest single library
  function. It is the paragraph-assembly layer, not a leaf scan, so it needs a
  different kind of analysis than the last two rounds.
- `extractWordArtFromDrawingData` (5.25 %) is the clearest remaining member of
  the same family: it runs a **four-iteration inner loop with a `match` flag**
  at every offset to compare a four-byte marker, and an **eight-iteration inner
  loop** to find a run of zeros, plus two `new Uint8Array` allocations per call.
  Flattening both to direct byte comparisons should behave like round 97's
  dispatch. `extractShapes` measured 1.34x on the corpus from a similar change;
  wordArt's inner loops are heavier per offset, so the headroom is larger.
- `extractEquationsFromWordDocumentStream` (3.78 %) and
  `extractChartsFromWordDocumentStream` (0.48 %) scan the *same* WordDocument
  stream independently of `extractShapes`. Four full passes over the same buffer
  is a structural redundancy, but merging them is a large refactor with real
  risk — worth measuring before attempting.
- `bytesToBase64DataUrl` (1.73 %) still builds a rope with `+=` over chunked
  `String.fromCharCode.apply`.
- `(garbage collector)` at 12.76 % remains a symptom; the heap profile has not
  yet pointed at a single dominant allocator inside the library.
