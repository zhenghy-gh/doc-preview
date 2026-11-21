# doc-preview

A pure front-end Vue 3 component that parses and renders Microsoft Word `.doc` (Word 97-2003 / OLE2) files directly in the browser.

**No file upload, no backend, no API key.** The parser is implemented from the public Microsoft specs (MS-DOC / MS-CFB) instead of relying on libraries such as mammoth.js.

[![npm](https://img.shields.io/npm/v/@zhenghy/doc-preview.svg)](https://www.npmjs.com/package/@zhenghy/doc-preview)
[![downloads](https://img.shields.io/npm/dm/@zhenghy/doc-preview.svg)](https://www.npmjs.com/package/@zhenghy/doc-preview)
[![license](https://img.shields.io/npm/l/@zhenghy/doc-preview.svg)](LICENSE)

- Live demo: <https://zhenghy-gh.github.io/doc-preview/>
- Feature list: [FEATURES.md](FEATURES.md) ｜ [简体中文](README.md)

## Install

```bash
npm install @zhenghy/doc-preview
```

An unscoped alias `doc-preview` is also published with identical contents.

## Usage

### Vue 3 component

```vue
<template>
  <input type="file" accept=".doc" @change="onChange" />
  <DocPreview :source="file" />
</template>

<script setup>
import { ref } from 'vue'
import { DocPreview } from '@zhenghy/doc-preview'
import '@zhenghy/doc-preview/style.css'

const file = ref(null)
const onChange = (e) => (file.value = e.target.files?.[0] ?? null)
</script>
```

### CDN

```html
<link rel="stylesheet" href="https://unpkg.com/@zhenghy/doc-preview/dist-lib/style.css" />

<script type="module">
  import { DocPreview } from 'https://unpkg.com/@zhenghy/doc-preview/dist-lib/doc-preview.js'
</script>
```

A UMD build is shipped as `dist-lib/doc-preview.umd.cjs` (global `window.DocPreview`).

### Parse only, no rendering

```ts
import { parseDocFileWithFormat } from '@zhenghy/doc-preview'

const result = await parseDocFileWithFormat(file)
if (result.success) {
  console.log(result.document?.paragraphs)
} else {
  console.error(result.error)
}
```

## API

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `source` | `File \| string \| null` | — | The `.doc` file to preview, or a URL it can be downloaded from |
| `useWebFont` | `boolean` | `false` | Enable Web font rendering |

### Events

| Event | Payload | Description |
| --- | --- | --- |
| `loaded` | `()` | Parsing finished |
| `loading` | `(isLoading: boolean)` | Loading state changed |
| `error` | `(message: string)` | Parsing failed |

### Instance methods

Call via a template `ref`.

| Method | Description |
| --- | --- |
| `reload()` | Reload the current document |
| `getPlainText()` | Get the parsed plain text |
| `focusContent()` | Move focus into the document body |

### Exported functions

| Export | Description |
| --- | --- |
| `DocPreview` | Preview component (also the default export) |
| `parseDocFile(file, debug?)` | Parse a `.doc` file, returns plain text |
| `parseDocFileWithFormat(file, debug?)` | Parse and return formatted document data |
| `parseDocFileFromBuffer(buffer, fileName?)` | Synchronous parse from an `ArrayBuffer` |
| `parseWithWorker(buffer, maxScanBytes?, onProgress?)` | Parse in a Web Worker |
| `DocParser` | Parser class with a configurable `maxScanBytes` |
| `enableDebugMode()` | Turn on debug logging |

> The component automatically uses the Worker for files ≥ 1 MB, so you never need to call `parseWithWorker` yourself.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + F` | Open the search bar |
| `F3` / `Ctrl + G` | Next match |
| `Shift + F3` / `Ctrl + Shift + G` | Previous match |
| `Esc` | Close the search bar |
| `Ctrl/Cmd + P` | Print / export PDF |
| `Ctrl/Cmd + =` / `-` / `0` | Zoom in / out / reset |
| `?` | Open the shortcuts panel |

## Support

**Supported**

- Word 97-2003 `.doc`, Word 6.0 / 95, and `.dot` templates
- Text: UTF-16LE and 8-bit compressed encodings, auto-detected (including files produced by macOS `textutil`)
- Character formatting: font, size, bold, italic, underline, strike, super/subscript, color, highlight, borders / shading, character spacing
- Paragraph formatting: alignment, indents, line spacing, space before/after, outline level, shading, borders, tab stops
- Styles, lists (multi-level / numbering continuation), tables (borders / merges / nesting / alignment)
- Sections, pagination, headers and footers (first page / odd / even)
- Images, shapes, text boxes, equations (→ LaTeX), charts, WordArt
- Hyperlinks, bookmarks, page-number fields, cross-references, index, table of contents
- Tracked changes (marks / accept / reject)
- UI: search, zoom, print, Markdown export, outline navigation, dark mode, zh/en switch

**Not supported**

- **DOCX** (Open XML) — this package only handles `.doc`
- VBA macros, ActiveX controls, encrypted documents
- Some advanced graphic effects (3D / gradients / artistic effects) are rendered in simplified form

## Browsers

Chrome 80+ / Edge 80+ / Firefox 75+ / Safari 14+, all with Web Worker support. Older browsers fall back to main-thread parsing (full functionality, large files may block the UI).

## Development

```bash
npm install
npm run dev            # dev server at http://localhost:5173
npm test               # unit tests (count grows with releases; see command output)
npm run lint           # lint
npm run scan:corpus    # health scan over 27 real .doc corpora
npm run audit:print    # preview-vs-print layout audit → tests/fixtures/print-layout-audit.json
npm run audit:i18n     # i18n key audit over src/**/*.{ts,vue} (non-zero exit on missing keys)
npm run build:lib      # build the library → dist-lib
npm run build          # build the demo site → dist
npm run release        # publish to npm (both scoped and unscoped names)
```

## License

[MIT](LICENSE) © zhenghy
