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
│  │  │ oleParser  │ │ fibParser   │ │  FormatDetector  │  │  │
│  │  │  (OLE2)    │ │  (FIB)      │ │  (heuristics)    │  │  │
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

The component is **stateless regarding documents** — the parent passes a `source`
and the component re-parses whenever it changes. State is local (loading, error,
search, zoom, outline).

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

1. `OleParser` — read OLE2/CFB structure
2. `parseFib` — read FIB offsets
3. Text extraction (UTF-16LE / 8-bit) + encoding detection
4. Format inference (heuristic, not binary format tables)
5. Paragraph cleaning (binary prefix removal, field code cleanup)

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
[FibParser.parseFib] ── offsets for text/clx ──→ { fcMin, fcMac, fcClx, lcbClx, fComplex }
  │
  ▼
[Encoding detection] ── 0x0D/0x00 ratio OR null-byte distribution
  │
  ▼
[Text extraction] ── scan until 0x0D / 0x0D 0x00 paragraph breaks
  │  - ASCII pass-through for 8-bit
  │  - UTF-16LE char decoding for Unicode
  │
  ▼
[Format inference] ── heuristic for bold / font size / alignment
  │
  ▼
[Paragraph cleaning] ── strip binary prefix, field codes
  │
  ▼
[Filtered paragraphs] ── return to DocPreview as FormattedParagraph[]
  │
  ▼
[DocPreview renders as HTML] ── v-html + CSS
```

## Design Decisions

### Why heuristic format detection?

Reading Word 97-2003 CHP/PAP format tables requires implementing the full
binary spec — there is no XML representation. The library is heuristic-based
because:

1. The tables are large and complex (hundreds of fields)
2. The most common patterns (Chinese document with title + paragraphs, mixed
   text) can be reliably detected by simple rules
3. The fallback for unparseable files is graceful — we just show the text

### Why a Web Worker?

Parsing a `.doc` file can take 50-200ms for small files and 500ms+ for large
ones. The default `DocPreview` is synchronous — for files >1 MiB, the user
perceives UI freeze. The Web Worker offloads parsing to a background thread,
keeping the UI responsive. Workers are not supported in all environments, so
a graceful fallback to main-thread parsing is implemented.

### Why no streams in lib UMD build?

The UMD build (`doc-preview.umd.cjs`) cannot use `new URL('./...', import.meta.url)`
because UMD has no concept of module URL resolution. The library build still
emits the worker chunk for ES module consumers; UMD consumers will hit the
fallback path. This is acceptable since the fallback provides identical
functionality.

## Future Work

- **Binary CHP/PAP table reading** — would enable exact font/alignment/header
  detection, but requires implementing the full Word 97 spec
- **Image extraction** — `.doc` files store images in separate streams
  (e.g. `Data`, `ObjectPool`) with their own binary format (Office Art)
- **Table stream parsing** — separate `Table` stream with structured binary data
- **Web Worker streaming** — for files larger than 100 MiB, parse in chunks
