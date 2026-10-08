# Round 88 — Hoist per-line regex construction in formatStoryText

Date: 2026-10-08

## What changed

`formatStoryText` in `src/components/DocPreview.vue` renders non-body stories
(headers, footers, footnotes, endnotes, comments, text boxes). It is invoked
straight from the template (`v-html="formatStoryText(section.text)"`), so it
re-runs on every re-render of each story section.

Inside its per-line loop it built **three** regular expressions for every
single line:

```js
.replace(new RegExp(SOFT_BR, 'g'), '<br>')
.replace(new RegExp(PAGE_BR, 'g'), '…[分页]…')
.replace(new RegExp(CELL_MARK, 'g'), '…│…')
```

plus a per-line `raw.replace(/\s+$/, '')` literal. All four are now hoisted
out of the loop to setup scope:

- `STORY_TRAILING_WS_RE`, `STORY_SOFT_BR_RE`, `STORY_PAGE_BR_RE`,
  `STORY_CELL_MARK_RE`
- `STORY_PAGE_BR_HTML`, `STORY_CELL_MARK_HTML` — the two long inline HTML
  replacement strings are now single constants instead of being re-created as
  template-free literals per line.

The loop body is otherwise byte-for-byte identical (same order of the three
replacements, same `<p style="margin:0 0 6px 0">` wrapper, same empty-line
collapsing).

## Equivalence notes

- The three patterns are single literal control characters (`\u000b`,
  `\u000c`, `\u0007`); the original built them via `new RegExp(str, 'g')`,
  which compiles the pattern on each call. Replacing that with a hoisted
  literal is behaviour-identical.
- The `g`-flagged regexes are only consumed by `String.replace`, which resets
  and ignores `lastIndex`, so sharing one instance across lines is safe.
- `SOFT_BR` / `PAGE_BR` / `CELL_MARK` had no other users in the file, so the
  local constants were removed rather than renamed.

## Verification

- Full suite: 59 files / **1334 tests** pass (this function is covered
  indirectly through the component/story rendering tests).
- `npm run lint` passes; `npm run build` (`vue-tsc` + Vite) passes.

## Bundle size

Main JS gzip **109.14 → 109.16 kB (+0.02 kB)** — essentially flat; the two
long HTML strings now exist once instead of being rebuilt per line.

## Release

Version bumped `0.7.31 → 0.7.32` and published to both package names.
