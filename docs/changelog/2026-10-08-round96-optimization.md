# Round 96 — Finish the regex hoisting in `paragraphFilter`, and stop allocating match arrays

Date: 2026-10-08

## Context

Round 87 hoisted the per-paragraph regex construction at the top of
`docparser/heuristics/paragraphFilter.ts`. It missed three places where regexes
are still built inside functions that run **once per paragraph**:

| site | per-paragraph cost before this round |
| --- | --- |
| `cleanWordFieldCodes` | `pagePattern` (1 regex) **plus** a 30-element `fieldPatterns` array of `gi` regexes |
| `applyStructuralFormats` | `/\u0001/g` and `/^[A-Z][a-z].*[.!?]?$/` literals |
| `splitMultiRowTables` | three `\u0007` literals |

Separately, three call sites used `text.match(/…/g)` when they only needed a
**count** or a **threshold**, allocating an array of every match.

## What changed

### 1. Every remaining in-body regex literal is now a module-level constant

`PAGE_OF_PAGES_RE`, `FIELD_CODE_PATTERNS` (the 30-entry array), `QUOTED_URL_RE`,
`HYPERLINK_QUOTED_PIC_RE`, `HYPERLINK_QUOTED_TRAIL_RE`, `HYPERLINK_BARE_PIC_RE`,
`HYPERLINK_BARE_TRAIL_RE`, `PIC_CLASSNAME_RE`, `MULTI_SPACE_RE`,
`DUP_COMMA_RE`, `DUP_PERIOD_RE`, `DUP_COLON_RE`, `HEADING_LIKE_RE`,
`CELL_MARK_RUN_RE`, `CELL_MARK_EDGE_RE`, `CELL_MARK_TRAIL_RE`.

The `text.replace(/\u0001/g, '')` in `applyStructuralFormats` now reuses the
existing `PIC_PLACEHOLDER_RE`.

Two comments were added to the source recording patterns that look mergeable but
are not: `HYPERLINK_QUOTED_PIC_RE` (`\s*` tail, replaces with `\u0001`) versus
the pre-existing `HYPERLINK_QUOTED_RE` (`[\s\u0001]*` tail, replaces with `''`).

All hoisted patterns carry `g`/`gi` and are only ever passed to
`String.prototype.replace`, which resets `lastIndex` at the start — so sharing
one instance across calls is safe.

### 2. `match()` arrays replaced by an allocation-free counter

```ts
function countMatches(re: RegExp, text: string, limit = Infinity): number {
  re.lastIndex = 0
  let count = 0
  while (count < limit && re.test(text)) count++
  return count
}
```

`RegExp.prototype.test` on a global regex only advances `lastIndex` — it does
**not** allocate a match array, unlike `exec` (one array per match) and unlike
`match` (one array holding every match). Every pattern passed here matches at
least one character, so there is no zero-length-match risk; the helper resets
`lastIndex` itself, so module-level instances stay safe.

Used at:
- `hasTooManyJunkChars` — `text.match(JUNK_ANY_RE) || []` → `countMatches(JUNK_ANY_RE, text, 3)`. The limit is 3 because `> 2` is the first short-circuit condition.
- `filterParagraphsWithGenericLogic` — `(p.text.match(WEIRD_CHAR_RE) || []).length` → `countMatches(WEIRD_CHAR_RE, p.text)`. The count is kept exact here, because the result feeds a floating-point ratio (`weird / len < 0.5`) and an early exit would have to reason about float rounding.

### 3. `hasSignificantContent`: stream the English words instead of collecting them

The predicate is only "at least 2 English words containing a vowel", yet the old
code built an array of **every** `[A-Za-z]{3,}` word in the paragraph and then
walked all of it. It now runs `ENGLISH_WORD_RE.exec` in a loop and returns as
soon as the second vowel-bearing word is found:

