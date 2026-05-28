# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

纯前端 `.doc` 文件在线预览工具。核心是一个基于 Vue 3 + TypeScript + Vite 的 OLE2/CFB 复合文档解析器，无需服务端支持即可解析 `.doc` 文件中的文本和基础格式信息。

## Commands

```bash
# 启动开发服务器 (默认 http://localhost:5173)
npm run dev

# 构建生产版本 (vue-tsc 类型检查 + vite build)
npm run build

# 预览构建产物
npm run preview
```

注意：该项目使用 npm，提交代码前确保 `package-lock.json` 已更新。

## Project Structure

```
src/
  main.ts                 # 应用入口
  App.vue                 # 主页面：文件拖拽/选择上传，切换到 DocPreview
  style.css               # 全局样式
  components/
    DocPreview.vue        # 文档预览组件：调用 parser 解析 .doc，渲染为 HTML
  utils/
    docParser.ts          # 核心解析器：OLE2 格式解析、FIB 解析、文本/格式提取
    docFormat.ts          # 格式化类型定义 (CharacterFormat, ParagraphFormat 等)
    docFormatTypes.ts     # 旧的/备选类型定义
    docParser copy.ts     # 旧版解析器备份

Python 分析工具 (根目录):
  analyze_format.py       # 分析 .doc 二进制中的字符格式（下划线检测等）
  check_binary.py         # 扫描 .doc 二进制中特定文本和冒号

测试脚本 (根目录，多为 Playwright E2E 测试):
  test_*.py / test_*.mjs  # 针对解析器的各种功能和边界测试
```

## Architecture

### .doc Parser (`src/utils/docParser.ts`)

解析流程遵循 OLE2 复合文档规范：

1. **OLE2 签名验证** — 检查 D0 CF 11 E0 A1 B1 1A E1 魔数
2. **文件头解析** — 读取扇区大小、DIFAT/FAT 位置等元信息
3. **FAT/DIFAT 表解析** — 构建扇区分配表
4. **目录表解析** — 查找 WordDocument 流
5. **FIB (File Information Block) 解析** — 读取 fcClx/lcbClx 定位文本和格式数据
6. **文本提取** — 通过 Clx/Pcdt 结构或直接扫描 UTF-16LE 编码提取段落
7. **格式推断（启发式）** — 所有格式均通过文本特征推断，不解析 CHP/PAP 格式表：
   - **字体大小**：含 ≥2 汉字 → 正文(16px)，标题短文本(6字内→36px，其余→22px)
   - **加粗**：短文本(≤18字符) + 高中文比 + 无句末标点 → 标题加粗
   - **下划线**：冒号后的值文本、日期/时间数字 → 下划线（多冒号行用邻近检测避免误标标签段）
   - **对齐**：短标题 → 居中；纯中文名(后半段)和日期行 → 右对齐

两条解析路径：
- `parse()` — 只提取纯文本
- `parseWithFormat()` — 提取文本 + 格式信息（段落、字符样式），在 DocPreview.vue 中使用

### DocPreview 渲染

`DocPreview.vue` 接收 parseWithFormat 的结果，将段落按以下优先级渲染为 HTML：
1. 如果解析器返回了字符级样式 (`charFormat.styles`) — 逐字符应用字体/下划线
2. 如果只有段落级格式 — 使用整体字体/对齐/加粗设置
3. 纯文本降级 — 短文本居中加粗作为标题，其余正文

字体尺寸映射（基于 half-points 到 CSS px）：
- 36 half-pts → 2.25rem (36px，小初)
- 22 half-pts → 1.375rem (22px，二号)
- 16 half-pts → 1.0rem (16px，正文)
- 12 half-pts → 0.75rem (12px)

### 关键类型 (`src/utils/docFormat.ts`)

- `CharacterFormat` — fontName, fontSize, bold, italic, underline, color, highlight
- `ParagraphFormat` — alignment, indent, lineSpacing, spaceBefore, spaceAfter
- `ParsedDocument` — paragraphs: FormattedText[]
- `ParseResult` — success, document?, text?, error?

### 关键类型 (`src/utils/docFormat.ts`)

- `CharacterFormat` — fontName, fontSize, bold, italic, underline, color, highlight
- `ParagraphFormat` — alignment, indent, lineSpacing, spaceBefore, spaceAfter
- `ParsedDocument` — paragraphs: FormattedText[]
- `ParseResult` — success, document?, text?, error?

## Testing

测试多为 **Playwright E2E 测试**，启动 dev server 后操作真实浏览器：

```bash
# 先启动 dev server
npm run dev

# 单独运行测试脚本
npx playwright test path/to/test_file.mjs
node test_format.mjs
node test_format.py   # 如果安装了 playwright-python
```

Python 测试脚本使用 `playwright` (python) 或 `chromium` (node) 启动无头浏览器，上传 `.doc` 文件，然后验证渲染结果（对齐方式、字体大小、加粗等）。

## Known Issues & Gotchas

- 解析器**完全依赖启发式推断格式**，不解析 Word 97-2003 的 CHP/PAP 格式表。这意味着下划线、字体、字号等格式来自文本特征分析而非文档二进制结构，对非标准排版格式的文档可能不准确
- 多冒号行（如 "讯 问 人：张四 记 录 人：李三"）的下划线推断使用邻近检测，靠近下一个冒号的字符不会被加下划线，但中间过渡字符可能被误标
- 签名日期行的数字可能被误加下划线（启发式无法区分"讯问时间"和"签名日期"）
- `docParser.ts` 有 `DEBUG_MODE = true` 常量，控制调试日志输出
- 项目包含一个样本文件 `6a164d2b7d5a1fdadbc11541.doc` 用于测试
- Vite resolve 别名 `@` 指向 `src/` 目录
- 确认无任何硬编码的文档特定模式（如"问：/答："检测）；所有规则均基于通用文本特征
