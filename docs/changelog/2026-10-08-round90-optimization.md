# Round 90 — Dedupe skip-keyword table + allocation-free char counting

Date: 2026-10-08

## What changed

### 1. `SKIP_KEYWORDS` was duplicated and rebuilt per paragraph

The 15-entry pseudo-body keyword list existed **twice** — once in
`docparser/encodingDetector.ts` and once in
`docparser/heuristics/paragraphFilter.ts` (the latter was hoisted in round 87,
but the copy in `encodingDetector.filterRawParagraphs` was still being rebuilt
for every paragraph).

It is now defined and exported once from `encodingDetector.ts`, and
`paragraphFilter.ts` imports it (it already imported `JUNK_CHAR_CLASS` /
`EXTRA_JUNK_CHARS` from the same module, so no new dependency edge — and no
cycle, since `paragraphFilter` → `encodingDetector` was already the direction).

### 2. Per-paragraph match arrays replaced with allocation-free counting

`filterRawParagraphs` counted Chinese characters and junk characters with
`(cp.match(/…/g) || []).length`, allocating a full match array per paragraph.
Both are now single-pass scans over UTF-16 code units:

- `countChineseChars` — `charCodeAt` range test for U+4E00–U+9FFF.
- `countJunkChars` — membership in `JUNK_CODE_SET`.

`JUNK_CODE_SET` deliberately stores **code points (`Set<number>`)** rather than
characters: with a `Set<string>` the loop would allocate a new single-character
string on every iteration just to hash it. That variant was measured and
rejected during this round.

## Measurements

Micro-benchmark (`node`, 2.4M calls over CJK / mixed / junk-heavy samples of
10–1000 chars), comparing the old regex-pair against the new scan-pair:

```
旧 (regex match)  : 11786.1 ms
新 (charCodeAt Set):  4527.5 ms
新/旧 = 0.384x  → 更快
正确性：所有样本新旧结果一致 ✓
```

The `Set<string>` + `text[i]` variant was tried first and showed no
improvement (it allocates per character), which is why the code-point set was
used instead.

## Test robustness fix (not caused by this round)

`tests/realDocs.test.ts` parses all 28 fixture documents (including 1.35 MB
files) inside a **single** `it()` block, using vitest's default 5000 ms
timeout. In isolation it runs in ~1 s, but with 59 test files running in
parallel the environment contention pushes it past 5 s, producing a false
failure (observed twice; the suite's `environment` time rose from ~380 s to
~1250 s under load).

The case now has an explicit 30000 ms budget. Assertions are unchanged — only
the harness budget was loosened. Confirmed green afterwards with 59 files /
1334 tests passing.

## Verification

- Targeted: `enc-def-err`, `perf-t3-dedup`, `field-cp-gov` — 26 tests pass.
- Full suite: 59 files / **1334 tests** pass.
- `npm run lint` passes; `npm run build` (`vue-tsc` + Vite) passes.

## Bundle size

Main JS gzip **109.22 → 109.27 kB (+0.05 kB)**. The deduped keyword table
partly offsets the added counting helpers.

## Release

Version bumped `0.7.33 → 0.7.34` and published to both package names.
