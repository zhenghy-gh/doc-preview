# doc-preview

纯前端的 Vue 3 组件，在浏览器里直接解析并渲染 Word `.doc`（Word 97-2003 / OLE2）文件。

**文件不上传、不需要后端、不需要 API Key。** 解析器按微软公开规范（MS-DOC / MS-CFB）自行实现，不依赖 mammoth.js 等第三方库。

[![npm](https://img.shields.io/npm/v/@zhenghy/doc-preview.svg)](https://www.npmjs.com/package/@zhenghy/doc-preview)
[![downloads](https://img.shields.io/npm/dm/@zhenghy/doc-preview.svg)](https://www.npmjs.com/package/@zhenghy/doc-preview)
[![license](https://img.shields.io/npm/l/@zhenghy/doc-preview.svg)](LICENSE)

- 在线体验：<https://zhenghy-gh.github.io/doc-preview/>
- 功能清单：[FEATURES.md](FEATURES.md) ｜ [English](README.en.md)

## 安装

```bash
npm install @zhenghy/doc-preview
```

同时提供非 scoped 别名 `doc-preview`，两者内容一致。

## 使用

### Vue 3 组件

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

同时提供 UMD 版本 `dist-lib/doc-preview.umd.cjs`（全局变量 `window.DocPreview`）。

### 只解析、不渲染

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

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `source` | `File \| string \| null` | — | 要预览的 `.doc` 文件，或可下载该文件的地址 |
| `useWebFont` | `boolean` | `false` | 是否启用 Web 字体渲染 |

### 事件

| 事件 | 参数 | 说明 |
| --- | --- | --- |
| `loaded` | `()` | 解析完成 |
| `loading` | `(isLoading: boolean)` | 加载状态变化 |
| `error` | `(message: string)` | 解析失败 |

### 实例方法

通过模板 `ref` 调用。

| 方法 | 说明 |
| --- | --- |
| `reload()` | 重新加载当前文档 |
| `getPlainText()` | 获取解析后的纯文本 |
| `focusContent()` | 把焦点移到文档内容区 |

### 导出函数

| 导出 | 说明 |
| --- | --- |
| `DocPreview` | 预览组件（也是默认导出） |
| `parseDocFile(file, debug?)` | 解析 `.doc`，返回纯文本 |
| `parseDocFileWithFormat(file, debug?)` | 解析并返回带格式的文档数据 |
| `parseDocFileFromBuffer(buffer, fileName?)` | 从 `ArrayBuffer` 同步解析 |
| `parseWithWorker(buffer, maxScanBytes?, onProgress?)` | 在 Web Worker 中解析 |
| `DocParser` | 解析器类，可自定义 `maxScanBytes` |
| `enableDebugMode()` | 打开调试日志 |

> 组件在文件 ≥ 1 MB 时会自动走 Worker，无需手动调用 `parseWithWorker`。

## 键盘快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl/Cmd + F` | 打开搜索栏 |
| `F3` / `Ctrl + G` | 下一个匹配项 |
| `Shift + F3` / `Ctrl + Shift + G` | 上一个匹配项 |
| `Esc` | 关闭搜索栏 |
| `Ctrl/Cmd + P` | 打印 / 导出 PDF |
| `Ctrl/Cmd + =` / `-` / `0` | 放大 / 缩小 / 重置缩放 |
| `?` | 打开快捷键面板 |

## 支持情况

**支持**

- Word 97-2003 `.doc`、Word 6.0 / 95，以及 `.dot` 模板
- 文本：UTF-16LE 与 8-bit 压缩编码，自动识别（含 macOS `textutil` 生成的文件）
- 字符格式：字体、字号、加粗、斜体、下划线、删除线、上下标、颜色、高亮、边框 / 底纹、字符间距
- 段落格式：对齐、缩进、行距、段前段后间距、大纲级别、底纹、边框、制表位
- 样式、列表（多级 / 编号续接）、表格（边框 / 合并 / 嵌套 / 对齐）
- 分节、分页、页眉页脚（首页 / 奇偶页）
- 图片、形状、文本框、公式（→ LaTeX）、图表、艺术字
- 超链接、书签、页码域、交叉引用、索引、目录
- 修订痕迹（标记 / 接受 / 拒绝）
- 界面：搜索、缩放、打印、导出 Markdown、大纲导航、暗色模式、中英文切换

**不支持**

- **DOCX**（Open XML）— 本包只处理 `.doc`
- VBA 宏、ActiveX 控件、加密文档
- 部分高级图形效果（3D / 渐变 / 艺术效果）会简化渲染

## 浏览器

Chrome 80+ / Edge 80+ / Firefox 75+ / Safari 14+，均支持 Web Worker。老浏览器自动降级到主线程解析（功能完整，大文件可能卡顿）。

## 本地开发

```bash
npm install
npm run dev            # 开发服务器 http://localhost:5173
npm test               # 单元测试（用例数随版本增长，以命令输出为准）
npm run lint           # 代码检查
npm run scan:corpus    # 27 份真实语料健康扫描（解析/分页/控制字符/NFC）
npm run audit:print    # 预览页数 ↔ 打印布局对照审计 → tests/fixtures/print-layout-audit.json
npm run build:lib      # 构建库产物 → dist-lib
npm run build          # 构建演示站点 → dist
npm run release        # 发布到 npm（同时发布 scoped 与非 scoped 两个包名）
```

## 许可证

[MIT](LICENSE) © zhenghy
