# Round 56 — Verify generated declaration API

Date: 2026-10-01

No source changes. Compared `src/index.ts` public exports with `dist-lib/index.d.ts`, then parsed the generated declaration using the TypeScript compiler API. The declaration syntax is valid and exposes 18 named exports covering the component, parser/worker APIs, and public types.

Validation uses the current local library build; no consumer TypeScript-version matrix was run.
