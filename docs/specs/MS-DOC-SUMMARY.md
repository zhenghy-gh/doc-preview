# [MS-DOC] Word (.doc) Binary File Format — 总览摘要

> 规范版本: v12.5 (2026-02-17)
> 官方 PDF: https://officeprotocoldocs-f5hpbjgea6b8gneq.b02.azurefd.net/files/MS-DOC/%5bMS-DOC%5d.pdf
> 在线文档: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc

本文件是 MS-DOC 规范的**精简总览**，用于快速理解 Word 二进制文档的整体结构。详细结构见各子文档。

---

## 1. 概述

Word 二进制文件格式（.doc）是 Microsoft Word 97 至 Word 2003 使用的文件格式。它基于 OLE2/CFB 复合文档格式，将文档数据存储在多个流中。

### 适用版本

- Microsoft Word 97
- Microsoft Word 2000
- Microsoft Word 2002 (XP)
- Microsoft Office Word 2003
- Microsoft Office Word 2007（兼容模式）

---

## 2. 文档结构总览

### OLE 存储中的主要流

| 流名称 | 作用 | 必须 |
|--------|------|------|
| `WordDocument` | 主文档流，包含 FIB 和文本内容 | ✅ |
| `0Table` 或 `1Table` | 包含表格流（Clx、样式表等） | ✅ |
| `SummaryInformation` | 文档属性（标题、作者等） | ❌ |
| `DocumentSummaryInformation` | 扩展文档属性 | ❌ |
| `Data` | 包含图片、OLE 对象等数据 | ❌ |

> **注意**：`0Table` 和 `1Table` 是互斥的，使用哪个由 FIB 中的 `fWhichTblStm` 标志决定。

---

## 3. WordDocument 流结构

WordDocument 流是文档的核心，按顺序包含：

```
+-----------------------+
| FIB                   |  File Information Block (可变大小)
+-----------------------+
| 其他数据              |  (取决于 FIB 中的偏移)
|                       |
|  ...                  |
+-----------------------+
```

### FIB (File Information Block)

FIB 是 Word 文档的"目录"，包含指向文档各部分数据的偏移和大小。

详细说明：[MS-DOC-FIB.md](./MS-DOC-FIB.md)

---

## 4. 表格流 (0Table / 1Table)

表格流包含各种文档结构表，由 FIB 中的偏移量引用。

### 重要表格

| 结构 | FIB 中的偏移字段 | 作用 |
|------|------------------|------|
| **Clx** | `fcClx` / `lcbClx` | 包含 Pcdt（文本位置表）和 Prl 格式信息 |
| STTBF (样式表) | `fcStshf` / `lcbStshf` | 样式定义表 |
| CHP 格式数据 | `fcPlcfBteChpx` / `lcbPlcfBteChpx` | 字符属性表 |
| PAP 格式数据 | `fcPlcfBtePapx` / `lcbPlcfBtePapx` | 段落属性表 |
| 文档结构表 | ... | 各种其他表 |

---

## 5. Clx / Pcdt / PlcPcd 结构

Clx 是文本提取的关键结构，包含 Piece Table（文本片段表）。

### 结构层级

```
Clx
 ├── Pcdt (Piece Descriptor Table)
 │    └── PlcPcd (Piece Table)
 │         ├── n (piece 数量)
 │         ├── rgCcp (字符位置数组, n+1 个)
 │         └── rgPcd (PCD 条目数组, n 个)
 │              └── 每个 PCD (8 字节):
 │                   ├── fc (4 字节): 文件偏移 + 压缩标志
 │                   └── prm (2 字节): 属性修饰符
 │              （共 8 字节：2 字节保留 + 4 字节 fc + 2 字节 prm）
 └── Prl (可选，格式属性)
```

### PCD 条目详解

每个 PCD（Piece Descriptor）8 字节：

| 偏移 | 大小 | 字段 | 说明 |
|------|------|------|------|
| 0 | 2 | 保留 | 未使用 |
| 2 | 4 | `fc` | 文件偏移 + 压缩标志 |
| 6 | 2 | `prm` | 属性修饰符 |

**fc 字段（4 字节）的位布局**：
- Bit 30: `fCompressed` — 0 = UTF-16LE, 1 = 8-bit 压缩
- Bits 29-0: 实际文件偏移

详细说明：[MS-DOC-CLX.md](./MS-DOC-CLX.md)

---

## 6. 文本提取流程

### 基本步骤

