# Round 94 — Remove per-character allocations in `detectCharacterStyles`

Date: 2026-10-08

## Context

Rounds 91–93 exhausted the "duplicate implementation" vein. This round returns
to the project's original mainline: **allocation in hot loops**.

`docparser/heuristics/textHeuristics.ts` runs once per paragraph; inside it,
`detectCharacterStyles` walks **every character** of every paragraph. It had
three allocation problems.

## What changed

### 1. A regex literal inside the per-character loop

```ts
for (let i = 0; i < text.length; i++) {
  const char = text[i]                       // ← 1-char string, every char
  const code = text.charCodeAt(i)
  ...
  const isWhitespace = /\s/.test(char)       // ← new RegExp object, every char
```

`/\s/` is a literal, so a fresh `RegExp` is created on every evaluation — once
per character. It is replaced by `isWhitespaceCode(code)`, a code-point range
test over the `charCodeAt` value that was **already being computed**, which
also removes the `text[i]` single-character string allocation.

`isWhitespaceCode` reproduces the ECMAScript `\s` set exactly:
`09–0D`, `20`, `A0`, `FEFF`, `1680`, `2000–200A`, `202F`, `205F`, `3000`,
`2028`, `2029` (WhiteSpace + LineTerminator).

### 2. The colon scan allocated a 1-char string per character

```ts
for (let i = 0; i < text.length; i++) {
  if (text[i] === '：' || text[i] === ':') colonPositions.push(i)
}
```

This loop always walks the whole paragraph. It now compares
`text.charCodeAt(i)` against `0xFF1A` / `0x003A`.

### 3. A `text.length`-long boolean array per paragraph (when colons exist)

The colon positions were expanded into `new Array(text.length).fill(false)`,
filled over the marked ranges, then each style segment re-walked that array to
count its marked positions.

The colon positions are ascending and the marked ranges are **disjoint and
ordered** (`start_ci = colon[ci] + 1`, `end_ci = colon[ci+1] - 4 < start_{ci+1}`),
so the same count is obtained by intersecting each segment with each range
directly:

```ts
count += max(0, min(seg.end, range.end) - max(seg.start, range.start))
```

That removes the O(n) array allocation and fill, and replaces the O(segment
length) recount with O(number of ranges) — typically one or two.

### 4. `shouldHaveUnderline` (called per digit character)

- `const char = text[index]; if (!/[0-9]/.test(char)) return false` →
  `text.charCodeAt(index)` range test. Drops a 1-char string and a regex
  evaluation per call.
- The three regex literals in its body (`/[：:]\s*$/`, `/[年日月时分秒]/`,
  `/[0-9]{2,4}[年月日时分秒]/`) are hoisted to module-level constants. None is
  global, so they are safe to share across calls.

### 5. Redundant `isSameStyle` call

```ts
if (currentStyle && isSameStyle(currentStyle, charStyle)) continue
if (currentStyle && !isSameStyle(currentStyle, charStyle)) { ...push... }
```

`isSameStyle` is pure, so the second call is redundant. Collapsed to a single
evaluation inside one `if (currentStyle)`.

## Equivalence evidence

**Parser output, bit-for-bit.** `bench-diff.mjs` (parses all 27 sample `.doc`
files and compares the extracted text against a `textutil` baseline) was run
before and after. Every reported figure is identical:

```
指标             改动前(940)           改动后(941)
total           27                    27
parseSuccess    27                    27
parseFail       0                     0
median          0.9502433994244857    0.9502433994244857
p10             0.8968160758834334    0.8968160758834334
p25             0.9154504595379104    0.9154504595379104
min             0.8115474418758475    0.8115474418758475
max             0.9999259480622746    0.9999259480622746
```

`topIssues` clustering is also identical.

**Function output.** A standalone micro-benchmark runs the old and new
`detectCharacterStyles` side by side over 10 samples (CJK, English, mixed,
colon-heavy, tab/full-width/NBSP/ZWNBSP whitespace, 500-char runs, list
markers). `JSON.stringify` of the returned style segments matched on **10/10**
samples.

## Measurements

Micro-benchmark, 20 000 rounds × 10 samples = **200 000 calls**:

```
旧实现: 1627.3 ms
新实现:  904.2 ms
新/旧 = 0.556x  → 快 1.8 倍
```

## Verification

- Full suite: 59 files / **1334 tests** pass.
- `npm run lint` passes; `npm run build` and `npm run build:lib` pass.

## Bundle size

App-form `npm run build` main bundle: **108.56 → 108.62 kB gzip (+0.06 kB)**.
The `underlineRanges` interval list and the `isWhitespaceCode` helper cost a
little more than the removed array fill — the same size-for-allocation trade
made in rounds 87–89.

## Release

Version bumped `0.7.37 → 0.7.38` and published to both package names.
