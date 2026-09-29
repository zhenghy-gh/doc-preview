# Round 10 — Count non-empty table cells in place

Date: 2026-09-29

`splitTableCells` now counts non-empty cells while collecting the trimmed return cells, avoiding an additional filtered array. `isWordTableRow` returns as soon as it finds a non-empty cell. Delimiter precedence, empty middle cells, and optional trailing empties remain unchanged.

Validation: 198 focused table, document, and rendering tests passed; full suite passed with 59 files and 1324 tests; lint and production build passed; real-document and parsing performance tests passed.
