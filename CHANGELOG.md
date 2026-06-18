# Changelog

All notable changes to `@zhenghy/doc-preview` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.1] - 2026-06-18

> Note: 0.3.0 was previously published as a development snapshot. This 0.3.1
> release consolidates all the new features (Web Worker, dark mode, TOC, etc.)
> into a polished release.

### Added
- Web Worker parsing for large files (>1MB) — `parseWithWorker()` and auto-fallback in `DocPreview`
- TypeScript declaration files via `vite-plugin-dts` (`.d.ts` outputs in lib build)
- Document outline / TOC navigation in the preview toolbar
- Reader mode (full-width reading view) toggle
- Copy text and download text buttons in the preview toolbar
- Document stats display (word count, paragraph count, character count)
- Custom favicon (`public/favicon.svg`)
- GitHub Pages SPA 404 fallback (`public/404.html`)
- `loaded` and `loading` events on `DocPreview`
- `reload()`, `getPlainText()`, and `focusContent()` methods exposed via `defineExpose`
- "Worker thread" badge in the loading state when large files use Web Worker
- `aria-label` and `role="separator"` accessibility attributes on toolbar
- **Skip-link** for keyboard users to jump to document content
- `examples/standalone.html` — non-Vue demo showing how to use the library directly
- `.editorconfig` for consistent editor settings across contributors
- `CHANGELOG.md` documenting all notable changes
- `docs/ARCHITECTURE.md` — detailed architecture and pipeline documentation
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `PULL_REQUEST_TEMPLATE.md`
- GitHub issue templates and dependabot config
- `vitest --coverage` integration with `npm run test:coverage` script

### Changed
- `maxScanBytes` is now a configurable `DocParser` property (default 10MB, was hardcoded 500KB)
- `Logger.debug` is no longer on by default; use `enableDebugMode()` to opt in
- Removed duplicate type file `docFormatTypes.ts` (was identical to `docFormat.ts`)
- Split monolithic `docParser.ts` into `oleParser.ts`, `fibParser.ts`, `logger.ts`, `docParser.worker.ts`, `parseWithWorker.ts`
- `OleParser` caches parsed header and FAT (avoids redundant reads)
- `detectEncodingFromBinary` now uses null-byte distribution as a fallback when 0x0D markers are absent
- `stripBinaryPrefix` uses three strategies (longest run, English capital word, first CJK) for better binary-noise removal
- Title detection supports ALL-CAPS English, "This Is A Title" patterns, and mixed Chinese/English
- List detection auto-renders numbered (`1.`, `a)`) and bulleted (`•`, `-`) lists
- Search now restores original HTML when closed
- Library build no longer warns about mixed named/default exports
- All toolbar buttons now use semantic Unicode symbols (no emoji rendering dependency)
- Public API (`DocParser`, `parseDocFile`, `parseDocFileFromBuffer`, `parseDocFileWithFormat`) now has full JSDoc
- Test suite: 30 → 58 tests
- GitHub Actions CI now includes `vue-tsc` type check and `npm test` before deploy
- README documents new events, Web Worker API, and project structure

### Fixed
- DOCX (ZIP) files no longer produce a confusing "invalid OLE" error
- `.docx` files explicitly rejected at upload time with a helpful message
- File size validation (max 50MB) at upload time
- Worker chunk properly emitted as separate file in library build
- README updated to use correct prop name `source` (was `file` in some examples)
- Library build no longer includes test fixtures in published bundle

### Tests
- 30 → **58 tests** (93% increase) with `npm run test:coverage`
- `logger.ts` 100% coverage
- `fibParser.ts` 94.87% coverage (truncation edge cases)
- `oleParser.ts` 88.49% coverage (FAT chains, directory entries, `findWordDocumentStream` fallback paths)
- Added synthetic OLE2 binary fixture construction in tests
- 5 test files: `logger`, `fibParser`, `oleParser`, `docParser`, `parseWithWorker`

## [0.2.1] - Initial Release

- Initial preview component with Vue 3 + TypeScript
- OLE2/CFB compound document parser
- FIB parsing
- Text extraction (8-bit and UTF-16LE)
- Heuristic format detection (font size, bold, alignment)
- Drag-and-drop and URL loading
- Search and zoom
- Print support
- Dark mode
- Mobile responsive
- 30 unit tests
- CI/CD with type-check, test, and GitHub Pages deploy
