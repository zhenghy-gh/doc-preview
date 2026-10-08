# Round 70 — Fix scoped styles for collapsible panel buttons

Date: 2026-10-01

Changed the existing `.stories-toggle`, hover, icon, and summary selectors in `DocPreview.vue`'s scoped stylesheet to use Vue `:deep()` selectors so they apply to nodes rendered by the child `CollapsiblePanel` component.

Browser verification with the sample DOC succeeded; computed button style was flex with 10px 16px padding, expand/collapse aria states worked, and there were no browser errors. Full tests passed (59 files, 1332 tests), lint passed, and production build passed (108.93 kB gzip JS; 7.91 kB gzip CSS).
