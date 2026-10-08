# Round 87 — Hoist per-paragraph regex construction in paragraphFilter

Date: 2026-10-08

## What changed

`src/utils/docparser/heuristics/paragraphFilter.ts` sits on the per-paragraph
hot path — `cleanParagraph` / `shouldSkipParagraph` / `hasSignificantContent`
are invoked for every paragraph from `docParser.ts` (3 call sites),
`encodingDetector.ts` (3 call sites) and `formatRecovery.ts` (1 call site).

Two of them rebuilt their regular expressions on every single call:

- `cleanParagraph` did `new RegExp('^[' + JUNK_CHAR_CLASS + ']+')` per call —
  `new RegExp` parses and compiles the pattern each time, unlike a literal.
- `hasTooManyJunkChars` did the same with a `g`-flagged pattern.

Both patterns depend only on the module-level string constants
`JUNK_CHAR_CLASS` / `EXTRA_JUNK_CHARS`, so they are now built once at module
scope (`JUNK_PREFIX_RE`, `JUNK_ANY_RE`).

The same treatment was applied to the remaining per-call constructions in the
module:

- `hasSignificantContent`: five regex literals (`ENGLISH_WORD_RE`,
  `VOWEL_RE`, `COMMON_PUNCT_RE`, `CHINESE_RUN_RE`, `NON_PRINTABLE_RE`)
  hoisted; the Chinese-character count now scans UTF-16 code units directly
  instead of `match(/…/g).length`, and the English-word count no longer
  allocates a `.filter()` array.
- `filterParagraphsWithGenericLogic`: the 15-entry `skip` keyword array is
  hoisted to `SKIP_KEYWORDS` (it was rebuilt for every short paragraph), and
  the "weird character" regex is hoisted to `WEIRD_CHAR_RE`.
- `applyStructuralFormats`: the two HYPERLINK field-code patterns, the
  `EMBED|LIBREOFFICE|INCLUDEPICTURE|INCLUDETEXT` pattern and the `\u0001`
  placeholder pattern are hoisted.

## Why sharing global regexes is safe here

`JUNK_ANY_RE`, `ENGLISH_WORD_RE`, `WEIRD_CHAR_RE`, the HYPERLINK patterns and
`PIC_PLACEHOLDER_RE` all carry the `g` flag, but they are only ever consumed
by `String.prototype.match` / `String.prototype.replace`, both of which reset
and ignore `lastIndex` (per `RegExp.prototype[Symbol.match]` /
`[Symbol.replace]`). No shared regex is used with `.exec()` or `.test()`
where `lastIndex` would leak between calls. `VOWEL_RE`, `COMMON_PUNCT_RE` and
`CHINESE_RUN_RE` are non-global and used with `.test()`, so they are
stateless.

## Equivalence notes

- `LIBREOFFICE` (not `LIBEROFFICE`) was carried over verbatim from the
  original literal — an early draft of this change misspelled it, which would
  have silently changed which field codes get stripped.
- The hoisted HYPERLINK / field-code regexes deliberately keep the original
  flags (no `u`) to avoid changing escape and surrogate handling.
- `hasSignificantContent` keeps its exact short-circuit order: table row →
  Chinese ratio → English words → punctuation+content → printable chars.

## Verification

- Targeted: `perf-t3-dedup`, `enc-def-err`, `field-cp-gov` — 26 tests pass.
- Full suite: 59 files / **1334 tests** pass.
- `npm run lint` passes; `npm run build` (`vue-tsc` + Vite) passes.

## Bundle size

Main JS gzip **108.98 kB → 109.14 kB (+0.16 kB)**; the worker chunk grew
127.10 → 127.23 kB. The increase comes from replacing the compact
`match(…).length` / `.filter(…).length` one-liners with explicit counting
loops. This is accepted: the dominant win is removing per-paragraph
`new RegExp` compilation, and the loops also drop two array allocations per
paragraph on CJK documents.

## Release

Version bumped `0.7.4 → 0.7.31` and published to both package names
(`@zhenghy/doc-preview`, `doc-preview`).
