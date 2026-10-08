# Round 95 — Remove per-paragraph allocations in `textHeuristics`

Date: 2026-10-08

## Context

Round 94 removed the **per-character** allocations inside
`docparser/heuristics/textHeuristics.ts`. This round removes the
**per-paragraph** ones: `guessCharFormat`, `detectListInfo` and
`detectAlignment` are each called once per paragraph, and each of them was
allocating several whole-string temporaries (`trim()`, `trimStart()`,
`trimEnd()`, `replace(/\s/g,'')`, `match(/…/g)`) purely to read a length or a
count.

The same file also held ~22 regex literals **inside function bodies**. A regex
literal is re-evaluated on every execution, so every one of these created a
fresh `RegExp` object per paragraph.

## What changed

### 1. Per-paragraph string temporaries → single-pass counters

`textHeuristics.ts` gains three allocation-free counters, all sharing the
`isWhitespaceCode` predicate introduced in Round 94 (which reproduces the exact
ECMAScript `\s` code-point set):

```ts
function countWhitespaceChars(text: string): number        // ≡ text.replace(/\s/g,'').length
function leadingWhitespaceCount(text: string): number      // ≡ text.length - text.trimStart().length
function trailingWhitespaceCount(text: string, leading: number): number
function leadingIndentWidth(text: string): number          // tab / U+3000 count as 2, others 1
```

`leadingIndentWidth` reproduces
`text.match(/^[\s\u3000\t]*/)[0].replace(/\t/g,'  ').replace(/\u3000/g,'  ').length`
— three whole-string allocations — as one pass with zero allocation.
`trailingWhitespaceCount` takes `leading` as an upper bound so the leading and
trailing scans can never overlap (a fully-blank string yields 0, matching
`text.trimEnd().length === 0 ? 0 : …`).

- **`guessCharFormat`**: `text.replace(/\s/g,'')` (length only) → `totalLength - countWhitespaceChars(text)`; `text.match(/[\u4e00-\u9fff]/g)` → the shared `countChineseChars` from `encodingDetector`.
- **`detectAlignment`**: previously `trim()` + `trimStart()` + `trimEnd()`×2 + `replace(/\s/g,'')` + `match(/[一-鿿]/g)` — **6 allocations per call**. Now only one `trim()` survives; everything else is a count over `text` (or over `trimmed`, which is already materialised).
- **`detectListInfo`**: `match(/^[\s\u3000\t]*/)` + two `replace()` → `leadingIndentWidth(text)`. The one remaining `match()` (CJK numerals) only used its result for a truthiness test, so it became `test()`.

### 2. Regex literals hoisted to module scope

22 literals moved out of function bodies to module-level constants, grouped and
commented by consumer (`SENTENCE_PUNCT_RE` … `LIST_BULLET_SQUARE_RE`). All are
non-global except `CAPITAL_WORD_RE` / `WORD_RE`, which carry `g` but are only
ever passed to `String.match` — that resets and ignores `lastIndex`, so sharing
them across calls is safe (noted inline).

Two near-duplicates were **deliberately kept separate** and the reason recorded
in the source: `SENTENCE_PUNCT_RE` (`[，。！？、；.!?]`) includes ASCII
`.!?`, whereas `ALIGN_SENTENCE_PUNCT_RE` (`[，。！？、；]`) is CJK-only. Merging
them would change behaviour.

### 3. `countChineseChars` promoted to a shared export

`encodingDetector.countChineseChars` was private; it is now exported so
`textHeuristics` can reuse it instead of writing a fourth copy of the
`0x4e00–0x9fff` scan. Dependency direction `heuristics → encodingDetector`
already existed (`encodingDetector` imports only `../logger` and `../docFormat`
types), so the graph stays acyclic.

## Equivalence evidence

### A. Full differential test against the HEAD implementation

The Round 94 file was extracted via `git show HEAD:…` and imported side by side
with the new one. Every exported function was compared over a corpus of
**~60 000 seeded-fuzz strings + ~150 hand-written targeted cases** covering
every branch of every predicate (all 8 list-marker families, every whitespace
code point in `\s`, tab / U+3000 indent mixing, date/name/caps alignment
paths):

| function | differences |
| --- | --- |
| `guessCharFormat` | 0 |
| `detectListInfo` | 0 |
| `detectAlignment` (7 `index/total` combinations each) | 0 |
| `detectCharacterStyles` / `shouldHaveUnderline` / `detectParagraphFormat` / `isSameStyle` | 0 |

A **negative control** confirmed the harness has teeth: deliberately biasing
`listLevel` by +1 was detected on 5 of 6 sample inputs.

### B. End-to-end parse output is bit-identical

`bench-diff.mjs` (27 sample `.doc` files, similarity against a `textutil`
baseline) was run before and after. Every field of the report — `total`,
`parseSuccess`, `parseFail`, `baselineMissing`, `similarityCount`, `median`,
`p10`, `p25`, `min`, `max`, `topIssues`, and all 13 `failures` entries with
their individual similarity scores — is **bit-identical** apart from the
`cycle` number and `timestamp`:

```
median 0.9502433994244857 · p10 0.8968160758834334 · p25 0.9154504595379104
min    0.8115474418758475 · max 0.9999259480622746
```

### C. Micro-benchmark

200 000 iterations over 15 representative paragraphs (CJK prose, multi-level
lists, dates, centred titles, ASCII bullets, blank):

```
OLD guessCharFormat + detectListInfo + detectAlignment   236.4 ms
NEW guessCharFormat + detectListInfo + detectAlignment   134.6 ms
                                                       → 0.569x (1.76x faster)
```

The benchmark also accumulates a checksum of every return value; both
implementations produced the identical checksum (2 226 684), so the speed-up is
not bought with different results.

## Verification

- `npx vue-tsc -p tsconfig.json --noEmit` — 0 errors
- `npm run lint` — clean
- `npm run build` — pass
- `npm run build:lib` — pass
- `npm test` — 59 files / 1334 tests pass

## Metrics

Main-bundle gzip: 108.62 → **108.75 kB (+0.13 kB)**.

The four counters plus the 22 hoisted constants cost slightly more bytes than
the string operations they replace — the same trade taken in Rounds 87–89 and
94 (small size cost, large allocation win). The win lands on a per-paragraph
path, so a 10 000-paragraph document saves 10 000 × 6 string allocations in
`detectAlignment` alone.

## Release

`0.7.38 → 0.7.39`, both packages published.

## Next round

`docparser/` still has per-paragraph work worth auditing:

- `paragraphFilter.ts` — per-paragraph regex literals and `trim()` temporaries.
- `detectParagraphFormat` — still allocates a `trim()` plus several `.test()`
  literals inside the body.
- `docParser.ts` orchestration layer — check whether paragraph-level results are
  recomputed instead of memoised.
