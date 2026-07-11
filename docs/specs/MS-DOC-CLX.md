# [MS-DOC] Clx / Pcdt / PlcPcd 结构详解

> 规范章节: MS-DOC §2.5.6
> 规范版本: v12.5 (2026-02-17)
> 官方 PDF: https://officeprotocoldocs-f5hpbjgea6b8gneq.b02.azurefd.net/files/MS-DOC/%5bMS-DOC%5d.pdf

本文档详细说明 Word 二进制文档中 Clx（complex file information）、Pcdt（Piece Descriptor Table）和 PlcPcd（Piece Table）的结构。这是文本提取的核心结构。

---

## 1. 概述

Clx 结构存储在 0Table/1Table 流中，由 FIB 的 `fcClx` 和 `lcbClx` 字段定位。它包含：

1. **Pcdt** (Piece Descriptor Table) — 文本片段描述表，定义文档中文本的存储位置
2. **可选的 Prl** — 属性修改列表（格式信息）

### 核心概念：Piece Table

Word 文档的文本不是连续存储的，而是被分割成多个 "piece"（片段）。每个 piece：
- 在逻辑上是连续的字符
- 在物理上可能存储在文件的不同位置
- 有自己的编码方式（8-bit 压缩或 UTF-16LE）

这是 Word 实现"快速保存"（Fast Save）的基础。

---

## 2. Clx 结构

Clx 由以下部分组成：

```
+-----------------------+
| clxt (1 byte)         |  类型标志 = 0x02 表示 Pcdt
+-----------------------+
| lcb (4 bytes)         |  Pcdt 数据的字节数
+-----------------------+
| Pcdt (lcb bytes)      |  Piece Descriptor Table
+-----------------------+
```

### 字段说明

| 偏移 | 大小 | 字段名 | 说明 |
|------|------|--------|------|
| 0 | 1 | `clxt` | Clx 类型：0x01 = Prl, 0x02 = Pcdt |
| 1 | 4 | `lcb` | Pcdt 数据的字节数 |
| 5 | lcb | `pcdtData` | Pcdt 数据 |

> **注意**：clxt 可能有多个值交替出现（Pcdt 和 Prl 交替）。对于文本提取，我们只关心 clxt=0x02 的 Pcdt。

---

## 3. Pcdt 结构

Pcdt（Piece Descriptor Table）的结构：

```
+-----------------------+
| clxt (1 byte)         |  = 0x01 (Pcdt 内部的 clxt)
+-----------------------+
| reserved (2 bytes)    |  保留，必须为 0
+-----------------------+
| lcbPlcPcd (4 bytes)   |  PlcPcd 数据的字节数
+-----------------------+
| PlcPcd (variable)     |  Piece Table 数据
+-----------------------+
```

### 字段说明

| 相对偏移 | 大小 | 字段名 | 说明 |
|----------|------|--------|------|
| 0 | 1 | `clxt` | 必须为 0x01 |
| 1 | 2 | `reserved` | 保留字段，忽略 |
| 3 | 4 | `lcbPlcPcd` | PlcPcd 的字节数 |
| 7 | lcbPlcPcd | `plcPcdData` | PlcPcd 数据 |

> **重要**：跳过 reserved 后，PlcPcd 从 Pcdt 起始偏移 + 7 字节处开始。

---

## 4. PlcPcd 结构

PlcPcd（Piece Table）是真正的文本位置映射表。

```
+---------------------------+
| n (4 bytes)               |  piece 的数量
+---------------------------+
| rgCcp ((n+1)*4 bytes)     |  字符位置数组 (n+1 个 32-bit 值)
+---------------------------+
| rgPcd (n*8 bytes)         |  PCD 描述符数组 (n 个 8 字节条目)
+---------------------------+
```

### 4.1 n 字段

- 大小：4 字节（32-bit 无符号整数）
- 含义：piece 的数量
- rgCcp 有 **n+1** 个元素（n 个 piece 有 n+1 个边界）
- rgPcd 有 **n** 个元素

### 4.2 rgCcp 数组

- 大小：(n+1) × 4 字节
- 每个元素是一个 32-bit 无符号整数，表示字符位置
- `rgCcp[i]` = 第 i 个 piece 的起始字符位置
- `rgCcp[i+1]` = 第 i 个 piece 的结束字符位置
- 第 i 个 piece 的字符数 = `rgCcp[i+1] - rgCcp[i]`

