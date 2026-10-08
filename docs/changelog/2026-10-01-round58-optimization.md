# Round 58 — Verify Vue peer dependency externalization

Date: 2026-10-01

No dependency changes. Confirmed that the ESM bundle retains `from "vue"`, the UMD bundle uses `require("vue")`, and the installed Vue 3.5.40 satisfies the declared peer range `^3.0.0`.

This verifies the current local build and installed version only; no consumer version matrix was run.