```ts
let englishWords = 0
ENGLISH_WORD_RE.lastIndex = 0
let wordMatch: RegExpExecArray | null
while ((wordMatch = ENGLISH_WORD_RE.exec(text)) !== null) {
  if (VOWEL_RE.test(wordMatch[0])) {
    if (++englishWords >= 2) return true
  }
}
```

This is the round's main win, and it is on the hottest path in the file —
`hasSignificantContent` is called for essentially every paragraph, and twice per
paragraph inside `filterAndEnhanceParagraphs`.

### 4. `cleanParagraph`: drop one of two `trim()` calls

`p.trim().replace(JUNK_PREFIX_RE, '').trim()` became:

```ts
const t = p.trim()
const stripped = t.replace(JUNK_PREFIX_RE, '')
return stripped === t ? t : stripped.trim()
```

When the junk-prefix replace is a no-op, `stripped === t`; and since `trim` is
idempotent over the same `WhiteSpace ∪ LineTerminator` set, `t.trim() === t`, so
returning `t` is identical.

## Equivalence evidence

### A. Differential test against the HEAD implementation

The Round 95 file was extracted with `git show HEAD:…` and imported side by
side. Every exported symbol was compared over **40 000 seeded-fuzz strings +
~100 hand-written targeted cases** (junk-character prefixes, every field-code
keyword, page-number patterns, `HYPERLINK` quoted/bare forms, picture
placeholders and CamelCase class names, `\u0007` cell-mark runs, tandem/triple
repeats, long pathological strings) — plus 400 pseudo-random
`ParserParagraph[]` documents for the mutating entry points:

| function group | differences |
| --- | --- |
| `cleanParagraph` / `hasSignificantContent` / `shouldSkipParagraph` / `hasTooManyJunkChars` | 0 |
| `removeInternalDuplicates` / `collapseWholeBlockRepeats` | 0 |
| `cleanWordFieldCodes` / `splitMultiRowTables` | 0 |
| `filterParagraphsWithGenericLogic` / `filterAndEnhanceParagraphs` | 0 |
| `applyStructuralFormats` (full array deep-compare after in-place mutation) | 0 |
| `normalizeParagraphCpAxis` / `replacePageFieldsInText` | 0 |
| `REMOVE_DUP_EXACT_MAX_LEN` | identical |

**Negative controls** (three, one per change class) confirmed the harness has
teeth:
1. Dropping the `g` flag from `DUP_PERIOD_RE` — caught (`"a。b。c"` vs `"a。b。 。c"`).
2. Raising the English-word threshold from 2 to 3 — caught on 3 of 4 inputs.
3. Making `cleanParagraph`'s fast path skip the junk-prefix strip — caught.

Control 1 is worth calling out: the `g` flag was genuinely dropped during this
round's first edit and only found by re-reading the constant block, not by the
type checker or the linter.

### B. End-to-end parse output is bit-identical

`bench-diff.mjs` (27 sample `.doc` files against a `textutil` baseline) before
and after: every report field except `cycle`/`timestamp` is **bit-identical**,
including all 13 `failures` entries with their per-sample similarity.

```
median 0.9502433994244857 · p10 0.8968160758834334 · p25 0.9154504595379104
min    0.8115474418758475 · max 0.9999259480622746
```

### C. Robust micro-benchmark

The first benchmark attempt reported ~1.00x overall, which contradicted the
change. Re-running with per-function isolation, 4 warmup passes, and 7
alternating trials (median of each) produced the real picture:

```
N = 300 000, 7 alternating trials, median
hasSignificantContent             OLD   94.2 ms | NEW   48.3 ms | 1.950x
hasTooManyJunkChars               OLD   13.3 ms | NEW   10.9 ms | 1.214x
filterParagraphsWithGenericLogic  OLD 1295.1 ms | NEW 1201.7 ms | 1.078x
cleanWordFieldCodes               OLD  411.6 ms | NEW  386.1 ms | 1.066x
splitMultiRowTables               OLD   19.1 ms | NEW   18.5 ms | 1.032x
cleanParagraph                    OLD   10.4 ms | NEW   10.3 ms | 1.015x
removeInternalDuplicates          OLD  967.0 ms | NEW  970.4 ms | 0.997x  (untouched code — noise floor)
```

