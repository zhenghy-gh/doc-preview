# Round 64 — Smoke-test CommonJS package entry

Date: 2026-10-01

No source changes. Loaded the package through Node CommonJS self-reference (`require('@zhenghy/doc-preview')`) and checked the component, parser, and worker API exports. The import succeeded.

This does not simulate browser UMD script loading or worker execution; no package was published.
