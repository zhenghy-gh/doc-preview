# Contributing

Thank you for your interest in improving `@zhenghy/doc-preview`! 🎉

## Quick Links

- 🐛 [Report a bug](https://github.com/zhenghy-gh/doc-preview/issues/new?template=bug_report.md)
- ✨ [Request a feature](https://github.com/zhenghy-gh/doc-preview/issues/new?template=feature_request.md)
- ❓ [Ask a question](https://github.com/zhenghy-gh/doc-preview/issues/new?template=question.md)
- 📖 [Architecture](docs/ARCHITECTURE.md)
- 📝 [Changelog](CHANGELOG.md)

## Development Setup

```bash
git clone https://github.com/zhenghy-gh/doc-preview.git
cd doc-preview
npm install
npm run dev
```

Visit http://localhost:5173 to see the dev server.

## Development Workflow

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** — follow the [code style](#code-style) below

3. **Add tests** for new functionality:
   ```bash
   # Run tests in watch mode
   npm run test:watch
   ```

4. **Verify your changes**:
   ```bash
   npm test
   npm run build
   npm run build:lib
   ```

5. **Open a pull request** — the [PR template](PULL_REQUEST_TEMPLATE.md) will guide you

## Code Style

- **Editor**: Project uses `.editorconfig` (2-space indent, LF line endings, UTF-8)
- **TypeScript**: Strict mode enabled, no `any` in public API
- **Vue 3**: Use `<script setup lang="ts">` Composition API
- **Comments**:
  - JSDoc for all public APIs
  - Inline comments for non-obvious binary format / hex offset mapping
  - No decorative comments

## Architecture Overview

The project has several distinct concerns:

| Module | Responsibility |
|--------|----------------|
| `src/components/DocPreview.vue` | Vue 3 component, UI rendering, toolbar |
| `src/utils/docParser.ts` | Public API, `DocParser` class, text extraction orchestration |
| `src/utils/oleParser.ts` | OLE2 / Compound File Binary structure |
| `src/utils/fibParser.ts` | Word File Information Block parsing |
| `src/utils/parseWithWorker.ts` | Web Worker wrapper + main-thread fallback |
| `src/utils/docParser.worker.ts` | Web Worker entry point |
| `src/utils/logger.ts` | Conditional console logging |
| `src/utils/docFormat.ts` | Public TypeScript types |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a detailed pipeline diagram.

## Testing

- All new functionality must include tests
- Run `npm run test:coverage` to see coverage
- Aim to keep or improve coverage — current overall: 28.57%
- Some modules (logger, fibParser) are at 90-100% coverage
- The OLE2 binary structure is testable with constructed buffers

## Areas Where Help is Welcome

- **Real .doc binary test fixtures** — the project has synthetic fixtures in
  `docs/synthetic/` but those are gitignored. Adding small (≤50KB) sample files
  to a `tests/fixtures/` directory would significantly improve integration test
  coverage.
- **Format inference improvements** — current heuristics handle common Chinese
  documents well, but English documents with mixed styles could be improved.
- **CHP/PAP binary table reading** — this would unlock exact font/alignment
  detection, replacing the heuristic-based approach.
- **Image and table extraction** — currently we skip these. A separate stream
  parser (e.g., `Data` stream for images, `Table` stream for tables) would be
  valuable.

## Reporting Issues

Please use the [issue templates](.github/ISSUE_TEMPLATE/) provided. For security
issues, see [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
