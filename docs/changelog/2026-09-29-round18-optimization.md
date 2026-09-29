# Round 18 — Convert Markdown roots without aggregation

Date: 2026-09-29

`htmlToMarkdown` now converts each page's child nodes as it iterates through `.page-content` containers, falling back to the root container's direct children when no page containers exist. It no longer builds a temporary array aggregating all root nodes.

Validation: 44 focused Markdown export and edge tests passed; full suite passed with 59 files and 1324 tests; lint and production build passed. Production main bundle gzip was approximately 108.77 kB.
