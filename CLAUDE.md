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
```

## Architecture

### .doc Parser (`src/utils/docParser.ts`)

解析流程遵循 OLE2 复合文档规范：

1. **OLE2 签名验证** — 检查 D0 CF 11 E0 A1 B1 1A E1 魔数
2. **文件头解析** — 读取扇区大小、DIFAT/FAT 位置等元信息
3. **FAT/DIFAT 表解析** — 构建扇区分配表（FAT 数组按扇区号索引，`fat[sectorNumber] = nextSector`）
4. **目录表解析** — 查找 WordDocument 流
5. **FIB (File Information Block) 解析** — 读取 fcClx/lcbClx 定位文本和格式数据。注意：**FibRgW/cslw/cbRgFcLcb 的偏移量取决于 csw 值**（csw 在 offset 32，FibRgW 在 offset 34，cslw 在 offset 34+csw*2，依此类推）
6. **文本提取** — 通过 Clx/Pcdt 结构或直接扫描编码提取段落
7. **格式推断（启发式）** — 所有格式均通过文本特征推断，不解析 CHP/PAP 格式表

两条解析路径：
- `parse()` — 只提取纯文本
- `parseWithFormat()` — 提取文本 + 格式信息（段落、字符样式），在 DocPreview.vue 中使用

### FIB 解析

关键逻辑在 `parseFib()` 中：
- 读取 Byte 12 的 bit 0 作为 `fComplex` 标志（1=8-bit 压缩，0=UTF-16LE）
- 通过 csw->FibRgW->cslw->FibRgLw->cbRgFcLcb 的链式计算 rgFcLcb 偏移
- `cbRgFcLcb < 16` 视为无有效偏移，回退到自动检测
- 已知问题：macOS `textutil` 创建的 .doc 文件 byte 12 始终为 0xBF，fComplex 不可靠

### 编码自动检测

当 FIB 无有效 fcMin/fcMac 时（常见于 textutil 创建的文件），使用 `detectEncodingFromBinary()` 方法：

1. 从 WordDocument 流 offset 2048 开始扫描 0x0D 字节
2. 计算 0x0D 后跟 0x00 的比例
3. **比例 < 30% → 8-bit 压缩**（段落标记为单独 0x0D）
4. **比例 >= 30% → UTF-16LE**（段落标记为 0x0D 0x00）
5. 如果无法通过二进制判断（无 0x0D），回退到评分机制：尝试两种编码并对结果评分

### 二进制前缀清除

`stripBinaryPrefix()` 处理第一个段落中的 FIB 头部噪声：
- **8-bit 模式**：检测高字节（>0x7E）比例，用 `\b[A-Z][a-z]+\b` 或元音单词定位正文起始
- **UTF-16LE 模式**：检测 CJK/ASCII 交替模式（FIB 噪声特征），定位第一个连续 4+ 中文字符
- 在 `filterParagraphsWithGenericLogic` 中对 filtered[0] 调用

### DocPreview 渲染

`DocPreview.vue` 接收 parseWithFormat 的结果，将段落按以下优先级渲染为 HTML：
1. 如果解析器返回了字符级样式 (`charFormat.styles`) — 逐字符应用字体/下划线
2. 如果只有段落级格式 — 使用整体字体/对齐/加粗设置
3. 纯文本降级 — 短文本居中加粗作为标题，其余正文

### 关键类型 (`src/utils/docFormat.ts`)

- `CharacterFormat` — fontName, fontSize, bold, italic, underline, color, highlight
- `ParagraphFormat` — alignment, indent, lineSpacing, spaceBefore, spaceAfter
- `ParsedDocument` — paragraphs: FormattedText[]
- `ParseResult` — success, document?, text?, error?

## Known Issues & Gotchas

- 解析器**完全依赖启发式推断格式**，不解析 Word 97-2003 的 CHP/PAP 格式表
- 编码自动检测依赖 0x0D/0x00 二进制模式。对于无段落标记（无 0x0D）的 Word 95 文件，回退评分可能误选编码
- `detectEncodingFromBinary` 从 offset 2048 开始扫描，以避免 FIB 头部中的伪 0x0D
- `stripBinaryPrefix` 的 CJK 噪声检测（`[一-鿿]{4,}`）在 FIB 噪声 CJK 字符紧邻真实 CJK 文本时可能残留 1 个字符
- FAT 表实现：`fat = new Array(totalSectors).fill(-2)`，DIFAT 中每个条目对应 `d * entriesPerSector` 个扇区
- 流读取：使用 `sectorToOffset(currentSector)` 而非 `sectorToOffset(fat[currentSector])` 计算物理偏移
- App.vue 的 `isValidFile` 同时接受 `.doc` 和 `.dot` 扩展名
- `docParser.ts` 有 `DEBUG_MODE = true` 常量，控制调试日志输出
- Vite resolve 别名 `@` 指向 `src/` 目录
- 确认无任何硬编码的文档特定模式；所有规则均基于通用文本特征
