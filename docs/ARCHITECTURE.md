# Architecture

This document describes the internal architecture of `@zhenghy/doc-preview` for
contributors and maintainers.

## Overview

```
┌────────────────────────────────────────────────────────────┐
│                  Browser / Vue 3 host                       │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────┐   │
│  │ App.vue      │  │ DocPreview.vue   │  │              │   │
│  │ (upload/UI)  │→ │ (render/UX)      │  │  other code  │   │
│  └──────────────┘  └──────────────────┘  └──────────────┘   │
│                            │                                │
│                            ▼                                │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  docParser.ts (public API: DocParser class + helpers)  │  │
│  │  ┌────────────┐ ┌─────────────┐ ┌──────────────────┐  │  │
│  │  │ oleParser  │ │ fibParser   │ │ Format Parsers │  │  │
│  │  │  (OLE2)    │ │  (FIB)      │ │ (CHPX/PAPX)    │  │  │
│  │  └────────────┘ └─────────────┘ └──────────────────┘  │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │   docParser.worker.ts (Web Worker entry)        │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │   parseWithWorker.ts (Worker + fallback)        │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

## Module Responsibilities

### `src/components/DocPreview.vue`

Vue 3 single-file component that:

- Receives `source: File | string | null` prop
- Calls the parser via `parseDocFileWithFormat` or `parseWithWorker` (for >1 MiB)
- Renders the result as styled HTML with toolbar, search, zoom, print
- Emits `error`, `loaded`, `loading` events
- Exposes `reload()`, `getPlainText()`, `focusContent()` via `defineExpose`

The parent owns the source and passes it as a prop; the component reloads when it changes.
Parsed content and transient UI state (loading, errors, search, zoom, and outline) are
held locally by the component.

### `src/App.vue`

Top-level Vue component that:

- Handles file upload (drag & drop, click, URL)
- Validates file extension and size (max 50 MiB)
- Passes the source to `DocPreview`
- Hosts the dark mode toggle
- Hosts the reader mode toggle (when preview is showing)

### `src/utils/docParser.ts` (main facade)

Exports:

- `DocParser` class — synchronous parser with `parse()` (text only) and `parseWithFormat()` (with styles)
- `parseDocFile(file)` — async helper, reads File → ArrayBuffer → parse
- `parseDocFileWithFormat(file)` — async helper, returns formatted doc
- `parseDocFileFromBuffer(buffer)` — sync helper
- `enableDebugMode()` — toggles verbose logging

Internally orchestrates:

1. `OleParser` — read the OLE2/CFB container, streams, and directory
2. `parseFib` — read text, CLX, and formatting table offsets
3. CLX/Pcdt parsing — map pieces to byte ranges and split document stories
4. Text decoding — use piece compression flags, with encoding detection as a fallback
5. Format recovery — parse CHPX/PAPX FKP runs and stylesheet data from the table stream
6. Enrichment and cleanup — extract properties, fields, pictures, and other objects; apply heuristic fallbacks when structures are unavailable

### `src/utils/oleParser.ts`

OLE2 / Compound File Binary parser:

- Validates OLE signature (8 bytes: `D0 CF 11 E0 A1 B1 1A E1`)
- Parses header (sector size, DIFAT, FAT sector locations)
- Reads FAT (sector chain table) — **cached after first read**
- Reads directory entries (128 bytes each)
- Locates the `WordDocument` stream
- Reads stream bytes by following FAT chains

The class exposes a `resetCache()` method for the rare case of mutated buffers.

### `src/utils/fibParser.ts`

Parses the File Information Block from a `WordDocument` stream:

- Validates magic (`0xa5ec` or `0xa5eb`)
- Computes the `csw → FibRgW → cslw → FibRgLw → cbRgFcLcb → rgFcLcbBlob` chain
- Returns `fcMin`, `fcMac`, `fcClx`, `lcbClx`, `fComplex`
- Falls back to partial result if buffer is too small

The `fComplex` flag indicates 8-bit compressed (1) vs UTF-16LE (0) text.

### `src/utils/parseWithWorker.ts` + `docParser.worker.ts`

Web Worker wrapper:

- `parseWithWorker(buffer, maxScanBytes?)` returns a Promise
- Uses Vite's native worker bundling: `new Worker(new URL('./docParser.worker.ts', import.meta.url), { type: 'module' })`
- The library build emits the worker as a separate chunk (`docParser.worker-[hash].js`)
- Falls back to main-thread parsing if:
  - `Worker` is undefined
  - Worker creation throws
  - Worker times out (30s)
  - Worker posts `onerror`

The buffer is **transferred** (zero-copy) to the worker via `postMessage(buf, [buf])`.

### `src/utils/logger.ts`

Simple logger class:

- Disabled by default in production
- Enable via `enableDebugMode()` (toggles global instance) or per-instance `new Logger(true)`
- Four log levels: `log`, `warn`, `error`, `info`, each prefixed with `[DOC Parser]`

### `src/utils/docFormat.ts`

Public TypeScript types for library users:

- `CharStyle`, `CharStyleSegment`, `CharacterFormat`
- `ParagraphFormat` (with `listType` / `listStyle`)
- `FormattedParagraph`, `FormattedRun` (legacy)
- `ParsedDocument`, `ParseResult`
- `CHP` / `PAP` deprecated aliases

## Parser Pipeline (Detailed)

```
.doc file (ArrayBuffer)
  │
  ▼