```
1. 解析 OLE 复合文档
2. 找到 WordDocument 流
3. 解析 FIB，获取 fcClx / lcbClx
4. 从 0Table/1Table 流中读取 Clx 数据
5. 解析 Clx → Pcdt → PlcPcd
6. 遍历每个 piece:
   a. 从 PCD 获取 fc 和 fCompressed
   b. 根据 fCompressed 计算字节数
   c. 从 WordDocument 流中读取文本
   d. 解码为字符（UTF-16LE 或 8-bit）
7. 按顺序拼接所有 piece 的文本
```

### 多 Story 概念

Word 文档包含多个 story（独立文本区域）：

| Story 类型 | 说明 |
|------------|------|
| 主文档 (Main Document) | 正文内容 |
| 页眉 (Header) | 每页顶部 |
| 页脚 (Footer) | 每页底部 |
| 脚注 (Footnote) | 脚注内容 |
| 尾注 (Endnote) | 尾注内容 |
| 文本框 (Textbox) | 浮动文本框 |
| ... | 其他 |

> **重要**：PlcPcd 中的 piece 按 story 组织，第一个 piece 是主文档。

---

## 7. 格式数据结构

### 字符属性 (CHP)

CHP (Character Properties) 定义了字符级别的格式：
- 字体、字号、加粗、斜体、下划线
- 颜色、高亮、删除线
- 上标/下标、字符间距等

存储位置：PlcfBteChpx 表格，存储在 0Table/1Table 流中

### 段落属性 (PAP)

PAP (Paragraph Properties) 定义了段落级别的格式：
- 对齐方式、缩进
- 行距、段前段后间距
- 边框、底纹、制表位
- 样式引用等

存储位置：PlcfBtePapx 表格，存储在 0Table/1Table 流中

### 样式表 (STTBF)

STTBF (String Table, File) 包含文档中所有样式的定义。

---

## 8. 规范章节索引

| 章节 | 内容 | 对应文档 |
|------|------|----------|
| §1 | 简介和约定 | 本文档 |
| §2 | 结构示例 | 本文档 |
| §2.5.1 | FIB 结构 | [MS-DOC-FIB.md](./MS-DOC-FIB.md) |
| §2.5.6 | Clx/Pcdt/PlcPcd | [MS-DOC-CLX.md](./MS-DOC-CLX.md) |
| §2.6 | CHPX/PAPX 字符与段落属性 | [MS-DOC-CHP-PAP.md](./MS-DOC-CHP-PAP.md) |
| §2.7 | 样式表 | 待补充 |
| §2.8 | 列表表 | 待补充 |
| §2.9 | 文档属性 | 待补充 |

---

## 9. 与项目实现的对照

### docParser.ts 实现状态

| 功能 | 状态 | 说明 |
|------|------|------|
| FIB 基础解析 | ⚠️ 部分 | 解析 fcClx/lcbClx 等关键字段，csw 链计算可能有问题 |
| Clx 解析 | ⚠️ 部分 | 已修复 PlcPcd 结构，支持多 piece 拼接，但仍缺 story 级严格分流 |
| 文本提取 | ⚠️ 部分 | 支持 UTF-16LE 和 8-bit 压缩，基于启发式 |
| CHP 字符格式 | ❌ 未实现 | 未解析 CHP 表，使用启发式推断 |
| PAP 段落格式 | ❌ 未实现 | 未解析 PAP 表，使用启发式推断 |
| 样式表 | ❌ 未实现 | |
| 表格 (Table) | ❌ 未实现 | 表格内容按段落平铺 |
| 页眉页脚 | ❌ 未实现 | 被跳过（设计选择） |
| 图片 | ❌ 未实现 | |
| 文档属性 | ❌ 未实现 | 未读取 SummaryInformation 流 |

### 现有实现特点

- 使用启发式规则推断格式（位置、长度 → 标题/正文）
- 支持编码自动检测（二进制模式 + 评分机制）
- Web Worker 支持大文件解析
- 有安全限制防止性能问题

---

## 10. 相关文档

- **OLE/CFB 底层格式**: [MS-CFB-SUMMARY.md](./MS-CFB-SUMMARY.md)
- **FIB 结构详解**: [MS-DOC-FIB.md](./MS-DOC-FIB.md)
- **Clx/Pcdt/PlcPcd 详解**: [MS-DOC-CLX.md](./MS-DOC-CLX.md)
- **项目架构**: [ARCHITECTURE.md](../ARCHITECTURE.md)
- **功能清单**: [FEATURES.md](../../FEATURES.md)
