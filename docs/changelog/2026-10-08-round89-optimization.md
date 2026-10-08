# Round 89 — Hoist list-marker regexes out of the per-item path

Date: 2026-10-08

## What changed

`src/utils/rendering/listRenderer.ts` ran on every list item of every list in
the document. Two functions rebuilt their patterns on each call:

**`extractListItemText`** chained 9 regex literals for ordered markers and 2
for unordered ones. A regex literal is re-evaluated (and a new `RegExp` object
created) every time the enclosing expression runs, so a single list item
allocated up to 11 regex objects.

The patterns now live in module-level tables:

- `ORDERED_MARKER_RES` — the 9 ordered-marker patterns, applied in the
  original order via a loop.
- `UNORDERED_MARKER_RES` — the 2 unordered-marker patterns.

**`renderNestedList`** stripped the paragraph wrapper per item with
`.replace(/^<p[^>]*>/, '').replace(/<\/p>$/, '')`; those two literals are now
`P_OPEN_RE` / `P_CLOSE_RE`.

## Equivalence notes

- The ordered markers are applied sequentially and **cannot** short-circuit:
  a marker can be stripped and a later pattern still match, e.g.
  `"1) a. foo"` → `"a. foo"` → `"foo"`. The loop preserves the exact order and
  the full chain, matching the original behaviour. The same reasoning is
  recorded in a code comment so it is not "optimised" away later.
- All hoisted patterns are `^`-anchored and **non-global**, used only with
  `String.replace`, so sharing one instance is safe (no `lastIndex` state).
- No pattern, replacement string, or ordering was altered.

## Verification

- Targeted: `listRenderer` (13), `documentRenderer` (29), `renderGolden` (11)
  — 53 tests pass, including the byte-level render golden suite.
- Full suite: 59 files / **1334 tests** pass.
- `npm run lint` passes; `npm run build` (`vue-tsc` + Vite) passes.

## Bundle size

Main JS gzip **109.16 → 109.22 kB (+0.06 kB)**. The regex tables are
materialised once instead of per call, which costs a small amount of module
init code; the win is removing up to 11 regex allocations per list item.

## Release

Version bumped `0.7.32 → 0.7.33` and published to both package names.
