# DOC Preview

纯前端 DOC 文件预览组件，无需后端服务，支持在浏览器中直接预览 Microsoft Word (.doc) 文件。

[在线预览地址](https://zhenghy-gh.github.io/doc-preview/) - 点击此处即可在线体验，上传您的 .doc 文件即可预览

## 功能特性

- 🚀 **纯前端实现** - 不依赖任何后端服务，完全在浏览器中解析和渲染
- 📦 **零依赖** - 不依赖 mammoth.js 等第三方 DOC 解析库，自主实现 OLE/CFB 格式解析
- 🎯 **Vue 3 组件** - 提供开箱即用的 Vue 3 组件
- 📄 **格式保留** - 尽可能保留文档的原始格式（字体、对齐、段落等）
- 🔒 **隐私安全** - 文件仅在本地处理，不上传至任何服务器
- 🌐 **跨平台** - 支持所有现代浏览器

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
    <DocPreview :file="currentFile" />
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
          <DocPreview :file="currentFile" />
        </div>
      `
    }).mount('#preview-container')
  </script>
</body>
</html>
```

## API

### Props

| 属性名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `file` | `File` | 是 | 要预览的 DOC 文件对象 |

### 事件

| 事件名 | 参数 | 说明 |
|--------|------|------|
| `error` | `(error: Error)` | 解析出错时触发 |

### 示例

```vue
<template>
  <DocPreview 
    :file="currentFile"
    @error="handleError"
  />
</template>

<script setup>
const handleError = (error) => {
  console.error('DOC 解析失败:', error)
  alert('文件解析失败，请确保是有效的 DOC 文件')
}
</script>
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

## 限制

- 不支持 DOCX 格式（请使用专门的 DOCX 解析器）
- 不支持复杂的图形、图片、宏等高级特性
- 不支持修订模式、批注等协作功能

## 开发

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

访问 http://localhost:5173 查看开发服务器。

### 构建库版本

```bash
npm run build:lib
```

构建后的文件将输出到 `dist` 目录。

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
│   │   └── DocPreview.vue    # 主预览组件
│   ├── utils/
│   │   ├── docParser.ts      # DOC 解析核心
│   │   ├── docFormat.ts      # 格式工具
│   │   └── docFormatTypes.ts  # 类型定义
│   ├── App.vue               # 应用入口
│   ├── main.ts               # 主程序
│   └── style.css             # 全局样式
├── docs/                     # 测试文档
├── package.json
└── vite.config.ts
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