**示例**（n=3，3 个 piece）：
```
rgCcp = [0, 100, 250, 400]

piece 0: 字符 0..99   (100 字符)
piece 1: 字符 100..249 (150 字符)
piece 2: 字符 250..399 (150 字符)
```

### 4.3 rgPcd 数组

- 大小：n × 8 字节
- 每个 PCD 条目 8 字节
- 第 i 个 PCD 条目对应第 i 个 piece

---

## 5. PCD 条目结构

每个 PCD（Piece Descriptor）条目 8 字节：

```
  0                   1                   2                   3
  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2
 +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 |        reserved (2 bytes)     |                               |
 +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+           fc (4 bytes)      +-+
 |                               |                               |
 +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 |        prm (2 bytes)          |
 +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### 字段说明

| 偏移 | 大小 | 字段名 | 说明 |
|------|------|--------|------|
| 0 | 2 | `reserved` | 保留/标志位，通常忽略 |
| 2 | 4 | `fc` | 文件偏移 + 压缩标志 |
| 6 | 2 | `prm` | 属性修饰符 (Property Modifier) |

---

### 5.1 fc 字段详解

fc (4 字节) 是一个编码的文件偏移值：

```
  3 3 2 2 2 2 2 2 2 2 2 2 1 1 1 1 1 1 1 1 1 1 0 0 0 0 0 0 0 0 0 0
  1 0 9 8 7 6 5 4 3 2 1 0 9 8 7 6 5 4 3 2 1 0 9 8 7 6 5 4 3 2 1 0
 +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 |f|                    actual file offset (30 bits)            |
 +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
  ^
  |
  +-- bit 30: fCompressed
```

| 位 | 名称 | 说明 |
|----|------|------|
| 31 | 未使用 | 应为 0 |
| 30 | `fCompressed` | 压缩标志：1 = 8-bit, 0 = UTF-16LE |
| 29-0 | `actual offset` | 在 WordDocument 流中的实际文件偏移 |

#### 计算实际偏移和字节数

```
fCompressed = (fc & 0x40000000) != 0
fcValue = fc & 0x3FFFFFFF   // 实际文件偏移

charCount = rgCcp[i+1] - rgCcp[i]  // 字符数

if fCompressed:
    // 8-bit 压缩格式，每个字符 1 字节
    byteCount = charCount
else:
    // UTF-16LE 格式，每个字符 2 字节
    byteCount = charCount * 2

// 文本在 WordDocument 流中的位置:
startByte = fcValue
endByte = fcValue + byteCount
```

---

### 5.2 prm 字段

prm (Property Modifier, 2 字节) 包含：
- 指向字符属性（CHP）的索引
- 格式修改信息

对于纯文本提取，可以忽略此字段。但要获取真实格式，需要解析 prm。

---

## 6. 多 Story 概念

PlcPcd 中的 piece 按 **story** 组织。Word 文档包含多个独立的文本区域（story）：

| Story 类型 | 说明 |
|------------|------|
| 主文档 (Main Document) | 正文内容，通常是第一个 piece |
| 页眉 (Header) | 每页顶部 |
| 页脚 (Footer) | 每页底部 |
| 脚注 (Footnote) | |
| 尾注 (Endnote) | |
| 批注 (Comment) | |
| 文本框 (Textbox) | |
| ... | ... |

> **重要**：第一个 piece 是主文档。后续 piece 对应其他 story。
> 如果只需要正文内容，只提取第一个 piece 即可。

---

## 7. 完整解析算法

```
function parseClx(clxData, wordDocData):
    result = ""
    offset = 0

    while offset < clxData.length:
        clxt = clxData[offset]
        offset += 1

        if clxt == 2:
            // Pcdt
            lcb = readUint32(clxData, offset)
            offset += 4

            // 解析 Pcdt
            pcdtStart = offset
            if clxData[pcdtStart] != 1:
                error "Pcdt clxt 不正确"

            // 跳过 2 字节 reserved
            lcbPlcPcd = readUint32(clxData, pcdtStart + 3)
            plcPcdStart = pcdtStart + 7

            // 解析 PlcPcd
            n = readUint32(clxData, plcPcdStart)

            // 读取 rgCcp (n+1 个)
            rgCcp = []
            for i = 0 to n:
                ccp = readUint32(clxData, plcPcdStart + 4 + i*4)
                rgCcp.append(ccp)

            // 读取 rgPcd (n 个)
            rgPcdStart = plcPcdStart + 4 + (n+1)*4

            // 提取第一个 piece (主文档)
            if n >= 1:
                charCount = rgCcp[1] - rgCcp[0]

                pcdOffset = rgPcdStart + 0*8
                fc = readUint32(clxData, pcdOffset + 2)
                fCompressed = (fc & 0x40000000) != 0
                fcValue = fc & 0x3FFFFFFF

                if fCompressed:
                    byteCount = charCount
                else:
                    byteCount = charCount * 2

                text = extractText(wordDocData, fcValue, byteCount, fCompressed)
                result = text

            break  // 找到 Pcdt 就可以停了

        elif clxt == 1:
            // Prl (属性修改列表)，跳过
            cb = readUint16(clxData, offset)
            offset += 2 + cb
        else:
            // 未知类型，终止
            break

    return result