[OleParser.isOleFile] ── check signature ──→ false → error "not OLE"
  │ true
  ▼
[OleParser.parseHeader] ── cached ──→ { sectorSize, difat, firstDirectorySector, ... }
  │
  ▼
[OleParser.getFatSectors] ── cached ──→ int[] (chain table)
  │
  ▼
[OleParser.getDirectorySectors] ──→ DirectoryEntry[]
  │
  ▼
[OleParser.findWordDocumentStream] ── exact → case-insensitive → contains "word" → largest stream
  │
  ▼
[OleParser.readStream] ── follow FAT chains ──→ Uint8Array
  │
  ▼
[FibParser.parseFib] ── stream/table offsets and story counts ──→ FIB metadata
  │
  ▼
[CLX/Pcdt parsing] ── piece CP ranges, file offsets, compression flags, stories
  │  - Missing/invalid CLX uses bounded text-scan and encoding-detection fallbacks
  │
  ▼
[Table stream parsing] ── BTE/FKP CHPX/PAPX runs + stylesheet data
  │
  ▼
[Text and format extraction] ── decode pieces and apply character/paragraph properties
  │  - 8-bit compressed bytes or UTF-16LE, bounded by scan/character limits
  │
  ▼
[Document enrichment] ── properties, fields, images/pictures, and embedded objects
  │
  ▼
[Paragraph cleanup] ── remove binary prefixes and field instructions; retain fallbacks
  │
  ▼
[Formatted paragraphs and metadata] ── return parser result to DocPreview
  │
  ▼
[DocPreview renders as HTML] ── sanitized content + component CSS
```

## Design Decisions

### Structured format recovery and heuristic fallback

The parser reads CHPX/PAPX properties from BTE/FKP structures and applies
stylesheet data where available. These structures are the primary source for
character and paragraph formatting.

Older or malformed documents can omit or misreport table offsets. In those
cases the parser falls back to inferred formatting or plain-text rendering so
that useful content remains available instead of failing the entire preview.

### Why a Web Worker?

Parsing a `.doc` file can take 50-200ms for small files and 500ms+ for large
ones. `DocPreview` parses files up to 1 MiB on the main thread and automatically
uses a Web Worker for larger files when available. This avoids blocking the UI
for larger inputs. If Worker support is unavailable or initialization fails,
the parser falls back to the main thread.

### Why no streams in lib UMD build?

The UMD build (`doc-preview.umd.cjs`) cannot use `new URL('./...', import.meta.url)`
because UMD has no concept of module URL resolution. The library build still
emits the worker chunk for ES module consumers; UMD consumers will hit the
fallback path. This is acceptable since the fallback provides identical
functionality.

## Future Work

- Expand the real-document regression corpus across Word, WPS, and other DOC producers
- Improve visual fidelity for complex floating shapes and embedded OLE objects
- Evaluate additional memory and responsiveness improvements within the 50 MiB input limit
