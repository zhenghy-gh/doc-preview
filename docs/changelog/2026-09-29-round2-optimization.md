# Round 2 — Avoid unnecessary tab-stop sorting

Date: 2026-09-29

`applyTabStops` now checks whether custom tab stops are already ascending before allocating and sorting a copy. Ascending inputs are reused without mutation; unordered inputs still use the previous sorted-copy behavior, including duplicate stops.

Validation: 53 focused rendering tests passed; full suite passed with 59 files and 1323 tests; lint and production build passed; real-document and performance tests passed.