```

---

## 8. 常见陷阱

### 8.1 Pcdt 中有 2 字节 reserved

Pcdt 的 clxt (1 字节) 之后有 **2 字节保留字段**，然后才是 lcbPlcPcd (4 字节)。
所以 PlcPcd 的起始偏移是 `pcdtStart + 1 + 2 + 4 = pcdtStart + 7`。

**易错点**：忘记跳过 2 字节 reserved，导致 lcbPlcPcd 读取错误。

### 8.2 rgCcp 有 n+1 个元素

n 个 piece 对应 n+1 个 ccp 边界值。
不要只读取 n 个 ccp 值。

### 8.3 fc 是编码的

fc 不是简单的文件偏移，bit 30 是压缩标志。
必须用 `fc & 0x3FFFFFFF` 获取实际偏移。

### 8.4 文本在 WordDocument 流中

Clx 结构在 0Table/1Table 流中，但文本数据在 WordDocument 流中。
fc 指向 WordDocument 流中的偏移。

### 8.5 piece 的顺序

rgCcp 是字符位置，rgPcd 对应的是物理存储位置。
piece 的物理存储顺序不一定与逻辑顺序一致。
必须按照字符顺序（rgCcp 的顺序）来拼接文本。

---

## 9. 项目实现状态

### docParser.ts 中的 parseClx

| 功能 | 状态 | 说明 |
|------|------|------|
| clxt 类型判断 | ✅ | 判断 clxt == 2 |
| Pcdt 跳过 reserved | ✅ | 已修复，跳过 2 字节 |
| lcbPlcPcd 读取 | ✅ | |
| n 字段读取 | ✅ | 已修复 |
| rgCcp 读取 (n+1个) | ✅ | |
| rgPcd 读取 | ✅ | |
| fc 压缩标志解析 | ✅ | fCompressed = (fc & 0x40000000) != 0 |
| 8-bit 编码文本提取 | ✅ | extractTextFromRange 支持 |
| UTF-16LE 编码文本提取 | ✅ | |
| 只提取主文档 (第一个 piece) | ✅ | 设计选择 |
| 多 piece 拼接 | ⚠️ | 只取第一个，不拼接多个 piece |
| 安全限制 (最大 piece 数) | ✅ | MAX_PIECE_COUNT = 1000 |
| 安全限制 (最大字符数) | ✅ | MAX_TOTAL_CHARS = 10MB |

### 历史问题（已修复）

- ❌ → ✅ Pcdt 偏移量错误（少跳过了 2 字节 reserved）
- ❌ → ✅ 缺少 n 字段读取，用"遇到 0 就停"判断
- ❌ → ✅ 32 位整数有符号溢出问题

---

## 10. 参考资料

- 官方规范: [MS-DOC.pdf](https://officeprotocoldocs-f5hpbjgea6b8gneq.b02.azurefd.net/files/MS-DOC/%5bMS-DOC%5d.pdf) §2.5.6
- 项目实现: [src/utils/docParser.ts](../../src/utils/docParser.ts) - `parseClx()` 方法
- 测试文件: [tests/clxParser.test.ts](../../tests/clxParser.test.ts)
- FIB 结构: [MS-DOC-FIB.md](./MS-DOC-FIB.md)
- 总览文档: [MS-DOC-SUMMARY.md](./MS-DOC-SUMMARY.md)
