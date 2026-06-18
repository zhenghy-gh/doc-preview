# DOC Preview

> A pure-frontend Vue 3 component for previewing Microsoft Word `.doc` files
> (OLE2 / CFB / Compound File Binary format) in the browser. No server, no
> upload, no backend. Search, zoom, print, dark mode, Web Worker parsing.

A **DOC file viewer** / **Word document previewer** built entirely in the browser.
A drop-in `<DocPreview>` Vue component for `.doc` (Word 97-2003) files.
Useful when you need to display Word documents on a website without sending
them to a server. Renders the original formatting (font size, bold, alignment,
list type) and supports search, zoom, print, and dark mode.

[在线预览地址](https://zhenghy-gh.github.io/doc-preview/) - 点击此处即可在线体验，上传您的 .doc 文件即可预览

## 关键词 / Keywords

`doc`, `doc-preview`, `doc-viewer`, `docx`, `docx-preview`, `word`, `word-preview`,
`word-viewer`, `microsoft word`, `ms word`, `vue`, `vue3`, `vue component`,
`preview`, `viewer`, `ole2`, `cfb`, `compound file`, `document parser`,
`word parser`, `binary parser`, `frontend`, `in-browser`, `no backend`,
`pure frontend`

## Features / 简介 (English)

- **Pure frontend**: parses and renders entirely in the browser — no upload, no
  server, no API key, no CDN dependency for parsing.
- **Vue 3 component**: drop-in `<DocPreview :source="file" />` for any Vue 3
  app; works with file upload, URL, or in-memory `File` object.
- **Microsoft Word .doc (OLE2 / CFB)**: parses the legacy Word 97-2003 binary
  format directly, including UTF-16LE and 8-bit compressed text streams, FIB
  headers, and heuristic format detection for font size / bold / alignment.
- **DOCX** is not supported by this package — for `.docx` (Open XML) files,
  use a dedicated DOCX parser. This package is the **`.doc` specialist**.
- **Web Worker parsing**: files >1 MB are parsed off the main thread so the
  UI never freezes.
- **Built-in UX**: keyword search with highlighting, zoom (50%–200%), print
  (browser print to PDF), text copy, text download, document outline / TOC.
- **Accessibility**: keyboard shortcuts, ARIA labels, skip-link, dark mode
  with `localStorage` persistence, mobile responsive.
- **Privacy**: files never leave the browser — safe for confidential docs.

### Use Cases

- A web app that needs to preview user-uploaded Word documents
- An intranet tool that displays .doc files in a browser without a server
- A document preview component for a content management system
- A privacy-first document viewer (no upload to third-party servers)

## 功能特性

- 🚀 **纯前端实现** - 不依赖任何后端服务，完全在浏览器中解析和渲染
- 📦 **零依赖** - 不依赖 mammoth.js 等第三方 DOC 解析库，自主实现 OLE/CFB 格式解析
- 🎯 **Vue 3 组件** - 提供开箱即用的 Vue 3 组件
- 📄 **格式保留** - 尽可能保留文档的原始格式（字体、对齐、段落等）
- 🔒 **隐私安全** - 文件仅在本地处理，不上传至任何服务器
- 🌐 **跨平台** - 支持所有现代浏览器
- 🎨 **暗色模式** - 支持亮色/暗色主题切换，自动持久化偏好
- 🔍 **文档搜索** - 支持关键词搜索和高亮定位
- 🔎 **缩放控制** - 支持页面缩放（50%~200%）
- 🖨️ **打印支持** - 一键打印或导出为 PDF
- 📋 **列表检测** - 自动识别编号列表和符号列表
- ⌨️ **键盘快捷键** - 完整的键盘操作支持

## 快速开始

### 在线使用

直接访问 [在线预览地址](https://zhenghy-gh.github.io/doc-preview/)，点击上传按钮选择您的 .doc 文件即可预览。

### 安装

```bash
npm install @zhenghy/doc-preview
```

### Vue 项目中使用

```vue
<template>
  <div>
    <input type="file" @change="handleFileChange" accept=".doc" />
    <DocPreview :source="currentFile" />
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { DocPreview } from '@zhenghy/doc-preview'

const currentFile = ref(null)

const handleFileChange = (event) => {
  const file = event.target.files[0]
  if (file) {
    currentFile.value = file
  }
}
</script>
```

### 独立 HTML 页面使用

```html
<!DOCTYPE html>
<html>
<head>
  <title>DOC Preview Demo</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    #preview-container { max-width: 800px; margin: 0 auto; }
  </style>
</head>
<body>
  <h1>DOC 文件预览</h1>
  
  <input type="file" id="fileInput" accept=".doc" />
  
  <div id="preview-container"></div>

  <script type="module">
    import { createApp } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js'
    import { DocPreview } from './dist/doc-preview.js'
    import './dist/style.css'

    createApp({
      components: { DocPreview },
      data() {
        return {
          currentFile: null
        }
      },
      methods: {
        handleFileChange(event) {
          const file = event.target.files[0]
          if (file) {
            this.currentFile = file
          }
        }
      },
      template: `
        <div>
          <input type="file" @change="handleFileChange" accept=".doc" />
          <DocPreview :source="currentFile" />
        </div>
      `
    }).mount('#preview-container')
  </script>
</body>
</html>
```

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+F` / `Cmd+F` | 打开搜索栏 |
| `F3` / `Ctrl+G` | 下一个匹配项 |
| `Shift+F3` / `Ctrl+Shift+G` | 上一个匹配项 |
| `Esc` | 关闭搜索栏 |
| `Ctrl+P` / `Cmd+P` | 打印/导出 PDF |
| `Ctrl+=` / `Ctrl++` | 放大 |
| `Ctrl+-` | 缩小 |
| `Ctrl+0` | 重置缩放 |

## API

### Props

| 属性名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `source` | `File \| string \| null` | 是 | 要预览的 DOC 文件对象或远程 URL 地址 |

### 事件

| 事件名 | 参数 | 说明 |
|--------|------|------|
| `error` | `(message: string)` | 解析出错时触发 |
| `loaded` | `()` | 文档成功解析后触发 |
| `loading` | `(isLoading: boolean)` | 加载开始/结束时触发 |

### 组件方法（通过 ref 暴露）

```ts
const previewRef = ref()

// 重新加载当前文档
previewRef.value?.reload()

// 获取解析后的纯文本
const text = previewRef.value?.getPlainText()
```

### 导出函数

| 函数名 | 说明 |
|--------|------|
| `parseDocFile(file)` | 解析 .doc 文件，返回纯文本 |
| `parseDocFileWithFormat(file)` | 解析 .doc 文件，返回带格式的文档数据 |
| `parseDocFileFromBuffer(buffer)` | 从 ArrayBuffer 解析 .doc 文件（同步） |
| `parseWithWorker(buffer, maxScanBytes?)` | 在 Web Worker 中解析（异步，大文件不阻塞 UI） |
| `enableDebugMode()` | 启用调试日志输出 |
| `DocParser` | 解析器类（可自定义 `maxScanBytes`） |

### 事件与方法示例

```vue
<template>
  <DocPreview 
    ref="previewRef"
    :source="currentFile"
    @error="handleError"
    @loaded="onLoaded"
    @loading="onLoading"
  />
  <button @click="previewRef?.reload()">重新加载</button>
</template>

<script setup>
import { ref } from 'vue'
import { DocPreview } from '@zhenghy/doc-preview'

const previewRef = ref()
const currentFile = ref()

function handleError(msg) { console.error('DOC 解析失败:', msg) }
function onLoaded() { console.log('文档已加载') }
function onLoading(isLoading) { console.log('加载中:', isLoading) }
</script>
```

### 自定义扫描上限

```ts
import { DocParser } from '@zhenghy/doc-preview'

const buffer = await file.arrayBuffer()
// 自定义扫描上限为 5MB（默认 10MB）
const parser = new DocParser(buffer, 5 * 1024 * 1024)
const result = parser.parseWithFormat()
```

### Web Worker 解析

> 自动行为：DocPreview 组件内部会在 `source` 超过 1MB 时自动使用 Worker。
> 如果你在代码中直接使用 `parseWithWorker`，可以手动管理。

```ts
import { parseWithWorker } from '@zhenghy/doc-preview'

const buffer = await file.arrayBuffer()
const result = await parseWithWorker(buffer, 10 * 1024 * 1024)

if (result.success) {
  console.log('段落数:', result.document?.paragraphs.length)
} else {
  console.error('失败:', result.error)
}
```

## 工作原理

本项目完全自主实现了 Microsoft Word 文档的解析器，包括：

1. **OLE/CFB 格式解析** - 解析复合文档格式，获取文档数据流
2. **FIB (File Information Block) 解析** - 读取文档结构信息
3. **文本提取** - 从 Word 6.0/95 格式中提取文本内容
4. **格式信息提取** - 获取字体、字号、对齐等格式信息
5. **HTML 渲染** - 将解析结果转换为 HTML 格式在浏览器中展示

## 支持的格式

- ✅ Microsoft Word 6.0/95 (.doc)
- ✅ OLE 复合文档格式
- ✅ ANSI 和 Unicode 编码的中文文档
- ✅ 基本格式（字体、字号、对齐、加粗、下划线）

## 浏览器支持

| 浏览器 | 最低版本 | Web Worker | 备注 |
|--------|---------|-----------|------|
| Chrome  | 80+     | ✅        | 推荐 |
| Edge    | 80+     | ✅        | Chromium 内核 |
| Firefox | 75+     | ✅        | 支持 Worker |
| Safari  | 14+     | ✅        | macOS 11+/iOS 14+ |
| IE 11   | ❌      | ❌        | 不支持 |

> 📌 较老的浏览器会自动降级到主线程解析。功能完整，但大文件可能阻塞 UI。

## 性能

- **<1MB 文件**: 同步解析（主线程）
- **≥1MB 文件**: Web Worker 解析（自动）
- **默认扫描上限**: 10MB（可配置 `maxScanBytes`）
- **典型解析速度**:
  - 小型 (<100KB): <50ms
  - 中型 (1MB): ~200ms
  - 大型 (10MB): ~1.5s (Worker 中)

## 限制

- 不支持 DOCX 格式（请使用专门的 DOCX 解析器）
- 不支持复杂的图形、图片、宏等高级特性
- 不支持修订模式、批注等协作功能
- 格式检测基于启发式规则，不读取完整的 CHP/PAP 格式表
- 某些由 macOS `textutil` 生成的 .doc 文件可能需要手动调整 fComplex 标志

## 开发

详细的架构说明请参阅 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

访问 http://localhost:5173 查看开发服务器。

### 单元测试

```bash
npm test
```

### 监听模式测试

```bash
npm run test:watch
```

### 类型检查

```bash
npx vue-tsc --noEmit
```

### 构建库版本

```bash
npm run build:lib
```

构建后的文件将输出到 `dist` 目录，含 ES + UMD 双格式和 `.d.ts` 类型声明。

### 构建文档预览版本

```bash
npm run build
```

## 技术栈

- Vue 3 - 前端框架
- TypeScript - 类型安全
- Vite - 构建工具
- OLE/CFB - Microsoft Office 文档格式

## AI Coding 介绍

本项目是 AI 辅助编程的典型实践案例，大量使用 AI 工具进行开发和优化：

### 开发过程中的 AI 应用

- **代码编写** - AI 辅助实现 OLE/CFB 复合文档格式解析器
- **问题调试** - AI 帮助定位和修复各种解析问题（乱码、格式错误、边界情况）
- **架构设计** - AI 参与项目架构和模块划分
- **文档完善** - AI 辅助编写 API 文档和使用示例
- **部署优化** - AI 帮助解决 GitHub Pages 和 npm 发布问题

### AI 工具使用

- **代码补全与生成** - 快速实现复杂的二进制解析逻辑
- **错误诊断** - 定位解析过程中的各种边界问题
- **优化建议** - 提供性能优化和代码改进建议
- **测试用例** - 辅助设计测试场景和边界条件

### 项目亮点

本项目展示了如何在 AI 辅助下，从 0 到 1 实现一个复杂的文件格式解析器，包括：
- 深入理解 Microsoft OLE/CFB 二进制格式规范
- 实现完整的 DOC 文件解析流程
- 处理各种编码和格式兼容性问题
- 发布高质量的 npm 包和在线演示

这是 AI 编程时代的一个典型项目案例，展示了 AI 如何大幅提升开发效率。

## 项目结构

```
doc-preview/
├── src/
│   ├── components/
│   │   └── DocPreview.vue           # 主预览组件（工具栏/搜索/缩放/打印/大纲）
│   ├── utils/
│   │   ├── logger.ts                # 日志工具
│   │   ├── oleParser.ts             # OLE2/CFB 复合文档结构解析
│   │   ├── fibParser.ts             # FIB (File Information Block) 解析
│   │   ├── docParser.ts             # 文本提取 + 格式推断 + 公开 API
│   │   ├── docParser.worker.ts      # Web Worker 入口
│   │   ├── parseWithWorker.ts       # Worker 封装 + 主线程降级
│   │   └── docFormat.ts             # 类型定义
│   ├── App.vue                      # 应用入口（上传/拖拽/URL 加载）
│   ├── index.ts                     # 库导出入口
│   ├── main.ts                      # 开发模式入口
│   ├── vite-env.d.ts                # Vite 类型声明
│   └── style.css                    # 全局样式 / CSS 变量 / 暗色主题
├── public/
│   ├── favicon.svg                  # 自定义图标
│   └── 404.html                     # GitHub Pages SPA 路由
├── tests/                           # Vitest 单元测试 (30+ tests)
│   ├── logger.test.ts
│   ├── fibParser.test.ts
│   ├── oleParser.test.ts
│   └── docParser.test.ts
├── .github/workflows/deploy.yml     # CI: type-check + test + build + deploy
├── LICENSE                          # MIT 许可证
├── package.json
├── vite.config.ts
└── vitest.config.ts
```

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## GitHub

- 仓库地址：[https://github.com/zhenghy-gh/doc-preview](https://github.com/zhenghy-gh/doc-preview)
- NPM 包：[https://www.npmjs.com/package/@zhenghy/doc-preview](https://www.npmjs.com/package/@zhenghy/doc-preview)

## 在线演示

[立即体验 DOC Preview](https://zhenghy-gh.github.io/doc-preview/)

点击上方的链接即可打开在线演示页面，无需安装任何软件，直接上传您的 .doc 文件即可预览效果。