`removeInternalDuplicates` is unchanged in this round, so its 0.997x is a useful
control: it shows the noise floor of the harness is about ±0.3 %.

### D. Finding: hoisting regex literals out of function bodies is nearly free in V8

`cleanWordFieldCodes` builds a 30-element array of `gi` regexes on every call —
21.6 million `RegExp` allocations across the benchmark — yet hoisting it is only
worth **1.066x**. The reason is that the array never escapes the function, so
V8's escape analysis removes it, and regex *literals* additionally reuse their
compiled pattern. Rounds 87–89 measured the same thing (their gzip size went up
while their timings barely moved).

The lesson, recorded here so later rounds do not re-learn it: **hoisting regex
literals is a readability and cross-engine win, not a V8 win.** The V8 wins in
this file come from (a) not allocating `match()` result arrays, and (b)
replacing whole-string temporaries with counters — which is exactly what
Rounds 94–96 have been doing.

## Verification

- `npx vue-tsc -p tsconfig.json --noEmit` — 0 errors
- `npm run lint` — clean
- `npm run build` — pass
- `npm run build:lib` — pass
- `npm test` — 59 files / 1334 tests pass

### Test-stability fix (separate commits `8f895e1` → `9a55955`)

Three consecutive full-suite runs of this round each failed **one** test — a
different one every time:

```
run 1 -> tests/locale.test.ts               > 'translates strings, functions, params and falls back to the key'
run 2 -> tests/composables/useI18n.test.ts  > 'returns the same singleton instance across calls'
run 3 -> tests/chartRenderer.test.ts        > 'resolves type/subtype labels in zh-CN and en via real locale dictionary'
```

All three are the **first** test in their file that performs a dynamic
`import()`, all timed out at the 5000 ms default, and all pass standalone in
0.7–1.2 s. The suite's `environment` phase measured 1704–1914 s (1474 s at
round 95) — heavy parallel contention.

The first fix (`8f895e1`) targeted the four files that use
`vi.resetModules()`. The third failure then landed on
`tests/chartRenderer.test.ts`, which does not use `resetModules` at all — it
simply calls `await import('../src/utils/locale')` at line 177. So the real
trigger is broader: **the first on-demand `import()` in a file pays for
transforming and evaluating the module graph**, and under 59-way parallelism
that can exceed 5 s. Exactly five test files do this.

None of them has an import path to the code changed here — `src/utils/locale.ts`
imports only `vue` and `./safeStorage`.

The final fix (`9a55955`) moves the budget to the harness, where it belongs:
`testTimeout: 30000` in `vitest.config.ts`, with the five per-file
`vi.setConfig` lines from the first attempt removed. No assertion was touched.

## Metrics

Main-bundle gzip: 108.75 → **108.91 kB (+0.16 kB)**.

Larger than Rounds 87–89 (+0.16/+0.02/+0.06) but in the same class. The bytes
go to the named constants and to `hasSignificantContent`'s exec loop, which is
longer than the `match` + `for` it replaces; the 1.95x on that function is the
payoff.

## Release

`0.7.39 → 0.7.40`, both packages published.

## Next round

- `detectParagraphFormat` (`textHeuristics.ts`) still allocates a `trim()` and
  evaluates several in-body `.test()` literals per paragraph.
- `docParser.ts` orchestration layer: check whether paragraph-level results are
  recomputed instead of memoised.
- The `removeInternalDuplicates` cost (≈3.2 µs/call on short paragraphs) is now
  the single largest term in `filterParagraphsWithGenericLogic`; worth a profile
  to see whether the outer `len` scan can start from a smaller bound.
