# Round 14 — Remove no-op equation replacements

Date: 2026-09-29

`eqnToLatex` no longer scans the input repeatedly to replace existing Greek letters, operators, functions, and arrows with identical text. Actual conversions for fractions, roots, bounds, superscripts/subscripts, degree/radian markers, and whitespace remain in their original order.

Validation: 136 focused equation, parser, real-document, and performance tests passed; full suite passed with 59 files and 1324 tests; lint and production build passed. Production main bundle gzip was approximately 108.77 kB.
